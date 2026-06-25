// =============================================
// Forms Public API — フォーム CRUD / Archive / ReadOnly / ChildOnly / Copy / Import
// =============================================
//
// Analytics API と同様に、公開 API は `executeAction_` の 1 経路へ統一する。
// google.script.run 用の `nfb*` 関数も doPost の `forms_*` アクション用ハンドラ
// (FormsApi_*_) も、共通の `Forms_dispatch_` を経由して `Forms_*_` ヘルパへ中継する。
//
// ［ハンドラ表の流派について（意図的差異）］
// Forms は import / resolve_ref / folder 系などアドホックなロジックを持つアクションが多いため、
// FORMS_HANDLERS_ は `{ run: function(raw){...} }` クロージャ方式（アクションごとに任意処理）を採る。
// 一方 Analytics（analyticsApi.gs）は type × mode が直交するため宣言的 `{ type, mode, idKey, ... }`
// ＋中央 switch 方式を採る。両者は `*_dispatch_ → Nfb_runScriptAction_ → executeAction_` の単一経路へ
// 収束済みで機能的な不整合は無い。表の書き味の違いは各ドメインの性質に合わせた意図的なもので、
// どちらかへの一律統一は不要（むしろ可読性を損なう）。必須フィールド検証は Nfb_requireField_ で共通化。

// ---- Action handler ディスパッチテーブル ----
// 各エントリの run(raw) は ctx.raw（リクエストペイロード）を受け取り、正規化済み
// レスポンスを返す。引数バリデーションもここに集約する。

