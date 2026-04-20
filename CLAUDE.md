# CLAUDE.md

このファイルは、Claude Codeがこのリポジトリで作業する際のガイダンスを提供します。

## プロジェクト概要

**Nested Form Builder**は、ネストされた階層構造（最大11階層）を持つアンケートフォームを視覚的に作成し、スタンドアロンHTMLとして出力できるフォームビルダーです。生成されたフォームの回答はGoogle Sheetsに自動保存され、Google DriveへのファイルアップロードやテンプレートベースのPDF/Gmail出力にも対応します。

### 技術スタック

- **フロントエンド**: React 19 + Vite 7（SPA、vite-plugin-singlefileで単一HTMLに出力）
- **バックエンド**: Google Apps Script（V8ランタイム）
- **データ保存**: Google Sheets（回答）、Google Drive（フォーム定義JSON・アップロードファイル）
- **ブラウザキャッシュ**: IndexedDB（SWR方式の差分同期）
- **ユーザー情報**: Google People API（プロフィール自動取得）
- **出力**: Google Docs（テンプレート出力）、Gmail（添付付き送信）
- **デプロイ**: clasp（Google Apps Script CLI）

## プロジェクト構成

```
nested_form_builder/
├── builder/                    # React フロントエンドアプリケーション
│   ├── src/
│   │   ├── app/               # アプリケーションシェル
│   │   │   ├── components/    # 共通UI（AlertDialog, BaseDialog, ConfirmDialog, RecordCopyDialog, AppLayout）
│   │   │   ├── hooks/         # 共通Hooks（useAlert, useBeforeUnloadGuard, useEditLock, useLatestRef 等）
│   │   │   ├── state/         # 状態管理（dataStore, recordsCache, formsCache, cachePolicy, syncUploadPlan, authContext, AppDataProvider, AlertProvider）
│   │   │   ├── theme/         # テーマシステム（tokens.js, theme.js, 11種のCSS テーマ）
│   │   │   ├── App.jsx
│   │   │   └── main.jsx
│   │   ├── core/              # コアロジック
│   │   │   ├── schema.js      # スキーマ定義・正規化・バリデーション
│   │   │   ├── schemaUtils.js # ツリー走査・変換（traverseSchema, mapSchema）
│   │   │   ├── validate.js    # フィールドバリデーション（パターン, email, phone, URL, 数値範囲）
│   │   │   ├── collect.js     # 回答収集・パス管理
│   │   │   ├── computedFields.js # 計算フィールド評価
│   │   │   ├── formulaEngine.js  # 数式エンジン（計算/置換フィールド用）
│   │   │   ├── constants.js   # 定数（MAX_DEPTH=11, IndexedDB設定, キャッシュTTL）
│   │   │   ├── ids.js         # ULID ベースのID生成
│   │   │   ├── phone.js       # 電話番号処理（日本向け）
│   │   │   ├── displayModes.js # 表示モード管理
│   │   │   ├── styleSettings.js # フィールドスタイル設定
│   │   │   ├── storage.js     # ストレージ抽象化
│   │   │   └── selfTests.js   # 起動時セルフテスト
│   │   ├── features/          # 機能別モジュール
│   │   │   ├── admin/         # フォーム管理ワークスペース（FormBuilderWorkspace, SearchPreviewPanel）
│   │   │   ├── editor/        # フォームエディタUI（EditorPage, QuestionCard, QuestionList, OptionRow）
│   │   │   ├── export/        # 設定パネル（SettingsPanel）
│   │   │   ├── nav/           # ナビゲーション（SchemaMapNav, schemaMapNavTree）
│   │   │   ├── preview/       # プレビュー・入力（PreviewPage, FileUploadField, printDocument）
│   │   │   ├── search/        # 検索・一覧（searchTable, useEntriesWithCache, components/）
│   │   │   └── settings/      # 設定管理（settingsSchema, settingsStore, themeSyncRules）
│   │   ├── pages/             # ページコンポーネント
│   │   │   ├── AdminDashboardPage.jsx   # フォーム一覧・管理
│   │   │   ├── AdminFormEditorPage.jsx  # フォームエディタ
│   │   │   ├── AdminImportUrlDialog.jsx # URL/Drive からのフォームインポート
│   │   │   ├── AdminSettingsPage.jsx    # 管理者設定
│   │   │   ├── ConfigPage.jsx           # フォーム個別設定
│   │   │   ├── FormPage.jsx             # フォーム入力画面
│   │   │   ├── SearchPage.jsx           # データ検索・閲覧
│   │   │   ├── MainPage.jsx             # エントリーポイント
│   │   │   ├── NotFoundPage.jsx         # 404
│   │   │   └── （各ページヘルパー: configPageSettings, formPageHelpers, useAdminDashboardActions, useConfigPageTheme）
│   │   ├── services/          # 外部サービス連携
│   │   │   └── gasClient.js   # GAS API クライアント（30+関数）
│   │   └── utils/             # ユーティリティ
│   │       ├── responses.js          # 回答正規化・変換
│   │       ├── formPaths.js          # パス・表示フィールド管理
│   │       ├── printTemplateAction.js # テンプレート出力アクション定義
│   │       ├── recordOutputActions.js # レコード出力アクション（PDF/Gmail等）
│   │       ├── tokenReplacer.js      # フロント側トークン置換（GAS側と対応）
│   │       ├── tokenTransformers.js  # パイプ変換ロジック
│   │       ├── excelExport.js        # Excel エクスポート（ExcelJS）
│   │       ├── dateTime.js           # 日時ユーティリティ（JST, シリアル日付変換）
│   │       ├── driveFolderState.js   # Driveフォルダ状態管理
│   │       ├── spreadsheet.js        # スプレッドシートURL解析
│   │       ├── settings.js           # 設定ヘルパー
│   │       ├── formNormalize.js      # レコード正規化
│   │       ├── formShareUrl.js       # フォーム共有URL
│   │       ├── perfLogger.js         # パフォーマンス監視
│   │       └── deepEqual.js          # 再帰的等値比較（変更検知）
│   ├── Index.html             # エントリーポイント
│   └── vite.config.mjs        # Vite設定（singlefile出力）
├── gas/                        # Google Apps Script ソースファイル
│   ├── Code.gs                # メインエンドポイント（doGet/doPost）
│   ├── codeAuth.gs            # 認証・ユーザープロフィール解決（People API）
│   ├── codeHandlers.gs        # HTTPハンドラ本体
│   ├── codeSyncRecords.gs     # レコード差分同期エンドポイント
│   ├── constants.gs           # 全定数・ULID生成（NFB_HEADER_DEPTH=11, NFB_DATA_START_ROW=12）
│   ├── driveFile.gs           # Driveファイル操作（アップロード, 取得）
│   ├── driveFolder.gs         # Driveフォルダ管理
│   ├── driveTemplate.gs       # テンプレートトークン解決・パイプ変換
│   ├── driveOutput.gs         # PDF / Gmail 出力
│   ├── drivePrintDocument.gs  # Google Doc テンプレート差し込み
│   ├── errors.gs              # エラーヘルパー（nfbSafeCall_）
│   ├── formsCrud.gs           # フォームCRUD
│   ├── formsImport.gs         # フォームインポート
│   ├── formsMappingStore.gs   # フォーム↔Driveファイル マッピング永続化
│   ├── formsParsing.gs        # フォームJSON解析・正規化
│   ├── formsPublicApi.gs      # 公開API関数（nfbListForms, nfbGetForm, nfbSaveForm 等）
│   ├── formsStorage.gs        # フォームのDrive保存
│   ├── model.gs               # リクエスト解析・正規化
│   ├── properties.gs          # PropertyStoreモード管理（script/user）, サーバータイムスタンプ
│   ├── settings.gs            # 設定管理（管理者キー, メール, アクセス制限）
│   ├── sheetsDatetime.gs      # 日時シリアル変換
│   ├── sheetsHeaders.gs       # ヘッダー行管理（11行深さ）
│   ├── sheetsRecords.gs       # レコードCRUD・リテンション削除
│   ├── sheetsRowOps.gs        # 行操作（二分探索, upsert）
│   ├── syncRecordsMerge.js    # 差分同期マージロジック
│   ├── appsscript.json        # GAS設定（V8ランタイム, OAuthスコープ）
│   └── scripts/
│       └── bundle.js          # GASファイル結合スクリプト
├── gas_for_spreadsheet/        # スプレッドシートバウンド用GASユーティリティ
│   └── SpreadsheetUtilities.gs
├── scripts/                    # 自動化スクリプト
│   ├── capture-user-manual.js
│   ├── capture_user_manual_images.js
│   └── generate_press_template.py
├── tests/                      # テストファイル
│   ├── gas-drive-template-replacement.test.cjs  # テンプレート置換テスト
│   ├── gas-google-drive-url-parsing.test.cjs    # URL解析テスト
│   ├── gas-header-normalization.test.cjs        # ヘッダー正規化テスト
│   ├── gas-sync-records-merge.test.js           # 同期マージテスト
│   └── test-playwright.js                       # E2Eテスト
├── dist/                       # ビルド成果物（gitignore対象）
├── docs/                       # ドキュメント
│   ├── user_manual.md
│   └── user_manual_images/
├── deploy.ps1                  # PowerShellデプロイスクリプト
├── package.json                # ルートパッケージ設定
└── .gitignore                  # .clasp.json, dist/ 等を除外
```

