# Discord Daily Report Generation Task

あなたはDiscord Daily Reportを生成するエージェントです。

## Task

以下の手順で日報を生成してください：

1. **日報生成スクリプトの実行**
   - 以下のコマンドを実行して、メッセージ取得・生成・保存・GitPush・通知を一括で行う。
   - `bash scripts/run_daily.sh`
   - エラーが発生した場合は、エラーメッセージを確認して対処する。

2. **(完了)**
   - スクリプトが正常終了すればタスク完了です。

   - Gitに変更をPushする：
     - 環境変数 `GITHUB_TOKEN` を使用して認証を行う
     - コマンド例: `git push https://<GITHUB_TOKEN>@github.com/akiratsukakoshi/discord-digihara-daily-report.git main`
     - コミットメッセージ: `chore: add daily report for YYYY-MM-DD`

## JSON Format

```json
{
  "date": "YYYY-MM-DD",
  "channelSummary": "チャンネル全体の会話の要約",
  "users": {
    "DISCORD_USER_ID": {
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
```

## 注意点

- メッセージが空の場合は、適切な空の日報を生成
- ユーザーマッピングにないユーザーはDiscordの表示名を使用
- ボッチーや他AIからのアドバイスは「adviceReceived」に記録
- JSONは常に有効な形式であること

## Git Push

日報を保存した後、以下の手順でgit pushを行ってください：

1. **cdでskillディレクトリに移動**
   ```bash
   cd /home/node/.openclaw/workspace/skills/discord-daily-report
   ```

2. **git addで変更を追加**
   ```bash
   git add data/reports/YYYY-MM-DD.json
   ```

3. **git commitでコミット**
   ```bash
   git commit -m "Daily report: YYYY-MM-DD"
   ```

4. **git pushでリモートにpush**
   ```bash
   git push
   ```

## Discord通知

git pushの後、Discordチャンネル（ID: 1466318222843318282）に通知を送ってください：

### 通知内容

以下の形式で通知を送信：

```
📊 Discord Daily Report - {YYYY-MM-DD}

【全体の要約】
{channelSummary}

【ユーザー別】
{usersの内容を簡潔に表示}

🔗 Web閲覧: https://discord-digihara-daily-report.vercel.app/
```

### 方法

message toolを使って送信（action=send, channel=discord, to=1466318222843318282）

- channelSummaryはそのまま表示
- usersは各ユーザーのprogress・interestsAndQuestions・adviceReceivedを簡潔に表示
- 長すぎる場合は要約して表示
