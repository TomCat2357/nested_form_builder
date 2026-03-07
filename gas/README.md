# GAS Backend README

`gas/` は Nested Form Builder の Apps Script バックエンドです。リポジトリ全体の概要、セットアップ、通常の開発フローは上位の `../README.md` を参照し、この README では Apps Script 側だけを扱います。

## この README の担当範囲

- `gas/` 配下のファイル構成
- `doGet` / `doPost` の責務
- `action` ベースの API ルーティング
- Google Drive / Google Sheets / Properties Service の使い分け
- `dist/Bundle.gs` とデプロイ手順の関係

逆に、次の内容は `../README.md` や `../docs/user_manual.md` の担当です。

- リポジトリ全体の入口説明
- React フロントエンドのセットアップ
- 利用者向けの画面説明

## ランタイム上の責務

### `doGet(e)`

- `Index` を返して Web アプリの UI を配信する
- `form` / `adminkey` クエリ、現在ユーザーのメールアドレスをもとにアクセス権を判定する
- フロントエンド向けに、`__GAS_WEBAPP_URL__`、`__IS_ADMIN__`、`__FORM_ID__`、`__PROPERTY_STORE_MODE__` などの値を HTML に注入する

### `doPost(e)`

- 受信 JSON を解釈し、`action` ごとのハンドラへ振り分ける
- 必要に応じて管理者チェック、`spreadsheetId` 必須チェックをかける
- JSON レスポンスを返す

### 直接呼び出し用関数

Apps Script の `google.script.run` や別経路から使える補助関数として、次も公開されています。

- `saveResponses`
- `listRecords`
- `getRecord`
- `deleteRecord`
- `nfbAcquireSaveLock`
- `nfbExportSearchResults`
- `nfbAppendExportRows`

## ファイル構成

### エントリーポイント・共通部

- `Code.gs`: `doGet` / `doPost`、レスポンス整形、ロック制御
- `constants.gs`: 定数
- `errors.gs`: エラーコードと共通エラー処理
- `model.gs`: リクエストのパースと検証

### フォーム管理

- `formsParsing.gs`: Google Drive URL / フォーム JSON の解析
- `formsMappingStore.gs`: formId と Drive ファイルの対応付け
- `formsStorage.gs`: フォーム保存・読み込みの下層
- `formsCrud.gs`: 作成・更新・削除・アーカイブ
- `formsImport.gs`: Drive からのインポート
- `formsPublicApi.gs`: 外向けラッパー
- `drive.gs`: Drive 操作の共通化

### 設定・プロパティ

- `settings.gs`: 管理者キー、管理者メール、アクセス制御
- `properties.gs`: Script/User Properties の切り替え、更新時刻管理

### スプレッドシート操作

- `sheetsDatetime.gs`: 日付変換
- `sheetsHeaders.gs`: ヘッダー行構築
- `sheetsRowOps.gs`: 行単位の共通処理
- `sheetsRecords.gs`: 保存・一覧・取得・削除・同期
- `sheetsExport.gs`: 検索結果の書き出し

### ビルド関連

- `scripts/bundle.js`: 上記 `.gs` を `dist/Bundle.gs` へ結合
- `appsscript.json`: マニフェスト

## `action` 一覧

`doPost` は `ctx.raw.action` を見て処理を振り分けます。主なものは次の通りです。

| action | 用途 | 備考 |
| --- | --- | --- |
| `forms_list` | フォーム一覧取得 | フォーム管理系 |
| `forms_get` | 単一フォーム取得 | フォーム管理系 |
| `forms_create` | フォーム新規作成 | フォーム管理系 |
| `forms_import` | Drive からフォーム取込 | フォーム管理系 |
| `forms_update` | フォーム更新 | フォーム管理系 |
| `forms_delete` | フォーム削除 | フォーム管理系 |
| `forms_archive` | フォームの公開状態変更 | フォーム管理系 |
| `admin_key_get` / `admin_key_set` | 管理者キー取得 / 保存 | 管理者設定系 |
| `admin_email_get` / `admin_email_set` | 管理者メール取得 / 保存 | 管理者設定系 |
| `list` | レコード一覧取得 | `spreadsheetId` 必須 |
| `get` | 単一レコード取得 | `spreadsheetId` と `id` が必要 |
| `save` | レコード保存 / 更新 | `spreadsheetId` 必須 |
| `delete` | レコード削除 | `spreadsheetId` と `id` が必要 |
| `sync_records` | レコード同期 | `spreadsheetId` 必須 |

補足:

- 管理者設定そのものは `propertyStoreMode=script` のときだけ有効です。
- `propertyStoreMode=user` では管理者設定画面は使わず、フォーム管理系はユーザー単位の Properties 運用になります。

## 保存先の使い分け

### Google Drive

- フォーム定義 JSON の保存先です。
- `formId` と Drive ファイルの対応付けは Properties Service に持ちます。

### Google Sheets

- 回答レコードの保存先です。
- `spreadsheetId` と `sheetName` に基づいて保存先を決めます。
- ヘッダーは NFB 標準レイアウトを前提に組み立てます。

### Properties Service

- フォームと Drive ファイルの対応付け
- 管理者キー / 管理者メール
- フォーム限定アクセスフラグ
- シートの最終更新時刻

`properties.gs` では `__NFB_PROPERTY_STORE_MODE__` の値に応じて、アクティブな保存先を Script Properties / User Properties で切り替えます。なお、管理者設定は Script Properties モードでのみ有効です。

## `dist/` との関係

このリポジトリの `clasp` 対象は `gas/` ではなく `dist/` です。つまり、Apps Script に push されるのは次の生成物です。

- `dist/Bundle.gs`
- `dist/index.html` または `dist/Index.html`
- `dist/appsscript.json`

そのため、`gas/*.gs` は開発用の分割ソースであり、`dist/Bundle.gs` を直接編集する運用にはしません。

## ビルドとデプロイ

通常はリポジトリルートから `.\deploy.ps1` を使います。スクリプトは次を行います。

1. `builder/` をビルド
2. `gas/scripts/bundle.js` で `dist/Bundle.gs` を生成
3. `gas/appsscript.json` を `dist/` へコピー
4. `Index.html` に `<base target="_top">` とデプロイ時刻を注入
5. `clasp push` / `clasp deploy`

手動で確認したいときはルート README の手順に従ってください。

## 補足メモ

- `doGet` は Apps Script の実行ユーザー情報を UI へ渡します。
- `DetermineAccess_` は `form` パラメータ優先で一般ユーザー導線を決めます。
- `settings.gs` の管理者メール設定は、自分自身をロックアウトしないため保存時に現在ユーザーを含むか検証します。
- 検索結果のエクスポートは `sheetsExport.gs` に集約されています。