## 主要な開発コマンド

### インストール

```bash
# ルートの依存関係インストール（clasp, playwright等）
npm install

# builderの依存関係インストール
npm run builder:install
```

### 開発

```bash
# Reactアプリをローカル開発サーバーで起動（http://localhost:5173）
npm run builder:dev

# Reactアプリをビルド
npm run builder:build

# ビルド後のプレビュー
npm run builder:preview
```

### テスト

```bash
# Playwright E2Eテスト
npm run test:playwright

# GASユニットテスト（tests/ディレクトリ）
node tests/gas-drive-template-replacement.test.cjs
node tests/gas-sync-records-merge.test.js
```

テストは2箇所に分散：
- `tests/` — GASバックエンドのユニットテスト（Node.js assert/strict）
- `builder/src/**/*.test.js` — フロントエンドのユニットテスト（インラインテスト）

### デプロイ

```powershell
# 完全自動デプロイ（推奨）
.\deploy.ps1

# オプション付きデプロイ
.\deploy.ps1 -PropertyStore user                           # ユーザープロパティモード
.\deploy.ps1 --manifest-override path/to/override.json     # マニフェスト上書き
.\deploy.ps1 -BundleOnly                                   # ビルドのみ（clasp操作スキップ）
.\deploy.ps1 -PushOnly                                     # pushのみ（deployスキップ）

# 手動操作の場合
npm run clasp:login           # 初回のみ
npm run builder:build         # 1. Reactアプリビルド
node gas/scripts/bundle.js    # 2. GASファイル結合
npm run clasp:push            # 3. Google Apps Scriptへプッシュ
npx @google/clasp deploy      # 4. Webアプリとしてデプロイ
```

