# Nested Form Builder

Nested Form Builder は、ネストした階層構造を持つフォームの設計・公開・回答管理を Google Apps Script Web アプリとして提供するプロジェクトです。

フロントエンドは `builder/` の React 19 + Vite 7 SPA、バックエンドは `gas/` の Apps Script で構成されます。デプロイ用成果物は `dist/` に生成され、`clasp` で Apps Script へ push します。

## 主な機能

- 最大 11 階層のネスト構造を持つフォームをブラウザ上で作成・編集
- 条件分岐（`childrenByValue`）による動的な質問表示
- フォーム定義を Google Drive 上の JSON として管理
- 回答を Google Sheets に保存し、一覧・検索・編集・削除
- Excel エクスポート、Google Doc / PDF / Gmail 下書きへの出力
- ファイルアップロード（Google Drive 保存）
- テーマ切替、表示設定、管理者設定
- IndexedDB による差分同期キャッシュ
- 排他制御付きの並行保存

## 機能マップ

### フロントエンド（builder/src/）

```
┌─────────────────────────────────────────────────────────────────┐
│  Pages（画面）                                                   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐           │
│  │MainPage  │ │FormPage  │ │SearchPage│ │ConfigPage│           │
│  │フォーム  │ │入力・編集│ │検索・一覧│ │フォーム別│           │
│  │一覧      │ │          │ │          │ │設定      │           │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘           │
│  ┌──────────────┐ ┌────────────────┐ ┌────────────────┐        │
│  │AdminDashboard│ │AdminFormEditor │ │AdminSettings   │        │
│  │フォーム管理  │ │スキーマ編集    │ │管理者キー・     │        │
│  │一覧          │ │                │ │メール設定      │        │
│  └──────────────┘ └────────────────┘ └────────────────┘        │
├─────────────────────────────────────────────────────────────────┤
│  Features（機能モジュール）                                      │
│                                                                 │
│  ┌─ admin ──────────────────────────────────────────┐           │
│  │ FormBuilderWorkspace  エディタ+プレビュー統合     │           │
│  │ SearchPreviewPanel    編集中の検索プレビュー       │           │
│  └──────────────────────────────────────────────────┘           │
│  ┌─ editor ─────────────────────────────────────────┐           │
│  │ EditorPage       質問リストの編集ワークスペース    │           │
│  │ QuestionCard     個別質問カード（タイプ選択・設定）│           │
│  │ QuestionList     ドラッグ並び替え対応リスト        │           │
│  │ OptionRow        選択肢の編集行                    │           │
│  │ fieldTypes.js    フィールドタイプ定義・変換        │           │
│  └──────────────────────────────────────────────────┘           │
│  ┌─ preview ────────────────────────────────────────┐           │
│  │ PreviewPage       フォーム入力・回答送信           │           │
│  │ FieldRenderer     再帰的フィールド描画エンジン     │           │
│  │ FileUploadField   Google Driveアップロード         │           │
│  │ printDocument.js  印刷ドキュメント生成             │           │
│  └──────────────────────────────────────────────────┘           │
│  ┌─ search ─────────────────────────────────────────┐           │
│  │ SearchTable/Toolbar/Sidebar/Pagination  検索UI    │           │
│  │ searchQueryEngine.js  高度な検索クエリパーサー     │           │
│  │ useEntriesWithCache   キャッシュ付きデータ取得     │           │
│  │ SearchDisplaySettingsDialog  列表示カスタマイズ    │           │
│  └──────────────────────────────────────────────────┘           │
│  ┌─ nav ────────────────┐ ┌─ settings ──────────────┐          │
│  │ SchemaMapNav          │ │ settingsSchema.js        │          │
│  │ スキーマツリー         │ │ settingsStore.js         │          │
│  │ ナビゲーション         │ │ themeSyncRules.js        │          │
│  └───────────────────────┘ └─────────────────────────┘          │
├─────────────────────────────────────────────────────────────────┤
│  Core（コアロジック）                                            │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐               │
│  │schema.js    │ │validate.js  │ │collect.js   │               │
│  │スキーマ正規 │ │入力バリデー │ │回答収集・    │               │
│  │化・検証     │ │ション       │ │パス管理     │               │
│  └─────────────┘ └─────────────┘ └─────────────┘               │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐               │
│  │ids.js       │ │constants.js │ │displayModes │               │
│  │ULID ID生成  │ │MAX_DEPTH=11 │ │表示モード   │               │
│  │             │ │キャッシュTTL│ │管理         │               │
│  └─────────────┘ └─────────────┘ └─────────────┘               │
├─────────────────────────────────────────────────────────────────┤
│  App Infrastructure（基盤）                                      │
│                                                                 │
│  State:  AuthProvider → AppDataProvider → AlertProvider          │
│          dataStore（GAS + IndexedDB統合データアクセス層）         │
│          recordsCache / formsCache（IndexedDBキャッシュ）         │
│          cachePolicy（SWR方式: 即時表示→バックグラウンド更新）   │
│                                                                 │
│  Hooks:  useAlert, useBeforeUnloadGuard, useEditLock,            │
│          useFormCacheSync, useApplyTheme 等                      │
│                                                                 │
│  Theme:  11種のテーマ（standard, dark, ocean, forest, sakura,    │
│          matcha, warm, snow, christmas, egypt, india）           │
├─────────────────────────────────────────────────────────────────┤
│  Services & Utils                                               │
│  gasClient.js     GAS RPC ラッパー（google.script.run Promise化）│
│  excelExport.js   Excelエクスポート（ExcelJS）                   │
│  dateTime.js      日時処理（JST, シリアル日付）                   │
│  responses.js     回答データ正規化                                │
│  tokenReplacer.js テンプレートトークン置換                        │
└─────────────────────────────────────────────────────────────────┘
```

