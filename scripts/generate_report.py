#!/usr/bin/env python3
"""
Discord Daily Report Generator

Discordメッセージを取得して、日報を生成する。
生成後、GitへのプッシュとDiscordへの通知を行う。
"""

import json
import os
import sys
import subprocess
from datetime import datetime, timedelta
import requests
from openai import OpenAI

# Configuration
# Load from environment (set by run_daily.sh or manually source .env)
DISCORD_BOT_TOKEN = os.getenv("DISCORD_BOT_TOKEN")
ZAI_API_KEY = os.getenv("ZAI_API_KEY")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

# Load channel ID from config file
def load_discord_config():
    """Discord設定を読み込む"""
    config_path = os.path.join(os.path.dirname(__file__), "../config/discord-config.json")
    try:
        with open(config_path) as f:
            data = json.load(f)
            return data.get("targetChannels", {}).get("test", "")
    except FileNotFoundError:
        print("Warning: discord-config.json not found.")
        return ""

CHANNEL_ID = load_discord_config()
if not CHANNEL_ID:
    print("Error: Could not load CHANNEL_ID from config.")
    sys.exit(1)

# Determine API Key and Base URL
API_KEY = ZAI_API_KEY or OPENAI_API_KEY
BASE_URL = os.getenv("OPENAI_BASE_URL", "https://api.z.ai/api/coding/paas/v4")
MODEL_NAME = "glm-4.7"

def get_discord_messages(channel_id, limit=100):
    """Discord APIからメッセージを取得"""
    if not DISCORD_BOT_TOKEN:
        print("Error: DISCORD_BOT_TOKEN is not set.")
        return []

    url = f"https://discord.com/api/v10/channels/{channel_id}/messages"
    headers = {
        "Authorization": f"Bot {DISCORD_BOT_TOKEN}",
        "Content-Type": "application/json"
    }

    # 過去24時間分のメッセージを取得するためにlimitを多めに設定するか、
    # timestampでフィルタリングするロジックが必要だが、まずはlimitで簡易実装
    # 本来は after/before パラメータや timestamp 判定が必要
    all_messages = []
    has_more = True
    last_id = None
    fetch_limit = 20  # Batch size
    
    while len(all_messages) < limit and has_more:
        params = {"limit": min(fetch_limit, limit - len(all_messages))}
        if last_id:
            params["before"] = last_id
            
        print(f"Fetching batch... (current count: {len(all_messages)})")
        try:
            response = requests.get(url, headers=headers, params=params)
            if response.status_code == 200:
                batch = response.json()
                if not batch:
                    has_more = False
                else:
                    all_messages.extend(batch)
                    last_id = batch[-1]["id"]
                    # If we got fewer than requested, we reached the end
                    if len(batch) < params["limit"]:
                        has_more = False
            else:
                print(f"Error fetching messages: {response.status_code}")
                print(response.text)
                has_more = False
        except Exception as e:
            print(f"Exception during fetch: {e}")
            has_more = False
            
    return all_messages

def load_user_mapping():
    """ユーザーマッピングを読み込む"""
    config_path = os.path.join(os.path.dirname(__file__), "../config/user-mapping.json")
    try:
        with open(config_path) as f:
            data = json.load(f)
            return data.get("users", {})
    except FileNotFoundError:
        print("Warning: user-mapping.json not found.")
        return {}

