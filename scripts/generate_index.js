#!/usr/bin/env node

/**
 * Generate Report Index
 *
 * data/reports/ ディレクトリ内のJSONファイルをスキャンし、
 * data/index.json を生成する。
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function generateIndex() {
  const baseDir = path.join(__dirname, '..');
  const reportsDir = path.join(baseDir, 'data', 'reports');
  const indexFile = path.join(baseDir, 'data', 'index.json');

  // JSONファイルを取得
  const files = fs.readdirSync(reportsDir).filter(f => f.endsWith('.json'));

  // 日付リストを作成（ファイル名から抽出、YYYY-MM-DD形式のみ）
  const dates = [];
  for (const file of files) {
    const dateStr = path.basename(file, '.json');
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      dates.push(dateStr);
    } else {
      console.log(`Skipping invalid filename: ${file}`);
    }
  }

  // 新しい順にソート
  dates.sort((a, b) => b.localeCompare(a));

  // index.json を書き出し
  const index = { dates, updatedAt: new Date().toISOString() };
  fs.writeFileSync(indexFile, JSON.stringify(index, null, 2), 'utf8');

  console.log(`Generated index.json with ${dates.length} reports.`);
  console.log(`Path: ${indexFile}`);
}

generateIndex();
