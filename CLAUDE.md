# CLAUDE.md

このファイルは Claude Code がこのリポジトリで作業するときの **入口** です。
詳細は `docs/claude/` 配下にテーマ別で分割しているので、タスクに応じて該当するものだけを開いてください。

## このプロジェクト

**Nested Form Builder** — 最大 11 階層のネスト構造を持つフォームを視覚的に設計し、スタンドアロン HTML を Google Apps Script Web アプリとして配信するツール。回答は Google Sheets に保存し、ファイルは Google Drive に格納、Google Doc / PDF / Gmail 出力、ブラウザ内 AlaSQL によるダッシュボード集計に対応。

**スタック**: React 19 + Vite 7 (`vite-plugin-singlefile` で単一 HTML 化) / Google Apps Script V8 / Google Sheets + Drive + Gmail + People API / IndexedDB / clasp デプロイ

## 全体把握

大きめのタスクに着手する前に、`/understand-anything:understand-dashboard` スキルでナレッジグラフを開いてアーキテクチャ全体を俯瞰すること。

## ナビゲーション（必要なときだけ開く）

| やりたいこと | 参照先 |
| --- | --- |
| 全体像・データフロー・Provider・保存先の分担 | [docs/claude/architecture.md](./docs/claude/architecture.md) |
| フロント / バックの機能モジュールを俯瞰したい | [docs/claude/feature-map.md](./docs/claude/feature-map.md) |
| ファイルがどこにあるか当たりをつけたい | [docs/claude/repo-structure.md](./docs/claude/repo-structure.md) |
| `doGet` / `doPost` / `ACTION_DEFINITIONS_` / `nfb*` 公開 API | [docs/claude/apps-script-backend.md](./docs/claude/apps-script-backend.md) |
| 外部アクションボタンの payload 契約（検索一覧/単票・子フォーム有無） | [docs/claude/apps-script-backend.md](./docs/claude/apps-script-backend.md) |
| ルート定義・対応フィールドタイプ | [docs/claude/routing.md](./docs/claude/routing.md) |
| 初回セットアップ | [docs/claude/setup.md](./docs/claude/setup.md) |
| 日常の dev / build / GAS 同期コマンド | [docs/claude/development-workflow.md](./docs/claude/development-workflow.md) |
| `deploy.ps1` のオプションと手動デプロイ | [docs/claude/deployment.md](./docs/claude/deployment.md) |
| テスト配置・実行コマンド | [docs/claude/testing.md](./docs/claude/testing.md) |
| 検索クエリ構文 | [docs/claude/search-query-syntax.md](./docs/claude/search-query-syntax.md) |
| テンプレートトークン（alasql 関数式） | [docs/claude/drive-template-tokens.md](./docs/claude/drive-template-tokens.md) |
| スキーマ / シートレイアウト / 日時 / ソフトデリート | [docs/claude/data-model.md](./docs/claude/data-model.md) |
| キャッシュ階層と差分同期・オフライン保存 | [docs/claude/cache-architecture.md](./docs/claude/cache-architecture.md) |
| 参照（リンク）の持ち方・保存時の追従・`driveFileUrl` 非永続化 | [docs/claude/links-and-save.md](./docs/claude/links-and-save.md) |
| Question / Dashboard（集計・可視化）のモジュール構成 | [docs/claude/feature-map.md](./docs/claude/feature-map.md) |
| 詰まったときの確認ポイント | [docs/claude/troubleshooting.md](./docs/claude/troubleshooting.md) |

## コーディング規約（圧縮版・常時適用）

### React（`builder/src/`）

- 関数コンポーネント + Hooks、JSX は **ダブルクォート**、**2 スペース**、ES Modules（`"type": "module"`）
- 命名: コンポーネント `PascalCase` / 変数・関数 `camelCase` / 定数 `UPPER_SNAKE_CASE`
- 状態管理: グローバル = `AppDataProvider`（Context） / データアクセス = `dataStore`（GAS + IndexedDB 抽象化） / UI 設定 = `settingsStore`（IndexedDB）
- 本番で `console.log` を残さない
- テストは **ソースと同ディレクトリ** に `*.test.js` で配置

### Google Apps Script（`gas/`）

- V8 ランタイムだが **既存コードは `var` + `function name() {}` スタイル** — 新規も合わせる（`let` / `const` / arrow を勝手に導入しない）
- 公開 API: **`nfb` プレフィックス**（例: `nfbListForms` / `nfbGetForm` / `nfbSaveForm`）
- 内部ヘルパー: **末尾アンダースコア**（例: `Forms_getForm_` / `nfbSafeCall_`）
- ドメインプレフィックス: `Sheets_` / `Forms_` / `Nfb_` / `Sync_` / `Admin_` / `Analytics_`
- エラーハンドリングは `nfbSafeCall_` ラッパーで `{ ok, error, code }` を返す形に統一

## 覚えておく定数