### バックエンド（gas/）

```
┌─────────────────────────────────────────────────────────────────┐
│  Entrypoint & Routing（Code.gs, codeHandlers.gs）               │
│  doGet(e)    HTML配信 + 認証情報注入（__IS_ADMIN__ 等）          │
│  doPost(e)   CORS対応 HTTPエンドポイント                         │
│  ACTION_DEFINITIONS_   アクション→ハンドラのルーティング定義     │
├─────────────────────────────────────────────────────────────────┤
│  Form Management（フォーム管理）                                 │
│  ┌─ formsCrud.gs ───────────────────────────────────┐           │
│  │ Forms_getForm_        フォーム取得（Drive JSON）  │           │
│  │ Forms_listForms_      一覧取得（バッチDrive API） │           │
│  │ Forms_saveForm_       保存（自動/上書き/コピー）   │           │
│  │ Forms_deleteForms_    削除（マッピング解除）       │           │
│  │ Forms_copyForm_       複製                        │           │
│  │ Forms_setFormsArchivedState_  アーカイブ切替      │           │
│  └──────────────────────────────────────────────────┘           │
│  ┌─ formsImport.gs ────────────────────────────────┐            │
│  │ Forms_importFromDrive_    Driveフォルダから一括取込│           │
│  │ Forms_registerImportedForm_  既存ファイル登録     │           │
│  └──────────────────────────────────────────────────┘           │
│  ┌─ formsStorage.gs / formsParsing.gs ──────────────┐           │
│  │ Drive上のJSON保存・読込・正規化                    │           │
│  └──────────────────────────────────────────────────┘           │
│  ┌─ formsMappingStore.gs ──────────────────────────┐            │
│  │ フォームID ⇔ DriveファイルURL 対応表管理         │           │
│  └──────────────────────────────────────────────────┘           │
│  ┌─ formsPublicApi.gs ─────────────────────────────┐            │
│  │ nfbListForms / nfbGetForm / nfbSaveForm 等       │           │
│  │ google.script.run向け公開API                      │           │
│  └──────────────────────────────────────────────────┘           │
├─────────────────────────────────────────────────────────────────┤
│  Sheet Operations（シート操作）                                   │
│  ┌─ sheetsHeaders.gs ──────────────────────────────┐            │
│  │ 11行階層ヘッダーの構築・読取・正規化              │           │
│  │ スキーマからの自動ヘッダー初期化                   │           │
│  └──────────────────────────────────────────────────┘           │
│  ┌─ sheetsRecords.gs ──────────────────────────────┐            │
│  │ レコードCRUD（upsert / get / list / softDelete） │           │
│  │ リテンション期限切れ行の自動パージ                 │           │
│  └──────────────────────────────────────────────────┘           │
│  ┌─ sheetsRowOps.gs ───────────────────────────────┐            │
│  │ 二分探索によるID検索（ソート済みULID前提）        │           │
│  │ レスポンス正規化・列順序管理                       │           │
│  └──────────────────────────────────────────────────┘           │
│  ┌─ sheetsDatetime.gs ─────────────────────────────┐            │
│  │ 日付⇔シリアル値⇔UnixMs 相互変換（JST対応）      │           │
│  └──────────────────────────────────────────────────┘           │
│  ┌─ sheetsExport.gs ───────────────────────────────┐            │
│  │ 検索結果→新規スプレッドシートへのエクスポート      │           │
│  └──────────────────────────────────────────────────┘           │
├─────────────────────────────────────────────────────────────────┤
│  Drive Integration（Drive連携）                                  │
│  ┌─ テンプレートシステム ──────────────────────────┐            │
│  │ トークン置換: {TOKEN}, {field|pipe1|pipe2}        │           │
│  │ 予約トークン: {ID}, {YYYY}, {MM}, {DD} 等         │           │
│  │ パイプ変換: date, time, left, pad, default 等     │           │
│  │ 和暦対応: {gg}（令和/平成/昭和...）               │           │
│  └──────────────────────────────────────────────────┘           │
│  ┌─ ドキュメント出力 ──────────────────────────────┐            │
│  │ Google Docテンプレートからの文書生成               │           │
│  │ PDF変換・Gmail下書き送信                           │           │
│  │ バッチ出力（複数レコード一括）                     │           │
│  └──────────────────────────────────────────────────┘           │
│  ┌─ フォルダ・ファイル管理 ────────────────────────┐            │
│  │ テンプレート名によるフォルダ自動生成               │           │
│  │ レコード別フォルダ作成                             │           │
│  │ ファイルアップロード（base64 → Drive）             │           │
│  │ Excelファイル保存・テーマインポート                │           │
│  └──────────────────────────────────────────────────┘           │
├─────────────────────────────────────────────────────────────────┤
│  Sync（差分同期: syncRecordsMerge.js）                           │
│  Sync_shouldApplyRecordToSheet_   上書き判定（タイムスタンプ比較）│
│  Sync_fillEmptySheetCellsFromRecord_   空セル非破壊補完          │
│  Sync_syncFixedMetaColumnsFromRecord_  メタデータ列同期          │
│  Sync_resolveNewRecordMetadata_   新規レコードのメタデータ生成   │
├─────────────────────────────────────────────────────────────────┤
│  Settings & Auth（設定・認証）                                   │
│  ┌─ settings.gs ───────────────────────────────────┐            │
│  │ 管理者キー / 管理者メール / フォーム限定モード     │           │
│  │ アクセス判定: IsAdmin_(), DetermineAccess_()      │           │
│  └──────────────────────────────────────────────────┘           │
│  ┌─ properties.gs ─────────────────────────────────┐            │
│  │ PropertyStoreモード（script / user）              │           │
│  │ シート更新タイムスタンプ管理                       │           │
│  │ ソフトデリート リテンション日数                    │           │
│  └──────────────────────────────────────────────────┘           │
│  ┌─ 認証・ユーザー情報 ────────────────────────────┐            │
│  │ People APIによるプロフィール取得                   │           │
│  │ メールホワイトリスト / adminKey認証                │           │
│  └──────────────────────────────────────────────────┘           │
├─────────────────────────────────────────────────────────────────┤
│  Infrastructure（基盤）                                          │
│  constants.gs   ULID生成, シート定数, Drive定数                  │
│  errors.gs      nfbSafeCall_ラッパー, HTTPレスポンス整形         │
│  model.gs       リクエスト解析・コンテキスト正規化               │
│  bundle.js      25ファイル → dist/Bundle.gs 結合                 │
└─────────────────────────────────────────────────────────────────┘
```

