/**
 * mapping エントリ ({ fileId, driveFileUrl, ... }) から fileId を解決する共通ヘルパ。
 * Forms / Analytics 両方の mapping store で使う。
 * entry.fileId → entry.driveFileUrl パース → どちらも取れなければ null。
 */
function Nfb_resolveFileIdFromEntry_(entry) {
  if (!entry) return null;
  if (entry.fileId) return entry.fileId;
  if (entry.driveFileUrl) {
    var parsed = Forms_parseGoogleDriveUrl_(entry.driveFileUrl);
    if (parsed && parsed.type === "file") return parsed.id;
  }
  return null;
}

/**
 * Drive ファイル名（または素の名前文字列）から、システム上の「名前」を導出する。
 * 末尾の ".json"（大文字小文字問わず）を 1 つだけ取り除く。
 * id ＝ fileId / 名前 ＝ Drive ファイル名 へ統一したため、フォーム/クエスチョン/
 * ダッシュボードの表示名は常にこのヘルパでファイル名から導出する。
 * @param {string} fileName
 * @return {string}
 */
function Nfb_nameFromFileName_(fileName) {
  var s = (fileName == null) ? "" : String(fileName);
  return s.replace(/\.json$/i, "");
}

/**
 * Drive File オブジェクトからシステム名を導出する薄いラッパ。
 * @param {GoogleAppsScript.Drive.File} file
 * @return {string}
 */
function Nfb_nameFromFile_(file) {
  try {
    return Nfb_nameFromFileName_(file.getName());
  } catch (e) {
    return "";
  }
}

// リクエスト単位のフォームキャッシュ。executeAction_ の冒頭で {} にリセットされる。
// 同一リクエスト内で Forms_getForm_ が複数回呼ばれる経路（保存=temporalMap+retention+
// spreadsheetId 解決 等）の Drive 読み取りを 1 回に集約する。
var __NFB_FORM_REQ_CACHE__ = {};

function Nfb_resetFormRequestCache_() {
  __NFB_FORM_REQ_CACHE__ = {};
}

// Forms_getForm_ の薄いラッパ。formId をキーにリクエストスコープでメモ化する。
function Nfb_getFormCached_(formId) {
  if (!formId) return null;
  if (Object.prototype.hasOwnProperty.call(__NFB_FORM_REQ_CACHE__, formId)) {
    return __NFB_FORM_REQ_CACHE__[formId];
  }
  var form = Forms_getForm_(formId);
  __NFB_FORM_REQ_CACHE__[formId] = form;
  return form;
}

// formId からレコード操作対象の { spreadsheetId, sheetName } を権威的に解決する。
// spreadsheetId が未設定/フォーム未解決なら null（呼び出し側でエラー化）。
function Nfb_resolveFormSheetTarget_(formId) {
  if (!formId) return null;
  var form = Nfb_getFormCached_(formId);
  if (!form || !form.settings) return null;
  var spreadsheetId = Model_normalizeSpreadsheetId_(form.settings.spreadsheetId);
  if (!spreadsheetId) return null;
  var sheetName = form.settings.sheetName || NFB_DEFAULT_SHEET_NAME;
  return { spreadsheetId: spreadsheetId, sheetName: sheetName };
}

function Forms_getForm_(formId) {
  if (!formId) return null;

  var mapping = Forms_getMapping_();
  var mappingEntry = mapping[formId] || {};
  // id ＝ Drive fileId へ統一。マッピングに登録があればその fileId を使い、無ければ
  // formId 自体を fileId とみなす（新方式では formId === fileId。旧 f_... id は移行期間中
  // マッピング経由で解決される）。
  var fileId = Nfb_resolveFileIdFromEntry_(mappingEntry) || formId;
  var driveFileUrlFromMap = mappingEntry.driveFileUrl;

  if (!fileId) return null;

  try {
    var file = DriveApp.getFileById(fileId);
    var content = file.getBlob().getDataAsString();
    var form = JSON.parse(content);

    // id・名前はファイル自体（fileId・ファイル名）から導出する。JSON 内の id/formTitle は持たない運用。
    form.id = formId;
    form.settings = (form.settings && typeof form.settings === "object" && !Array.isArray(form.settings)) ? form.settings : {};
    form.settings.formTitle = Nfb_nameFromFile_(file);

    // driveFileUrlがない場合はマッピング/ファイルから補完
    if (!form.driveFileUrl) {
      form.driveFileUrl = driveFileUrlFromMap || file.getUrl();
    }

    return form;
  } catch (err) {
    Logger.log("[Forms_getForm_] Error loading form " + formId + ": " + err);
    return null;
  }
}

