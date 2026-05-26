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
  var fileId = payload.fileId;
  var fileUrl = payload.fileUrl || ("https://drive.google.com/file/d/" + fileId + "/view");

  var mapping = Forms_getMapping_();
  var formId = form.id ? String(form.id) : "";
  if (formId && mapping[formId] && mapping[formId].fileId && mapping[formId].fileId !== fileId) {
    Logger.log("[Forms_registerImportedForm_] Existing form id conflict. Assigning new id: " + formId);
    formId = "";
  }
  if (!formId) {
    formId = Forms_generateFormId_(mapping);
  }
  form.id = formId;
  form.driveFileUrl = fileUrl;

  // タイトル正規化 + 衝突時の自動採番（自分以外の登録済みタイトルと比較）
  var existingTitlesImport = [];
  for (var otherImportId in mapping) {
    if (!mapping.hasOwnProperty(otherImportId) || otherImportId === formId) continue;
    var ot = mapping[otherImportId] && mapping[otherImportId].title;
    if (ot) existingTitlesImport.push(ot);
  }
  var desiredImportTitle = (form.settings && form.settings.formTitle) || "";
  var uniqueImportTitle = Forms_makeUniqueFormTitle_(desiredImportTitle, existingTitlesImport);
  form.settings = form.settings || {};
  form.settings.formTitle = uniqueImportTitle;

  mapping[formId] = { fileId: fileId, driveFileUrl: fileUrl, title: uniqueImportTitle };
  Forms_saveMapping_(mapping);

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
