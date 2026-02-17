# Discord Daily Report Skill

毎日24:00（JST）にDiscordコミュニティの会話を自動記録・要約するskill。

## Features

- 🔔 **自動日報生成**: 毎日24:00にDiscordのメッセージ履歴を取得
- 📊 **進捗可視化**: 参加者ごとの進捗・興味・疑問を記録
- 💡 **アドバイス追跡**: ボッチーや他者からのアドバイスを記録
- 🔐 **Web閲覧**: パスワード保護されたWebインターフェース

## Directory Structure

```
discord-daily-report/
├── SKILL.md                    # Skillの説明
├── README.md                   # このファイル
├── config/
│   ├── discord-config.json     # Discord Bot設定
│   ├── user-mapping.json       # ユーザーマッピング
│   └── web-config.json         # Web設定
├── scripts/
│   ├── daily_report_task.md    # 日報生成タスク
│   └── generate_report.py      # （未使用）Pythonスクリプト
├── templates/
│   └── index.html              # Web閲覧インターフェース
└── data/
    └── reports/
        └── YYYY-MM-DD.json     # 日報データ
```

## Setup

### 1. Discord Bot

Discord Botは既に設定済み：
- **Bot Name:** gaku-co3.0
- **Bot ID:** 1467518015326130470
- **Test Channel:** 1473262637419593771

### 2. ユーザーマッピング

`config/user-mapping.json` にDiscordユーザーIDと表示名・ロールを追加：

```json
{
  "users": {
    "DISCORD_USER_ID": {
      "name": "表示名",
      "role": "参加者/運営/AIアシスタント"
    }
  }
}
```

### 3. Cron Job

Cron Jobは既に設定済み：
- **ID:** aeaaedde-4ac1-48fb-a9f0-114c3a2cc873
- **Schedule:** 毎日24:00 JST

### 4. Web閲覧

`templates/index.html` をブラウザで開く：
- デフォルトパスワード: `test123`（本番では変更）
- 日付で日報を切り替え可能

## Usage

### 手動実行

```bash
# OpenClawでsub-agentを起動
sessions_spawn --task "/home/node/.openclaw/workspace/skills/discord-daily-report/scripts/daily_report_task.md の内容に従って、Discord Daily Reportを生成してください。" --model "anthropic/claude-haiku-4-5-20251001"
```

### Cron Job管理

```bash
# Cron Job一覧
cron list

# Cron Job実行履歴
cron runs --jobId aeaaedde-4ac1-48fb-a9f0-114c3a2cc873

# 手動実行
cron run --jobId aeaaedde-4ac1-48fb-a9f0-114c3a2cc873
```

## Output Format

日報は以下のJSON形式で保存されます：

```json
{
  "date": "2026-02-17",
  "channelSummary": "チャンネル全体の会話の要約",
  "users": {
    "DISCORD_USER_ID": {
      "name": "表示名",
      "role": "参加者/運営/AIアシスタント",
      "progress": "開発の進捗の要約",
      "interestsAndQuestions": "興味・疑問の要約",
      "adviceReceived": [
        {
          "from": "アドバイスをくれた人の名前",
          "content": "アドバイス内容の要約"
        }
      ]
    }
  }
}
```

## Security

- Web閲覧はパスワード保護
- プライベートな会話は公開しない
- 本番環境ではパスワードを変更してください

## Future Enhancements

- [ ] Webホスティング（Vercel/GitHub Pages）
- [ ] リアルタイム更新
- [ ] 検索機能
- [ ] 過去の日報の比較
- [ ] 通知機能（Slack/Email）

## Credits

- **Developed by:** gaku-co & ガクチョ
- **Project:** デジタル原っぱ大学
