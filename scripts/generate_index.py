#!/usr/bin/env python3
"""
Generate Report Index

data/reports/ ディレクトリ内のJSONファイルをスキャンし、
data/index.json を生成する。
"""

import json
import os
import glob
from datetime import datetime

def generate_index():
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    reports_dir = os.path.join(base_dir, "data", "reports")
    index_file = os.path.join(base_dir, "data", "index.json")
    
    # JSONファイルを取得
    report_files = glob.glob(os.path.join(reports_dir, "*.json"))
    
    # 日付リストを作成（ファイル名から抽出）
    dates = []
    for filepath in report_files:
        filename = os.path.basename(filepath)
        date_str = os.path.splitext(filename)[0]
        try:
            # 日付形式のチェック（YYYY-MM-DD）
            datetime.strptime(date_str, "%Y-%m-%d")
            dates.append(date_str)
        except ValueError:
            print(f"Skipping invalid filename: {filename}")
            continue
            
    # 新しい順にソート
    dates.sort(reverse=True)
    
    # index.json を書き出し
    with open(index_file, "w", encoding="utf-8") as f:
        json.dump({"dates": dates, "updatedAt": datetime.now().isoformat()}, f, ensure_ascii=False, indent=2)
        
    print(f"Generated index.json with {len(dates)} reports.")
    print(f"Path: {index_file}")

if __name__ == "__main__":
    generate_index()
