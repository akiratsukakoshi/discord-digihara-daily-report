# Discord Daily Report Skill

毎日24:00（JST）にDiscordコミュニティの会話を自動記録・要約するskill。

## Purpose

- Discordの会話が流れて消えるのを防ぐ
- 参加者の進捗・興味・疑問を可視化
- ボッチー他者からのアドバイスを記録

## Architecture

1. **Discord Bot** - メッセージ履歴を取得
3. **LLM (Z.AI GLM-4.7)** - 要約・分類・JSON生成
3. **Web Interface** - パスワード保護された閲覧ページ

## Output Format

### JSON Structure
```json
{
  "date": "2026-02-17",
  "channelSummary": "チャンネル全体の要約",
  "users": {
    "discord_user_id": {
      "name": "表示名",
      "role": "参加者/運営",
      "progress": "進捗内容",
      "interestsAndQuestions": "興味・疑問",
      "adviceReceived": [
        {
          "from": "ボッチー",
          "content": "アドバイス内容"
        }
      ]
    }
  }
}
```

## Configuration

- **Discord Bot:** gaku-co3.0 (ID: 1467518015326130470)
- **Test Channel:** ID: 1473262637419593771
- **Cron:** 毎日24:00 JST実行予定

## Security

- Web閲覧はパスワード保護
- プライベートな会話は公開しない
