# Nested Form Builder - システム仕様書

## 1. システム概要

### 1.1 目的
階層構造を持つフォームをブラウザだけで設計し、スタンドアロンHTML・GAS Webアプリを通じてGoogle Sheetsに回答を保存・検索できる環境を提供する。

### 1.2 現行の主要機能
- **ビジュアルフォームエディタ**: 6階層までのネスト、条件分岐（`childrenByValue`）、displayMode（none/normal/compact）、必須/正規表現/placeholderなどをUIで編集。
- **フォーム/スキーマ管理**: アーカイブ、複数選択操作、JSON/ZIPエクスポート、インポート時の重複解決、localStorageへの永続化。
- **スタンドアロンHTML生成**: `generators/pure_form` でCSS/JS同梱の単一HTMLを生成し、`window.__NFB_CONFIG__`・`window.__NFB_SCHEMA__`で設定を受け渡し。
- **GAS連携**: `Code.gs`＋`sheets.gs`で回答の保存・取得・削除・一覧を提供し、IndexedDBキャッシュや `google.script.run` バックエンドもサポート。
- **検索UI**: `SearchPage` がスプレッドシートヘッダー行やスキーマから列を構築し、AND/OR/比較/正規表現クエリ・ページネーション・削除オペレーションを提供。IndexedDB (`recordsCache`) へ全件キャッシュ。
- **回答編集/再送信**: `FormPage` から既存回答を再読込し、`submitResponses` で再投入。`PreviewPage` も同じレンダラーを共有。
- **デプロイパイプライン**: `deploy.sh` が builder ビルド→GAS結合→`dist/`配置→`clasp push/deploy` を一括実行し、`.gas-deployment.json` に情報をキャッシュ。

### 1.3 技術スタック
- **フロントエンド**: React 19, React Router 6 (HashRouter), Vite 7, `vite-plugin-singlefile`, `file-saver`, `jszip`。
- **バックエンド**: Google Apps Script (V8, HtmlService, SpreadsheetApp, PropertiesService)。
- **ビルド/ツール**: Node.js 18, npm, `@google/clasp`, Playwright（設定のみ）, Bash (`deploy.sh`), `scripts/bundle-gas.js`。
- **ストレージ**:
  - localStorage: フォーム・エントリ・設定・スキーマの保存。
  - IndexedDB: `NestedFormBuilder/recordsCache` に回答一覧キャッシュ。
  - Google Sheets: 永続データソース。ヘッダー6行＋動的列。

### 1.4 主なディレクトリ
- `builder/`: Reactアプリ（`src/app`, `src/features`, `src/generators`, `src/services`）。
- `gas/`: `Code.gs`, `model.gs`, `sheets.gs`, `settings.gs`, `Index.html`, `appsscript.json`。
- `shared/`: `payload_contract.md`, `schema_examples/basic.json`。
- `samples/form.json`: UIで読み込めるデモスキーマ。
- `scripts/bundle-gas.js`: GAS結合スクリプト。
- `docs/images/`, `docs/screenshots/`: UIスクリーンショット。

---

## 2. アーキテクチャ

### 2.1 コンポーネント構成
```
┌──────────────────────────────────────────────────────────────┐
│                        User Browser (builder)                 │
├──────────────────────────────────────────────────────────────┤
│ React 19 SPA (HashRouter)                                    │
│  - AppDataProvider / dataStore / recordsCache                │
│  - Features: admin, editor, preview, export, search, form    │
│  - Services: gasClient (fetch + google.script.run)           │
└───────────────┬──────────────────────────────────────────────┘
                │ HTTPS POST (JSON as text/plain)
                ▼
┌──────────────────────────────────────────────────────────────┐
│      Google Apps Script Web App (`gas/`, bundled to dist/)    │
├──────────────────────────────────────────────────────────────┤
│ doGet  : `Index.html` (builder build)                        │
│ doPost : submit/delete/list/get responses                    │
│ saveResponses/deleteRecord/getRecord/listRecords (script.run)│
│ nfbLoadUserSettings / nfbSaveUserSettings                    │
│ Modules: settings.gs → model.gs → sheets.gs → Code.gs        │
└───────────────┬──────────────────────────────────────────────┘
                │ Spreadsheet API (SpreadsheetApp)             │
                ▼
┌──────────────────────────────────────────────────────────────┐
│                    Google Sheets (最大6階層ヘッダー)         │
└──────────────────────────────────────────────────────────────┘
```

