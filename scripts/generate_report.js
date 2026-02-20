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
const USER_MAPPING = loadUserMapping();

// Environment variables
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const ZAI_API_KEY = process.env.ZAI_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// OpenAI Configuration
const API_KEY = ZAI_API_KEY || OPENAI_API_KEY;
const BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.z.ai/api/coding/paas/v4';
const MODEL_NAME = 'glm-4.7';

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
      date: new Date().toISOString().split('T')[0],
      channelSummary: '本日の会話はありません。',
      users: {}
    };
  }

  const messagesText = formattedMessages.join('\n');
  const today = new Date().toISOString().split('T')[0];

  const prompt = `以下はDiscordチャンネルでの対話ログです。このログを分析して、以下の形式で日報を生成してください。

対話ログ:
${messagesText}

JSON形式で出力してください:
{
  "date": "${today}",
  "channelSummary": "チャンネル全体の会話の要約",
  "users": {
    "ユーザーID": {
      "name": "表示名",
      "role": "参加者/運営/AIアシスタント",
      "progress": "開発の進捗がある場合は要約（ない場合は「なし」）",
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
- ユーザーIDはDiscordのユーザーIDを使用
- ユーザーごとの情報は実際の会話内容に基づいて抽出
- ボッチーや他AIからのアドバイスは「adviceReceived」に記録
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
    return JSON.parse(content);
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

  const dateStr = report.date || new Date().toISOString().split('T')[0];
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
    await execAsync('git push origin main', { cwd: repoDir });
    console.log('Git push successful.');
  } catch (error) {
    console.error(`Git operation failed: ${error}`);
  }
}

/**
 * Discordに通知を送る
 */
async function notifyDiscord(dateStr) {
  console.log('Sending notification to Discord...');
  const url = `https://discord.com/api/v10/channels/${CHANNEL_ID}/messages`;
  const headers = {
    'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
    'Content-Type': 'application/json'
  };

  const content = `📊 **DigiHara Daily Report (${dateStr})** が完成しました！
URL: https://discord-digihara-daily-report.vercel.app/
Pass: \`harappa2026\``;

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
    await notifyDiscord(report.date);
  } else {
    console.error('Failed to generate report.');
  }

  console.log('Done!');
}

main().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
