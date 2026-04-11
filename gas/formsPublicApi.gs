function nfbListForms(options) {
  return nfbSafeCall_(function() {
    var result = Forms_listForms_(options || {});
    return {
      ok: true,
      forms: result.forms || [],
      loadFailures: result.loadFailures || [],
    };
  });
}

/**
 * 特定フォームを取得
 */

function nfbGetForm(formId) {
  return nfbSafeCall_(function() {
    var form = Forms_getForm_(formId);
    if (!form) {
      return {
        ok: false,
        error: "Form not found",
      };
    }
    return {
      ok: true,
      form: form,
    };
  });
}

/**
 * フォームを保存（新規作成または更新）
 * @param {Object} payload - { form: Object, targetUrl: string, saveMode: string }
 */

function nfbSaveForm(payload) {
  return nfbSafeCall_(function() {
    var form = payload.form || payload;
    var targetUrl = payload.targetUrl || null;
    var saveMode = payload.saveMode || "auto";
    return Forms_saveForm_(form, targetUrl, saveMode);
  });
}

/**
 * フォームを削除
 */

function nfbDeleteForm(formId) {
  return nfbSafeCall_(function() {
    var res = Forms_deleteForms_([formId]);
    return { ok: res.ok };
  });
}

/**
 * 複数フォームを削除（まとめてプロパティ更新）
 */

function nfbDeleteForms(formIds) {
  return nfbSafeCall_(function() {
    return Forms_deleteForms_(formIds);
  });
}

/**
 * フォームをアーカイブ
 */

function nfbArchiveForm(formId) {
  return nfbSafeCall_(function() {
    var res = Forms_setFormsArchivedState_([formId], true);
    if (res.ok && res.forms && res.forms.length > 0) {
      return { ok: true, form: res.forms[0] };
    }
    return { ok: false, error: (res.errors && res.errors[0]) ? res.errors[0].error : "Unknown error" };
  });
}

/**
 * フォームのアーカイブを解除
 */

function nfbUnarchiveForm(formId) {
  return nfbSafeCall_(function() {
    var res = Forms_setFormsArchivedState_([formId], false);
    if (res.ok && res.forms && res.forms.length > 0) {
      return { ok: true, form: res.forms[0] };
    }
    return { ok: false, error: (res.errors && res.errors[0]) ? res.errors[0].error : "Unknown error" };
  });
}

/**
 * 複数フォームをまとめてアーカイブ
 * @param {Array<string>} formIds
 * @return {Object} { ok: boolean, updated: number, errors: Array, forms: Array }
 */

function nfbArchiveForms(formIds) {
  return nfbSafeCall_(function() {
    return Forms_setFormsArchivedState_(formIds, true);
  });
}

/**
 * 複数フォームのアーカイブをまとめて解除
 * @param {Array<string>} formIds
 * @return {Object} { ok: boolean, updated: number, errors: Array, forms: Array }
 */

function nfbUnarchiveForms(formIds) {
  return nfbSafeCall_(function() {
    return Forms_setFormsArchivedState_(formIds, false);
  });
}

/**
 * フォームをコピー（同じDriveフォルダに新IDで作成）
 * @param {string} formId - コピー元フォームID
 * @return {Object} { ok, fileId, fileUrl, form }
 */

function nfbCopyForm(formId) {
  return nfbSafeCall_(function() {
    if (!formId) return { ok: false, error: "formId is required" };
    var result = Forms_copyForm_(formId);
    return result;
  });
}

/**
 * Google DriveのURL（ファイルまたはフォルダ）からフォームをインポート
 * @param {string} url - Google DriveのURL
 * @return {Object} { ok: true, forms: Array, skipped: number }
 */

function nfbImportFormsFromDrive(url) {
  return nfbSafeCall_(function() {
    return Forms_importFromDrive_(url);
  });
}

/**
 * インポートしたフォームをコピーなしでマッピングに登録する
 * @param {Object} payload - { form: Object, fileId: string, fileUrl: string }
 * @return {Object} { ok: true, form, fileId, fileUrl }
 */

function nfbRegisterImportedForm(payload) {
  return nfbSafeCall_(function() {
    return Forms_registerImportedForm_(payload);
  });
}

/**
 * フォーム内容からハッシュ値を計算（同じ内容なら同じハッシュ）
 * タイムスタンプとdriveFileUrlを除いた内容でハッシュを計算
 * @param {Object} form - フォームオブジェクト
 * @return {string} ハッシュ値（16進数、先頭16文字）
 */