var FORMS_HANDLERS_ = {
  "forms_list": {
    run: function(raw) {
      var result = Forms_listForms_({ includeArchived: !!(raw && raw.includeArchived) });
      var forms = result.forms || [];
      // Drive 二重読み取りを避けるため、取得済み forms からフォルダを派生（登録簿と union）。
      // アーカイブのみのフォルダは登録簿側で保持される。
      return { ok: true, forms: forms, loadFailures: result.loadFailures || [], folders: Forms_collectFolders_(forms) };
    }
  },
  "forms_folders_list": {
    run: function() { return Forms_listFolders_(); }
  },
  "forms_folder_create": {
    run: function(raw) { return Forms_createFolder_(raw && raw.path); }
  },
  "forms_move": {
    run: function(raw) { return Forms_moveItems_(raw || {}); }
  },
  "forms_folder_rename": {
    run: function(raw) { return Forms_renameFolder_(raw || {}); }
  },
  "forms_folder_delete": {
    run: function(raw) { return Forms_deleteFolder_(raw && raw.path); }
  },
  "forms_folders_backfill_physical": {
    run: function() { return FormsDrive_backfillPhysicalFolders_(); }
  },
  "forms_get": {
    run: function(raw) {
      var err = Nfb_requireField_(raw, "formId", "フォームIDが指定されていません");
      if (err) return err;
      var form = Forms_getForm_(raw.formId);
      if (!form) return { ok: false, error: "Form not found" };
      return { ok: true, form: form };
    }
  },
  "forms_save": {
    run: function(raw) {
      var form = (raw && (raw.form || raw.formData)) || raw || {};
      var saveMode = (raw && raw.saveMode) || "auto";
      // 保存先は標準フォルダ構成（01_forms）固定。外部からの保存先 URL 指定は受け付けない。
      // copy_to_folder（指定フォルダ複製）は Forms_copyForm_ が内部利用するのみ。
      return Forms_saveForm_(form, null, saveMode);
    }
  },
  "forms_update": {
    run: function(raw) {
      var formId = raw && raw.formId;
      var updates = raw && raw.updates;
      if (!formId || !updates) return { ok: false, error: "フォームIDまたは更新内容が指定されていません" };
      var current = Forms_getForm_(formId);
      if (!current) return { ok: false, error: "フォームが見つかりません" };
      var nextForm = {};
      for (var k in current) { if (current.hasOwnProperty(k)) nextForm[k] = current[k]; }
      for (var u in updates) { if (updates.hasOwnProperty(u)) nextForm[u] = updates[u]; }
      nextForm.id = formId;
      nextForm.createdAt = current.createdAt;
      nextForm.createdAtUnixMs = current.createdAtUnixMs;
      return Forms_saveForm_(nextForm);
    }
  },
  "forms_import": {
    run: function(raw) {
      var err = Nfb_requireField_(raw, "fileUrl", "ファイルURLが指定されていません");
      if (err) return err;
      var parsed = Forms_parseGoogleDriveUrl_(raw.fileUrl);
      if (!parsed || parsed.type !== "file" || !parsed.id) return { ok: false, error: "無効なファイルURLです" };
      var formData;
      try {
        var file = DriveApp.getFileById(parsed.id);
        formData = JSON.parse(file.getBlob().getDataAsString());
        formData.driveFileUrl = formData.driveFileUrl || file.getUrl();
      } catch (error) {
        return { ok: false, error: "フォームデータの取得に失敗しました: " + nfbErrorToString_(error) };
      }
      if (!formData || !formData.id) return { ok: false, error: "フォームデータが不正です（idが必要です）" };
      return Forms_saveForm_(formData);
    }
  },
  "forms_delete_one": {
    run: function(raw) {
      var res = Forms_deleteForms_([raw && raw.formId]);
      return { ok: res.ok };
    }
  },
  "forms_delete_batch": {
    run: function(raw) { return Forms_deleteForms_((raw && raw.formIds) || []); }
  },
  "forms_delete_with_files_batch": {
    run: function(raw) { return Forms_deleteFormsWithFiles_((raw && raw.formIds) || []); }
  },
  "forms_archive_one": {
    run: function(raw) { return Nfb_unwrapSingleResult_(Forms_setFormsArchivedState_([raw && raw.formId], true), "forms", "form"); }
  },
  "forms_unarchive_one": {
    run: function(raw) { return Nfb_unwrapSingleResult_(Forms_setFormsArchivedState_([raw && raw.formId], false), "forms", "form"); }
  },
  "forms_archive_batch": {
    run: function(raw) { return Forms_setFormsArchivedState_((raw && raw.formIds) || [], true); }
  },
  "forms_unarchive_batch": {
    run: function(raw) { return Forms_setFormsArchivedState_((raw && raw.formIds) || [], false); }
  },
  "forms_readonly_set_one": {
    run: function(raw) { return Nfb_unwrapSingleResult_(Forms_setFormsReadOnlyState_([raw && raw.formId], true), "forms", "form"); }
  },
  "forms_readonly_clear_one": {
    run: function(raw) { return Nfb_unwrapSingleResult_(Forms_setFormsReadOnlyState_([raw && raw.formId], false), "forms", "form"); }
  },
  "forms_readonly_set_batch": {
    run: function(raw) { return Forms_setFormsReadOnlyState_((raw && raw.formIds) || [], true); }
  },
  "forms_readonly_clear_batch": {
    run: function(raw) { return Forms_setFormsReadOnlyState_((raw && raw.formIds) || [], false); }
  },
  "forms_childonly_set_one": {
    run: function(raw) { return Nfb_unwrapSingleResult_(Forms_setFormsChildOnlyState_([raw && raw.formId], true), "forms", "form"); }
  },
  "forms_childonly_clear_one": {
    run: function(raw) { return Nfb_unwrapSingleResult_(Forms_setFormsChildOnlyState_([raw && raw.formId], false), "forms", "form"); }
  },
  "forms_childonly_set_batch": {
    run: function(raw) { return Forms_setFormsChildOnlyState_((raw && raw.formIds) || [], true); }
  },
  "forms_childonly_clear_batch": {
    run: function(raw) { return Forms_setFormsChildOnlyState_((raw && raw.formIds) || [], false); }
  },
  "forms_copy": {
    run: function(raw) {
      var err = Nfb_requireField_(raw, "formId", "formId is required");
      if (err) return err;
      return Forms_copyForm_(raw.formId);
    }
  },
  "forms_import_drive": {
    run: function(raw) { return Forms_importFromDrive_(raw && raw.url); }
  },
  "forms_register_import": {
    run: function(raw) { return Forms_registerImportedForm_(raw || {}); }
  },
  "forms_resolve_ref": {
    run: function(raw) { return Forms_resolveFormRef_((raw && raw.ref) || raw || {}); }
  }
};

