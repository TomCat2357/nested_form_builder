# Nested Form Builder

最大 11 階層のネスト構造を持つフォームをブラウザ上で設計し、**スタンドアロン HTML を Google Apps Script Web アプリとして配信**するツールです。
回答は Google Sheets に保存、ファイルは Google Drive に格納、Google Doc テンプレートから PDF / Gmail 下書きを生成、ブラウザ内 AlaSQL で集計ダッシュボードまで作れます。

- **フロント**: React 19 + Vite 7（`vite-plugin-singlefile` で単一 HTML 化）
- **バック**: Google Apps Script V8（`clasp` でデプロイ）
- **保存先**: Google Sheets（回答）/ Google Drive（フォーム定義・添付・出力）/ Properties Service / IndexedDB（ブラウザキャッシュ・オフライン保存キュー）

## できること

- 視覚的なフォーム設計（最大 11 階層のネスト、`childrenByValue` による条件分岐）
- 回答の保存・検索（簡易モード／IME 対応・ヒット箇所表示、先頭 `SELECT` の SQL モードで親子横断・別フォーム参照）・並べ替え・Excel エクスポート・ソフトデリート（既定 30 日保持）
- 印刷 PDF / Google Doc / Gmail 下書きの自動生成（alasql 関数式によるテンプレ。トークンは `{{...}}`（ビュー形式）に統一。単一ブレース `{...}` はリテラル文字）
- ファイルアップロード（Google Drive 保存）
- 集計ダッシュボード（Question / Dashboard、ブラウザ内 AlaSQL、Chart.js / ECharts / Leaflet / ピボット）
- オフラインファースト保存（フォーム / Question / Dashboard は IndexedDB へ即保存 → バックグラウンドで Drive へ write-behind アップロード、指数バックオフで再試行）
- 17 種のテーマ、表示モード、IndexedDB SWR キャッシュ、`LockService` ベースの排他制御

## クイックスタート

```bash
# 依存インストール
npm install
npm run builder:install

# clasp ログイン
npm run clasp:login

# ルートに .clasp.json を作成
#   { "scriptId": "YOUR_SCRIPT_ID", "rootDir": "dist" }

# ローカル開発（http://localhost:5173）
npm run builder:dev

# 本番デプロイ（Windows / PowerShell）
.\deploy.ps1
```

`deploy.ps1` が React ビルド・GAS バンドル・`clasp push` ・`clasp deploy` をまとめて実行します（`-h` でオプション一覧）。
非 Windows 環境では `npm run builder:build && npm run bundle:gas && cp gas/appsscript.json dist/ && npm run clasp:push && npx --yes @google/clasp deploy` を実行してください。

## リポジトリ構成（抜粋）

```text
nested_form_builder/
├── builder/          # React 19 + Vite 7 SPA（実装本体）
├── gas/              # Apps Script 分割ソース（dist/Bundle.gs に結合される）
├── gas_for_spreadsheet/  # 保存先スプレッドシート用の補助スクリプト
├── gas_for_external_action/      # 「外部アクションボタン」の POST 受信 Web アプリ雛形
├── dist/             # clasp push 対象（自動生成・コミットしない）
├── docs/             # 読者別ドキュメント
│   ├── developers/   #   開発者向け詳細（テーマ別 12 本）
│   └── operations/   #   運用・デプロイ・環境構築担当向け（4 本）
├── tests/ / e2e/     # GAS 横断テスト・Playwright E2E
├── md2pdf/ / scripts/  # ユーザーマニュアル生成ツール群（manual/ は gitignore）
├── deploy.ps1        # Windows 用ワンショットデプロイ
└── CLAUDE.md         # AI エージェント（Claude）専用の操作契約・索引
```

## ドキュメント（読者別）

ドキュメントは読者層ごとに分離しています。まず [`docs/README.md`](./docs/README.md)（ドキュメント・ハブ）から、自分に合った入口を選んでください。

| あなたは… | 入口 | 内容 |
| --- | --- | --- |
| 🧑‍💻 **アプリを使う人**（利用者） | 生成 PDF マニュアル（下記注記） | フォーム作成・回答・検索・出力の操作方法 |
| 🛠 **コードを読む / 変更する人**（開発者） | [`docs/developers/README.md`](./docs/developers/README.md) | アーキ・データモデル・公開 API・検索/テンプレ仕様・テスト |
| 🚀 **環境構築・デプロイ・運用する人** | [`docs/operations/README.md`](./docs/operations/README.md) | セットアップ・開発コマンド・`deploy.ps1`・トラブルシュート |
| 🤖 **AI エージェント（Claude）** | [`CLAUDE.md`](./CLAUDE.md) | コーディング規約・絶対ルール・定数・タスク別ナビ |

> 🧑‍💻 利用者向け操作マニュアル（`manual/user_manual.pdf`）は `scripts/` と `md2pdf/` で生成する成果物で、`manual/`（および生成元 `docs/user_manual.md`）は `.gitignore` 対象のためリポジトリには含まれません。

## ライセンス

Private