// 01_forms 配下の 1 ファイルを Form として確定する。id ＝ fileId / 名前 ＝ ファイル名 を採用し、
// マッピング（fileId キー）と認証用 URL マップを最新化する。失敗時は null。
function Forms_adoptFormFile_(file, mapping) {
  var fileId = file.getId();
  var json;
  try {
    json = JSON.parse(file.getBlob().getDataAsString());
  } catch (err) {
    Logger.log("[Forms_adoptFormFile_] parse failed: " + file.getName());
    return null;
  }
  if (!json || !Array.isArray(json.schema)) return null;

  var name = Nfb_nameFromFile_(file);
  var fileUrl = file.getUrl();
  mapping[fileId] = { fileId: fileId, driveFileUrl: fileUrl, title: name };
  Forms_saveMapping_(mapping);

  json.id = fileId;
  json.settings = (json.settings && typeof json.settings === "object" && !Array.isArray(json.settings)) ? json.settings : {};
  json.settings.formTitle = name;
  if (!json.driveFileUrl) json.driveFileUrl = fileUrl;
  try { AddFormUrl_(fileId, fileUrl); } catch (e) { /* non-critical */ }
  return json;
}

// フォルダ（とサブフォルダ）を再帰探索し、ファイル名が targets のいずれかに一致する
// 最初の JSON ファイルを返す（無ければ null）。
function Forms_findFileByNamesRecursive_(folder, targets) {
  var files = folder.getFiles();
  while (files.hasNext()) {
    var f = files.next();
    if (typeof f.isTrashed === "function" && f.isTrashed()) continue;
    if (!StdFolders_isJsonFile_(f)) continue;
    if (targets[f.getName()]) return f;
  }
  var subs = folder.getFolders();
  while (subs.hasNext()) {
    var sub = subs.next();
    if (typeof sub.isTrashed === "function" && sub.isTrashed()) continue;
    var hit = Forms_findFileByNamesRecursive_(sub, targets);
    if (hit) return hit;
  }
  return null;
}

/**
 * 壊れた Form 参照（クエスチョンの formId）を解決する。ref = { formId, formName }。
 *   1) id（＝fileId）で解決。マッピング登録があればその fileId、無ければ formId 自体を
 *      fileId とみなして直接開く（コピー直後でマッピング未構築のケースを救済）。
 *   2) 標準フォルダ 01_forms（サブフォルダ含む）を「ファイル名（formName + ".json"）」で探す。
 * 戻り: { ok:true, form, formId, relinked, matchedBy }。見つからなければ form:null。
 */
function Forms_resolveFormRef_(ref) {
  return nfbSafeCall_(function() {
    ref = ref || {};
    var wantId = ref.formId ? String(ref.formId) : "";
    var wantName = (typeof ref.formName === "string") ? ref.formName : "";
    var mapping = Forms_getMapping_();

    // 1) id（fileId）で解決を試みる。
    if (wantId) {
      var fid = (mapping[wantId] ? Nfb_resolveFileIdFromEntry_(mapping[wantId]) : null) || wantId;
      if (fid) {
        try {
          var f0 = DriveApp.getFileById(fid);
          if (!(typeof f0.isTrashed === "function" && f0.isTrashed()) && StdFolders_isJsonFile_(f0)) {
            var fm = Forms_adoptFormFile_(f0, mapping);
            if (fm) return { ok: true, form: fm, formId: fm.id, relinked: fm.id !== wantId, matchedBy: "id" };
          }
        } catch (e0) { /* 壊れている / fileId でない → 名前フォールバックへ */ }
      }
    }

    // 2) ファイル名フォールバック（01_forms をサブフォルダ含め再帰探索）。
    if (wantName) {
      var base = FormsDrive_baseFolderOrNull_();
      if (base) {
        var targets = {};
        targets[wantName + ".json"] = true;
        targets[Forms_normalizeFormTitle_(wantName) + ".json"] = true;
        var found = Forms_findFileByNamesRecursive_(base, targets);
        if (found) {
          var fm2 = Forms_adoptFormFile_(found, mapping);
          if (fm2) return { ok: true, form: fm2, formId: fm2.id, relinked: true, matchedBy: "name" };
        }
      }
    }

    return { ok: true, form: null };
  });
}

