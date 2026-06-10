// =============================================
// Forms Import — Google Drive のファイル/フォルダから JSON フォームを取り込む
// （元ファイルをコピーせず参照で管理する）
// =============================================

/**
 * Google Drive の URL（ファイル or フォルダ、ID 単体も可）からフォーム JSON を読み込む。
 * 既登録のファイルは skip。共通本体は Nfb_scanDriveJsonImports_。
 * @param {string} url
 * @return {{ ok: true, forms: Array, skipped: number, parseFailed: number, totalFiles: number }}
 */
function Forms_importFromDrive_(url) {
  var result = Nfb_scanDriveJsonImports_(url, Forms_getMapping_(), {
    normalize: Forms_normalizeImportedFormData_,
    makeEntry: function(form, fileId, fileUrl) {
      return { form: form, fileId: fileId, fileUrl: fileUrl };
    },
    entityLabel: "フォーム"
  });
  return {
    ok: true,
    forms: result.items,
    skipped: result.skipped,
    parseFailed: result.parseFailed,
    totalFiles: result.totalFiles
  };
}

/**
 * インポートしたフォームをマッピングに登録する（ファイルのコピーは作らない）。
 * @param {Object} payload - { form: Object, fileId: string, fileUrl?: string }
 * @return {{ ok: true, form: Object, fileId: string, fileUrl: string }}
 */
function Forms_registerImportedForm_(payload) {
  if (!payload || !payload.form || !payload.fileId) {
    throw new Error("form と fileId が必要です");
  }

  var form = Forms_normalizeImportedFormData_(payload.form);
  if (!form) {
    throw new Error("フォームJSONが有効な形式ではありません");
  }

  // 配置（構成内なら参照のまま / 構成外なら 01_forms へコピー）+ マッピング登録は共通本体に委譲。
  // forms 固有: 名前 ＝ Drive ファイル名。希望タイトル（無ければ現ファイル名）を既存と衝突しないよう
  // 自動採番し、物理ファイル名もそれに揃える（名前 ＝ Drive ファイル名 を保証）。
  var reg = SharedEntity_registerImported_(payload.fileId, {
    stdKey: "forms",
    getMapping: Forms_getMapping_,
    saveMapping: Forms_saveMapping_,
    labelKey: "title",
    relativeFolderOfFile: FormsDrive_relativeFolderOfFile_,
    resolveLabel: function(mapping, formId, placedFileId) {
      var existingTitlesImport = [];
      for (var otherImportId in mapping) {
        if (!mapping.hasOwnProperty(otherImportId) || otherImportId === formId) continue;
        var ot = mapping[otherImportId] && mapping[otherImportId].title;
        if (ot) existingTitlesImport.push(ot);
      }
      var placedFile = null;
      try { placedFile = DriveApp.getFileById(placedFileId); } catch (e) { placedFile = null; }
      var desiredImportTitle = (form.settings && form.settings.formTitle) || (placedFile ? Nfb_nameFromFile_(placedFile) : "");
      var uniqueImportTitle = Forms_makeUniqueFormTitle_(desiredImportTitle, existingTitlesImport);
      if (placedFile && placedFile.getName() !== uniqueImportTitle + ".json") {
        try { placedFile.setName(uniqueImportTitle + ".json"); } catch (eRename) { /* non-critical */ }
      }
      return uniqueImportTitle;
    }
  });
  var formId = reg.newId;   // id ＝ Drive fileId へ統一
  var fileId = reg.fileId;
  var fileUrl = reg.fileUrl;

  form.id = formId;
  form.driveFileUrl = fileUrl;
  form.settings = form.settings || {};
  form.settings.formTitle = reg.label;

  // 開いていたフォルダ配下へ取り込む。参照先 Drive ファイルの json.folder を書き換える
  // （移動/リネームと同じ既存ヘルパ）。マッピング保存後に呼ぶことで fileId 解決が効く。
  if (payload.folder) {
    var normFolder = Forms_normalizeFolderPath_(payload.folder);
    Forms_setFormFolder_(formId, normFolder);
    form.folder = normFolder;
  }

  // AddFormUrl_ にも登録（?form=xxx でアクセス可能にする）
  try {
    AddFormUrl_(formId, fileUrl);
  } catch (err) {
    Logger.log("[Forms_registerImportedForm_] AddFormUrl_ failed (non-critical): " + err);
  }

  return { ok: true, form: form, fileId: fileId, fileUrl: fileUrl };
}
