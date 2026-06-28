# Apps Script バックエンド（Claude 向け詳細）

CLAUDE.md から分離した、GAS 側のエントリポイント・アクション定義・公開関数・`dist/` との関係。GAS を触る前に参照する。

## doGet / doPost

- `doGet(e)` — `Index.html` を配信。`form` / `adminkey` クエリでアクセス権を判定し、初期値を HTML に注入
- `doPost(e)` — 受信 JSON の `action` に応じて `ACTION_DEFINITIONS_` のハンドラへ振り分け
- 公開 API（`nfb*` / `forms_*` / `analytics_*`）はすべて `executeAction_` の 1 経路に集約。`doPost` は `executeAction_(null, e, { source: "doPost" })`、`google.script.run` 経由は `Forms_runScriptAction_` / `Analytics_runScriptAction_` 等のラッパが `executeAction_(action, payload, { source: "scriptRun" })` を呼ぶ。実体は `Forms_dispatch_` / `Analytics_dispatch_` → `Forms_*_` / `Analytics_*_` ヘルパ。

## アクション定義

| action | 用途 | 制約 |
| --- | --- | --- |
| `forms_list` | フォーム一覧取得 | （なし） |
| `forms_get` | 単一フォーム取得 | （なし） |
| `forms_create` | フォーム新規作成（doPost: `formData`/`saveUrl`） | 管理者 |
| `forms_import` | Drive ファイル URL からフォーム取込 | 管理者 |
| `forms_update` | フォーム部分更新（get→merge→save） | 管理者 |
| `forms_delete` | フォーム削除（doPost 旧契約） | 管理者 |
| `forms_archive` | 公開状態変更（doPost 旧契約、`archived` 真偽） | 管理者 |
| `forms_readonly` | 参照のみ状態切替（doPost 旧契約、`readOnly` 真偽） | 管理者 |
| `forms_save` | フォーム保存（`form`/`saveMode`、`nfbSaveForm` 経由。保存先は標準フォルダ構成固定） | （なし） |
| `forms_delete_one` / `forms_delete_batch` | フォーム削除（単一 `formId` / 配列 `formIds`） | （なし） |
| `forms_delete_with_files_batch` | フォーム削除（配列 `formIds`、関連 Drive ファイルごと削除） | （なし） |
| `forms_archive_one` / `forms_unarchive_one` | アーカイブ/解除（単一 `formId`） | （なし） |
| `forms_archive_batch` / `forms_unarchive_batch` | アーカイブ/解除（配列 `formIds`） | （なし） |
| `forms_readonly_set_one` / `forms_readonly_clear_one` | 参照のみ設定/解除（単一 `formId`） | （なし） |
| `forms_readonly_set_batch` / `forms_readonly_clear_batch` | 参照のみ設定/解除（配列 `formIds`） | （なし） |
| `forms_childonly_set_one` / `forms_childonly_clear_one` | 子フォーム専用フラグ設定/解除（単一 `formId`） | （なし） |
| `forms_childonly_set_batch` / `forms_childonly_clear_batch` | 子フォーム専用フラグ設定/解除（配列 `formIds`） | （なし） |
| `forms_copy` | フォーム複製（`formId`） | （なし） |
| `forms_import_drive` | Drive ファイル/フォルダ URL から取込（`url`） | （なし） |
| `forms_register_import` | 取込済みフォームをマッピング登録（`form`/`fileId`） | （なし） |
| `forms_resolve_ref` | フォーム参照（論理パス/旧 fileId）の解決 | （なし） |
| `forms_folders_list` | フォルダ一覧取得 | （なし） |
| `forms_folder_create` / `forms_folder_rename` / `forms_folder_delete` | フォルダ作成/改名/削除 | 管理者 |
| `forms_move` | フォーム/フォルダの移動 | 管理者 |
| `forms_folders_backfill_physical` | 仮想フォルダに対応する物理フォルダの復旧バックフィル | 管理者 |
| `admin_key_get` / `admin_key_set` | 管理者キー取得/保存 | 管理者 |
| `admin_email_get` / `admin_email_set` | 管理者メール取得/保存 | 管理者 |
| `save` | レコード保存/更新 | `spreadsheetId` |
| `save_lock` | 保存ロック取得 | `spreadsheetId` |
| `list` | レコード一覧取得 | `spreadsheetId` |
| `get` | 単一レコード取得 | `spreadsheetId` + `id` |
| `delete` | レコード削除 | `spreadsheetId` + `id` |
| `sync_records` | 差分同期 | `spreadsheetId` |
| `analytics_*` | Question/Dashboard の CRUD/Archive/Copy/Import/参照解決/フォルダ管理（`analyticsApi.gs` 参照） | list/get/resolve_ref 以外は管理者。フォルダ操作は管理者 |

> `forms_save` 等の「（なし）」アクションは `nfb*` フォーム関数（`nfbSaveForm` 等）が経由するため、従来の `nfb*` と同じくゲートなし。`forms_create`/`forms_update`/`forms_delete`/`forms_archive`/`forms_readonly` は doPost 旧契約として `adminOnly` を維持。

