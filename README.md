# Nested Form Builder

Nested Form Builder は、ネストしたフォームの設計、公開、回答管理を 1 つの Google Apps Script Web アプリで扱うためのプロジェクトです。フロントエンドは `builder/` の React 19 + Vite 7、バックエンドは `gas/` の Apps Script で構成され、デプロイ用成果物は `dist/` に生成されます。

この README をリポジトリ全体の単一の README とし、従来 `gas/README.md` に分かれていた Apps Script 側の説明もここへ集約しています。

## 何をするプロジェクトか

- 階層構造を持つフォームをブラウザ上で作成・編集する
- フォーム定義を Google Drive 上の JSON として管理する
- 回答を Google Sheets に保存し、一覧・検索・編集・削除する
- Apps Script Web アプリとして配布し、一般ユーザー画面と管理画面を切り替える
- テーマ、表示設定、管理者設定、プロパティ保存先モードを切り替える

## アーキテクチャ概要

1. `gas/Code.gs` の `doGet(e)` が `dist/Index.html` を配信し、`window.__IS_ADMIN__` などの初期値を HTML に注入します。
2. `builder/Index.html` から `builder/src/app/main.jsx` が起動し、React アプリが `HashRouter` で画面を構築します。
3. 画面は `builder/src/services/gasClient.js` 経由で `google.script.run` を呼び、Apps Script の公開関数と通信します。
4. フォーム定義は Google Drive、回答レコードは Google Sheets、フォーム対応表や管理設定は Properties Service、ブラウザ側キャッシュは IndexedDB に保存されます。

## リポジトリ構成

```text
nested_form_builder/
├── builder/                # React 19 + Vite 7 の SPA
├── gas/                    # Apps Script の分割ソース
├── dist/                   # clasp へ push する生成物
├── docs/                   # 利用者向けマニュアルなど
├── gas_for_spreadsheet/    # 保存先スプレッドシート側の補助スクリプト
├── deploy.ps1              # Windows 用ビルド + bundle + deploy
├── package.json            # ルートの npm scripts / clasp / Playwright
└── README.md               # このファイル
```

補足:

- `builder/vite.config.mjs` はビルド出力先を `../dist` に向けています。
- `vite-plugin-singlefile` により、フロントエンドは Apps Script 配信向けの単一 HTML に寄せた出力になります。
- `gas/scripts/bundle.js` は `gas/` 配下のバンドル対象ソースを `dist/Bundle.gs` に結合します。
- `dist/` は生成物です。通常は直接編集せず、`builder/` と `gas/` を修正してください。

## React フロントエンド

### 起動とビルド

- エントリ HTML は `builder/Index.html`、エントリ JS は `builder/src/app/main.jsx` です。
- `main.jsx` はテーマ CSS を読み込み、`import.meta.glob("./theme/themes/*.css", { eager: true })` で全テーマを事前登録してから `<App />` を描画します。
- `builder:dev` は Vite 開発サーバーを起動し、`builder:build` は `dist/` へ本番ビルドを出力します。
- ローカル Vite 環境では `google.script.run` が存在しないため、Apps Script 依存の処理は一部動きません。`AuthProvider` はその場合に管理者扱いの既定値を使うため、画面構成やスタイル確認はローカルでも可能です。

### ルーティングと画面責務

React 側のルーティングは `builder/src/app/App.jsx` に集約されています。Apps Script 配下で 1 枚の HTML を配る前提のため `BrowserRouter` ではなく `HashRouter` を使っています。

| ルート | 画面 | 役割 |
| --- | --- | --- |
| `/` | `MainPage` または一般ユーザー向けリダイレクト | フォーム一覧の入口。`form` クエリが注入されている場合は検索画面へ遷移 |
| `/search` | `SearchPage` | 回答一覧、検索、並び替え、エクスポート、削除/復活 |
| `/form/:formId/new` | `FormPage` | 新規回答入力 |
| `/form/:formId/entry/:entryId` | `FormPage` | 既存回答の閲覧・編集 |
| `/forms` | `AdminDashboardPage` | フォーム管理一覧、インポート/エクスポート、公開/削除 |
| `/forms/new` | `AdminFormEditorPage` | 新規フォーム作成 |
| `/forms/:formId/edit` | `AdminFormEditorPage` | 既存フォーム編集 |
| `/config` | `ConfigPage` | フォーム別または全体設定 |
| `/admin-settings` | `AdminSettingsPage` | 管理者キー、管理者メールなどの設定 |

