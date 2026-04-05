#!/usr/bin/env node

/**
 * Discord Daily Report Generator (Node.js版) - 本番版
 * 複数チャンネルのDiscordメッセージを取得して、日報を生成する。
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
    return {
      kichiCategoryId: data.kichiCategoryId || '',
      otherChannels: data.otherChannels || [],
      notificationThreadId: data.notificationThreadId || '',
      guildId: data.guildId || process.env.DISCORD_GUILD_ID || ''
    };
  } catch (error) {
    console.error('Warning: discord-config.json not found.');
    return null;
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

const DISCORD_CONFIG = loadDiscordConfig();
const USER_MAPPING = loadUserMapping();

// 除外ユーザーIDリスト
const EXCLUDED_IDS = (() => {
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
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID || '';
const ZAI_API_KEY = process.env.ZAI_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const API_KEY = ZAI_API_KEY || OPENAI_API_KEY;
const BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.z.ai/api/coding/paas/v4';
const MODEL_NAME = 'glm-4.7';

/**
 * Discord APIからメッセージを取得（過去24時間分）
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
    if (lastId) params.append('before', lastId);

    try {
      const response = await fetch(`${url}?${params}`, { headers });
      if (response.ok) {
        const batch = await response.json();
        if (!batch || batch.length === 0) {
          hasMore = false;
        } else {
          allMessages.push(...batch);
          lastId = batch[batch.length - 1].id;
          if (batch.length < fetchLimit) hasMore = false;
        }
      } else {
        console.error(`Error fetching messages from ${channelId}: ${response.status}`);
        hasMore = false;
      }
    } catch (error) {
      console.error(`Exception during fetch: ${error}`);
      hasMore = false;
    }
  }

  // 過去24時間分のみ抽出
  const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000;
  const snowflakeEpoch = 1420070400000;
  return allMessages.filter(msg => {
    const timestamp = (parseInt(msg.id) / 4194304) + snowflakeEpoch;
    return timestamp >= twentyFourHoursAgo;
  });
}

/**
 * 基地カテゴリ配下のテキストチャンネル一覧を取得
 */
async function getKichiChannels(guildId, categoryId) {
  if (!DISCORD_BOT_TOKEN || !guildId) {
    console.error('Warning: Cannot fetch kichi channels (missing guildId or token).');
    return [];
  }
  const url = `https://discord.com/api/v10/guilds/${guildId}/channels`;
  const headers = { 'Authorization': `Bot ${DISCORD_BOT_TOKEN}` };
  try {
    const response = await fetch(url, { headers });
    if (!response.ok) {
      console.error(`Error fetching guild channels: ${response.status}`);
      return [];
    }
    const channels = await response.json();
    // type=0: テキストチャンネル、parent_id: 所属カテゴリID
    return channels.filter(ch => ch.type === 0 && ch.parent_id === categoryId);
  } catch (e) {
    console.error(`Error fetching kichi channels: ${e}`);
    return [];
  }
}

/**
 * 活動日の日付を返す（JST基準）
 * cron実行が深夜0時台のため、JST午前4時未満は前日を活動日とみなす
 */
function getActivityDate() {
  const jstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const jstHour = jstNow.getUTCHours();
  if (jstHour < 4) jstNow.setUTCDate(jstNow.getUTCDate() - 1);
  return jstNow.toISOString().split('T')[0];
}


function buildAuthorDirectory(kichiMessagesMap, otherMessagesMap) {
  const dir = {};
  const all = [
    ...Object.values(kichiMessagesMap || {}),
    ...Object.values(otherMessagesMap || {})
  ];
  for (const msgs of all) {
    for (const msg of msgs || []) {
      const a = msg.author || {};
      if (!a.id) continue;
      dir[a.id] = {
        username: a.username || '',
        globalName: a.global_name || '',
        displayName: a.display_name || ''
      };
    }
  }
  return dir;
}

function mergeUserRecords(base = {}, incoming = {}) {
  const merged = { ...base };
  for (const [k, v] of Object.entries(incoming)) {
    if (v == null || v === '' || v === 'なし' || v === '未定') continue;
    if (Array.isArray(v)) {
      const current = Array.isArray(merged[k]) ? merged[k] : [];
      const seen = new Set(current.map(x => JSON.stringify(x)));
      for (const item of v) {
        const key = JSON.stringify(item);
        if (!seen.has(key)) {
          current.push(item);
          seen.add(key);
        }
      }
      merged[k] = current;
    } else if (!merged[k] || merged[k] === '' || merged[k] === 'なし' || merged[k] === '未定') {
      merged[k] = v;
    }
  }
  return merged;
}

