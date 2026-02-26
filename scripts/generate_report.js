#!/usr/bin/env node

/**
 * Discord Daily Report Generator (Node.js版)
 * Discordメッセージを取得して、日報を生成する。
 * 生成後、GitへのプッシュとDiscordへの通知を行う。
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const SKILL_DIR = path.join(__dirname, '..');
const CONFIG_DIR = path.join(SKILL_DIR, 'config');
const DATA_DIR = path.join(SKILL_DIR, 'data/reports');

// Load config files
const loadDiscordConfig = () => {
  const configPath = path.join(CONFIG_DIR, 'discord-config.json');
  try {
    const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return data.targetChannels?.test || '';
  } catch (error) {
    console.error('Warning: discord-config.json not found.');
    return '';
  }
};

const loadUserMapping = () => {
  const configPath = path.join(CONFIG_DIR, 'user-mapping.json');
  try {
    const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return data.users || {};
  } catch (error) {
    console.error('Warning: user-mapping.json not found.');
    return {};
  }
};

const CHANNEL_ID = loadDiscordConfig();
const NOTIFICATION_THREAD_ID = '1475108738456354816'; // 運営の記録スレッド
const USER_MAPPING = loadUserMapping();

// 除外ボットIDリスト（user-mapping.jsonのexcludedBotsから読み込む）
const EXCLUDED_BOT_IDS = (() => {
  const configPath = path.join(CONFIG_DIR, 'user-mapping.json');
  try {
    const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return data.excludedBots || [];
  } catch {
    return [];
  }
})();

// Environment variables
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const ZAI_API_KEY = process.env.ZAI_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// OpenAI Configuration
const API_KEY = ZAI_API_KEY || OPENAI_API_KEY;
const BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.z.ai/api/coding/paas/v4';
const MODEL_NAME = 'glm-4-plus';

/**
 * Discord APIからメッセージを取得
 */
async function getDiscordMessages(channelId, limit = 100) {
  if (!DISCORD_BOT_TOKEN) {
    console.error('Error: DISCORD_BOT_TOKEN is not set.');
    return [];
  }

  const url = `https://discord.com/api/v10/channels/${channelId}/messages`;
  const headers = {
    'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
    'Content-Type': 'application/json'
  };

  const allMessages = [];
  let hasMore = true;
  let lastId = null;
  const fetchLimit = 20;

  while (allMessages.length < limit && hasMore) {
    const params = new URLSearchParams({ limit: Math.min(fetchLimit, limit - allMessages.length).toString() });
    if (lastId) {
      params.append('before', lastId);
    }

    console.log(`Fetching batch... (current count: ${allMessages.length})`);

    try {
      const response = await fetch(`${url}?${params}`, { headers });
      if (response.ok) {
        const batch = await response.json();
        if (!batch || batch.length === 0) {
          hasMore = false;
        } else {
          allMessages.push(...batch);
          lastId = batch[batch.length - 1].id;
          if (batch.length < fetchLimit) {
            hasMore = false;
          }
        }
      } else {
        console.error(`Error fetching messages: ${response.status}`);
        console.error(await response.text());
        hasMore = false;
      }
    } catch (error) {
      console.error(`Exception during fetch: ${error}`);
      hasMore = false;
    }
  }

  // 過去24時間分のみを抽出（現在時刻から24時間前以降のメッセージ）
  const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000;
  const snowflakeEpoch = 1420070400000;

  const filteredMessages = allMessages.filter(msg => {
    const timestamp = (parseInt(msg.id) / 4194304) + snowflakeEpoch;
    return timestamp >= twentyFourHoursAgo;
  });

  return filteredMessages;
}

/**
 * 活動日の日付を返す（JST基準）
 * cron実行が深夜0時台のため、JST午前4時未満は前日を活動日とみなす
 */
function getActivityDate() {
  const jstNow = new Date(Date.now() + 9 * 60 * 60 * 1000); // UTC → JST
  const jstHour = jstNow.getUTCHours();
  if (jstHour < 4) {
    jstNow.setUTCDate(jstNow.getUTCDate() - 1);
  }
  return jstNow.toISOString().split('T')[0];
}