アクセス制御は `FormsRoute` と `AdminSettingsRoute` が担当します。`propertyStoreMode=script` では管理者のみを許可し、`propertyStoreMode=user` ではフォーム管理系を全ユーザーに開放する構成です。

### Provider と状態管理

`App.jsx` では次の 3 つの Provider がアプリ全体を包みます。

- `AuthProvider`
  - `gas/Code.gs` の `doGet(e)` が注入する `window.__IS_ADMIN__`、`window.__FORM_ID__`、`window.__PROPERTY_STORE_MODE__` などを読み取り、認証状態と表示モードを React 側へ渡します。
- `AppDataProvider`
  - フォーム一覧のロード、作成、更新、アーカイブ、削除、インポートを担当します。
  - `formsCache.js` を使って IndexedDB にフォーム一覧を保存し、起動直後はキャッシュを先に表示、その後に必要な同期だけ実行します。
  - フォーム更新系は楽観的 UI を入れつつ、キャッシュも同時更新します。
- `AlertProvider`
  - 画面共通のアラート、確認ダイアログ、トーストの表示窓口です。

### データフローとキャッシュ

- `builder/src/app/state/dataStore.js`
  - React 側のリポジトリ層です。フォーム・回答の取得先を一元化し、GAS 通信と IndexedDB キャッシュの差を吸収します。
  - フォーム定義は Drive 上の JSON と Properties 情報を扱い、回答レコードはスプレッドシート同期とローカルキャッシュを扱います。
- `builder/src/services/gasClient.js`
  - `google.script.run` を Promise 化し、Apps Script の公開関数呼び出しを React から扱いやすい形に揃えます。
  - スプレッドシート検証、保存ロック取得、レコード取得、フォーム CRUD、Drive インポート、検索結果 Excel 保存などの API を集約しています。
- `builder/src/features/search/useEntriesWithCache.js`
  - 検索画面と入力画面が共通利用する回答キャッシュ管理フックです。
  - 起動時は IndexedDB のキャッシュを先に表示し、必要時のみ差分同期または全件同期を行います。
  - `forceRefreshAll()` はローカル未同期データの flush 後に全件同期を行い、ロック競合時は再試行します。
- `builder/src/app/state/recordsCache.js`
  - 回答レコードの IndexedDB キャッシュです。`formId + entryId` の複合キー、ヘッダー行、最終同期時刻、サーバー更新トークンを保持します。
  - 差分同期結果をマージし、削除済みデータの保持期間も管理します。
- `builder/src/core/storage.js` と `builder/src/features/settings/settingsStore.js`
  - テーマ、ページサイズ、検索表示制限、削除保持日数などの UI 設定を IndexedDB に保存します。

### 画面ごとの React 実装ポイント

- `MainPage`
  - フォーム一覧の入口です。`AppDataProvider` のフォーム一覧とキャッシュ年齢を見て、前景同期か背景同期かを切り替えます。
- `SearchPage`
  - フォーム設定とヘッダー行から検索テーブル列を動的生成します。
  - キーワード検索、並び替え、ページング、削除済み表示、Excel エクスポートをまとめています。
- `FormPage`
  - `PreviewPage` を使って実際の入力 UI を描画します。
  - 下書きは `sessionStorage` に退避し、未保存編集がある間はバックグラウンド更新で内容を上書きしないよう制御しています。
  - 保存時はまずローカルキャッシュを更新し、その後に必要なら Apps Script 側へスプレッドシート保存を依頼します。
- `AdminDashboardPage`
  - フォーム一覧、Drive からのインポート、JSON/ZIP エクスポート、公開状態切替、削除を担当します。
  - 共有 URL のコピーや読み込み失敗フォームの表示もここで扱います。

### テーマと UI

