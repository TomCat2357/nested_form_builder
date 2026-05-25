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
| `forms_save` | フォーム保存（`form`/`targetUrl`/`saveMode`、`nfbSaveForm` 経由） | （なし） |
| `forms_delete_one` / `forms_delete_batch` | フォーム削除（単一 `formId` / 配列 `formIds`） | （なし） |
| `forms_archive_one` / `forms_unarchive_one` | アーカイブ/解除（単一 `formId`） | （なし） |
| `forms_archive_batch` / `forms_unarchive_batch` | アーカイブ/解除（配列 `formIds`） | （なし） |
| `forms_readonly_set_one` / `forms_readonly_clear_one` | 参照のみ設定/解除（単一 `formId`） | （なし） |
| `forms_readonly_set_batch` / `forms_readonly_clear_batch` | 参照のみ設定/解除（配列 `formIds`） | （なし） |
| `forms_copy` | フォーム複製（`formId`） | （なし） |
| `forms_import_drive` | Drive ファイル/フォルダ URL から取込（`url`） | （なし） |
| `forms_register_import` | 取込済みフォームをマッピング登録（`form`/`fileId`） | （なし） |
| `admin_key_get` / `admin_key_set` | 管理者キー取得/保存 | 管理者 |
| `admin_email_get` / `admin_email_set` | 管理者メール取得/保存 | 管理者 |
| `save` | レコード保存/更新 | `spreadsheetId` |
| `save_lock` | 保存ロック取得 | `spreadsheetId` |
| `list` | レコード一覧取得 | `spreadsheetId` |
| `get` | 単一レコード取得 | `spreadsheetId` + `id` |
| `delete` | レコード削除 | `spreadsheetId` + `id` |
| `sync_records` | 差分同期 | `spreadsheetId` |
| `analytics_*` | Question/Dashboard の CRUD/Archive/Copy/Import（`analyticsApi.gs` 参照） | list/get 以外は管理者 |

> `forms_save` 等の「（なし）」アクションは `nfb*` フォーム関数（`nfbSaveForm` 等）が経由するため、従来の `nfb*` と同じくゲートなし。`forms_create`/`forms_update`/`forms_delete`/`forms_archive`/`forms_readonly` は doPost 旧契約として `adminOnly` を維持。

## google.script.run 公開関数

レコード系（**`nfb` 無しのレガシー契約**）: `saveResponses` / `listRecords` / `getRecord` / `deleteRecord` / `syncRecordsProxy`（`nfbAcquireSaveLock` のみ `nfb` 付き）

> ⚠️ レコード系 `saveResponses` / `listRecords` / `getRecord` / `deleteRecord` / `syncRecordsProxy` は `nfb` プレフィックスを持たない歴史的な命名。`gas/Code.gs`・`gas/codeSyncRecords.gs` の関数名と `builder/src/services/gasClient.js` の呼び出し文字列が完全一致している必要があるため、リネームするなら両者をロックステップで変更し `dist/Bundle.gs` を再生成すること（doPost の `ACTION_DEFINITIONS_` キー `"save"`/`"list"`/`"get"`/`"delete"`/`"sync_records"` は別物なので無関係）。

その他、Drive 操作系: `nfbSaveExcelToDrive` / `nfbSaveFileToDrive` / `nfbCreateRecordPrintDocument` / `nfbExecuteRecordOutputAction` / `nfbExecuteBatchGoogleDocOutput` / `nfbUploadFileToDrive` / `nfbCopyDriveFileToDrive` / `nfbCreateGoogleDocumentFromTemplate` / `nfbFindDriveFileInFolder` / `nfbFinalizeRecordDriveFolder` / `nfbTrashDriveFilesByIds` / `nfbImportThemeFromDrive`

フォーム管理系: `nfbListForms` / `nfbGetForm` / `nfbSaveForm` / `nfbDeleteForm` / `nfbDeleteForms` / `nfbArchiveForm` / `nfbUnarchiveForm` / `nfbArchiveForms` / `nfbUnarchiveForms` / `nfbSetFormReadOnly` / `nfbClearFormReadOnly` / `nfbSetFormsReadOnly` / `nfbClearFormsReadOnly` / `nfbCopyForm` / `nfbImportFormsFromDrive` / `nfbRegisterImportedForm`

> フォーム管理系のうち**単数操作**（`nfbArchiveForm` 等）は GAS 側 `Nfb_unwrapSingleResult_`（`gas/errors.gs`）でバッチ結果を `{ ok, form }` に畳んでから返し、`gasClient.js` 側で `r.form` を取り出す。**複数操作**（`nfbArchiveForms` 等）は `{ ok, forms, errors }` のまま返し、フロントは部分成功/失敗を扱う。この形状差は意図的。
>
> google.script.run の `nfb*` ラッパは `Forms_runScriptAction_` / `Analytics_runScriptAction_` → 共通 `Nfb_runScriptAction_`（`gas/errors.gs`）→ `executeAction_` の 1 経路に集約される。

設定系: `nfbGetAdminKey` / `nfbSetAdminKey` / `nfbGetAdminEmail` / `nfbSetAdminEmail` / `nfbGetRestrictToFormOnly` / `nfbSetRestrictToFormOnly`

## dist/ との関係

`clasp` の push 対象は `dist/` です。以下の 3 ファイルが反映されます。

- `dist/Index.html` — React ビルド成果物 (single-file)
- `dist/Bundle.gs` — GAS 分割ソースの結合版
- `dist/appsscript.json` — GAS マニフェスト

`gas/*.gs` は開発用の分割ソースであり、`dist/` を直接編集しないでください。