### 2.2 ビルド/デプロイ経路
1. `npm --prefix builder install && npm --prefix builder run build` → `dist/Index.html`。
2. `node scripts/bundle-gas.js` → `dist/Bundle.gs` に統合。
3. `deploy.sh` が `<base target="_top">` を挿入し `dist/appsscript.json` を配置。
4. `clasp push` / `clasp deploy` でGASへデプロイ。結果は `.gas-deployment.json` に保存。

---

## 3. データモデルとストレージ

### 3.1 フォームレコード (`builder/src/app/state/dataStore.js`)
```ts
interface FormRecord {
  id: string;
  name: string;
  description: string;
  schema: Field[];
  settings: FormSettings;
  schemaHash: string;              // computeSchemaHash(schema)
  importantFields: string[];       // collectDisplayFieldSettings(schema).map(path)
  displayFieldSettings: { path: string; mode: "none"|"normal"|"compact"; type: string; }[];
  createdAt: string;               // ISO
  modifiedAt: string;              // ISO
  archived: boolean;
  schemaVersion: number;
}
```
`dataStore` は `nfb.forms.v1` にJSON配列を保存し、読み込み時に `ensureDisplayInfo()` で `displayFieldSettings` を再構築する。

### 3.2 フィールド定義
| プロパティ | 説明 |
| --- | --- |
| `type` | `text`, `textarea`, `number`, `date`, `time`, `select`, `radio`, `checkboxes`, `regex` |
| `label` | 表示ラベル。`validateUniqueLabels` で重複チェック。 |
| `required` | 必須フラグ。`PreviewPage` とスタンドアロンHTMLでバリデーション。 |
| `placeholder`/`showPlaceholder` | `QuestionCard` のトグルで設定。 |
| `pattern` | `regex` 型用。`buildSafeRegex` で検証し、保存時に保持。 |
| `options` | 選択肢。各optionにも `id` が振られ、`normalizeSchemaIDs` が不足分を補う。 |
| `childrenByValue` | 値ごとの子質問配列。最大階層は `MAX_DEPTH = 6`。 |
| `displayMode` | `none`/`normal`/`compact`。`toImportantFlag` と連動し、`collectDisplayFieldSettings` が検索表示列を抽出。`compact`は`radio`/`select`のみ。 |
| `important` | displayMode != none の場合に自動ON。 |

### 3.3 フォーム設定 (`builder/src/features/settings/settingsSchema.js`)
```ts
interface FormSettings {
  formTitle: string;      // default "受付フォーム"
  spreadsheetId: string;  // URLでも可。normalizeSpreadsheetIdでID抽出。
  sheetName: string;      // default "Responses"
  gasUrl: string;         // google.script.run不可環境で使用
  pageSize: number;       // SearchPage の1ページ表示件数
  apiToken?: string;      // standalone runtime向け。存在しない場合は空文字
}
```
- localStorageキー: `nested_form_builder_settings_v1` (`DEFAULT_SETTINGS` とマージ)。
- `useBuilderSettings` は `google.script.run` がある場合 `nfbLoadUserSettings` / `nfbSaveUserSettings` を呼び、Apps ScriptのUserPropertiesにも保存する。