- `builder/src/app/theme/` に共通トークン、テーマ適用ロジック、各テーマ CSS を置いています。
- `DEFAULT_THEME` をベースに、フォーム設定またはローカル設定でテーマを切り替えます。
- 検索画面と入力画面は同じテーマシステムを共有し、Excel 出力でもテーマ色を一部再利用します。

## Apps Script バックエンド

### 実行時の責務

#### `doGet(e)`

- `Index` を返して Web アプリの UI を配信する
- `form` / `adminkey` クエリと現在ユーザー情報をもとにアクセス権を判定する
- React 側が読む `window.__GAS_WEBAPP_URL__`、`window.__IS_ADMIN__`、`window.__FORM_ID__`、`window.__AUTH_ERROR__`、`window.__PROPERTY_STORE_MODE__` などを HTML に注入する

#### `doPost(e)`

- 受信 JSON を解釈し、`action` ごとのハンドラへ振り分ける
- 管理者チェック、`spreadsheetId` 必須チェック、エラー整形を行う
- JSON レスポンスを返す

#### `google.script.run` から直接呼ぶ公開関数

- `saveResponses`
- `listRecords`
- `getRecord`
- `deleteRecord`
- `nfbAcquireSaveLock`
- `nfbExportSearchResults`
- `nfbAppendExportRows`
- `syncRecordsProxy`

### `gas/` の主なファイル

| ファイル群 | 役割 |
| --- | --- |
| `Code.gs` | `doGet` / `doPost`、レスポンス整形、ロック制御、ルーティング |
| `constants.gs`, `errors.gs`, `model.gs` | 定数、エラー、リクエスト解析 |
| `forms*.gs`, `drive.gs` | フォーム定義の保存、読込、Drive URL 解析、対応表管理 |
| `settings.gs`, `properties.gs` | 管理者設定、Properties Service の切替 |
| `sheets*.gs` | スプレッドシートのヘッダー構築、行操作、検索結果出力、差分同期 |
| `scripts/bundle.js` | 分割 `.gs` を `dist/Bundle.gs` に結合 |
| `appsscript.json` | Apps Script マニフェスト |

### `action` 一覧

`doPost` は `ctx.raw.action` に応じて次を処理します。

| action | 用途 | 備考 |
| --- | --- | --- |
| `forms_list` | フォーム一覧取得 | 管理系 |
| `forms_get` | 単一フォーム取得 | 管理系 |
| `forms_create` | フォーム新規作成 | 管理系 |
| `forms_import` | Drive からフォーム取込 | 管理系 |
| `forms_update` | フォーム更新 | 管理系 |
| `forms_delete` | フォーム削除 | 管理系 |
| `forms_archive` | フォーム公開状態変更 | 管理系 |
| `admin_key_get` / `admin_key_set` | 管理者キー取得 / 保存 | 管理者設定 |
| `admin_email_get` / `admin_email_set` | 管理者メール取得 / 保存 | 管理者設定 |
| `list` | レコード一覧取得 | `spreadsheetId` 必須 |
| `get` | 単一レコード取得 | `spreadsheetId` と `id` 必須 |
| `save` | レコード保存 / 更新 | `spreadsheetId` 必須 |
| `delete` | レコード削除 | `spreadsheetId` と `id` 必須 |
| `sync_records` | レコード差分同期 | `spreadsheetId` 必須 |

### 保存先の分担

- Google Drive
  - フォーム定義 JSON の保存先です。
- Google Sheets
  - 回答レコードの保存先です。`spreadsheetId` と `sheetName` に基づいて保存先を決定します。
- Properties Service
  - フォームと Drive ファイルの対応付け、管理者キー、管理者メール、フォーム限定アクセス、最終更新時刻を保持します。
  - `propertyStoreMode=script` では共有設定、`propertyStoreMode=user` ではユーザー単位設定として使います。

### `dist/` との関係

`clasp` の push 対象は `gas/` ではなく `dist/` です。Apps Script に反映されるのは次の生成物です。

- `dist/Bundle.gs`
- `dist/index.html` または `dist/Index.html`
- `dist/appsscript.json`