## google.script.run 公開関数

レコード系（**`nfb` 無しのレガシー契約**）: `saveResponses` / `listRecords` / `getRecord` / `deleteRecord` / `syncRecordsProxy`（`nfbAcquireSaveLock` のみ `nfb` 付き）

> ⚠️ レコード系 `saveResponses` / `listRecords` / `getRecord` / `deleteRecord` / `syncRecordsProxy` は `nfb` プレフィックスを持たない歴史的な命名。`gas/Code.gs`・`gas/codeSyncRecords.gs` の関数名と `builder/src/services/gasClient.js` の呼び出し文字列が完全一致している必要があるため、リネームするなら両者をロックステップで変更し `dist/Bundle.gs` を再生成すること（doPost の `ACTION_DEFINITIONS_` キー `"save"`/`"list"`/`"get"`/`"delete"`/`"sync_records"` は別物なので無関係）。

その他、Drive 操作系: `nfbSaveExcelToDrive` / `nfbSaveFileToDrive` / `nfbCreateRecordPrintDocument` / `nfbExecuteRecordOutputAction` / `nfbExecuteBatchGoogleDocOutput` / `nfbUploadFileToDrive` / `nfbCopyDriveFileToDrive` / `nfbCreateGoogleDocumentFromTemplate` / `nfbFindDriveFileInFolder` / `nfbFinalizeRecordDriveFolder` / `nfbTrashDriveFilesByIds` / `nfbImportThemeFromDrive`

フォーム管理系: `nfbListForms` / `nfbGetForm` / `nfbSaveForm` / `nfbDeleteForm` / `nfbDeleteForms` / `nfbDeleteFormsWithFiles` / `nfbArchiveForm` / `nfbUnarchiveForm` / `nfbArchiveForms` / `nfbUnarchiveForms` / `nfbSetFormReadOnly` / `nfbClearFormReadOnly` / `nfbSetFormsReadOnly` / `nfbClearFormsReadOnly` / `nfbSetFormChildOnly` / `nfbClearFormChildOnly` / `nfbSetFormsChildOnly` / `nfbClearFormsChildOnly` / `nfbCopyForm` / `nfbImportFormsFromDrive` / `nfbRegisterImportedForm` / `nfbResolveFormRef`

フォルダ操作系: `nfbListFolders` / `nfbCreateFolder` / `nfbMoveItems` / `nfbRenameFolder` / `nfbDeleteFolder` / `nfbBackfillPhysicalFolders`

デプロイ情報系: `nfbGetDeployInfo`（現行デプロイの URL / バージョン等を返す）

> フォーム管理系のうち**単数操作**（`nfbArchiveForm` 等）は GAS 側 `Nfb_unwrapSingleResult_`（`gas/errors.gs`）でバッチ結果を `{ ok, form }` に畳んでから返し、`gasClient.js` 側で `r.form` を取り出す。**複数操作**（`nfbArchiveForms` 等）は `{ ok, forms, errors }` のまま返し、フロントは部分成功/失敗を扱う。この形状差は意図的。
>
> google.script.run の `nfb*` ラッパは `Forms_runScriptAction_` / `Analytics_runScriptAction_` → 共通 `Nfb_runScriptAction_`（`gas/errors.gs`）→ `executeAction_` の 1 経路に集約される。

設定系: `nfbGetAdminKey` / `nfbSetAdminKey` / `nfbGetAdminEmail` / `nfbSetAdminEmail` / `nfbGetRestrictToFormOnly` / `nfbSetRestrictToFormOnly`

外部アクション系: `nfbSendExternalAction`（外部アクション URL へのサーバ間リレー送信。`UrlFetchApp` で POST し、`{ status, body }` を返す）

## 外部アクション送信（外部アクション URL に渡る payload 契約）

「外部アクション」ボタンは、レコード/検索結果を外部の GAS Web アプリ等へ送る機能。**ボタンを押したときに外部アクション URL へ渡る情報**の契約をここにまとめる（実体はフロント側 `builder/src/utils/externalActionPost.js` ほか。受信例は `gas_for_external_action/`）。

### 送信の仕組み（2 パターン共通）

- ブラウザの隠しフォーム POST ではなく、**本体 GAS のサーバ間リレー**で送る（`sendExternalAction` → `nfbSendExternalAction` → `UrlFetchApp`）。隠しフォーム POST はログインリダイレクトで POST 本文を失う弱点があったため廃止。
- 送信先 URL に `?nfbRelay=1` を付け、POST ボディ `payload`(form-encoded) に **JSON 文字列**を入れる。受信側は `e.parameter.payload` を `JSON.parse` で全データを受け取る。
- **誤送信防止プローブ**: 本送信の前に `nfbProbe=1` + `nonce` を投げ、受信側が `HMAC-SHA256(nonce, 共有秘密)` の署名を返せれば宛先を確認して本送信する（確認できないと `DEST_UNVERIFIED`）。
- URL 内トークンは印刷様式と共通の alasql `{{...}}` エンジンで解決（`externalActionUrl.js`）。機微トークン（`_spreadsheet_id` / `_spreadsheet_url` / `_sheet_name` / `_drive_file_url` / `_user_email`）は **adminOnly && isAdmin のときだけ**展開を許可し、違反時は URL を null 化して送信中止。

