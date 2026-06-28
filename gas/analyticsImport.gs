// =============================================
// Analytics Import — Drive URL から Question/Dashboard を取り込み
// =============================================

/**
 * インポートしたテンプレートデータを正規化。
 * - questions: query フィールドが object であること
 * - dashboards: cards フィールドが array であること
 */
function Analytics_normalizeImportedTemplate_(type, raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }

  if (type === "questions") {
    if (!raw.query || typeof raw.query !== "object" || Array.isArray(raw.query)) {
      return null;
    }
  } else if (type === "dashboards") {
    if (!Array.isArray(raw.cards)) {
      return null;
    }
  } else if (type === "crossSearches") {
    // 串刺しフォーム検索は参照フォーム配列 formIds を必須とする。
    if (!Array.isArray(raw.formIds)) {
      return null;
    }
  } else {
    return null;
  }

  var normalized = {};
  for (var key in raw) {
    if (!raw.hasOwnProperty(key)) continue;
    normalized[key] = raw[key];
  }
  normalized.archived = !!normalized.archived;
  return normalized;
}

/**
 * Drive URL（ファイルまたはフォルダ、ID 単体も可）から JSON を読み込み、
 * コピーせず参照用にメタを返す。既登録の fileId / driveFileUrl は skip。
 * 共通本体は Nfb_scanDriveJsonImports_。
 */
function Analytics_importFromDrive_(type, url) {
  return nfbSafeCall_(function() {
    var resultKey = Analytics_getResultKey_(type);
    var scan = Nfb_scanDriveJsonImports_(url, Analytics_getMapping_(type), {
      normalize: function(rawData) { return Analytics_normalizeImportedTemplate_(type, rawData); },
      makeEntry: function(normalized, fileId, fileUrl) {
        var entry = { fileId: fileId, fileUrl: fileUrl };
        entry[resultKey] = normalized;
        return entry;
      },
      entityLabel: type === "questions" ? "Question" : (type === "crossSearches" ? "CrossSearch" : "Dashboard")
    });
    return {
      ok: true,
      items: scan.items,
      skipped: scan.skipped,
      parseFailed: scan.parseFailed,
      totalFiles: scan.totalFiles,
    };
  });
}

/**
 * インポートしたテンプレートをマッピング登録（コピーなし）。
 * payload: { question?, dashboard?, fileId, fileUrl }
 */
function Analytics_registerImportedTemplate_(type, payload) {
  return nfbSafeCall_(function() {
    if (!payload || typeof payload !== "object") {
      throw new Error("payload が不正です");
    }
    var resultKey = Analytics_getResultKey_(type);
    var rawTemplate = payload[resultKey];
    var fileId = payload.fileId;
    if (!rawTemplate || !fileId) {
      throw new Error(resultKey + " と fileId が必要です");
    }
    var template = Analytics_normalizeImportedTemplate_(type, rawTemplate);
    if (!template) {
      throw new Error(resultKey + " の JSON が有効な形式ではありません");
    }

    // 配置（構成内なら参照のまま / 構成外なら該当サブフォルダへコピー）+ マッピング登録は共通本体に委譲。
    // id ＝ Drive fileId / 名前 ＝ ファイル名 へ統一。名前はファイル名から導出し、空なら template.name。
    var reg = SharedEntity_registerImported_(fileId, {
      stdKey: type === "questions" ? "questions" : (type === "crossSearches" ? "crossSearches" : "dashboards"),
      getMapping: function() { return Analytics_getMapping_(type); },
      saveMapping: function(m) { return Analytics_saveMapping_(type, m); },
      labelKey: "name",
      relativeFolderOfFile: function(fid) { return AnalyticsDrive_relativeFolderOfFile_(type, fid); },
      resolveLabel: function(mapping, newId, placedFileId) {
        var name = "";
        try { name = Nfb_nameFromFile_(DriveApp.getFileById(placedFileId)); } catch (eName) { name = ""; }
        if (!name) name = template.name || "";
        return name;
      }
    });
    var newId = reg.newId;
    fileId = reg.fileId;
    var fileUrl = reg.fileUrl;

    template.id = newId;
    template.name = reg.label;
    template.driveFileUrl = fileUrl;

    // 論理フォルダの決定:
    //   - payload.folder（管理画面で開いていた論理フォルダ）が明示指定されていればそれを論理パスとし、
    //     物理ファイルもその物理フォルダへ移動する（物理パスを論理に合わせる）。
    //   - 未指定のときは、取り込んだ物理ファイルが種類に対応した場所（02_questions / 03_dashboards
    //     配下）の何処にあるかをそのまま論理パスとする（物理位置 ＝ 論理パス）。
    var normFolder;
    if (typeof payload.folder === "string" && payload.folder.trim() !== "") {
      normFolder = Forms_normalizeFolderPath_(payload.folder);
      Analytics_setItemFolder_(type, newId, normFolder);
    } else {
      var physical = AnalyticsDrive_relativeFolderOfFile_(type, fileId);
      normFolder = physical == null ? "" : physical;
    }
    template.folder = normFolder;

    var result = { ok: true, fileId: fileId, fileUrl: fileUrl };
    result[resultKey] = template;
    return result;
  });
}