def generate_daily_report(messages, user_mapping):
    """LLMを使って日報を生成"""
    if not API_KEY:
        print("Error: API Key (ZAI_API_KEY or OPENAI_API_KEY) is not set.")
        return None

    client = OpenAI(api_key=API_KEY, base_url=BASE_URL)

    # 日付フィルタ（JSTで昨日24:00〜今日24:00、つまり今日の00:00~23:59と仮定、または実行時点から24時間前）
    # 簡易的に、取得した全メッセージを投げる（数が多すぎなければ）
    
    # メッセージを整形
    formatted_messages = []
    for msg in reversed(messages):
        # Bot自身のメッセージは除外してもいいが、AIアシスタントの発言も含めるならそのまま
        user_id = msg["author"]["id"]
        user_info = user_mapping.get(user_id, {"name": msg["author"]["username"], "role": "参加者"})
        content = msg.get("content", "")
        # Embedなどは無視
        if content:
            formatted_messages.append(f"{user_info['name']} ({user_info['role']}): {content}")

    if not formatted_messages:
        print("No messages to report.")
        return None

    messages_text = "\n".join(formatted_messages)

    # LLMに投げるプロンプト
    prompt = f"""
以下はDiscordチャンネルでの対話ログです。このログを分析して、以下の形式で日報を生成してください。

対話ログ:
{messages_text}

JSON形式で出力してください:
{{
  "date": "{datetime.now().strftime('%Y-%m-%d')}",
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

    print(f"Generating report using model: {MODEL_NAME}")
    try:
        response = client.chat.completions.create(
            model=MODEL_NAME,
            messages=[
                {"role": "system", "content": "You are a helpful assistant that generates daily reports from Discord conversations. You accept input in Japanese and output JSON."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.3,
            response_format={"type": "json_object"}
        )
        return json.loads(response.choices[0].message.content)
    except Exception as e:
        print(f"Error generating report: {e}")
        return None

def save_report(report):
    """日報を保存"""
    if not report:
        return None
        
    data_dir = os.path.join(os.path.dirname(__file__), "../data/reports")
    os.makedirs(data_dir, exist_ok=True)

    date_str = report.get("date", datetime.now().strftime("%Y-%m-%d"))
    filepath = os.path.join(data_dir, f"{date_str}.json")

    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    print(f"Report saved to: {filepath}")
    return filepath

def git_push_changes(date_str):
    """変更をGitにコミットしてプッシュ"""
    print("Pushing changes to Git...")
    repo_dir = os.path.join(os.path.dirname(__file__), "..")
    try:
        subprocess.run(["git", "add", "."], cwd=repo_dir, check=True)
        # コミットする変更があるか確認
        status = subprocess.run(["git", "status", "--porcelain"], cwd=repo_dir, capture_output=True, text=True)
        if not status.stdout.strip():
            print("No changes to commit.")
            return

        subprocess.run(["git", "commit", "-m", f"chore: add daily report for {date_str}"], cwd=repo_dir, check=True)
        subprocess.run(["git", "push", "origin", "main"], cwd=repo_dir, check=True)
        print("Git push successful.")
    except subprocess.CalledProcessError as e:
        print(f"Git operation failed: {e}")

def notify_discord(date_str):
    """Discordに通知を送る"""
    print("Sending notification to Discord...")
    url = f"https://discord.com/api/v10/channels/{CHANNEL_ID}/messages"
    headers = {
        "Authorization": f"Bot {DISCORD_BOT_TOKEN}",
        "Content-Type": "application/json"
    }
    
    content = f"""📊 **DigiHara Daily Report ({date_str})** が完成しました！
URL: https://discord-digihara-daily-report.vercel.app/
Pass: `harappa2026`"""

    payload = {"content": content}
    
    try:
        response = requests.post(url, headers=headers, json=payload)
        if response.status_code == 200 or response.status_code == 201:
            print("Notification sent successfully.")
        else:
            print(f"Failed to send notification: {response.status_code}")
            print(response.text)
    except Exception as e:
        print(f"Error sending notification: {e}")

def main():
    """メイン処理"""
    print(f"Starting Daily Report Task at {datetime.now()}")

    print("Fetching Discord messages...")
    messages = get_discord_messages(CHANNEL_ID)
    print(f"Fetched {len(messages)} messages")

    print("Loading user mapping...")
    user_mapping = load_user_mapping()

    print("Generating daily report...")
    report = generate_daily_report(messages, user_mapping)

    if report:
        print("Saving report...")
        save_report(report)

        # インデックスを更新
        print("Updating index...")
        try:
            import generate_index
            generate_index.generate_index()
        except ImportError:
            print("Warning: Could not import generate_index script.")
        except Exception as e:
            print(f"Error updating index: {e}")

        # Git Push
        git_push_changes(report.get("date"))

        # Discord Notification
        notify_discord(report.get("date"))
    else:
        print("Failed to generate report.")

    print("Done!")

if __name__ == "__main__":
    main()