### payload 共通の外枠（`buildExternalActionPayload`）— 起動元に依らない単一フォーマット

編集・閲覧画面（単票）／検索一覧の単一選択／検索一覧の複数選択の **3 起動元すべてが同一フォーマット**で送る。受信側は **`recordCount`（= `records` 数）だけ**で単一/複数を判定する（旧 `context` フィールドは廃止）。単一レコードしか受け取らない受信側は `recordCount === 1` で弾く。

```
{ formId, formName, generatedAt(ISO8601),
  recordCount,                              // records 数（編集画面・検索単一=1、検索複数=N）
  records: [ { id, no, items:[…] }, … ],    // base は top-level 展開（base ラッパは無い）
  storage? }                                // adminOnly && isAdmin のときだけ付く
```

各レコードの `items`:

```
items: [ { question, value, type, files?, folderUrl?, folderName? }, … ]
```

- `items` は全フィールドをフラットに並べた配列。`question` は階層を `/` 連結したパス文字列。
- **子フォーム（formLink）は常に items にインライン展開**（`buildRecordFromEntry` → `buildRecordItems(..., { childDataByFieldId })`）。子の行は「親カード/#No/子フィールド」の `question` パスで items に並ぶ（`#No` は子レコードのマーカー）。子は **1 階層のみ**（孫 formLink は再帰展開しない）、1 項目あたり最大 200 件（`MAX_CHILD_RECORDS_PER_FIELD`）。
- **ファイルは items[].files に内包**（`[{ name, url, driveFileId? }]`）。`url` は `driveFileId` から決定的に再構成し、`folderUrl` / `folderName` も item に付く。旧・別引数 `files`／サーバ側 Drive 解決は廃止。
- **`includeChildData` フラグは非依存で常時 ON**（schema 正規化で永続化は残すが、どの呼び出し側もフィルタに使わない＝`schema.js`）。

`storage`（管理者限定ボタン＋管理者のみ）= `{ spreadsheetId, spreadsheetUrl, sheetName, driveFileUrl, userEmail, childSpreadsheetId, childSpreadsheetUrl, childSheetName }`

- 子フォーム系（`childSpreadsheetId` / `childSpreadsheetUrl` / `childSheetName`）は**単票・検索一覧の両方**で付く。formLink の子フォーム定義（`settings.spreadsheetId` / `settings.sheetName`）から解決し、親フォームの formLink は通常 1 つなので**最初の非空 `childSpreadsheetId` を持つ子フォームの単一値**を採る（単票=`PreviewPage.jsx` のループ / 一覧=`resolveSearchChildStorageMeta`）。`childSheetName` は空なら `"Data"` 既定。リレー先（choju 等）が子シートへの書き込み/リンク表示に使う。
- **子 SS は `storage`（admin ゲート）のみに載る**。子データ本体（`records[].items`）は SS を含まないため、非管理者へ漏れる経路は無い（旧 `childFormsByRow` 埋め込み＋`stripChildSpreadsheetIds` の二重ガードは不要になり廃止）。

### 起動元ごとの差（`records` 数だけ）

| 起動元 | 送信元 | `recordCount` |
| --- | --- | --- |
| 編集・閲覧画面（単票） | `PreviewPage.jsx` | 1 |
| 検索一覧・単一選択 | `SearchSidebar.buttons.js` | 1（編集画面と完全同形） |
| 検索一覧・複数選択 | `SearchSidebar.buttons.js` | N（選択行があればその行、無ければ絞り込み後の全行） |

- **子データの取得タイミング**: 単票は編集中の子データ（`childFormMeta`）を即インライン。検索一覧は**送信時に on-demand 取得**（一覧表示中は取らずコストを払わない）。クリック時に子フォームごと 1 回 `listRecordsByPids` でバッチ取得し、各行の `items` にインライン展開（`searchChildFormResolvers.js`）。いずれも結果の payload 形は同一。
- **子が付く前提（単票）**: 子を取得するのは **保存済みレコード（id あり）かつ GAS 環境かつ子フォーム文脈でない**ときだけ（未保存・非 GAS・`inChildContext` では子なし）。

### 受信側レスポンス契約

受信側が `nfbRelay=1` で `{ ok, title, message, openUrl }`（JSON）を返せばそれを使う（`interpretExternalActionResponse`）。`openUrl` があれば新規タブで開く。JSON でない（旧受信アプリの HTML 等）ときは汎用の成功メッセージにフォールバックする。

## dist/ との関係

`clasp` の push 対象は `dist/` です。以下の 3 ファイルが反映されます。

- `dist/Index.html` — React ビルド成果物 (single-file)
- `dist/Bundle.gs` — GAS 分割ソースの結合版
- `dist/appsscript.json` — GAS マニフェスト

`gas/*.gs` は開発用の分割ソースであり、`dist/` を直接編集しないでください。