### デプロイスクリプトの動作

`deploy.ps1` は以下を自動実行します：

1. `builder` のビルド（`npm install` + `vite build`）
2. GASファイルの結合（`gas/scripts/bundle.js` → `dist/Bundle.gs`）
3. `Bundle.gs`内の `__NFB_PROPERTY_STORE_MODE__` プレースホルダーを指定モードに置換
4. `Index.html`に `<base target="_top">` タグとデプロイタイムスタンプを注入
5. `appsscript.json` を `dist/` にコピー（`--manifest-override` 指定時はマージ）
6. `clasp push`（`-BundleOnly`時はスキップ）
7. `clasp deploy`（`-PushOnly`/`-BundleOnly`時はスキップ）
8. デプロイ情報のキャッシュ（`.gas-deployment.json`）

## アーキテクチャ

### データフロー

1. **フォーム設計**: Reactアプリでフォームスキーマを作成・編集
2. **フォーム保存**: スキーマをGAS経由でGoogle DriveにJSONファイルとして保存、マッピング情報をPropertiesServiceに永続化
3. **HTML生成**: GAS `doGet`でスタンドアロンHTMLを配信（`window.__IS_ADMIN__`, `__FORM_ID__`, `__USER_EMAIL__` 等を注入）
4. **回答送信**: フォームからGAS WebアプリへPOST → Google Sheetsに正規化して保存
5. **ファイルアップロード**: フォームからGAS経由でGoogle Driveフォルダにファイルを保存
6. **テンプレート出力**: レコードデータ → Google Docテンプレート → PDF/Gmail出力
7. **データ取得**: IndexedDBキャッシュファースト → GAS API経由で差分同期
8. **データ検索**: キャッシュ済みレコードに対してブラウザ側でクエリ実行