function resolveUserId(rawId, user, authorDirectory) {
  if (/^\d{16,20}$/.test(rawId)) return rawId;

  // Case: model outputs short numeric suffix like "64330" from username "kazumik_64330"
  if (/^\d{3,10}$/.test(rawId)) {
    const suffix = `_${rawId}`;
    for (const [id, info] of Object.entries(authorDirectory)) {
      const uname = (info.username || '').toLowerCase();
      if (uname.endsWith(suffix.toLowerCase()) || uname.includes(suffix.toLowerCase())) {
        return id;
      }
    }
  }

  // Case: unknown_<name>
  if (rawId.startsWith('unknown_')) {
    const hinted = (rawId.replace(/^unknown_/, '') || user?.name || '').toLowerCase();
    if (hinted) {
      for (const [id, info] of Object.entries(authorDirectory)) {
        const cands = [info.username, info.globalName, info.displayName].filter(Boolean).map(v => v.toLowerCase());
        if (cands.some(v => v === hinted || v.includes(hinted) || hinted.includes(v))) return id;
      }
    }
  }

  return rawId;
}

/**
 * メッセージをテキストに整形（除外ユーザーをスキップ）
 */
function formatMessages(messages) {
  const lines = [];
  for (const msg of [...messages].reverse()) {
    if (EXCLUDED_IDS.includes(msg.author.id)) continue;
    const userInfo = USER_MAPPING[msg.author.id] || { name: msg.author.username, role: '参加者' };
    const content = msg.content || '';
    if (content) lines.push(`${userInfo.name} (${userInfo.role}): ${content}`);
  }
  return lines.join('\n');
}

/**
 * LLMを使って日報を生成（複数チャンネル対応）
 */
async function generateDailyReport(kichiMessagesMap, otherMessagesMap) {
  if (!API_KEY) {
    console.error('Error: API Key is not set.');
    return null;
  }

  // 基地チャンネルのメッセージをまとめる
  const kichiLines = [];
  for (const [chName, msgs] of Object.entries(kichiMessagesMap)) {
    const text = formatMessages(msgs);
    if (text) kichiLines.push(`【#${chName}】\n${text}`);
  }
  const kichiText = kichiLines.join('\n\n') || '（本日の発言なし）';

  // その他チャンネルのメッセージ
  const otherSections = [];
  for (const [chName, msgs] of Object.entries(otherMessagesMap)) {
    const text = formatMessages(msgs);
    otherSections.push({ name: chName, text: text || '（本日の発言なし）' });
  }
  const otherText = otherSections.map(s => `【#${s.name}】\n${s.text}`).join('\n\n') || '（本日の発言なし）';

  // ユーザープロジェクト情報
  const userProjectsText = Object.entries(USER_MAPPING)
    .filter(([id]) => !EXCLUDED_IDS.includes(id))
    .map(([id, info]) => {
      if (!info.projects || info.projects.length === 0) return null;
      const projectList = info.projects.map(p => `    - ${p.name}: ${p.description}`).join('\n');
      return `- ${info.name} (ID: ${id})\n${projectList}`;
    })
    .filter(Boolean)
    .join('\n');

  const activityDate = getActivityDate();
  const otherChannelNames = otherSections.map(s => s.name);

  const prompt = `以下はDiscordコミュニティの各チャンネルの対話ログです。このログを分析して、以下の形式で日報をJSON形式で生成してください。

=== 基地カテゴリのチャンネル（複数チャンネルをまとめて提供、参加者の進捗把握に使う）===
${kichiText}

=== その他のチャンネル（各チャンネルのサマリを生成する） ===
${otherText}

【各人の既知開発案件リスト】
${userProjectsText || '（なし）'}

JSON形式で出力してください（JSONのみ、コードブロックなし）:
{
  "date": "${activityDate}",
  "channelSummaries": {
${otherChannelNames.map(n => `    "${n}": "このチャンネルの要約"`).join(',\n')}
  },
  "users": {
    "DiscordユーザーID（数字のみ）": {
      "name": "表示名（自己紹介チャンネルで使っているニックネームがあればそれ、なければアカウント名）",
      "role": "運営/参加者",
      "theme": "開発テーマ名（基地のやり取りから推測、不明の場合は「未定」）",
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
- usersのキーは必ずDiscordのユーザーID（数字のみ）を使用。名前は使わない。
- ユーザーIDが不明な場合は「unknown_<名前>」形式を使用
- 除外ユーザー（ボッチー ID:1360187059544920115, ガクコ ID:1467518015326130470）はusersに含めない
- 各ユーザーの「projects」には【各人の既知開発案件リスト】の案件をすべて含める
- ログに既知リストにない新規案件が登場した場合はprojectsに追加する（descriptionは会話から推測）
- 運営ユーザー（ガクチョ・もっちゃん）はusers内で最後に記載すること
- 文字列内の改行は必ず「\\n」にエスケープ、ダブルクォートは「\\"」にエスケープ`;

  console.log(`Generating report using model: ${MODEL_NAME}`);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 300000);

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
        max_tokens: 32768
      })
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`API error: ${response.status}`);
      console.error(errorText);
      return null;
    }

    const data = await response.json();
    const content = data.choices[0].message.content;
    console.log('Raw LLM output:', content);

    let cleanContent = content.trim();
    if (cleanContent.startsWith('```json')) {
      cleanContent = cleanContent.replace(/^```json\n?/, '').replace(/\n?```$/, '');
    } else if (cleanContent.startsWith('```')) {
      cleanContent = cleanContent.replace(/^```\n?/, '').replace(/\n?```$/, '');
    }

    const report = JSON.parse(cleanContent);

    // LLMのユーザーIDゆれを補正（例: 64330 -> 1466317347374628929）
    const authorDirectory = buildAuthorDirectory(kichiMessagesMap, otherMessagesMap);
    const normalizedUsers = {};
    for (const [rawId, user] of Object.entries(report.users || {})) {
      const resolvedId = resolveUserId(rawId, user, authorDirectory);
      normalizedUsers[resolvedId] = normalizedUsers[resolvedId]
        ? mergeUserRecords(normalizedUsers[resolvedId], user)
        : user;
    }

    // DiscordユーザーID形式以外は除外
    for (const id of Object.keys(normalizedUsers)) {
      if (!/^\d{16,20}$/.test(id)) {
        console.warn(`Dropping non-discord user id from report: ${id}`);
        delete normalizedUsers[id];
      }
    }

    // 運営を最後にソート
    const nonManagement = Object.entries(normalizedUsers).filter(([, u]) => u.role !== '運営');
    const management = Object.entries(normalizedUsers).filter(([, u]) => u.role === '運営');
    const sortedUsers = {};
    [...nonManagement, ...management].forEach(([id, u]) => { sortedUsers[id] = u; });
    report.users = sortedUsers;

    return report;
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
 * Gitにコミットしてプッシュ
 */
