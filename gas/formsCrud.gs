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

// 同一物理ファイル（fileId）を指す mapping キーが複数あるとき 1 つに畳む共通ヘルパ。
// 旧 ULID キーのまま rename した際に fileId キーが新規追加され、旧キーが残って
// 一覧が二重化する不具合の自己修復。fileId キー（key === fileId）を優先して残し、
// それ以外（旧 ULID 等）を除去する。1 キー＝1 ファイルの正常エントリは衝突しないので不変。
// Forms / Analytics 両方の mapping store で使う。変更があれば true を返す（呼び出し側で永続化する）。
function Nfb_dedupeMappingByFileId_(mapping) {
  var keepFor = {};   // fileId -> 残すキー
  var toDelete = [];
  for (var k in mapping) {
    if (!mapping.hasOwnProperty(k)) continue;
    var fid = Nfb_resolveFileIdFromEntry_(mapping[k]);
    if (!fid) continue;   // fileId 不明なエントリは触らない（重複判定の対象外）
    var cur = keepFor[fid];
    if (cur === undefined) { keepFor[fid] = k; continue; }
    // 衝突: fileId キー（key === fid）を優先して残し、もう一方を畳む。
    if (k === fid && cur !== fid) { toDelete.push(cur); keepFor[fid] = k; }
    else { toDelete.push(k); }
  }
  for (var i = 0; i < toDelete.length; i++) delete mapping[toDelete[i]];
  return toDelete.length > 0;
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
    var read = Nfb_readJsonFileById_(fileId);
    var file = read.file;
    var form = read.json;

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
  mapping[fileId] = {
    fileId: fileId,
    driveFileUrl: fileUrl,
    title: name,
    folder: Forms_normalizeFolderPath_(json.folder)
  };
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
// forms は JSON ファイルのみを名前一致対象にする（StdFolders_isJsonFile_ を fileFilter に渡す）。
function Forms_findFileByNamesRecursive_(folder, targets) {
  return SharedDrive_findFileByNameRecursive_(folder, targets, StdFolders_isJsonFile_);
}

// 既存フォームの物理ファイルを「fileId → 実体 URL → 中央辞書(folder+title)アンカー」の順で解決する。
// Analytics_resolveItemFileOrNull_ の forms 版。フロントの cache 優先取得が渡す stale な id
// （実体とずれた fileId / 旧 f_... ULID）でも実体を引き当て、保存時に「別ファイル新規作成 /
// 上書き失敗」ではなく「実体の上書き(setName)」へ倒して二重化・保存エラーを防ぐ。
// 見つからなければ null（呼び出し側で従来フォールバックへ）。
function Forms_resolveFormFileOrNull_(fileId, formId, entry, driveFileUrl) {
  // 多段解決の本体は SharedCrud_resolveEntityFileOrNull_（sharedEntityCrud.gs）に集約。
  // forms 固有の差分（title をアンカー名に使う / URL 救済あり / base ツリーを再帰探索 /
  // id 名フォールバックなし）を opts で注入する。
  return SharedCrud_resolveEntityFileOrNull_(fileId, {
    name: (entry && typeof entry.title === "string") ? entry.title : "",
    folder: (entry && typeof entry.folder === "string") ? entry.folder : null,
    driveFileUrl: driveFileUrl || (entry && entry.driveFileUrl) || "",
    lookupFolderForPath: FormsDrive_lookupFolderForPath_,
    findInTree: function(name) {
      var base = FormsDrive_baseFolderOrNull_();
      if (!base) return null;
      var targets = {};
      targets[name + ".json"] = true;
      if (typeof Forms_normalizeFormTitle_ === "function") targets[Forms_normalizeFormTitle_(name) + ".json"] = true;
      return Forms_findFileByNamesRecursive_(base, targets);
    },
    idFallbackName: "",
  });
}

// フォルダ込みフォーム名（"フォルダ/サブ/葉"）を、その物理フォルダ「直下のみ」で葉名一致解決する。
// 別フォルダの同名へ波及しないようパス厳密（非再帰）。フォルダ込みでない / 物理未解決は null。
function Forms_findFileByQualifiedName_(qualifiedName) {
  var norm = Forms_normalizeFolderPath_(qualifiedName);
  if (!norm || norm.indexOf("/") === -1) return null;
  var segs = norm.split("/");
  var leaf = segs.pop();
  var folder = FormsDrive_lookupFolderForPath_(segs.join("/"));
  if (!folder) return null;
  var targets = {};
  targets[leaf + ".json"] = true;
  targets[Forms_normalizeFormTitle_(leaf) + ".json"] = true;
  var files = folder.getFiles();
  while (files.hasNext()) {
    var f = files.next();
    if (typeof f.isTrashed === "function" && f.isTrashed()) continue;
    if (!StdFolders_isJsonFile_(f)) continue;
    if (targets[f.getName()]) return f;
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

    var entry = wantId ? (mapping[wantId] || null) : null;

    // 1) id（fileId）で解決を試みる。
    if (wantId) {
      var fid = (entry ? Nfb_resolveFileIdFromEntry_(entry) : null) || wantId;
      if (fid) {
        try {
          var f0 = DriveApp.getFileById(fid);
          if (!(typeof f0.isTrashed === "function" && f0.isTrashed()) && StdFolders_isJsonFile_(f0)) {
            var fm = Forms_adoptFormFile_(f0, mapping);
            if (fm) return { ok: true, form: fm, formId: fm.id, relinked: fm.id !== wantId, matchedBy: "id" };
          }
        } catch (e0) { /* 壊れている / fileId でない → 中央辞書アンカーで復旧へ */ }
      }
    }

    // 2) 中央辞書（マッピング）の論理パス folder + title アンカーで物理ファイルを引き当て直す
    //    （id 変化＝コピー/再作成の自動再リンク）。参照に formName を持たなくても復旧できる。
    if (entry && typeof entry.title === "string" && entry.title) {
      var leafJson = entry.title + ".json";
      var leafJsonNorm = (typeof Forms_normalizeFormTitle_ === "function")
        ? Forms_normalizeFormTitle_(entry.title) + ".json" : leafJson;
      if (typeof entry.folder === "string") {
        var scopedFolder = FormsDrive_lookupFolderForPath_(entry.folder);
        if (scopedFolder) {
          var scoped = StdFolders_findFileByNameInFolder_(scopedFolder, leafJson)
            || StdFolders_findFileByNameInFolder_(scopedFolder, leafJsonNorm);
          if (scoped) {
            var fmS = Forms_adoptFormFile_(scoped, mapping);
            if (fmS) return { ok: true, form: fmS, formId: fmS.id, relinked: true, matchedBy: "registry" };
          }
        }
      }
      // folder 不明/未一致 → 名前でツリー全体を探す（degrade）。
      var baseR = FormsDrive_baseFolderOrNull_();
      if (baseR) {
        var targetsR = {};
        targetsR[leafJson] = true;
        targetsR[leafJsonNorm] = true;
        var foundR = Forms_findFileByNamesRecursive_(baseR, targetsR);
        if (foundR) {
          var fmR = Forms_adoptFormFile_(foundR, mapping);
          if (fmR) return { ok: true, form: fmR, formId: fmR.id, relinked: true, matchedBy: "registry" };
        }
      }
    }

    // 3) 名前フォールバック（旧 ref.formName を渡す呼び出し・旧データ救済の後方互換）。
    if (wantName) {
      var base = FormsDrive_baseFolderOrNull_();
      if (base) {
        // 2a) フォルダ込み名（"フォルダ/サブ/葉"）→ その物理フォルダ直下で葉名一致（パス厳密）。
        //     解けなければ再帰探索へは降りず、別フォルダ同名への誤マッチを避ける。
        if (Forms_normalizeFolderPath_(wantName).indexOf("/") !== -1) {
          var foundQ = Forms_findFileByQualifiedName_(wantName);
          if (foundQ) {
            var fmQ = Forms_adoptFormFile_(foundQ, mapping);
            if (fmQ) return { ok: true, form: fmQ, formId: fmQ.id, relinked: true, matchedBy: "path" };
          }
          return { ok: true, form: null };
        }
        // 2b) バレ名 → ファイル名で再帰探索（従来互換）。
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
  // 既存の二重登録（旧 ULID キー + fileId キーが同一ファイルを指す）を畳んでから一覧化する。
  // 一覧自体は fileId 単位で表示するため見た目は重複しないが、残存した旧キーが再保存時の
  // 名前ユニーク化を誤らせる（誤った ` (1)` 付与）ため、ここで永続的に掃除する。
  if (Nfb_dedupeMappingByFileId_(mapping)) Forms_saveMapping_(mapping);

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

            // タイトル／論理パスキャッシュの遅延バックフィル（名前 ＝ ファイル名由来 / folder ＝ JSON 由来）
            var cachedTitle = mappingEntry && mappingEntry.title;
            var actualTitle = (form.settings && form.settings.formTitle) || "";
            var actualFolder = typeof form.folder === "string" ? Forms_normalizeFolderPath_(form.folder) : null;
            var cachedFolder = (mappingEntry && typeof mappingEntry.folder === "string") ? mappingEntry.folder : null;
            if ((actualTitle && cachedTitle !== actualTitle) || (actualFolder !== null && cachedFolder !== actualFolder)) {
              mapping[formId] = {
                fileId: mappingEntry.fileId || null,
                driveFileUrl: mappingEntry.driveFileUrl || null,
                title: actualTitle || (typeof cachedTitle === "string" ? cachedTitle : null),
                folder: actualFolder !== null ? actualFolder : cachedFolder,
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
 * 複数フォームのリンクを解除（アンマウント）する。Drive 上の実体は削除せず残し、
 * 中央辞書（マッピング）の登録のみを除去する。
 * 戻り値の deleted は「リンク解除した件数」（後方互換のためキー名は据え置き）。
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

    // リンク（登録）のみ解除する。Drive 上のファイル本体は削除しない。
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
 * 複数フォームを「削除」する。リンク解除（マッピング除去）に加え、
 * プロジェクト内（標準フォルダ 01_forms 配下、ネスト含む）にある実体ファイルだけを
 * Drive のゴミ箱へ移動する。プロジェクト外のファイルはリンク解除のみで実体は残す。
 * @param {Array<string>} formIds
 * @return {Object} { ok, deleted, trashed, errors }
 */
function Forms_deleteFormsWithFiles_(formIds) {
  if (!formIds || !formIds.length) {
    throw new Error("Form IDs are required");
  }

  var ids = Nfb_normalizeIdList_(formIds);
  var mapping = Forms_getMapping_();
  var deleted = 0;
  var trashed = 0;
  var errors = [];

  ids.forEach(function(formId) {
    if (!formId) return;

    // 実体トラッシュ判定用の fileId（id ≠ fileId に備えてマッピングからも解決）。
    var fileId = Nfb_resolveFileIdFromEntry_(mapping[formId]) || formId;

    // リンク（登録）を解除する。
    if (mapping.hasOwnProperty(formId)) {
      delete mapping[formId];
      deleted += 1;
    }

    // プロジェクト内のファイルだけ実体をゴミ箱へ移動する。
    if (fileId && StdFolders_isFileInStdSubfolder_(fileId, "forms")) {
      try {
        DriveApp.getFileById(fileId).setTrashed(true);
        trashed += 1;
      } catch (err) {
        errors.push({ id: formId, fileId: fileId, reason: nfbErrorToString_(err) });
      }
    }
  });

  Forms_saveMapping_(mapping);

  return {
    ok: true,
    deleted: deleted,
    trashed: trashed,
    errors: errors
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
  var parentFolderUrl = SharedDrive_parentFolderUrlOfFileId_(mappingEntry.fileId, "Forms_copyForm_");

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

