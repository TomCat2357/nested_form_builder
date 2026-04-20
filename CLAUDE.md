# CLAUDE.md

このファイルは、Claude Code がこのリポジトリで作業する際の**補足ガイド**です。
プロジェクト全般の仕様・アーキテクチャ・使い方は [README.md](./README.md) を正とし、ここでは Claude の行動に直結する内容だけを残しています。

## このプロジェクトは何か

**Nested Form Builder** — 最大 11 階層のネスト構造を持つアンケートフォームを視覚的に設計し、スタンドアロン HTML を Google Apps Script Web アプリとして配信するツール。回答は Google Sheets に保存、ファイルは Google Drive に格納、Google Docs テンプレートからの PDF / Gmail 出力に対応。

**技術スタック**: React 19 + Vite 7（フロント、`vite-plugin-singlefile` で単一 HTML 化） / Google Apps Script V8（バック） / Google Sheets + Drive + Gmail + People API / IndexedDB キャッシュ / clasp デプロイ。

## 詳細情報のマップ

毎回必要なわけではない情報は外出ししています。タスクに応じて該当ドキュメントを開いてください。

| 知りたいこと | 参照先 |
|--|--|
| ディレクトリ構成・モジュール分割 | [README.md](./README.md) 「機能マップ」「リポジトリ構成」 |
| 開発コマンド（dev / build / test） | [README.md](./README.md) 「セットアップ」「開発フロー」 |
| デプロイ手順・`deploy.ps1` の動作 | [README.md](./README.md) 「デプロイ」 |
| アーキテクチャ・データフロー・Provider | [README.md](./README.md) 「アーキテクチャ概要」「Apps Script バックエンド」 |
| テンプレートトークン・パイプ変換 | [README.md](./README.md) 「テンプレートトークン・パイプ変換」 |
| 検索クエリ構文 | [README.md](./README.md) 「検索クエリ構文」 |
| 対応フィールドタイプ・ルーティング | [README.md](./README.md) 「対応フィールドタイプ」「ルーティング」 |
| テスト配置と実行 | [README.md](./README.md) 「テスト」 |
| データ構造（スキーマ / シートレイアウト / ソフトデリート） | [docs/claude/data-model.md](./docs/claude/data-model.md) |
| キャッシュ・差分同期の実装詳細 | [docs/claude/cache-architecture.md](./docs/claude/cache-architecture.md) |
| トラブルシュート・デプロイ情報の確認 | [docs/claude/troubleshooting.md](./docs/claude/troubleshooting.md) |

## コーディング規約（必読・圧縮版）

### React（`builder/src/`）

- 関数コンポーネント + Hooks、JSX は**ダブルクォート**、**2 スペース**、ES Modules（`"type": "module"`）
- 命名: コンポーネント `PascalCase` / 変数・関数 `camelCase` / 定数 `UPPER_SNAKE_CASE`
- 状態管理: グローバル = `AppDataProvider`（Context） / データアクセス = `dataStore`（GAS + IndexedDB 抽象化） / UI 設定 = `settingsStore`（IndexedDB）
- 本番で `console.log` を残さない
- テストは**ソースと同ディレクトリ**に `*.test.js` で配置

### Google Apps Script（`gas/`）

- V8 ランタイムだが、**既存コードは `var` + `function name() {}` スタイル** — 新規コードも合わせる（`let` / `const` / アロー関数を勝手に導入しない）
- 公開 API: **`nfb` プレフィックス**（例: `nfbListForms`, `nfbGetForm`, `nfbSaveForm`）
- 内部ヘルパー: **末尾アンダースコア**（例: `Forms_getForm_`, `nfbSafeCall_`）
- ドメインプレフィックス: `Sheets_`, `Forms_`, `Nfb_`, `Sync_`
- エラーハンドリングは `nfbSafeCall_` ラッパーで `{ok, error, code}` を返す形に統一

## 覚えておく定数

- `NFB_HEADER_DEPTH = 11` / `NFB_DATA_START_ROW = 12` / フロント `MAX_DEPTH = 11`
- `NFB_LOCK_WAIT_TIMEOUT_MS = 10000`（同時書き込み制御）
- `NFB_DELETED_RECORD_RETENTION_DAYS`（既定 30 日、ソフトデリート保持期間）
- IndexedDB: `NestedFormBuilder` v4 / SWR max 30 分・BG 更新 5 分

## 重要ファイル（影響範囲が広い）

- `gas/constants.gs` — 全 GAS 定数・ULID 生成・`NFB_FIXED_HEADER_PATHS`
- `gas/driveTemplate.gs` / `gas/driveOutput.gs` — トークン置換・PDF / Gmail 出力
- `gas/Code.gs` — doGet / doPost エンドポイント
- `gas/formsPublicApi.gs` — 公開 API 一覧
- `gas/scripts/bundle.js` — GAS ファイル結合順序の定義
- `builder/src/core/schema.js` — スキーマ正規化・バリデーション
- `builder/src/core/constants.js` — フロント定数
- `builder/src/app/state/recordsCache.js` — IndexedDB キャッシュ実装
- `builder/src/services/gasClient.js` — GAS API クライアント

## 開発時の絶対ルール

1. **新規ファイル作成前にユーザー確認** — 勝手に増やさない
2. **既存パターンを踏襲** — 特に GAS の `var` / `function` 宣言スタイル
3. **`dist/` は自動生成物** — 直接編集しない（gitignore 対象）
4. **`.clasp.json` はローカルのみ** — gitignore 対象。`rootDir: "dist"` で作成
5. **OAuth スコープ変更は全ユーザー再認証を招く** — 安易に触らない
6. **GAS 実行時間制限は 6 分** — 長時間処理はバッチ分割を検討
7. **テスト配置の分散**: `tests/`（GAS バックエンド、Node `assert/strict`） と `builder/src/**/*.test.js`（フロント、インラインテスト）