async function gitPushChanges(dateStr) {
  console.log('Pushing changes to Git...');
  const repoDir = SKILL_DIR;
  try {
    await execAsync('git add .', { cwd: repoDir });
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
 * Discordに通知
 */
async function notifyDiscord(report) {
  const threadId = DISCORD_CONFIG?.notificationThreadId || '1475108738456354816';
  console.log('Sending notification to Discord...');
  const url = `https://discord.com/api/v10/channels/${threadId}/messages`;
  const headers = {
    'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
    'Content-Type': 'application/json'
  };

  // チャンネルサマリをまとめる
  const summaries = report.channelSummaries || {};
  const summaryText = Object.entries(summaries)
    .map(([ch, s]) => `• #${ch}: ${s}`)
    .join('\n') || report.channelSummary || 'なし';

  const content = `📊 **DigiHara Daily Report (${report.date})** が完成しました！
URL: https://discord-digihara-daily-report.vercel.app/
Pass: \`harappa2026\`

📝 **本日の概要**:
${summaryText}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ content })
    });
    if (response.ok || response.status === 201) {
      console.log('Notification sent successfully.');
    } else {
      console.error(`Failed to send notification: ${response.status}`);
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

  if (!DISCORD_CONFIG) {
    console.error('Error: Could not load discord config.');
    process.exit(1);
  }

  const { kichiCategoryId, otherChannels } = DISCORD_CONFIG;
  const effectiveGuildId = DISCORD_CONFIG.guildId || DISCORD_GUILD_ID;

  // 基地チャンネル一覧を取得
  console.log('Fetching kichi category channels...');
  const kichiChannels = await getKichiChannels(effectiveGuildId, kichiCategoryId);
  console.log(`Found ${kichiChannels.length} kichi channels: ${kichiChannels.map(c => c.name).join(', ')}`);

  // 基地チャンネルのメッセージを取得
  const kichiMessagesMap = {};
  for (const ch of kichiChannels) {
    console.log(`Fetching messages from kichi channel: #${ch.name}`);
    kichiMessagesMap[ch.name] = await getDiscordMessages(ch.id);
    console.log(`  → ${kichiMessagesMap[ch.name].length} messages`);
  }

  // その他チャンネルのメッセージを取得
  const otherMessagesMap = {};
  for (const ch of otherChannels) {
    console.log(`Fetching messages from channel: #${ch.name}`);
    otherMessagesMap[ch.name] = await getDiscordMessages(ch.id);
    console.log(`  → ${otherMessagesMap[ch.name].length} messages`);
  }

  const totalMessages = [
    ...Object.values(kichiMessagesMap),
    ...Object.values(otherMessagesMap)
  ].reduce((sum, msgs) => sum + msgs.length, 0);
  console.log(`Total messages fetched: ${totalMessages}`);

  console.log('Generating daily report...');
  const report = await generateDailyReport(kichiMessagesMap, otherMessagesMap);

  if (report) {
    console.log('Saving report...');
    const filepath = saveReport(report);

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

    const dryRun = process.argv.includes('--dry-run');
    if (!dryRun) {
      if (filepath) await gitPushChanges(report.date);
      await notifyDiscord(report);
    } else {
      console.log('Dry-run mode: skipped git push and Discord notification.');
    }
  } else {
    console.error('Failed to generate report.');
  }

  console.log('Done!');
}

main().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
