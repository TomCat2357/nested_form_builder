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
- **外部アクション**（レコード／検索結果を外部の GAS Web アプリ等へ送るボタン。後述）
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

## 外部アクション

レコード（編集・閲覧画面の単票）や検索結果（一覧の単一／複数選択）を、外部の GAS Web アプリ等へ送るボタンです。
送り先で Excel 出力・別シート取り込み・カレンダー連携などを行わせる、本体に手を入れずに機能を足すための拡張点です。

- **送信方式**: ブラウザの隠しフォーム POST ではなく、**本体 GAS のサーバ間リレー**（`nfbSendExternalAction` → `UrlFetchApp`）。
  送信先 URL に `?nfbRelay=1` を付け、POST ボディ `payload`(form-encoded) に **JSON 文字列**を入れる。受信側は `e.parameter.payload` を `JSON.parse` する。
- **誤送信防止プローブ**: 本送信の前に `nfbProbe=1` + `nonce` を投げ、受信側が `HMAC-SHA256(nonce, 共有秘密)` の署名を返せた宛先にだけ本送信する。
- **payload は単一フォーマット**: 起動元（単票／検索単一／検索複数）に依らず同形で、受信側は `recordCount`（= `records` 数）だけで単一/複数を判定する。
  各レコードは `{ id, no, items:[{ question, value, type, files?, … }] }`。子フォーム（formLink）は常に `items` にインライン展開（親/`#No`/子質問）、ファイルは `items[].files` に Drive URL で内包。
- **管理者限定情報**: スプレッドシート ID / シート名 / Drive URL / ユーザー等の `storage` は **管理者ボタン＋管理者本人**のときだけ付く。
- URL 内トークンは印刷様式と共通の alasql `{{...}}` エンジンで解決（機微トークンは管理者限定）。
- 詳細な payload 契約は [`docs/claude/apps-script-backend.md`](./docs/claude/apps-script-backend.md) の「外部アクション送信」節を参照。

`gas_for_external_action/` に受信側 Web アプリの雛形と実例があります。

| ディレクトリ | 役割 |
| --- | --- |
| `template/` | 受信の最小雛形（payload を受け取り中身を確認するところまで） |
| `choju_intake/` | 鳥獣保護管理法様式 ↔ フォームの双方向ブリッジ（フォーム→Excel 出力／Excel→シート取り込み） |
| `choju_kyokasho/` | フォーム → 許可証等様式 `.xlsx` 出力（`choju_intake` の逆方向） |
| `kujo_intake/` | お問い合わせフォーム CSV → 苦情・通報フォームの Data シートへ取り込み |
| `for_kouza/` | Google カレンダーから「講座」イベントを抽出して Data シートへ upsert |
| `for_utility/` | 保存先シートのユーティリティ（createdAt ソート／No. リナンバー／列並べ替え） |

## リポジトリ構成（抜粋）

```text
nested_form_builder/
├── builder/          # React 19 + Vite 7 SPA（実装本体）
├── gas/              # Apps Script 分割ソース（dist/Bundle.gs に結合される）
├── gas_for_spreadsheet/  # 保存先スプレッドシート用の補助スクリプト（for_kouza / for_utility）
├── gas_for_external_action/  # 外部アクションの受信 Web アプリ（雛形 template/ ＋ 実例 5 種）
├── dist/             # clasp push 対象（自動生成・コミットしない）
├── docs/claude/      # 開発者向け詳細ドキュメント（テーマ別 16 本）
├── tests/ / e2e/     # GAS 横断テスト・Playwright E2E
├── md2pdf/ / scripts/  # ユーザーマニュアル生成ツール群（manual/ は gitignore）
├── deploy.ps1        # Windows 用ワンショットデプロイ
└── CLAUDE.md         # 開発者向けの入口（docs/claude/ への索引）
```

## ドキュメント

| 用途 | 参照先 |
| --- | --- |
| 開発者向けナビ（テーマ別 16 ファイルへの索引） | [`CLAUDE.md`](./CLAUDE.md) |
| 全体像・データフロー | [`docs/claude/architecture.md`](./docs/claude/architecture.md) |
| セットアップ詳細 | [`docs/claude/setup.md`](./docs/claude/setup.md) |
| 日常コマンド | [`docs/claude/development-workflow.md`](./docs/claude/development-workflow.md) |
| デプロイ（`deploy.ps1`） | [`docs/claude/deployment.md`](./docs/claude/deployment.md) |
| バックエンド API・外部アクション payload 契約 | [`docs/claude/apps-script-backend.md`](./docs/claude/apps-script-backend.md) |
| トラブルシュート | [`docs/claude/troubleshooting.md`](./docs/claude/troubleshooting.md) |

> 利用者向け操作マニュアル（`manual/user_manual.pdf`）は `scripts/` と `md2pdf/` で生成する成果物で、`manual/` は `.gitignore` 対象のためリポジトリには含まれません。

## ライセンス

Private
