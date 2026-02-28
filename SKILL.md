# Discord Daily Report Skill

毎日24:00（JST）にDiscordコミュニティの会話を自動記録・要約するskill。

## Purpose

- Discordの会話が流れて消えるのを防ぐ
- 参加者の進捗・興味・疑問を可視化
- アドバイスを記録

## Architecture

1. **Discord Bot** - 複数チャンネルのメッセージ履歴を取得
2. **LLM (Z.AI GLM-4-plus)** - 要約・分類・JSON生成
3. **Web Interface** - パスワード保護された閲覧ページ

## 対象チャンネル

- **基地カテゴリ（動的取得）**: カテゴリID `1473574389118271580` 配下の全テキストチャンネル（サマリ不要）
- **固定チャンネル（サマリ生成あり）**:
  - #自己紹介 `1466307902611390579`
  - #開発ラボ `1466309042346655755`
  - #成果物 `1466308993642135635`
  - #雑談 `1466308919197565111`
  - #質問箱 `1476829649798565959`

## 除外ユーザー

- ボッチー `1360187059544920115`
- ガクコ（gaku-co3.0） `1467518015326130470`

## Output Format

```json
{
  "date": "2026-02-28",
  "channelSummaries": {
    "自己紹介": "チャンネルのサマリ",
    "開発ラボ": "チャンネルのサマリ",
    "成果物": "チャンネルのサマリ",
    "雑談": "チャンネルのサマリ",
    "質問箱": "チャンネルのサマリ"
  },
  "users": {
    "discord_user_id": {
      "name": "表示名",
      "role": "参加者/運営",
      "theme": "開発テーマ（不明な場合は「未定」）",
      "projects": [
        {
          "name": "案件名",
          "description": "案件の説明",
          "progress": "本日の進捗"
        }
      ],
      "interestsAndQuestions": "興味・疑問",
      "adviceReceived": [
        {
          "from": "アドバイスをくれた人",
          "content": "アドバイス内容"
        }
      ]
    }
  }
}
```

表示順: 参加者 → 運営（ガクチョ・もっちゃん）

## Configuration

- **Discord Bot:** gaku-co3.0 (ID: 1467518015326130470)
- **Guild ID:** 1466302866854641824
- **Notification Thread:** ID: 1475108738456354816
- **Cron:** 毎日24:00 JST実行

## 必要な環境変数（.env）

- `DISCORD_BOT_TOKEN`: Discordボットトークン
- `DISCORD_GUILD_ID`: DiscordサーバーのギルドID（`1466302866854641824`）
- `ZAI_API_KEY`: Z.AI APIキー
- `GITHUB_TOKEN`: GitHub Personal Access Token

## Security

- Web閲覧はパスワード保護
