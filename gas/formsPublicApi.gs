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
 * スプレッドシートの存在・権限を検証する
 * @param {string} spreadsheetIdOrUrl
 * @return {Object} { ok, spreadsheetId, title, canEdit, canView, sheetNames }
 */

function nfbValidateSpreadsheet(spreadsheetIdOrUrl) {
  return nfbSafeCall_(function() {
    if (!spreadsheetIdOrUrl) {
      return { ok: false, error: "Spreadsheet URL/ID is required" };
    }

    var parsed = Forms_parseSpreadsheetTarget_(String(spreadsheetIdOrUrl));
    if (!parsed.type) {
      return { ok: false, error: "無効なスプレッドシートURL/IDです" };
    }

    var userEmail = Session.getEffectiveUser().getEmail();

    if (parsed.type === "folder") {
      var folder = DriveApp.getFolderById(parsed.id);
      var canEdit = false;
      var canView = true;
      try {
        var editors = folder.getEditors();
        for (var i = 0; i < editors.length; i++) {
          if (editors[i].getEmail() === userEmail) {
            canEdit = true;
            break;
          }
        }
        if (!canEdit) {
          canEdit = folder.getOwner().getEmail() === userEmail || folder.getSharingPermission() === DriveApp.Permission.EDIT;
        }
      } catch (permErr) {
        Logger.log("[nfbValidateSpreadsheet] folder permission check failed: " + permErr);
      }

      return {
        ok: true,
        spreadsheetId: "",
        title: folder.getName(),
        sheetNames: [],
        canEdit: canEdit,
        canView: canView,
        isFolder: true,
        folderId: parsed.id,
      };
    }

    var spreadsheetId = parsed.id;
    var ss = SpreadsheetApp.openById(spreadsheetId);
    var sheets = ss.getSheets();
    var file = DriveApp.getFileById(spreadsheetId);

    var canEditSheet = false;
    var canViewSheet = true; // openByIdが成功した時点で閲覧は可
    try {
      var editorsSheet = file.getEditors();
      for (var j = 0; j < editorsSheet.length; j++) {
        if (editorsSheet[j].getEmail() === userEmail) {
          canEditSheet = true;
          break;
        }
      }
      if (!canEditSheet) {
        canEditSheet = file.getOwner().getEmail() === userEmail || file.getSharingPermission() === DriveApp.Permission.EDIT;
      }
    } catch (permErrSheet) {
      Logger.log("[nfbValidateSpreadsheet] permission check failed: " + permErrSheet);
    }

    return {
      ok: true,
      spreadsheetId: spreadsheetId,
      title: ss.getName(),
      sheetNames: sheets.map(function(sheet) { return sheet.getName(); }),
      canEdit: canEditSheet,
      canView: canViewSheet,
      isFolder: false,
    };
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