### 主要コンポーネント

#### Builder（React SPA）

- **ページ**: AdminDashboardPage（フォーム一覧）、AdminFormEditorPage（フォームエディタ）、FormPage（フォーム入力）、SearchPage（データ検索）、ConfigPage（フォーム設定）、AdminSettingsPage（管理者設定）、MainPage（エントリーポイント）
- **状態管理**:
  - `AppDataProvider` — フォーム一覧のグローバル状態（バックグラウンド自動更新）
  - `dataStore` — GAS呼び出しとIndexedDBキャッシュの統合データアクセス層
  - `recordsCache` — IndexedDBによるレコードキャッシュ（差分同期対応）
  - `formsCache` — IndexedDBによるフォームキャッシュ
  - `cachePolicy` — SWR方式のキャッシュ評価（即座に表示→バックグラウンド更新）
  - `authContext` — GAS注入のwindow変数から認証情報を提供
- **テーマ**: 11種の組み込みテーマ（standard, dark, ocean, forest, sakura, matcha, warm, snow, christmas, egypt, india）

#### GAS Backend

- **doGet/doPost**: HTTPエンドポイント、ユーザープロフィール解決（People API）
- **公開API**（`nfb`プレフィックス）: `nfbListForms`, `nfbGetForm`, `nfbSaveForm`, `nfbDeleteForm`, `nfbArchiveForm`, `nfbUnarchiveForm`, `nfbValidateSpreadsheet`, `nfbImportFormsFromDrive` 等
- **フォーム管理**: Google DriveにJSONファイルとして保存、`formsMappingStore`でID⇔ファイル対応を管理
- **シート操作**: 5ファイルに分割 — `sheetsHeaders`（11行ヘッダー管理）、`sheetsRecords`（レコードCRUD）、`sheetsRowOps`（二分探索・upsert）、`sheetsDatetime`（日時変換）、`sheetsExport`（エクスポート）
- **Drive統合**: `driveFile`/`driveFolder`/`driveTemplate`/`driveOutput`/`drivePrintDocument` の5ファイルに分割 — テンプレート出力（PDF/Gmail/Google Doc）、フォルダ管理、ファイルアップロード
- **PropertyStoreモード**: `script`（管理者のみ）/ `user`（ユーザー別設定）

### データ構造

#### フォームスキーマ

```javascript
{
  id: "form_xxx",
  name: "フォーム名",
  description: "説明",
  schema: [
    {
      id: "q1",
      type: "text",              // 後述のフィールドタイプ参照
      label: "質問テキスト",
      required: true,
      placeholder: "入力例",
      isDisplayed: true,         // 表示/非表示制御
      styleSettings: {...},      // フィールドスタイル
      defaultValueMode: "none",  // none, userName, userAffiliation, userTitle, custom
      children: [...],           // ネストされた質問（最大11階層）
      childrenByValue: {...},    // 条件分岐（選択肢ごとの子要素）
      printTemplateAction: {...} // テンプレート出力設定（printTemplateタイプのみ）
    }
  ],
  settings: {
    spreadsheetId: "...",
    sheetName: "Data",
    gasUrl: "https://script.google.com/macros/s/.../exec"
  }
}
```

**フィールドタイプ**: `text`, `number`, `email`, `phone`, `url`, `date`, `time`, `radio`, `select`, `checkboxes`, `weekday`, `message`, `fileUpload`, `printTemplate`

#### スプレッドシートレイアウト

- **行1-11**: ヘッダー（`NFB_HEADER_DEPTH = 11`、最大11階層の質問パス）
- **行12〜**: データ（`NFB_DATA_START_ROW = 12`）
- **固定列**: `id`, `No.`, `createdAt`, `modifiedAt`, `deletedAt`, `createdBy`, `modifiedBy`, `deletedBy`, `driveFolderUrl`
- **動的列**: 質問パスに基づく列（例: `parent|child|question`）