/**
 * LLMを使って日報を生成
 */
async function generateDailyReport(messages, userMapping) {
  if (!API_KEY) {
    console.error('Error: API Key (ZAI_API_KEY or OPENAI_API_KEY) is not set.');
    return null;
  }

  // メッセージを整形
  const formattedMessages = [];
  for (const msg of messages.reverse()) {
    const userId = msg.author.id;
    // 除外ボットはスキップ
    if (EXCLUDED_BOT_IDS.includes(userId)) {
      continue;
    }
    const userInfo = userMapping[userId] || {
      name: msg.author.username,
      role: '参加者'
    };
    const content = msg.content || '';
    if (content) {
      formattedMessages.push(`${userInfo.name} (${userInfo.role}): ${content}`);
    }
  }

  if (formattedMessages.length === 0) {
    console.log('No messages to report.');
    // 空の日報を返す
    return {
      date: getActivityDate(),
      channelSummary: '本日の会話はありません。',
      users: {}
    };
  }

  const messagesText = formattedMessages.join('\n');
  const activityDate = getActivityDate();

  // 各ユーザーの案件リストをプロンプト用テキストに変換
  const userProjectsText = Object.entries(userMapping)
    .filter(([id]) => !EXCLUDED_BOT_IDS.includes(id))
    .map(([id, info]) => {
      if (!info.projects || info.projects.length === 0) return null;
      const projectList = info.projects.map(p => `    - ${p.name}: ${p.description}`).join('\n');
      return `- ${info.name} (ID: ${id})\n${projectList}`;
    })
    .filter(Boolean)
    .join('\n');

  const prompt = `以下はDiscordチャンネルでの対話ログです。このログを分析して、以下の形式で日報を生成してください。

対話ログ:
${messagesText}

【各人の既知開発案件リスト】
${userProjectsText}

JSON形式で出力してください:
{
  "date": "${activityDate}",
  "channelSummary": "チャンネル全体の会話の要約",
  "users": {
    "DiscordユーザーID（数字のみ）": {
      "name": "表示名",
      "role": "運営/参加者",
      "projects": [
        {
          "name": "案件名",
          "description": "案件の説明",
          "progress": "本日のこの案件に関する進捗（会話ログに該当内容がない場合は「変化なし」）"
        }
      ],
      "interestsAndQuestions": "進捗以外の会話から興味や疑問を抽出（ない場合は「なし」）",
      "adviceReceived": [
        {
          "from": "アドバイスをくれた人の名前",
          "content": "アドバイス内容の要約"
        }
      ]
    }
  }
}

注意点:
- usersのキーは必ずDiscordのユーザーID（数字のみ）を使用すること。名前は使わない。
- ユーザーIDが不明な場合は「unknown_<名前>」形式を使用
- 各ユーザーの「projects」には【各人の既知開発案件リスト】に載っている案件をすべて含める
- ログ中に既知リストにない新規案件が登場した場合は、その案件もprojectsに追加する（descriptionは会話から推測して記載）
- 各案件のprogressには、その案件に関して本日実際にあった進捗・変化のみを書く（ない場合は「変化なし」）
- 文字列内の改行は生の改行コードではなく、必ず「\\n」にエスケープしてください。
- 文字列内のダブルクォーテーションは必ず「\\"」にエスケープしてください。
- JSONのみを出力（コードブロックや余計なテキストなし）`;

  console.log(`Generating report using model: ${MODEL_NAME}`);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000); // 2 minutes timeout

    const response = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: MODEL_NAME,
        messages: [
          {
            role: 'system',
            content: 'You are a helpful assistant that generates daily reports from Discord conversations. You accept input in Japanese and output JSON.'
          },
          { role: 'user', content: prompt }
        ],
        temperature: 0.3,
        max_tokens: 4096
      })
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`OpenAI API error: ${response.status}`);
      console.error(errorText);
      return null;
    }

    const data = await response.json();
    const content = data.choices[0].message.content;
    console.log("Raw LLM output:", content);

    // Strip markdown code blocks if present
    let cleanContent = content.trim();
    if (cleanContent.startsWith('```json')) {
      cleanContent = cleanContent.replace(/^```json\n?/, '').replace(/\n?```$/, '');
    } else if (cleanContent.startsWith('```')) {
      cleanContent = cleanContent.replace(/^```\n?/, '').replace(/\n?```$/, '');
    }

    return JSON.parse(cleanContent);
  } catch (error) {
    console.error(`Error generating report: ${error}`);
    return null;
  }
}