### フロントエンド⇔バックエンド連携

```
┌──────────────────┐      google.script.run       ┌──────────────────┐
│   React SPA      │ ◄──────────────────────────► │   Apps Script    │
│  (builder/)      │      gasClient.js             │   (gas/)         │
├──────────────────┤                               ├──────────────────┤
│                  │  forms_list / forms_get /      │                  │
│  AppDataProvider ├─ forms_create / forms_update ─►│  Forms_*         │
│  formsCache      │  forms_delete / forms_archive  │  formsPublicApi  │
│                  │                               │                  │
│  FormPage        │  save / get / list / delete   │                  │
│  recordsCache    ├─ sync_records / save_lock ───►│  Sheets_*        │
│  useEntries…     │                               │  syncRecords…    │
│                  │                               │                  │
│  FileUploadField ├─ nfbUploadFileToDrive ───────►│  drive*.gs       │
│  printDocument   │  nfbCreateRecordPrint…         │  driveOutput     │
│  excelExport     │  nfbSaveExcelToDrive           │  driveFile       │
│                  │                               │                  │
│  AdminSettings   ├─ admin_key / admin_email ────►│  settings.gs     │
│  ConfigPage      │  nfbGetRestrictToFormOnly      │  properties.gs   │
├──────────────────┤                               ├──────────────────┤
│  IndexedDB       │         ← キャッシュ →         │  Google Sheets   │
│  (ブラウザ)      │                               │  Google Drive    │
│  formsCache      │                               │  Properties Svc  │
│  recordsCache    │                               │                  │
│  settingsStore   │                               │                  │
└──────────────────┘                               └──────────────────┘
```

