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

### payload 共通の外枠（`buildExternalActionPayload`）

```
{ context: "record" | "search", formId, formName, generatedAt(ISO8601),
  ...(record か list),     // base は top-level 展開 → record / list はトップレベルキー（base ラッパは無い）
  storage? }               // adminOnly && isAdmin のときだけ付く
```

`storage`（管理者限定ボタン＋管理者のみ）= `{ spreadsheetId, spreadsheetUrl, sheetName, driveFileUrl, userEmail, childSpreadsheetId, childSpreadsheetUrl, childSheetName }`

- 子フォーム系（`childSpreadsheetId` / `childSpreadsheetUrl` / `childSheetName`）は**単票・検索一覧の両方**で付く。formLink の子フォーム定義（`settings.spreadsheetId` / `settings.sheetName`）から解決し、親フォームの formLink は通常 1 つなので**最初の非空 `childSpreadsheetId` を持つ子フォームの単一値**を採る（単票=`PreviewPage.jsx` のループ / 一覧=`SearchSidebar.buttons.js` の `firstChildStorageMeta`）。`childSheetName` は空なら `"Data"` 既定。リレー先（choju 等）が子シートへの書き込み/リンク表示に使う。

### パターン① 各レコード（単票）`context:"record"`

`PreviewPage.jsx` の外部アクションカードから送信。

```
record: { id, no, items: [ { question, value, type, files?, folderUrl?, folderName? }, ... ] }
```

- `items` は全フィールドをフラットに並べた配列。`question` は階層を `/` 連結したパス文字列。
- ファイルは payload には入れず、**別引数 `files`** で渡す。フォルダ/ファイル URL の解決と質問項目ごとの構造化は Drive 権限を持つ本体 GAS（`ExtAction_send_`）が行う（実体ではなく URL のみ送る）。
- **子レコードの紐づけは pid 一致**: 送られる子は **pid == そのレコードの ID** のものに限る（`listRecordsByPids({ formId: childFormId, pids: [recordId] })`、`recordId = recordIdRef.current`）。子レコードは保存時に pid=親 ID が刻まれ、それで紐づく。
- **子が付く前提**: 子を取得・送信するのは **保存済みレコード（id あり）かつ GAS 環境かつ子フォーム文脈でない**ときだけ。未保存の新規レコード・非 GAS 環境・子フォーム内表示（`inChildContext`）・formLink 項目なしでは子は付かない（`PreviewPage.jsx:187-190`）。
- 子は **1 階層のみ**。子レコード内のさらなる孫 formLink は再帰展開しない（`childFormData.js:116-117`）。1 項目あたり最大 200 件（超過は先頭 200 件、`MAX_CHILD_RECORDS_PER_FIELD`）。

### パターン② 検索結果一覧 `context:"search"`

`SearchSidebar.buttons.js` の外部アクションボタンから送信。

```
list: { headers, rows, rowCount, childFormsByRow?, fileRefsByRow? }
```

- `headers` は階層を `/` 連結した「1 列 = 1 文字列」、`rows` は 2 次元配列。
- 対象行: **選択行があればその行、無ければ絞り込み後の全行**。
- `fileRefsByRow` は行と同順・各行 `[{ question, folderUrl, folderName, files:[{name, driveFileId, driveFileUrl}] }]`。単票と違い payload に直接埋め込む。

### 子フォーム（formLink）の有無による違い

- **単票**: 子データは**常時 ON** で `record.items` にインライン展開（`buildRecordItems(..., { childDataByFieldId })`）。子の行は「親カード/#記号子フォーム名/子フィールド」の `question` パスで items に並ぶ。子フォームが無ければ items は親項目のみ。対象は schema の**全** formLink 項目で、**`includeChildData` フラグに非依存で常時 ON**（`buildRecordItems` 自体も `includeChildData` を見ず、渡された子データをそのまま展開する）。← 検索一覧が `includeChildData=true` 限定なのと**非対称**。
- **検索一覧**: 子データは**送信時に on-demand 取得**（一覧表示中は取らずコストを払わない）。`includeChildData=true` の formLink のみ対象で、クリック時に子フォームごと 1 回 `listRecordsByPids` でバッチ取得（`useSearchPageState.js:315-373`）。`list.childFormsByRow` は行と同順、各行 = 子フォーム合成オブジェクト配列:

  ```
  { fieldPath, childFormId, childFormName, childFormUrl,
    count, truncated?,            // 1 項目あたり最大 200 件（childFormData.js MAX_CHILD_RECORDS_PER_FIELD）
    records: [ { id, no, items:[{question,value,type,...}] }, ... ],
    childSpreadsheetId?, childSheetName? }  // 機微: 非管理者には両方剥がす（stripChildSpreadsheetIds）
  ```

  子フォームが無い（formLink 無し or `includeChildData=false`）なら `childFormsByRow` キー自体が付かず、on-demand 取得も走らない。
- **機微の二重ガード**: `childSpreadsheetId` は `storage` と違い `childFormsByRow` が常時送信されるため、非管理者には `stripChildSpreadsheetIds` で別途剥がす。

| | 子フォームなし | 子フォームあり |
| --- | --- | --- |
| **各レコード** | `record.items` = 親項目のみ | `record.items` に子を**常時**インライン展開（pid==recordId・全 formLink・`includeChildData` 非依存） |
| **検索一覧** | `list` に `childFormsByRow` なし | 送信時 on-demand → `list.childFormsByRow`（行同順・`records[{id,no,items}]`・最大 200/`truncated`・`includeChildData=true` のみ） |

> 単票で子が付くのは保存済みレコード（pid=自身の id）かつ GAS 環境かつ子フォーム文脈でないときだけ。未保存の新規レコード・非 GAS・`inChildContext` では子を取得・送信しない。

### 受信側レスポンス契約

受信側が `nfbRelay=1` で `{ ok, title, message, openUrl }`（JSON）を返せばそれを使う（`interpretExternalActionResponse`）。`openUrl` があれば新規タブで開く。JSON でない（旧受信アプリの HTML 等）ときは汎用の成功メッセージにフォールバックする。

## dist/ との関係

`clasp` の push 対象は `dist/` です。以下の 3 ファイルが反映されます。

- `dist/Index.html` — React ビルド成果物 (single-file)
- `dist/Bundle.gs` — GAS 分割ソースの結合版
- `dist/appsscript.json` — GAS マニフェスト

`gas/*.gs` は開発用の分割ソースであり、`dist/` を直接編集しないでください。