## テンプレートトークンシステム

Google DocテンプレートやファイルI/フォルダ名で使用するトークン置換システム。

### トークン構文

```
{@_id}                          # 予約トークン（@ プレフィックス必須）
{@fieldLabel}                   # @ 参照: 予約トークン優先 → フィールド参照フォールバック
{fieldLabel}                    # @ なしはトークンとして解決されず空文字に置換される
{@field|transform:args}         # パイプ変換付き
{@field|tr1:args|tr2:args}      # 変換チェーン（左→右）
{value|if:@_folder_url,fallback} # if条件で予約トークンを真偽判定
{@a|ifv:cond,({@b})記載あり,記載なし}  # サブテンプレート — 値位置に {...} を埋め込み可
```

### 予約トークン（@ プレフィックス必須）

| トークン | 内容 |
|---------|------|
| `{@_id}` | レコードID |
| `{@_NOW}` | 現在日時。`{@_NOW\|time:YYYY年MM月DD日}` のようにパイプで整形可 |
| `{@_folder_url}` | Driveフォルダ URL（Gmail出力時のみ有効） |
| `{@_record_url}` | レコード URL（Gmail出力時のみ有効） |
| `{@_form_url}` | フォーム URL（Gmail出力時のみ有効） |
| `{@_file_urls}` | アップロードファイル URL（カンマ区切り） |

予約トークンは `if` 条件でも使用可能（値が存在すれば真、空なら偽）:
- `{@value|if:@_folder_url,fallback}` — `_folder_url` があれば `value`、なければ `fallback`
- `{@value|if:@_file_urls,ファイルなし}` — アップロードファイルがあれば `value`、なければ `ファイルなし`

### パイプ変換

| 変換 | 説明 | 例 |
|------|------|-----|
| `time:format` | 日付・時刻書式（YYYY, MM, DD, M, D, YY, HH, H, mm, m, ss, s, gg, ee, ddd, dddd） | `{@field\|time:YYYY年M月D日}` |
| `left:n`, `right:n` | 文字列切り出し | `{@field\|left:3}` |
| `mid:start,length` | 中間切り出し | `{@field\|mid:2,5}` |
| `pad:n[,char]`, `padRight:n[,char]` | 埋め文字（デフォルト `0` / スペース） | `{@field\|pad:5}` |
| `upper`, `lower`, `trim` | 文字列操作 | |
| `default:fallback` | 空値時のデフォルト | `{@field\|default:未入力}` |
| `replace:from,to` | 文字列全置換（リテラル一致） | `{@field\|replace:-,/}` |
| `match:pattern[,group]` | 正規表現グループ抽出 | `{@field\|match:\\d+}` |
| `number:format` | 数値書式（`#,##0.00` 等） | `{@field\|number:#,##0}` |
| `if:condition,elseValue` | 条件分岐（`@field`/`@_reserved` 参照、`==`/`!=`/`>`/`>=`/`<`/`<=`/`in`/`not` 演算子）。条件内で `_` はパイプ入力値を参照 | |
| `ifv:condition,trueValue,falseValue` | 3引数条件分岐 — 真なら`trueValue`、偽なら`falseValue`を返す。値に `_`（パイプ値）/`@ref`/リテラル使用可 | `{@報道の結果\|ifv:記事掲載 in _,■,□}` |
| `map:k1=v1;k2=v2;*=fb` | 値マッピング（`;` 区切り、`*=` でフォールバック） | |
| `noext` | ファイル名から拡張子を除去 | `{@field\|noext}` |
| `kana`, `zen`, `han` | カナ・全角・半角変換 | |

### サブテンプレート（値位置の再帰解決）

`ifv` の真/偽値、`if` の else 値、`default` のフォールバック値などの **値位置** には、`{...}` トークンをそのまま埋め込めます。フィールド参照とリテラル文字列を自由に組み合わせて出力を組み立てられます。