### 3.4 回答レコードとスプレッドシート
```ts
interface EntryRecord {
  id: string;            // r_<timestamp>_<random>
  "No.": number | string;
  formId: string;
  createdAt: string;
  modifiedAt: string;
  data: Record<string, string>; // "親|子|質問" キー
  order: string[];       // 列順
}
```
- GASは `SerializeRecord_` で `Date` や `Array` を文字列化し、`data` にパスキーを格納する。
- スプレッドシート構成: 先頭6行をヘッダー（固定列 `id`, `No.`, `createdAt`, `modifiedAt` + 動的列）。データは7行目以降。
- `Sheets_buildHeaderKeyMap_` が `order` を元に列を動的追加、`Sheets_ensureHeaderMatrix_` で6行固定＋freezeを維持。

### 3.5 クライアント側ストレージ
| 種類 | キー/名称 | 用途 |
| --- | --- | --- |
| localStorage | `nfb.forms.v1` | フォームレコード一覧 |
| localStorage | `nfb.entries.v1` | フォーム毎の回答キャッシュ（スプレッドシート未設定時に使用） |
| localStorage | `nested_form_builder_settings_v1` | ビルダー設定 |
| localStorage | `nested_form_builder_schema_slim_v1` | インポートUI向け一時スキーマ |
| IndexedDB | DB:`NestedFormBuilder`, Store:`recordsCache`, keyPath:`id` | `saveRecordsToCache` / `getRecordsFromCache` / `clearRecordsCache` / `hasCachedRecords` |

---

## 4. GAS APIと連携仕様

### 4.1 ソース構成
1. `settings.gs`: ユーザー設定（PropertiesService）とキー定義。
2. `model.gs`: `Model_normalizeContext_()` がHTTP/ScriptRun双方の入力を統一。
3. `sheets.gs`: ヘッダー生成、binary search付のID検索、CRUD。
4. `Code.gs`: `doGet`, `doPost`, `saveResponses`, `deleteRecord`, `getRecord`, `listRecords`, `handleCors_`, `JsonOutput_`。

### 4.2 HTTPエンドポイント
- **ベースURL**: `https://script.google.com/macros/s/{DEPLOYMENT_ID}/exec`
- **Content-Type**: `text/plain;charset=utf-8`（`gasClient` がJSON文字列を文字列ボディで送信）
- **CORS**: `Access-Control-Allow-Origin`/`Credentials` を `handleCors_` で付与。`OPTIONS` は空レスポンス。

#### doGet
```
GET {BASE_URL}
→ HtmlService.createHtmlOutputFromFile("Index") を返却（builderのビルド成果物）。
```
HashRouter運用のため `<base target="_top">` を `deploy.sh` が挿入済み。

#### doPost（actionによる多機能）
| action値 (省略時: `save`) | 説明 | 主な入力 | 返却 |
| --- | --- | --- | --- |
| `save` | 回答の新規登録/更新 | `spreadsheetId`, `sheetName?`, `responses`, `order`, `id?` | `{ ok: true, spreadsheetUrl, sheetName, rowNumber, id }` |
| `delete` | レコード削除 | `spreadsheetId`, `sheetName?`, `id` | `{ ok: true, id, deletedRow }` |
| `list` | 全件取得 | `spreadsheetId`, `sheetName?` | `{ ok: true, records, count, headerMatrix }`（recordsは未シリアライズRow） |
| `get` | 単一取得 | `spreadsheetId`, `sheetName?`, `id` | `{ ok: true, record: SerializeRecord }` |

**例: 回答送信**
```http
POST {BASE_URL}
Content-Type: text/plain;charset=utf-8

{
  "action": "save",
  "spreadsheetId": "1AbCdEf...",
  "sheetName": "Responses",
  "id": "r_123",
  "responses": { "氏名": "山田" },
  "order": ["氏名"]
}
```

### 4.3 `google.script.run` エントリ
`gasClient` は GAS内で実行される場合に以下を直接呼び出す：
- `saveResponses(payload)` → doPostと同等。
- `deleteRecord(payload)` / `getRecord(payload)` / `listRecords(payload)` → 返却時に `SerializeRecord_` 適用。
- 例外は `normalizeScriptRunError` で `Error` に変換。