そのため `gas/*.gs` は開発用の分割ソースであり、`dist/Bundle.gs` を直接編集する運用にはしません。

## セットアップ

### 前提

- Node.js 18 以上
- Google アカウント
- `clasp` を利用できる環境
- Google Apps Script API が有効な Google Cloud / Apps Script プロジェクト

### 依存関係のインストール

```powershell
npm install
npm run builder:install
```

- ルートの `npm install` で `@google/clasp` などの共通ツールを入れます。
- `npm run builder:install` で `builder/` 配下のフロントエンド依存関係を入れます。

### `.clasp.json`

ルートに `.clasp.json` を置き、`rootDir` を `dist` に設定します。

```json
{
  "scriptId": "YOUR_SCRIPT_ID",
  "rootDir": "dist"
}
```

### clasp ログイン

```powershell
npm run clasp:login
```

## 開発フロー

### フロントエンドをローカルで触る

```powershell
npm run builder:dev
```

Vite の開発サーバーが起動します。UI 開発、テーマ確認、ルーティング確認には十分ですが、Apps Script 実通信が必要な処理は Web アプリ上での確認が必要です。

### 本番相当の成果物を作る

```powershell
npm run builder:build
node gas/scripts/bundle.js
Copy-Item gas/appsscript.json dist/appsscript.json -Force
```

この手順で少なくとも次の 3 つが `dist/` に揃います。

- `dist/index.html` または `dist/Index.html`
- `dist/Bundle.gs`
- `dist/appsscript.json`

### Apps Script と同期する

```powershell
npm run clasp:push
npm run clasp:pull
```

- `clasp:push` は `dist/` を Apps Script プロジェクトへ反映します。
- `clasp:pull` は `dist/` を最新化します。`gas/` 側の分割ソースとは別物なので、pull 後に `dist/Bundle.gs` を編集し続けないでください。

## デプロイ

### 自動デプロイ（Windows / PowerShell）

```powershell
.\deploy.ps1
```

`deploy.ps1` は次をまとめて実行します。

1. `builder/` の `npm install` と `npm run build`
2. `gas/scripts/bundle.js` による `dist/Bundle.gs` 生成
3. `dist/index.html` または `dist/Index.html` への `<base target="_top">` とデプロイ時刻メタ付与
4. `gas/appsscript.json` の `dist/` へのコピー
5. `clasp push`
6. `clasp deploy`

よく使うオプション:

```powershell
.\deploy.ps1 -BundleOnly
.\deploy.ps1 -PropertyStore script
.\deploy.ps1 -PropertyStore user
.\deploy.ps1 -ManifestOverride .\path\to\override.json
```

- `-BundleOnly`: ビルドと bundle だけ実行し、`clasp push/deploy` はしません。
- `-PropertyStore script`: 共有の Script Properties を使います。管理者設定が有効になります。
- `-PropertyStore user`: User Properties を使います。管理者設定は無効になります。
- `-ManifestOverride`: `gas/appsscript.json` に上書き JSON をマージしてから push/deploy します。

### 手動デプロイ

PowerShell スクリプトを使わない場合は、少なくとも次の流れです。

```powershell
npm run builder:build
node gas/scripts/bundle.js
Copy-Item gas/appsscript.json dist/appsscript.json -Force
npm run clasp:push
npx --yes @google/clasp deploy --description "Nested Form Builder"
```

## 運用メモ

- フォーム定義本体は Google Drive 上の JSON ファイルとして保存されます。
- 回答レコードはフォーム設定が指す Google Sheets に保存されます。
- フォームと Drive ファイルの対応付け、最終更新時刻などは Properties Service で管理します。
- `propertyStoreMode=script` のときは共有設定と管理者設定を使う運用、`propertyStoreMode=user` のときはユーザーごとのフォーム管理を使う運用です。

## 関連ドキュメント

- `docs/user_manual.md`: 利用者向けの操作マニュアル
- `gas/appsscript.json`: Apps Script マニフェスト
- `gas_for_spreadsheet/SpreadsheetUtilities.gs`: スプレッドシート側の補助ユーティリティ

## ライセンス

Private