function Forms_listForms_(options) {
  var includeArchived = !!(options && options.includeArchived);

  var mapping = Forms_getMapping_();

  var forms = [];
  var loadFailures = [];

  var pushFailure = function(id, fId, fName, fUrl, stage, errMsg) {
    loadFailures.push({
      id: id,
      fileId: fId,
      fileName: fName || null,
      driveFileUrl: fUrl || (fId ? Forms_buildDriveFileUrlFromId_(fId) : null),
      errorStage: stage,
      errorMessage: errMsg,
      lastTriedAt: new Date().toISOString(),
    });
  };

  // マッピングからfileIdリストを構築
  var fileIdMap = {}; // { fileId: formId }
  var formIdToMappingEntry = {}; // { formId: mappingEntry }

  for (var formId in mapping) {
    if (!mapping.hasOwnProperty(formId)) continue;
    var mappingEntry = mapping[formId] || {};
    var fileId = Nfb_resolveFileIdFromEntry_(mappingEntry);
    var driveFileUrlFromMap = mappingEntry.driveFileUrl;

    if (fileId) {
      fileIdMap[fileId] = formId;
      formIdToMappingEntry[formId] = mappingEntry;
    } else {
      // fileIdがない場合はエラーとして記録
      pushFailure(formId, null, null, driveFileUrlFromMap, "fileId", "プロパティサービスにファイルIDが登録されていません");
    }
  }

  var fileIds = Object.keys(fileIdMap);
  var titleCacheDirty = false;

  // Drive API v3 バッチリクエスト（最大100件ずつ）
  var BATCH_SIZE = NFB_DRIVE_API_BATCH_SIZE;

  for (var i = 0; i < fileIds.length; i += BATCH_SIZE) {
    var batchFileIds = fileIds.slice(i, i + BATCH_SIZE);

    // バッチリクエストで複数ファイルのメタデータとコンテンツを取得
    try {
      var batchResults = Forms_batchGetFiles_(batchFileIds);

      // バッチ結果を処理
      for (var j = 0; j < batchResults.length; j++) {
        var result = batchResults[j];
        var fileId = result.fileId;
        var formId = fileIdMap[fileId];
        var mappingEntry = formIdToMappingEntry[formId];

        if (result.error) {
          // エラーケース
          pushFailure(formId, fileId, result.fileName, mappingEntry.driveFileUrl, result.errorStage || "unknown", result.error);
        } else {
          // 成功ケース
          try {
            var form = JSON.parse(result.content);
            form.id = formId;

            // 名前 ＝ Drive ファイル名（.json 除去）。JSON 内の formTitle は持たない運用。
            var derivedTitle = Nfb_nameFromFileName_(result.fileName);
            form.settings = (form.settings && typeof form.settings === "object" && !Array.isArray(form.settings)) ? form.settings : {};
            if (derivedTitle) form.settings.formTitle = derivedTitle;

            // driveFileUrlがない場合はマッピング/ファイルから補完
            if (!form.driveFileUrl) {
              form.driveFileUrl = mappingEntry.driveFileUrl || result.fileUrl;
            }

            // Plan P4 γ: form.createdAt / modifiedAt は JST 文字列を canonical に。
            // 旧データ救済として Unix ms / シリアル値も受け付け、文字列化する。
            var createdAtSerial = Sheets_toUnixMs_(form.createdAt, true);
            var modifiedAtSerial = Sheets_toUnixMs_(form.modifiedAt, true);
            if (createdAtSerial !== null) form.createdAt = Sheets_formatJstString_(createdAtSerial);
            if (modifiedAtSerial !== null) form.modifiedAt = Sheets_formatJstString_(modifiedAtSerial);
            form.createdAtUnixMs = createdAtSerial;
            form.modifiedAtUnixMs = modifiedAtSerial;

            // タイトルキャッシュの遅延バックフィル（名前 ＝ ファイル名由来）
            var cachedTitle = mappingEntry && mappingEntry.title;
            var actualTitle = (form.settings && form.settings.formTitle) || "";
            if (actualTitle && cachedTitle !== actualTitle) {
              mapping[formId] = {
                fileId: mappingEntry.fileId || null,
                driveFileUrl: mappingEntry.driveFileUrl || null,
                title: actualTitle,
              };
              titleCacheDirty = true;
            }

            // アーカイブフィルタリング
            if (!includeArchived && form.archived) {
              Logger.log("[Forms_listForms_] Skipping archived form: " + formId);
              continue;
            }

            forms.push(form);
          } catch (parseErr) {
            pushFailure(formId, fileId, result.fileName, mappingEntry.driveFileUrl || result.fileUrl, "parse", nfbErrorToString_(parseErr));
          }
        }
      }
    } catch (batchErr) {
      Logger.log("[Forms_listForms_] Batch request failed: " + batchErr);
      // バッチ全体が失敗した場合は個別にフォールバック
      for (var k = 0; k < batchFileIds.length; k++) {
        var fbFileId = batchFileIds[k];
        var fbFormId = fileIdMap[fbFileId];
        pushFailure(fbFormId, fbFileId, null, formIdToMappingEntry[fbFormId].driveFileUrl, "batch", nfbErrorToString_(batchErr));
      }
    }
  }

  if (titleCacheDirty) {
    try {
      Forms_saveMapping_(mapping);
    } catch (errSaveMap) {
      Logger.log("[Forms_listForms_] Title cache backfill save failed: " + errSaveMap);
    }
  }

  return {
    forms: forms,
    loadFailures: loadFailures,
  };
}

