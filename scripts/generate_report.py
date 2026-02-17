#!/usr/bin/env python3
"""
Discord Daily Report Generator

Discordメッセージを取得して、日報を生成する
"""

import json
import os
from datetime import datetime, timedelta
import requests
from openai import OpenAI

# Configuration
DISCORD_BOT_TOKEN = os.getenv("DISCORD_BOT_TOKEN")
CHANNEL_ID = "1473262637419593771"
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

def get_discord_messages(channel_id, limit=100):
    """Discord APIからメッセージを取得"""
    url = f"https://discord.com/api/v10/channels/{channel_id}/messages"
    headers = {
        "Authorization": f"Bot {DISCORD_BOT_TOKEN}",
        "Content-Type": "application/json"
    }

    response = requests.get(url, headers=headers, params={"limit": limit})
    if response.status_code == 200:
        return response.json()
    else:
        print(f"Error fetching messages: {response.status_code}")
        print(response.text)
        return []

def load_user_mapping():
    """ユーザーマッピングを読み込む"""
    with open("/home/node/.openclaw/workspace/skills/discord-daily-report/config/user-mapping.json") as f:
        data = json.load(f)
        return data.get("users", {})

def generate_daily_report(messages, user_mapping):
    """LLMを使って日報を生成"""
    client = OpenAI(api_key=OPENAI_API_KEY)

    # メッセージを整形
    formatted_messages = []
    for msg in reversed(messages):
        user_id = msg["author"]["id"]
        user_info = user_mapping.get(user_id, {"name": msg["author"]["username"], "role": "参加者"})
        formatted_messages.append(f"{user_info['name']} ({user_info['role']}): {msg['content']}")

    messages_text = "\n".join(formatted_messages)

    # LLMに投げるプロンプト
    prompt = f"""
以下はDiscordチャンネルでの対話ログです。このログを分析して、以下の形式で日報を生成してください。

対話ログ:
{messages_text}

JSON形式で出力してください:
{{
  "date": "YYYY-MM-DD",
  "channelSummary": "チャンネル全体の会話の要約",
  "users": {{
    "ユーザーID": {{
      "name": "表示名",
      "role": "参加者/運営/AIアシスタント",
      "progress": "開発の進捗がある場合は要約（ない場合は「なし」）",
      "interestsAndQuestions": "進捗以外の会話から興味や疑問を抽出（ない場合は「なし」）",
      "adviceReceived": [
        {{
          "from": "アドバイスをくれた人の名前",
          "content": "アドバイス内容の要約"
        }}
      ]
    }}
  }}
}}

注意点:
- ユーザーIDはDiscordのユーザーIDを使用
- ユーザーごとの情報は実際の会話内容に基づいて抽出
- ボッチーや他AIからのアドバイスは「adviceReceived」に記録
- JSONのみを出力（コードブロックや余計なテキストなし）
"""

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": "You are a helpful assistant that generates daily reports from Discord conversations."},
            {"role": "user", "content": prompt}
        ],
        temperature=0.3,
        response_format={"type": "json_object"}
    )

    return json.loads(response.choices[0].message.content)

def save_report(report):
    """日報を保存"""
    data_dir = "/home/node/.openclaw/workspace/skills/discord-daily-report/data/reports"
    os.makedirs(data_dir, exist_ok=True)

    date_str = datetime.now().strftime("%Y-%m-%d")
    filepath = os.path.join(data_dir, f"{date_str}.json")

    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    print(f"Report saved to: {filepath}")

def main():
    """メイン処理"""
    print("Fetching Discord messages...")
    messages = get_discord_messages(CHANNEL_ID)
    print(f"Fetched {len(messages)} messages")

    print("Loading user mapping...")
    user_mapping = load_user_mapping()

    print("Generating daily report...")
    report = generate_daily_report(messages, user_mapping)

    print("Saving report...")
    save_report(report)

    # インデックスを更新
    print("Updating index...")
    # 同じディレクトリにある generate_index.py をインポートして実行
    try:
        import generate_index
        generate_index.generate_index()
    except ImportError:
        print("Warning: Could not import generate_index script.")
    except Exception as e:
        print(f"Error updating index: {e}")

    print("Done!")
    print(json.dumps(report, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()