// 非管理者クライアントへ返すフォームから機微な spreadsheetId / spreadsheetPath を伏せる。
// 保存先の有無だけは hasSpreadsheet 真偽で伝え、フロントのシート保存ゲートに使わせる。
// spreadsheetId / spreadsheetPath 自体は Drive 上のフォーム JSON（ソースオブトゥルース）には残る。
function Forms_stripSpreadsheetForClient_(form) {
  if (!form || !form.settings || typeof form.settings !== "object") return form;
  // 論理パス（spreadsheetPath）か直接 ID/URL（spreadsheetId）のどちらかが設定されていれば true。
  var hasPath = typeof form.settings.spreadsheetPath === "string" && form.settings.spreadsheetPath.trim() !== "";
  var hasSpreadsheet = hasPath || !!Model_normalizeSpreadsheetId_(form.settings.spreadsheetId);
  form.settings.hasSpreadsheet = hasSpreadsheet;
  delete form.settings.spreadsheetId;
  delete form.settings.spreadsheetPath;
  return form;
}

function Forms_dispatch_(action, ctx) {
  var def = FORMS_HANDLERS_[action];
  if (!def) throw new Error("Unknown forms action: " + action);
  var result = def.run((ctx && ctx.raw) || {});

  // forms_get / forms_list はゲートなしの公開読み取り経路。非管理者には spreadsheetId を伏せる。
  if ((action === "forms_get" || action === "forms_list") && result && result.ok) {
    var isAdmin = Nfb_isAdminFromCtx_(ctx);
    if (!isAdmin) {
      if (result.form) Forms_stripSpreadsheetForClient_(result.form);
      if (Array.isArray(result.forms)) {
        for (var i = 0; i < result.forms.length; i++) {
          Forms_stripSpreadsheetForClient_(result.forms[i]);
        }
      }
    }
  }

  return result;
}

// ---- doPost (ACTION_DEFINITIONS_) から呼ばれる handler ----
// AnalyticsApi_*_ と同じく Forms_dispatch_ への 1 行転送。

function FormsApi_List_(ctx)   { return Forms_dispatch_("forms_list", ctx); }
function FormsApi_Get_(ctx)    { return Forms_dispatch_("forms_get", ctx); }
function FormsApi_Create_(ctx) { return Forms_dispatch_("forms_save", ctx); }
function FormsApi_Import_(ctx) { return Forms_dispatch_("forms_import", ctx); }
function FormsApi_Update_(ctx) { return Forms_dispatch_("forms_update", ctx); }
function FormsApi_Delete_(ctx) { return Forms_dispatch_("forms_delete_one", ctx); }
function FormsApi_ResolveFormRef_(ctx) { return Forms_dispatch_("forms_resolve_ref", ctx); }

function FormsApi_SetArchived_(ctx) {
  var raw = (ctx && ctx.raw) || {};
  var archivedFlag = ["true", true, 1, "1"].indexOf(raw.archived) !== -1;
  return Forms_dispatch_(archivedFlag ? "forms_archive_one" : "forms_unarchive_one", ctx);
}

function FormsApi_SetReadOnly_(ctx) {
  var raw = (ctx && ctx.raw) || {};
  var readOnlyFlag = ["true", true, 1, "1"].indexOf(raw.readOnly) !== -1;
  return Forms_dispatch_(readOnlyFlag ? "forms_readonly_set_one" : "forms_readonly_clear_one", ctx);
}

// ---- public google.script.run wrappers ----
// google.script.run はトップレベル global function を要求するため個別宣言するが、
// 本体は共通の Nfb_runScriptAction_（errors.gs）への 1 行転送に統一する。

