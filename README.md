# Nested Form Builder

最大 11 階層のネスト構造を持つフォームをブラウザ上で設計し、**スタンドアロン HTML を Google Apps Script Web アプリとして配信**するツールです。
回答は Google Sheets に保存、ファイルは Google Drive に格納、Google Doc テンプレートから PDF / Gmail 下書きを生成、ブラウザ内 AlaSQL で集計ダッシュボードまで作れます。

- **フロント**: React 19 + Vite 7（`vite-plugin-singlefile` で単一 HTML 化）
- **バック**: Google Apps Script V8（`clasp` でデプロイ）
- **保存先**: Google Sheets（回答）/ Google Drive（フォーム定義・添付・出力）/ Properties Service / IndexedDB（ブラウザキャッシュ）

## できること

- 視覚的なフォーム設計（最大 11 階層のネスト、`childrenByValue` による条件分岐）
- 回答の保存・検索・並べ替え・Excel エクスポート・ソフトデリート（既定 30 日保持）
- 印刷 PDF / Google Doc / Gmail 下書きの自動生成（alasql 関数式によるテンプレ）
- ファイルアップロード（Google Drive 保存）
- 集計ダッシュボード（Question / Dashboard、ブラウザ内 AlaSQL、Chart.js / ECharts / Leaflet / ピボット）
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
├── dist/             # clasp push 対象（自動生成）
├── docs/             # ユーザーマニュアル + claude/ 配下に開発者向け補足
├── tests/ / e2e/     # GAS 横断テスト・Playwright E2E
├── deploy.ps1        # Windows 用ワンショットデプロイ
└── CLAUDE.md         # 開発者向けの入口（docs/claude/ への索引）
```

## ドキュメント

| 用途 | 参照先 |
| --- | --- |
| 利用者向け操作マニュアル | [`manual/user_manual.pdf`](./manual/user_manual.pdf) |
| 開発者向けナビ（テーマ別 14 ファイルへの索引） | [`CLAUDE.md`](./CLAUDE.md) |
| 全体像・データフロー | [`docs/claude/architecture.md`](./docs/claude/architecture.md) |
| セットアップ詳細 | [`docs/claude/setup.md`](./docs/claude/setup.md) |
| 日常コマンド | [`docs/claude/development-workflow.md`](./docs/claude/development-workflow.md) |
| デプロイ（`deploy.ps1`） | [`docs/claude/deployment.md`](./docs/claude/deployment.md) |
| トラブルシュート | [`docs/claude/troubleshooting.md`](./docs/claude/troubleshooting.md) |

## ライセンス

Private