- `NFB_HEADER_DEPTH = 11` / `NFB_DATA_START_ROW = 12` / フロント `MAX_DEPTH = 11`
- `NFB_LOCK_WAIT_TIMEOUT_MS = 10000` ms（保存ロックタイムアウト、コード `LOCK_TIMEOUT`）
- `NFB_DEFAULT_DELETED_RECORD_RETENTION_DAYS = 30`（ソフトデリート保持期間）
- IndexedDB: `NestedFormBuilder` v10。ストアは `formsCache` / `settingsStore` / `analyticsQuestions` / `analyticsDashboards` / `uploadQueue` / `openHistory`（v9）/ `registry`（v10・フロントの参照解決作業キャッシュ。Script Properties registry のミラー。詳細 [links-and-save.md](./docs/claude/links-and-save.md) §6）。SWR しきい値はキャッシュ種別で別。レコード（`RECORD_CACHE_*`）= fresh 5 分・要再取得 30 分。一覧（フォーム / Dashboard / Question、`FORM_CACHE_*` を共用）= fresh 1 時間・1〜24 時間は裏更新・24 時間超で同期再取得。`recordsCache` / `analyticsSnapshots` 系は v6 で撤去済み（メモリ常駐に移行）
- オフラインファースト保存（v8）: フォーム / Question / Dashboard の保存は IndexedDB へ即書き込み → `uploadQueue`（write-behind ジョブ）に積み、`uploadWorker` が逐次 Drive へ送る。仮 ID `local_…` を成功時に実 fileId へ付け替えて参照を再リンク。失敗は指数バックオフ（`UPLOAD_RETRY_BASE_MS` 2 秒〜`UPLOAD_RETRY_MAX_MS` 5 分）で自動リトライ
- フロント `DEFAULT_SEARCH_DEBOUNCE_MS = 300`（検索バー遅延検索。設定 `searchDebounceMs` で変更、`0` で即時。IME 変換中は確定時のみコミット）

## 影響範囲の広い重要ファイル

| ファイル | 何のために重要か |
| --- | --- |
| [gas/Code.gs](./gas/Code.gs) | `doGet` / `doPost` / `ACTION_DEFINITIONS_` の dispatch table |
| [gas/constants.gs](./gas/constants.gs) | 全 GAS 定数・ULID 生成・`NFB_FIXED_HEADER_PATHS` |
| [gas/scripts/bundle.js](./gas/scripts/bundle.js) | `FILE_ORDER`（gas/ → `dist/Bundle.gs` 結合順序）・alasql ES2019 lower・UDF 再生成 |
| [gas/formsPublicApi.gs](./gas/formsPublicApi.gs) | フォーム関連の `nfb*` 公開 API 一覧 |
| [gas/expressionEvaluator.gs](./gas/expressionEvaluator.gs) / [gas/templateEvaluator.gs](./gas/templateEvaluator.gs) | alasql 互換式評価器・テンプレ解決 |
| [gas/driveTemplate.gs](./gas/driveTemplate.gs) / [gas/driveOutput.gs](./gas/driveOutput.gs) | トークン置換・PDF / Gmail / Doc 出力 |
| [gas/syncRecordsMerge.js](./gas/syncRecordsMerge.js) | 差分同期の純関数群 |
| [builder/src/core/schema.js](./builder/src/core/schema.js) | スキーマ正規化・バリデーション |
| [builder/src/core/constants.js](./builder/src/core/constants.js) | フロント定数（`MAX_DEPTH` / キャッシュ TTL 等） |
| [builder/src/features/expression/templateEvaluator.js](./builder/src/features/expression/templateEvaluator.js) | フロント側 alasql テンプレ評価器 |
| [builder/src/app/state/dataStore.js](./builder/src/app/state/dataStore.js) / [recordsMemoryStore.js](./builder/src/app/state/recordsMemoryStore.js) | データアクセスとメモリ常駐レコードストア |
| [builder/src/app/state/uploadQueue.js](./builder/src/app/state/uploadQueue.js) / [uploadWorker.js](./builder/src/app/state/uploadWorker.js) | オフラインファースト保存の永続キューと逐次アップロードワーカー |
| [builder/src/services/gasClient.js](./builder/src/services/gasClient.js) | GAS API クライアント（`google.script.run` の Promise ラッパー） |

## 絶対ルール

1. **新規ファイル作成前にユーザー確認** — 勝手に増やさない
2. **既存パターンを踏襲** — 特に GAS の `var` + `function` 宣言スタイル
3. **`dist/` は自動生成物** — 直接編集しない（gitignore 対象）
4. **`.clasp.json` はローカル専用**（gitignore）。`rootDir: "dist"` で作成
5. **OAuth スコープ変更は全ユーザー再認証を招く** — 安易に触らない
6. **GAS 実行時間制限は 6 分** — 長時間処理はバッチ分割を検討
7. **テスト配置の分散**: フロント `*.test.js` はソースと同居 / GAS は `tests/` 配下