### 4.4 ユーザー設定API
- `nfbLoadUserSettings()` / `nfbSaveUserSettings(settings)` が UserProperties (`NFB_USER_SETTINGS_*`) に `formTitle`, `spreadsheetId`, `sheetName`, `gasUrl`, `pageSize` を保存。ビルダーは起動時に読み込み、localStorageとマージする。

### 4.5 エラー/ステータス
- 失敗時は `{ ok: false, error: string }` を返却。HTTPステータスは200/400/500のいずれか（Apps Script制約で常時200の場合もある）。
- `gasClient.handleFetchError()` は 401/403/opaqueredirect を検出し、公開設定やURL誤りを示す日本語エラーを投げる。

---

## 5. フロントエンド実装

### 5.1 ルーティング (`builder/src/app/App.jsx`)
| パス | コンポーネント | 役割 |
| --- | --- | --- |
| `/` | `MainPage` | 非アーカイブフォーム一覧・検索画面遷移ボタン |
| `/search` | `SearchPage` | `?formId=` で対象フォームを指定し、回答一覧/検索/削除 |
| `/form/:formId/new` | `FormPage` | 新規回答作成。`FormPage` が `PreviewPage` を埋め込む |
| `/form/:formId/entry/:entryId` | `FormPage` | 既存回答を読込・編集 |
| `/admin` | `AdminDashboardPage` | 管理ダッシュボード（選択・エクスポート・インポート・アーカイブ） |
| `/admin/forms/new` | `AdminFormEditorPage` | フォーム新規作成 |
| `/admin/forms/:formId/edit` | `AdminFormEditorPage` | 既存フォーム編集 |
| `*` | `NotFoundPage` | 404表示 |

### 5.2 共通状態とサービス
- **AppDataProvider**: `dataStore` を包み、CRUD実行後 `refreshForms()` を共有。`createOperationWithRefresh` で再読み込みを共通化。
- **dataStore**:
  - localStorage読み書き (`readStorage`/`writeStorage`) と `ensureDisplayInfo` により `displayFieldSettings` を常に再計算。
  - `upsertEntry` は `collectResponses`結果を保存し、`order`をシリアライズ。フォームの `settings.spreadsheetId` が設定されている場合は主導でスプレッドシート保存→localStorage同期。
  - `listEntries(formId)` は設定有りなら `gasClient.listEntries` を呼び、recordsを `id` 昇順にソートして `persistEntries` に保存しつつ `headerMatrix` を返す。設定なしの場合はlocalStorage値を返す。
  - `getEntry`/`deleteEntry` も GAS優先・local fallback。
  - `importForms` は `dataStore.createForm` を使ってIDを新規発行し、`exportForms` は `stripSchemaIDs` 済みJSONを返す。
- **recordsCache (`builder/src/app/state/recordsCache.js`)**: IndexedDBに全回答を保存。`saveRecordsToCache` は storeを一旦`clear`してから `put`、`hasCachedRecords` で存在確認。
- **useBuilderSettings**: localStorageとUserPropertiesを同期。`saveUserSettings` はスクリプトRunのみで呼ばれるため、ブラウザ単体でも安全。

### 5.3 管理ダッシュボード (`AdminDashboardPage`)
- テーブルソート済み一覧＋複数選択（`selected` Set）。
- **一括操作**: アーカイブ/復元（選択状態を確認）、削除、スプレッドシートをブラウザで開くボタン。
- **インポート**: `<input type="file" multiple>` でJSON/ZIPを選択。`startImportWorkflow` が重複名を検出し、
  - オプション: overwrite / save-as（auto rename or custom） / abort。
  - `conflictDialog` で「この選択を全件に適用」チェック可。`generateUniqueName` でサフィックス `(2)`, `(3)`...
- **エクスポート**: 1件なら単独JSON、複数ならJSZipでまとめ、`file-saver` でダウンロード。
- `displayFieldSettings` を1行表示し、compact指定列は「簡略表示」ラベルを付与。