## 対応フィールドタイプ

`text` / `number` / `email` / `phone` / `url` / `date` / `time` / `radio` / `select` / `checkboxes` / `weekday` / `textarea` / `regex` / `userName` / `fileUpload` / `message` / `printTemplate`

## アーキテクチャ概要

1. `gas/Code.gs` の `doGet(e)` が `dist/Index.html` を配信し、`window.__IS_ADMIN__` 等の初期値を HTML に注入
2. `builder/src/app/main.jsx` が React アプリを起動し、`HashRouter` で画面を構築
3. React は `gasClient.js` 経由で `google.script.run` を呼び、Apps Script の公開関数と通信
4. フォーム定義は Drive、回答は Sheets、対応表・設定は Properties Service、ブラウザ側キャッシュは IndexedDB に保存

## リポジトリ構成

```text
nested_form_builder/
├── builder/                # React 19 + Vite 7 SPA
│   ├── src/
│   │   ├── app/           # App.jsx, Provider, 状態管理, テーマ
│   │   ├── core/          # スキーマ, バリデーション, displayModes
│   │   ├── features/      # admin, editor, preview, search, nav, export, settings
│   │   ├── pages/         # ページコンポーネント
│   │   ├── services/      # gasClient.js (GAS RPC ラッパー)
│   │   └── utils/         # dateTime, excelExport, formPaths 等
│   ├── Index.html         # エントリ HTML
│   └── package.json
├── gas/                    # Apps Script 分割ソース
│   ├── Code.gs            # doGet / doPost, アクション定義, ルーティング
│   ├── constants.gs       # ULID生成, プロパティキー, シート定数
│   ├── errors.gs          # エラー型, レスポンス整形
│   ├── model.gs           # リクエスト解析, コンテキスト構築
│   ├── settings.gs        # 管理者設定 (adminKey, adminEmail)
│   ├── properties.gs      # Properties Service 抽象化
│   ├── drive.gs           # Drive連携, 印刷, テンプレート, ファイルアップロード
│   ├── forms*.gs          # フォームCRUD, インポート, マッピング, 解析, API
│   ├── sheets*.gs         # ヘッダー構築, 行操作, レコードCRUD, エクスポート, 差分同期
│   ├── appsscript.json    # GAS マニフェスト
│   └── scripts/bundle.js  # .gs → dist/Bundle.gs 結合スクリプト
├── gas_for_spreadsheet/    # 保存先スプレッドシート用の補助スクリプト
├── dist/                   # clasp push 対象 (自動生成)
├── docs/                   # ユーザーマニュアル, 画像
├── tests/                  # Playwright E2E, GAS ユニットテスト
├── deploy.ps1              # Windows 用ビルド + deploy
├── package.json            # ルートの npm scripts
└── README.md
```

## ルーティング

| ルート | 画面 | 役割 |
| --- | --- | --- |
| `/` | `MainPage` / `UserRedirect` | フォーム一覧。`formId` 注入時は検索画面へ遷移 |
| `/search` | `SearchPage` | 回答一覧・検索・並び替え・エクスポート・削除/復活 |
| `/form/:formId/new` | `FormPage` | 新規回答入力 |
| `/form/:formId/entry/:entryId` | `FormPage` | 既存回答の閲覧・編集 |
| `/forms` | `AdminDashboardPage` | フォーム管理一覧・インポート/エクスポート・公開/削除 |
| `/forms/new` | `AdminFormEditorPage` | 新規フォーム作成 |
| `/forms/:formId/edit` | `AdminFormEditorPage` | 既存フォーム編集 |
| `/config` | `ConfigPage` | フォーム別・全体設定 |
| `/admin-settings` | `AdminSettingsPage` | 管理者キー・メール設定 |

アクセス制御は `FormsRoute`（`propertyStoreMode=script` で管理者限定）と `AdminSettingsRoute`（管理者設定有効時のみ）が担当します。

