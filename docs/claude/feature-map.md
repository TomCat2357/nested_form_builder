# 機能マップ（Claude 向け詳細）

CLAUDE.md から分離した、フロントエンド・バックエンドのモジュール構成とフロント⇔バック連携の俯瞰図。「どこに何があるか」を素早く掴むための地図として参照する。

## フロントエンド（builder/src/）

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

## バックエンド（gas/）

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
│  │ トークン置換: {@TOKEN}, {@field|pipe1|pipe2}       │           │
│  │ 予約トークン: {@_id}, {@_NOW}, {@_folder_url} 等  │           │
│  │ パイプ変換: time, left, pad, default, if 等       │           │
│  │ 和暦対応: {@_NOW|time:gg ee年}                    │           │
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

## フロントエンド⇔バックエンド連携

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