### 5.4 フォームビルダー (`FormBuilderWorkspace`)
- `editor`/`preview`タブ切替。`runSelfTests()` を初回マウント時に実行し、collect/regexの自己テストを行う。
- `EditorPage` → `QuestionList` → `QuestionCard` 構造。
  - 質問選択で上下移動をトグル。optionの移動・削除ボタン、子質問追加ボタン、placeholderトグルを提供。
  - タイプ切替時に `handleTypeChange` が `_savedChoiceState` を保持し、選択肢⇔入力型の往復でも子質問やdisplayModeを復元。
  - `validateSchema` が `validateUniqueLabels` / `validateMaxDepth` を呼び、エラーは `AlertDialog` で即時通知。
- `SearchPreviewPanel` が現在入力値から `collectResponses` → `buildSearchColumns` → `computeRowValues` を再利用し、検索表のイメージを即時表示。

### 5.5 プレビュー＆回答ページ
- `PreviewPage` は `FieldRenderer` を再帰レンダリング。`collectDefaultNowResponses` が `defaultNow` フラグを初期値にセット。
- `validateByPattern` が `regex` フィールドのエラーを即時表示。`hasValidationErrors` で送信前チェック。
- `FormPage`:
  - ルーティング状態 (`location.state`) を読み、一覧/検索からの戻り先を保持。
  - `dataStore.getEntry` で既存回答をロードし、`restoreResponsesFromData` でUI値に変換（Sheetsの1899年基準時間対応含む）。
  - `beforeunload` で未保存警告。`ConfirmDialog` で保存/破棄を選べる。
  - 保存時は `PreviewPage` の `submit({ silent: true })` を呼び、`submitResponses` + `dataStore.upsertEntry` を連携。

### 5.6 エクスポート/スタンドアロンHTML
- `ExportFormHtmlButton` → `createFormHtmlString(schema, settings)`：
  - `computeSchemaHash` を含む `window.__NFB_CONFIG__` を埋め込み、`normalizeSpreadsheetId` でURLをID化。
  - `runtime.inline.js` は custom alert、recordId生成、`collectResponses`、`collectAllPossiblePaths`、`sortResponsesMap` を埋め込み、`fetch` or `google.script.run` の両方をサポート。
- `ExportSchemaButton` は `stripSchemaIDs` 済みスキーマと設定をJSON保存。複数フォームは `AdminDashboard` からZIP出力可。

### 5.7 検索UI (`SearchPage`/`features/search/searchTable.js`)
- `buildSearchColumns()` がフォーム設定のdisplayModeを列に変換。スプレッドシートから `headerMatrix` が届いた場合は `buildColumnsFromHeaderMatrix` に差し替え。
- `matchesKeyword()` はトークン/構文解析で以下をサポート：
  1. キーワード単体（全列OR）
  2. `列名:部分一致`
  3. 比較演算 (`>`, `>=`, `<`, `<=`, `=`, `!=`, `<>`, `><`)
  4. 正規表現 (`列名:/pattern/`)
  5. `AND` / `OR` / `()` での論理結合
- `saveRecordsToCache` により再取得を抑止。`location.state?.saved`/`fromMainPage` で強制再取得。
- 一覧は `headerRows`（複数行ヘッダー）＋ `computeRowValues`（表示値/ソート用値/ts）で構成。行選択→削除が可能。

### 5.8 設定・ユーティリティ
- `SettingsPanel` は `SETTINGS_FIELDS` を元にフォーム設定を編集。`normalizeSpreadsheetId` でURL/ID両対応。
- `utils/responses.js` が `collectResponses` の逆変換（Sheets値→UI）と `hasDirtyChanges` を提供。
- `utils/dateTime.js` は Sheets由来の `1899-12-30` 系ISOをユーザー表示に変換し、検索ソートでも利用。

---

## 6. 代表的なデータフロー

