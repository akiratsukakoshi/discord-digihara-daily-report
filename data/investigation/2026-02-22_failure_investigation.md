# Discord Daily Report Skill 失敗要因調査

## 調査日時
2026-02-23 07:43 JST

## 問題の概要
Cron job `discord-daily-report` (ID: aeaaedde-4ac1-48fb-a9f0-114c3a2cc873) が連続してタイムアウトエラーを発生させている。
- Cron timeout設定: 300秒 (5分)
- 最後のエラー: "cron: job execution timed out"
- 対象スクリプト: `/home/node/.openclaw/workspace/skills/discord-daily-report/scripts/generate_report.js`

## 失敗要因分析

### 要因1: LLM APIタイムアウト設定が過剰に短い（最も可能性高い）
- **現状**: LLM APIコールに対して120秒（2分）のタイムアウトが設定されている
- **問題点**:
  - プロンプトが大きくなる場合、モデルの推論に2分以上かかる可能性がある
  - 120秒経過時点でAbortControllerが発火し、APIコールが強制終了される
  - エラーハンドリングでは`console.error`のみで、再試行が行われない
- **影響**: 生成中にタイムアウトした場合、`generateDailyReport`関数は`null`を返し、全体処理が失敗する

### 要因2: プロンプトサイズが過大になる可能性がある
- **現状**: 最大100件のメッセージを取得し、すべてがプロンプトに含まれる
- **問題点**:
  - 1メッセージ平均200文字と仮定すると、メッセージだけで約20,000文字
  - ユーザーごとの案件リストもプロンプトに追加される
  - `max_tokens: 4096`に対して、入力プロンプトが大きすぎると応答生成時間が増加
  - プロンプトサイズのログ出力がないため、実際のサイズが不明
- **影響**: プロンプトサイズが大きい場合、LLMの処理時間が長くなり、120秒タイムアウトに到達しやすくなる

### 要因3: メッセージ取得処理の遅延が積み重なる
- **現状**: Discord APIから最大100件のメッセージを20件ずつバッチで取得
- **問題点**:
  - `limit: 100` の場合、5回のAPIコールが必要（20件 × 5回）
  - 各APIコールごとにネットワークレイテンシーが発生
  - チャンネルが活発な場合、100件取得に数十秒かかる可能性
- **影響**: メッセージ取得だけで30秒以上かかる場合、残りの時間（270秒）でLLM生成・Git Push・通知処理を完結させる必要がある

### 要因4: Git Push処理の遅延
- **現状**: `git push origin main` を同期実行
- **問題点**:
  - リモートリポジトリの応答が遅い場合、処理がブロックされる
  - 事前に変更があるか確認する`git status --porcelain`が追加されているが、プッシュ自体のタイムアウト対策がない
- **影響**: Git Pushがハングまたは遅延すると、全体処理がタイムアウトする可能性がある

### 要因5: エラーハンドリングとロギングが不十分
- **現状**: LLM生成失敗時に`console.error`のみで終了
- **問題点**:
  - プロンプトサイズ、応答時間、APIレスポンスの詳細がログに出力されない
  - タイムアウト時の具体的な原因（ネットワークエラーかAPI側の遅延か）が不明
  - 失敗時に部分処理（例：保存済みファイル）が残る可能性がある
- **影響**: 再発防止に必要な診断情報が不足している

### 要因6: 再試行メカニズムがない
- **現状**: LLM APIコール、Git Push、Discord通知のいずれにも再試行がない
- **問題点**:
  - 一時的なネットワークエラーやAPIの一時的な遅延で処理が完全に失敗する
  - 運用担当者による手動再実行が必要
- **影響**: 信頼性が低く、運用負荷が増大する

## 推奨される解決策

### 1. LLM APIタイムアウトの延長と再試行（高優先度）
```javascript
// 現状: 120秒
const timeoutId = setTimeout(() => controller.abort(), 120000);

// 改善案: 240秒 + 再試行ロジック
const MAX_RETRIES = 2;
const TIMEOUT_MS = 240000; // 4分
```
- タイムアウトを240秒（4分）に延長（Cronの300秒内で収まる）
- 再試行回数を2回に設定
- 指数バックオフ（1回目失敗後3秒待機、2回目失敗後10秒待機）

### 2. プロンプトサイズの最適化（高優先度）
```javascript
// メッセージ数制限の追加
const MAX_MESSAGES_FOR_PROMPT = 50;
const messagesForPrompt = formattedMessages.slice(-MAX_MESSAGES_FOR_PROMPT);

// プロンプトサイズをログに出力
console.log(`Prompt size: ${prompt.length} characters`);
```
- プロンプトに使用するメッセージを最新50件に制限
- ユーザー案件リストも同様に文字数制限を設ける
- プロンプトサイズをログに出力してモニタリング可能にする

### 3. 進捗ログの強化（中優先度）
```javascript
console.log(`[${new Date().toISOString()}] LLM request: ${prompt.length} chars`);
const startTime = Date.now();
// ... APIコール ...
const duration = Date.now() - startTime;
console.log(`[${new Date().toISOString()}] LLM response received in ${duration}ms`);
console.log(`[${new Date().toISOString()}] Response tokens: ${data.usage?.total_tokens || 'unknown'}`);
```
- 各処理の開始・終了時刻を出力
- LLM応答時間とトークン数をログに記録

### 4. Git Pushを非同期・バックグラウンド実行化（中優先度）
```javascript
// Git Pushを非同期化
gitPushChanges(report.date).catch(err => {
  console.error('Git push failed (non-critical):', err);
});
```
- Git Pushを必須処理から外し、失敗しても日報生成自体は成功とみなす
- バックグラウンド実行して、メイン処理のタイムアウトを防ぐ

### 5. メッセージ取得数の動的調整（低優先度）
```javascript
// 前日の実績に基づいて取得数を調整
const limit = isHighActivityDay ? 100 : 50;
```
- チャンネルの活動量に応じて取得数を動的に調整
- 平日は50件、週末は100件など

### 6. 通知処理のタイムアウト設定（低優先度）
```javascript
// Discord通知にタイムアウトを追加
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 30000); // 30秒

const response = await fetch(url, {
  method: 'POST',
  headers,
  body: JSON.stringify(payload),
  signal: controller.signal
});
```
- Discord通知もタイムアウトを設定して、全体処理がハングしないようにする

## 優先度と次のアクション

### 高優先度（即時実施）
1. **LLM APIタイムアウトを120秒→240秒に延長**
   - ファイル: `generate_report.js` の `generateDailyReport` 関数
   - 行番号: 約152行目
2. **LLM APIに再試行ロジックを追加**
   - 最大2回の再試行、指数バックオフ付き
3. **プロンプトサイズをログ出力**
   - 問題発生時の診断に活用

### 中優先度（今週中に実施）
1. **プロンプトに使用するメッセージ数を50件に制限**
   - 処理時間の短縮と安定性向上
2. **Git Pushを非同期実行化**
   - メイン処理のタイムアウトリスク低減
3. **各処理の進捗ログを強化**
   - ボトルネック特定のための詳細ログ

### 低優先度（来週以降）
1. **メッセージ取得数の動的調整機能の実装**
2. **Discord通知処理のタイムアウト設定**
3. **アラート通知機能の実装**
   - 失敗時に管理者へ通知（Slack/Discord等）

---

**追記（2026-02-23 08:00 JST）**: 調査完了。主な原因はLLM APIの120秒タイムアウトが過短であることと、プロンプトサイズが過大になる可能性である。高優先度の対策2件を実施することで、即座に改善が見込まれる。