## Provider と状態管理

`App.jsx` で 3 つの Provider がアプリ全体を包みます。

- **`AuthProvider`** — `doGet` が注入する `window.__IS_ADMIN__` / `__FORM_ID__` / `__PROPERTY_STORE_MODE__` 等を React 側へ渡す
- **`AppDataProvider`** — フォーム一覧のロード・CRUD・IndexedDB キャッシュ・楽観的 UI
- **`AlertProvider`** — アラート・確認ダイアログ・トーストの表示窓口

### データフローとキャッシュ

- `dataStore.js` — フォーム・回答の取得先を一元化し、GAS 通信と IndexedDB キャッシュの差を吸収
- `gasClient.js` — `google.script.run` を Promise 化した GAS RPC ラッパー
- `useEntriesWithCache.js` — 検索・入力画面共通の回答キャッシュ管理フック。起動時はキャッシュ先行表示、必要時のみ差分/全件同期
- `recordsCache.js` — 回答レコードの IndexedDB キャッシュ。`formId + entryId` 複合キー、同期トークン管理
- `formsCache.js` — フォーム一覧の IndexedDB キャッシュ
- `settingsStore.js` — テーマ・ページサイズ等の UI 設定を IndexedDB に保存

## Apps Script バックエンド

### doGet / doPost

- `doGet(e)` — `Index.html` を配信。`form` / `adminkey` クエリでアクセス権を判定し、初期値を HTML に注入
- `doPost(e)` — 受信 JSON の `action` に応じて `ACTION_DEFINITIONS_` のハンドラへ振り分け

### アクション定義

| action | 用途 | 制約 |
| --- | --- | --- |
| `forms_list` | フォーム一覧取得 | 管理者 |
| `forms_get` | 単一フォーム取得 | 管理者 |
| `forms_create` | フォーム新規作成 | 管理者 |
| `forms_import` | Drive からフォーム取込 | 管理者 |
| `forms_update` | フォーム更新 | 管理者 |
| `forms_delete` | フォーム削除 | 管理者 |
| `forms_archive` | 公開状態変更 | 管理者 |
| `admin_key_get` / `admin_key_set` | 管理者キー取得/保存 | 管理者 |
| `admin_email_get` / `admin_email_set` | 管理者メール取得/保存 | 管理者 |
| `save` | レコード保存/更新 | `spreadsheetId` |
| `save_lock` | 保存ロック取得 | `spreadsheetId` |
| `list` | レコード一覧取得 | `spreadsheetId` |
| `get` | 単一レコード取得 | `spreadsheetId` + `id` |
| `delete` | レコード削除 | `spreadsheetId` + `id` |
| `sync_records` | 差分同期 | `spreadsheetId` |

### google.script.run 公開関数

`saveResponses` / `listRecords` / `getRecord` / `deleteRecord` / `nfbAcquireSaveLock` / `nfbExportSearchResults` / `nfbAppendExportRows` / `syncRecordsProxy`

その他、Drive 操作系: `nfbSaveExcelToDrive` / `nfbSaveFileToDrive` / `nfbCreateRecordPrintDocument` / `nfbExecuteRecordOutputAction` / `nfbExecuteBatchGoogleDocOutput` / `nfbUploadFileToDrive` / `nfbCopyDriveFileToDrive` / `nfbCreateGoogleDocumentFromTemplate` / `nfbFindDriveFileInFolder` / `nfbFinalizeRecordDriveFolder` / `nfbTrashDriveFilesByIds` / `nfbImportThemeFromDrive`

フォーム管理系: `nfbListForms` / `nfbGetForm` / `nfbSaveForm` / `nfbDeleteForm` / `nfbDeleteForms` / `nfbArchiveForm` / `nfbUnarchiveForm` / `nfbArchiveForms` / `nfbUnarchiveForms` / `nfbValidateSpreadsheet` / `nfbImportFormsFromDrive` / `nfbRegisterImportedForm`

設定系: `nfbGetAdminKey` / `nfbSetAdminKey` / `nfbGetAdminEmail` / `nfbSetAdminEmail` / `nfbGetRestrictToFormOnly` / `nfbSetRestrictToFormOnly`

### 保存先の分担

| 保存先 | 内容 |
| --- | --- |
| Google Drive | フォーム定義 JSON、アップロードファイル、出力ドキュメント |
| Google Sheets | 回答レコード |
| Properties Service | フォーム↔Drive ファイル対応表、管理者キー/メール、最終更新時刻 |
| IndexedDB (ブラウザ) | フォーム一覧キャッシュ、レコードキャッシュ、UI 設定 |