1. **フォーム作成/編集**: `MainPage` → `/admin` → `/admin/forms/new|:id/edit` → `FormBuilderWorkspace`（編集/プレビュー/保存）→ `dataStore.(create|update)` → localStorage更新 → `AppDataProvider.refreshForms()`。
2. **フォーム配布**: `Admin` で `ExportFormHtmlButton`/`ExportSchemaButton` を使用し、単一HTMLまたはJSONを共有。HTMLはGoogle Drive等に配置しても単独動作する。
3. **回答送信（ビルダー上）**: `FormPage` → `PreviewPage.submit` → `collectResponses` → `submitResponses` (`gasClient`経由) → GAS `SubmitResponses_` → `Sheets_upsertRecordById_`。成功後 `dataStore.upsertEntry` がローカルキャッシュ更新 → IndexedDBへ同期。
4. **回答送信（スタンドアロンHTML）**: runtimeが `fetch` で `action=save` をPOST。`order` は全パス（空回答含む）を生成して送信し、列順を維持。
5. **回答一覧/検索**: `SearchPage` → `dataStore.listEntries`。`forms.settings.spreadsheetId` があればGAS→IndexedDBへ全件保存→`computeRowValues`でテーブル化。キャッシュのみで済む場合はIndexedDBから即座に描画。
6. **回答削除**: `SearchPage` の行アクション→`dataStore.deleteEntry`→`gasClient.deleteEntry`→GAS `DeleteRecord_`。成功後 localStorage/IndexedDB キャッシュも削除。

---

## 7. バリデーションとセキュリティ
- **スキーマ検証**: `validateUniqueLabels` / `validateMaxDepth` / `normalizeSchemaIDs` が保存時に適用され、欠損IDや6階層超過を防ぐ。
- **入力検証**: `buildSafeRegex` と `validateByPattern` がユーザー指定正規表現を実行前にチェック。不正なパターンはUIで赤枠表示。
- **データ正規化**: `Model_normalizeContext_` が `sheetName` デフォルトを `Responses` に統一、`order` 無指定時は `responses` のキー列挙。
- **CORS/権限**: `handleCors_` がOriginを反映し、`Access-Control-Allow-Credentials` を常時trueに設定。GASは `executeAs: USER_DEPLOYING`, `access: ANYONE`（`gas/appsscript.json`）。
- **ストレージの注意**: localStorage/IndexedDBは暗号化されず、ブラウザクリアで消失。機微データはスプレッドシートにのみ残す想定。
- **スキーマハッシュ**: `computeSchemaHash` がバージョン管理用途でHTML内に埋め込まれる（回答payloadにも含まれる）。

---

## 8. パフォーマンスと制約
- **二分探索**: `Sheets_binarySearchById_` が ID列ソート済みかつ `r_` 形式である場合にO(log n)で検索。ソート済みでない場合は線形探索へフォールバック。
- **自動ソート**: `Sheets_getAllRecords_` はデータ取得前に `id` 列で昇順ソートし、`records` を返送。
- **ヘッダー最適化**: `Sheets_buildHeaderKeyMap_` と `collectDisplayFieldSettings` が列順を固定し、検索表の再計算コストを抑制。
- **React最適化**: `useMemo`/`useCallback`/`useRef` により再レンダリングを抑制。`createOperationWithRefresh` でCRUD後の副作用を共通化。
- **IndexedDBキャッシュ**: 大量データでも再度GAS呼び出しを避け、`SearchPage` の初期表示を高速化。
- **シングルファイルビルド**: `vite-plugin-singlefile` でCSS/JSを1ファイルにまとめ、GAS `HtmlService` での配信を簡略化。

### 8.1 制約
| 項目 | 値 |
| --- | --- |
| GAS同期実行時間 | 約6分/リクエスト |
| GAS WebApp同時実行 | およそ30リクエスト/秒 |
| Google Sheets | 最大5,000,000セル。ヘッダー6行固定 |
| localStorage | 約5〜10MB（ブラウザ依存） |
| IndexedDB | ブラウザ依存（Chrome 50MB+） |
| ネスト深度 | `MAX_DEPTH = 6`（UI/保存時で強制） |

---