/**
 * 日報を保存
 */
function saveReport(report) {
  if (!report) return null;

  fs.mkdirSync(DATA_DIR, { recursive: true });

  const dateStr = report.date || getActivityDate();
  const filepath = path.join(DATA_DIR, `${dateStr}.json`);

  fs.writeFileSync(filepath, JSON.stringify(report, null, 2), 'utf8');
  console.log(`Report saved to: ${filepath}`);
  return filepath;
}

/**
 * Gitに変更をコミットしてプッシュ
 */
async function gitPushChanges(dateStr) {
  console.log('Pushing changes to Git...');
  const repoDir = SKILL_DIR;

  try {
    await execAsync('git add .', { cwd: repoDir });

    // コミットする変更があるか確認
    const { stdout: statusOutput } = await execAsync('git status --porcelain', { cwd: repoDir });
    if (!statusOutput.trim()) {
      console.log('No changes to commit.');
      return;
    }

    await execAsync(`git commit -m "chore: add daily report for ${dateStr}"`, { cwd: repoDir });

    const githubToken = process.env.GITHUB_TOKEN;
    if (githubToken) {
      const remoteUrl = `https://${githubToken}@github.com/akiratsukakoshi/discord-digihara-daily-report.git`;
      await execAsync(`git push ${remoteUrl} main`, { cwd: repoDir });
    } else {
      await execAsync('git push origin main', { cwd: repoDir });
    }

    console.log('Git push successful.');
  } catch (error) {
    console.error(`Git operation failed: ${error}`);
  }
}

/**
 * Discordに通知を送る
 */
async function notifyDiscord(report) {
  console.log('Sending notification to Discord...');
  const url = `https://discord.com/api/v10/channels/${NOTIFICATION_THREAD_ID}/messages`;
  const headers = {
    'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
    'Content-Type': 'application/json'
  };

  const content = `📊 **DigiHara Daily Report (${report.date})** が完成しました！
URL: https://discord-digihara-daily-report.vercel.app/
Pass: \`harappa2026\`

📝 **本日の概要**:
${report.channelSummary || 'なし'}`;

  const payload = { content };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    if (response.ok || response.status === 201) {
      console.log('Notification sent successfully.');
    } else {
      console.error(`Failed to send notification: ${response.status}`);
      console.error(await response.text());
    }
  } catch (error) {
    console.error(`Error sending notification: ${error}`);
  }
}

/**
 * メイン処理
 */
async function main() {
  console.log(`Starting Daily Report Task at ${new Date().toISOString()}`);

  if (!CHANNEL_ID) {
    console.error('Error: Could not load CHANNEL_ID from config.');
    process.exit(1);
  }

  console.log('Fetching Discord messages...');
  const messages = await getDiscordMessages(CHANNEL_ID);
  console.log(`Fetched ${messages.length} messages`);

  console.log('Generating daily report...');
  const report = await generateDailyReport(messages, USER_MAPPING);

  if (report) {
    console.log('Saving report...');
    const filepath = saveReport(report);

    // インデックスを更新（generate_index.jsがある場合）
    console.log('Updating index...');
    try {
      const indexPath = path.join(SKILL_DIR, 'scripts', 'generate_index.js');
      if (fs.existsSync(indexPath)) {
        await execAsync(`node ${indexPath}`, { cwd: SKILL_DIR });
      } else {
        console.log('Warning: generate_index.js not found.');
      }
    } catch (error) {
      console.error(`Error updating index: ${error}`);
    }

    // Git Push
    if (filepath) {
      await gitPushChanges(report.date);
    }

    // Discord Notification
    await notifyDiscord(report);
  } else {
    console.error('Failed to generate report.');
  }

  console.log('Done!');
}

main().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