### dist/ との関係

`clasp` の push 対象は `dist/` です。以下の 3 ファイルが反映されます。

- `dist/Index.html` — React ビルド成果物 (single-file)
- `dist/Bundle.gs` — GAS 分割ソースの結合版
- `dist/appsscript.json` — GAS マニフェスト

`gas/*.gs` は開発用の分割ソースであり、`dist/` を直接編集しないでください。

## セットアップ

### 前提

- Node.js 18 以上
- Google アカウント
- `clasp` を利用できる環境
- Google Apps Script API が有効

### インストール

```bash
npm install
npm run builder:install
```

### .clasp.json

ルートに配置し、`rootDir` を `dist` に設定します。

```json
{
  "scriptId": "YOUR_SCRIPT_ID",
  "rootDir": "dist"
}
```

### clasp ログイン

```bash
npm run clasp:login
```

## 開発フロー

### ローカル開発

```bash
npm run builder:dev
```

Vite 開発サーバーが `http://localhost:5173` で起動します。`google.script.run` は存在しないため、GAS 通信を伴う処理は Web アプリ上での確認が必要です。`AuthProvider` は GAS 外では管理者扱いの既定値を使うため、画面構成やスタイル確認はローカルでも可能です。

### ビルド

```bash
npm run builder:build
node gas/scripts/bundle.js
```

### GAS との同期

```bash
npm run clasp:push    # dist/ → Apps Script
npm run clasp:pull    # Apps Script → dist/
```

## デプロイ

### 自動デプロイ (Windows / PowerShell)

```powershell
.\deploy.ps1
```

`deploy.ps1` は以下をまとめて実行します。

1. `builder/` の `npm install` と `npm run build`
2. `gas/scripts/bundle.js` による `dist/Bundle.gs` 生成
3. `dist/Index.html` への `<base target="_top">` とデプロイ時刻メタ付与
4. `gas/appsscript.json` の `dist/` へのコピー
5. `clasp push` → `clasp deploy`

オプション:

```powershell
.\deploy.ps1 -BundleOnly                          # ビルドのみ (push/deploy なし)
.\deploy.ps1 -PushOnly                             # push のみ (deploy なし)
.\deploy.ps1 -PropertyStore script                 # 共有 Script Properties (管理者設定有効)
.\deploy.ps1 -PropertyStore user                   # User Properties (管理者設定無効)
.\deploy.ps1 -ManifestOverride .\override.json     # appsscript.json を上書きマージ
```

### 手動デプロイ

```bash
npm run builder:build
node gas/scripts/bundle.js
cp gas/appsscript.json dist/appsscript.json
npm run clasp:push
npx --yes @google/clasp deploy --description "Nested Form Builder"
```

## テスト

```bash
# Playwright E2E テスト
npm run test:playwright

# GAS ユニットテスト (tests/ 配下)
node --experimental-vm-modules tests/gas-sync-records-merge.test.js
node tests/gas-header-normalization.test.cjs
node tests/gas-google-drive-url-parsing.test.cjs
node tests/gas-drive-template-replacement.test.cjs
```

`builder/src/` 内にも `*.test.js` ファイルがあります（スキーマ、バリデーション、キャッシュ、状態管理等）。

## 検索クエリ構文

```
keyword                   # キーワード検索
列名:keyword              # 列指定検索
列名>値 / 列名>=値         # 比較演算
列名<値 / 列名<=値
列名=値 / 列名!=値
条件1 AND 条件2            # AND 結合
条件1 OR 条件2             # OR 結合
列名 ~ /パターン/          # 正規表現
```

詳細は `docs/検索機能の使い方.md` を参照。

## テーマ

`builder/src/app/theme/` に共通トークン、テーマ適用ロジック、各テーマ CSS を配置しています。`main.jsx` で `import.meta.glob` により全テーマを事前登録し、フォーム設定またはローカル設定でテーマを切り替えます。

## 関連ドキュメント

- `docs/user_manual.md` — 利用者向け操作マニュアル
- `docs/検索機能の使い方.md` — 検索クエリ仕様
- `docs/beginner_manual_pptx/` — 初心者向け PowerPoint 資料
- `gas/appsscript.json` — Apps Script マニフェスト
- `gas_for_spreadsheet/SpreadsheetUtilities.gs` — スプレッドシート側補助ユーティリティ

## ライセンス

Private