## 9. 将来の拡張候補
1. Google OAuth 2.0 によるユーザー認証とフォーム所有者分離。
2. Firestoreなど別データストアへの同期、WebSocketによるリアルタイム更新通知。
3. 回答の集計ダッシュボード、グラフ、CSV/Excelエクスポート。
4. 多言語化（i18n）とテーマ切替（ライト/ダーク）。
5. スキーマ差分管理や履歴ロールバック。

---

## 10. ビルド/デプロイ運用

### 10.1 npmスクリプト
| スクリプト | 内容 |
| --- | --- |
| `npm run builder:install` | builder配下の依存関係をインストール |
| `npm run builder:build` | Viteビルド（単一HTML生成） |
| `npm run builder:dev` | ローカル開発サーバ |
| `npm run clasp:login/push/pull` | Apps Script への操作 |

### 10.2 `deploy.sh`
1. オプション解析（`--manifest-override`）。
2. builder依存関係インストール＆ビルド。
3. `scripts/bundle-gas.js` 実行で `dist/Bundle.gs` を生成。
4. `<base target="_top">` 追記、`gas/appsscript.json` を `dist/` へコピー（必要に応じてoverrideマージ）。
5. `clasp push` → `clasp deploy`。JSONレスポンス対応、fallback解析あり。
6. デプロイ情報を `.gas-deployment.json` に書き込み、HTTPステータスチェック（curlで302/401警告）。

### 10.3 `scripts/bundle-gas.js`
- `gas/settings.gs → model.gs → sheets.gs → Code.gs` の順で結合し、ヘッダーコメントを自動付与。
- `dist/` が存在しなければ作成。

---

## 11. トラブルシューティング

### 11.1 GASが401/403/302を返す
- `gasClient` のエラー文「アクセスが許可されていません」「リダイレクトを返しました」が表示された場合、`deploy.sh` 後にGAS管理画面で「アクセスできるユーザー」を「全員」に設定し直す。
- URLをコピーし直し、`settings.gasUrl` に最新の `.../exec` を貼り付ける。

### 11.2 検索結果が更新されない
1. `SearchPage` サイドバーから「再取得」相当の操作を行う（フォーム一覧→検索ページに戻ると `location.state.fromMainPage` で強制再読込）。
2. ブラウザのDevToolsで `IndexedDB` (`NestedFormBuilder/recordsCache`) と `localStorage` (`nfb.entries.v1`) をクリアし、再ロードする。
3. スプレッドシート側でID列を昇順にソート。`Sheets_binarySearchById_` はソート済みである前提。

### 11.3 ビルド/デプロイ失敗
- `builder/node_modules` を削除→`npm run builder:install`。
- `npm cache clean --force` 実行後に再ビルド。
- `clasp push` 実行時に認証エラーが出る場合は `npm run clasp:login` で再ログイン。

### 11.4 GASへの書き込みが失敗する
- `FormSettings` の `spreadsheetId` がURLのままになっている場合があるため、`normalizeSpreadsheetId` の結果（ID）を設定する。
- `PropertiesService` に保存した設定が古い場合、`useBuilderSettings` の UI で更新し直す。

---

## 12. 付録

### 12.1 参考ドキュメント
- `README.md`: 開発・セットアップ手順概要。
- `shared/payload_contract.md`: フォームHTML → GAS へのpayload仕様。
- `shared/schema_examples/basic.json`: 最小スキーマ例。
- `samples/form.json`: 実際のフォーム（ヒグマ相談）例。
- `docs/user_manual_v2.docx`: 操作マニュアル（Word形式）。
- `docs/images/`, `docs/screenshots/`: UI参考画像。

### 12.2 バージョン情報
- `dist/` : `deploy.sh` 実行時に `Bundle.gs`, `Index.html`, `appsscript.json` を生成。
- `test-results/`: Playwright実行ログ（自動生成）

---

**ドキュメントバージョン**: 1.1

**最終更新**: 2025-11-15

**作成者**: Codex (AI-assisted)