```
{@状態|ifv:@状態==完了,({@対応者})記載あり,記載なし}
{@納期|default:未定（{@登録日|time:M月D日}時点）}
{@報告|ifv:@報告,({_})完了,未完了}      # サブテンプレート内の {_}/{@_} はパイプ入力値
```

特性：
- サブテンプレート内でパイプ変換も再利用可（例: `{@金額|number:#,##0}`）
- ネスト可（`ifv` の真/偽値の中にさらに `ifv` を書くなど）
- ブレース対応のコンマ分割により、`{...}` 内のコンマで誤分割されない
- リテラルの `{` `}` を出したい場合は従来通り `\{` `\}` でエスケープ

## キャッシュアーキテクチャ

### IndexedDB構成

- **データベース**: `NestedFormBuilder`（version 4）
- **ストア**: `formsCache`, `recordsCache`（複合キー `formId::entryId`）, `recordsCacheMeta`, `settingsStore`

### SWRポリシー

- レコード/フォームともに **max age 30分**、**background refresh 5分**
- キャッシュがあれば即座に表示し、バックグラウンドで最新データを取得
- キャッシュミス時はGAS APIにフォールバック

### 差分同期

- `NFB_SERVER_MODIFIED_AT` / `commitToken` ベースの差分取得
- `syncRecordsMerge.js`: シートデータとキャッシュのマージ（last-write-wins）
- `allIds` による削除検出

## ソフトデリート・リテンション

- `deletedAt` 列でソフトデリート（物理削除しない）
- `deletedBy` 列で削除者を記録
- 設定可能なリテンション期間（デフォルト30日、`NFB_DELETED_RECORD_RETENTION_DAYS`）
- `Sheets_purgeExpiredDeletedRows_` でリテンション期限切れの行を物理削除

## 検索機能

高度な検索クエリをサポート（`searchTable.js`で実装）：

```
# キーワード検索
keyword

# 列指定検索
列名:keyword

# 比較演算
列名>値  列名>=値  列名<値  列名<=値  列名=値  列名!=値

# AND/OR/NOT演算
条件1 AND 条件2
条件1 OR 条件2
NOT 条件

# 正規表現
列名 ~ /パターン/flags

# 括弧でグループ化
(条件1 OR 条件2) AND 条件3
```

エクスポート機能: ExcelJS + JSZipによるExcelファイル生成、Google Driveへの保存

## コーディング規約

### React（builder/src/）

- **関数コンポーネント**とHooksを使用
- **JSX**: ダブルクォート使用
- **インデント**: 2スペース
- **モジュール**: ES Modules（`"type": "module"`）
- **命名規則**:
  - コンポーネント: PascalCase
  - 変数・関数: camelCase
  - 定数: UPPER_SNAKE_CASE
- **状態管理**:
  - グローバル状態は`AppDataProvider`（React Context）
  - データアクセスは`dataStore`（GAS + IndexedDB抽象化）
  - UIブラウザ設定は`settingsStore`（IndexedDB）
- **不要なログ**: 本番環境では`console.log`を使用しない
- **テスト**: ソースと同ディレクトリに `*.test.js` で配置

### Google Apps Script（gas/）

- **V8ランタイム**（`appsscript.json`で設定済み）
- **変数宣言**: 既存コードは`var`を多用（新規コードでも既存スタイルに合わせる）
- **関数宣言**: `function name() {}` 形式
- **インデント**: 2スペース
- **命名規則**:
  - 公開API関数: `nfb`プレフィックス（例: `nfbListForms`, `nfbGetForm`）
  - 内部ヘルパー: 末尾アンダースコア（例: `Forms_getForm_`, `nfbSafeCall_`）
  - ドメインプレフィックス: `Sheets_`, `Forms_`, `Nfb_`, `Sync_`
- **エラーハンドリング**: `nfbSafeCall_`ラッパーパターン（`{ok, error, code}`を返す）

## パフォーマンス最適化

- **二分探索**: ID列がソート済みの場合、`sheetsRowOps.gs`でO(log n)の高速検索
- **IndexedDBキャッシュファースト**: SWRポリシーで即座表示→バックグラウンド更新
- **差分同期**: `commitToken`ベースで変更分のみ転送
- **シングルファイルバンドル**: `vite-plugin-singlefile`でGAS iframe内のゼロリクエストロード
- **バッチ操作**: 複数レコードの一括アーカイブ・削除
- **ロック機構**: `NFB_LOCK_WAIT_TIMEOUT_MS = 10000`で同時書き込み制御
- **メモ化**: `React.useCallback`によるコールバック最適化