/**
 * 複数ファイルを DriveApp で順次読み取る
 * @param {Array<string>} fileIds - ファイルIDの配列
 * @return {Array<Object>} 結果の配列 [{ fileId, fileName, fileUrl, content, error, errorStage }]
 */

function Forms_batchGetFiles_(fileIds) {
  var results = [];

  for (var i = 0; i < fileIds.length; i++) {
    var fid = fileIds[i];
    try {
      var file = DriveApp.getFileById(fid);
      results.push({
        fileId: fid,
        fileName: file.getName(),
        fileUrl: file.getUrl(),
        content: file.getBlob().getDataAsString(),
      });
    } catch (err) {
      results.push({
        fileId: fid,
        error: nfbErrorToString_(err),
        errorStage: "read",
      });
    }
  }

  return results;
}


/**
 * 複数フォームを削除（Driveファイルは削除せず、紐付けのみ解除）
 * @param {Array<string>} formIds
 * @return {Object} { ok: boolean, deleted: number, errors: Array }
 */

function Forms_deleteForms_(formIds) {
  if (!formIds || !formIds.length) {
    throw new Error("Form IDs are required");
  }

  var ids = Nfb_normalizeIdList_(formIds);
  var mapping = Forms_getMapping_();
  var deleted = 0;

  ids.forEach(function(formId) {
    if (!formId) return;

    if (mapping.hasOwnProperty(formId)) {
      delete mapping[formId];
      deleted += 1;
    }
  });

  Forms_saveMapping_(mapping);

  return {
    ok: true,
    deleted: deleted,
    errors: []
  };
}


/**
 * 複数フォームの真偽状態フラグを一括変更する内部ヘルパ。
 *   field       : 設定するフィールド名（"archived" or "readOnly"）
 *   value       : 設定値
 *   clearField  : value が truthy のとき false に強制する相互排他フィールド名。
 *                 null / "" の場合は相互排他処理を行わない。
 * 返り値の形は元の Forms_setFormsArchivedState_ / Forms_setFormsReadOnlyState_ と同等。
 */