function Forms_runScriptAction_(action, payload) {
  return Nfb_runScriptAction_(action, payload);
}

function nfbListForms(options)             { return Forms_runScriptAction_("forms_list",                 { includeArchived: !!(options && options.includeArchived) }); }
function nfbGetForm(formId)                { return Forms_runScriptAction_("forms_get",                  { formId: formId }); }
function nfbSaveForm(payload)              { return Forms_runScriptAction_("forms_save",                 payload || {}); }
function nfbDeleteForm(formId)             { return Forms_runScriptAction_("forms_delete_one",           { formId: formId }); }
function nfbDeleteForms(formIds)           { return Forms_runScriptAction_("forms_delete_batch",         { formIds: formIds }); }
function nfbDeleteFormsWithFiles(formIds)  { return Forms_runScriptAction_("forms_delete_with_files_batch", { formIds: formIds }); }
function nfbArchiveForm(formId)            { return Forms_runScriptAction_("forms_archive_one",          { formId: formId }); }
function nfbUnarchiveForm(formId)          { return Forms_runScriptAction_("forms_unarchive_one",        { formId: formId }); }
function nfbArchiveForms(formIds)          { return Forms_runScriptAction_("forms_archive_batch",        { formIds: formIds }); }
function nfbUnarchiveForms(formIds)        { return Forms_runScriptAction_("forms_unarchive_batch",      { formIds: formIds }); }
function nfbSetFormReadOnly(formId)        { return Forms_runScriptAction_("forms_readonly_set_one",     { formId: formId }); }
function nfbClearFormReadOnly(formId)      { return Forms_runScriptAction_("forms_readonly_clear_one",   { formId: formId }); }
function nfbSetFormsReadOnly(formIds)      { return Forms_runScriptAction_("forms_readonly_set_batch",   { formIds: formIds }); }
function nfbClearFormsReadOnly(formIds)    { return Forms_runScriptAction_("forms_readonly_clear_batch", { formIds: formIds }); }
function nfbSetFormChildOnly(formId)       { return Forms_runScriptAction_("forms_childonly_set_one",    { formId: formId }); }
function nfbClearFormChildOnly(formId)     { return Forms_runScriptAction_("forms_childonly_clear_one",  { formId: formId }); }
function nfbSetFormsChildOnly(formIds)     { return Forms_runScriptAction_("forms_childonly_set_batch",  { formIds: formIds }); }
function nfbClearFormsChildOnly(formIds)   { return Forms_runScriptAction_("forms_childonly_clear_batch", { formIds: formIds }); }
function nfbCopyForm(formId)               { return Forms_runScriptAction_("forms_copy",                 { formId: formId }); }
function nfbImportFormsFromDrive(url)      { return Forms_runScriptAction_("forms_import_drive",         { url: url }); }
function nfbRegisterImportedForm(payload)  { return Forms_runScriptAction_("forms_register_import",      payload || {}); }
function nfbResolveFormRef(payload)         { return Forms_runScriptAction_("forms_resolve_ref",          payload || {}); }
function nfbListFolders()                  { return Forms_runScriptAction_("forms_folders_list",         {}); }
function nfbCreateFolder(path)             { return Forms_runScriptAction_("forms_folder_create",        { path: path }); }
function nfbMoveItems(payload)             { return Forms_runScriptAction_("forms_move",                 payload || {}); }
function nfbRenameFolder(payload)          { return Forms_runScriptAction_("forms_folder_rename",        payload || {}); }
function nfbDeleteFolder(path)             { return Forms_runScriptAction_("forms_folder_delete",        { path: path }); }
function nfbBackfillPhysicalFolders()      { return Forms_runScriptAction_("forms_folders_backfill_physical", {}); }
// バックエンド（Bundle.gs）のデプロイ時刻を取得する（設定画面の「システム情報」用）。
function nfbGetDeployInfo()                 { return Forms_runScriptAction_("deploy_info_get",            {}); }