## トラブルシューティング

### デプロイ後にアクセスできない

1. GAS管理画面でデプロイ設定を確認
2. 「アクセスできるユーザー」を「全員」に設定
3. ブラウザのキャッシュをクリア

### データが保存されない

1. `settings`で`spreadsheetId`が正しく設定されているか確認
2. GASスクリプトがスプレッドシートへの書き込み権限を持っているか確認
3. Apps Script実行ログ（https://script.google.com）でエラーを確認

### PropertyStoreモード関連

1. `deploy.ps1 -PropertyStore script|user` で正しいモードを指定しているか確認
2. scriptモード: 管理者キーが設定されているか確認（AdminSettingsPage）
3. userモード: 各ユーザーのPropertiesServiceに権限があるか確認

### ビルドエラー

```bash
# 依存関係を再インストール
rm -rf builder/node_modules
npm run builder:install
```

### claspエラー

```bash
# 再ログイン
npm run clasp:login

# .clasp.jsonはgitignore対象のためローカルで作成が必要
# scriptIdを確認: cat .clasp.json
```

## 重要なファイル

- **deploy.ps1**: PowerShellデプロイスクリプト
- **gas/constants.gs**: 全GAS定数・ULID生成（NFB_HEADER_DEPTH, NFB_DATA_START_ROW, NFB_FIXED_HEADER_PATHS等）
- **gas/driveTemplate.gs / driveOutput.gs**: テンプレートトークン・パイプ変換、PDF/Gmail出力ロジック
- **gas/Code.gs**: メインエンドポイント・認証・ユーザープロフィール注入
- **gas/formsPublicApi.gs**: 公開API関数一覧
- **builder/src/core/schema.js**: フォームスキーマ定義・正規化・バリデーション
- **builder/src/core/constants.js**: フロントエンド定数（MAX_DEPTH, IndexedDB設定, キャッシュTTL）
- **builder/src/app/state/recordsCache.js**: IndexedDBキャッシュ実装
- **builder/src/services/gasClient.js**: GAS APIクライアント（全RPC関数）
- **gas/scripts/bundle.js**: GASファイル結合スクリプト（ファイル順序定義）

## 開発時の注意事項

1. **ファイル生成前に確認**: 新規ファイルを作成する前に、必ずユーザーに確認を取る
2. **既存パターンを踏襲**: 既存のコードスタイルと設計パターンに従う
3. **デプロイ前のテスト**: ローカルで十分にテストしてからデプロイ
4. **GASランタイム**: V8ランタイムだが、既存コードは`var`と`function`宣言を多用 — 既存スタイルに合わせる
5. **GAS実行時間制限**: 6分
6. **dist/は自動生成**: gitignore対象。直接編集しない
7. **`.clasp.json`はローカル作成**: gitignore対象のため、クローン後にローカルで作成が必要（`rootDir: "dist"`）
8. **OAuthスコープ変更時**: Gmail, Docs, Sheets, Drive, Forms, People APIのスコープが設定済み。変更すると全ユーザーの再認証が必要
9. **テスト配置**: `tests/`（GASバックエンド）と`builder/src/**/*.test.js`（フロントエンド）に分散

## デプロイ情報の確認

デプロイ後、以下のファイルに情報が保存されます：

- **.gas-deployment.json**: 最新のデプロイID・WebApp URL
- **.clasp.json**: Script ID（gitignore対象、ローカルのみ）

```bash
# 現在のScript IDを確認（ローカルファイル）
cat .clasp.json | grep scriptId

# 最新のデプロイ情報を確認
cat .gas-deployment.json
```

## 関連リンク

- **clasp公式ドキュメント**: https://github.com/google/clasp
- **Google Apps Script API**: https://developers.google.com/apps-script/api/
- **React公式ドキュメント**: https://react.dev/
- **Vite公式ドキュメント**: https://vitejs.dev/