function Forms_setFormsStateField_(formIds, field, value, clearField) {
  if (!formIds || !formIds.length) {
    throw new Error("Form IDs are required");
  }

  var ids = Nfb_normalizeIdList_(formIds);
  var errors = [];
  var updated = 0;
  var updatedForms = [];
  var currentTsUnixMs = Sheets_dateToSerial_(new Date());
  var currentTsJst = Sheets_formatJstString_(currentTsUnixMs);
  var nextValue = !!value;
  var logTag = "[Forms_setFormsStateField_:" + field + "]";

  ids.forEach(function(formId) {
    if (!formId) return;

    try {
      var form = Forms_getForm_(formId);
      if (!form) {
        errors.push({ formId: formId, error: "Form not found" });
        return;
      }

      form[field] = nextValue;
      if (nextValue && clearField) {
        form[clearField] = false;
      }
      form.modifiedAt = currentTsJst;
      form.modifiedAtUnixMs = currentTsUnixMs;

      var result = Forms_saveForm_(form);
      if (result && result.ok) {
        updated += 1;
        updatedForms.push(result.form);
      } else {
        errors.push({ formId: formId, error: "Save failed" });
      }
    } catch (err) {
      Logger.log(logTag + " Error updating " + field + " state for form " + formId + ": " + err);
      errors.push({ formId: formId, error: err.message || String(err) });
    }
  });

  return {
    ok: errors.length === 0,
    updated: updated,
    errors: errors,
    forms: updatedForms
  };
}

/**
 * 複数フォームのアーカイブ状態を一括変更
 * @param {Array<string>} formIds
 * @param {boolean} archived
 * @return {Object} { ok: boolean, updated: number, errors: Array, forms: Array }
 */
function Forms_setFormsArchivedState_(formIds, archived) {
  return Forms_setFormsStateField_(formIds, "archived", archived, "readOnly");
}

/**
 * 複数フォームの参照のみ状態を一括変更
 * @param {Array<string>} formIds
 * @param {boolean} readOnly
 * @return {Object} { ok: boolean, updated: number, errors: Array, forms: Array }
 */
function Forms_setFormsReadOnlyState_(formIds, readOnly) {
  return Forms_setFormsStateField_(formIds, "readOnly", readOnly, "archived");
}

/**
 * フォームをコピー（同じDriveフォルダに新IDで作成）
 * @param {string} formId - コピー元フォームID
 * @return {Object} Forms_saveForm_の戻り値（{ ok, fileId, fileUrl, form }）
 */
function Forms_copyForm_(formId) {
  if (!formId) throw new Error("formId is required");

  // 1. 元フォームを取得
  var sourceForm = Forms_getForm_(formId);
  if (!sourceForm) throw new Error("コピー元フォームが見つかりません: " + formId);

  // 2. 元ファイルの親フォルダURLを取得
  var mapping = Forms_getMapping_();
  var mappingEntry = mapping[formId] || {};
  var sourceFileId = mappingEntry.fileId;
  var parentFolderUrl = null;

  if (sourceFileId) {
    try {
      var sourceFile = DriveApp.getFileById(sourceFileId);
      var parents = sourceFile.getParents();
      if (parents.hasNext()) {
        var parentFolder = parents.next();
        parentFolderUrl = "https://drive.google.com/drive/folders/" + parentFolder.getId();
      }
    } catch (e) {
      Logger.log("[Forms_copyForm_] Failed to get parent folder: " + e);
    }
  }

  // 3. 新しいフォームデータを作成（id ＝ コピー先ファイルの fileId。事前採番はしない）
  var newForm = JSON.parse(JSON.stringify(sourceForm));
  delete newForm.id;

  var originalTitle = (sourceForm.settings && sourceForm.settings.formTitle) || "";
  newForm.settings = newForm.settings || {};
  // 同名フォームが既に存在するため、Forms_saveForm_ 内の auto-numbering で (1)(2)... が付く
  newForm.settings.formTitle = originalTitle;
  newForm.archived = false;
  newForm.readOnly = false;
  delete newForm.driveFileUrl;

  // 4. 同じフォルダに保存（フォルダが不明ならルートに保存）
  var saveMode = parentFolderUrl ? "copy_to_folder" : "copy_to_root";
  var result = Forms_saveForm_(newForm, parentFolderUrl, saveMode);

  return result;
}

