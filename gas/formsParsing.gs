function Forms_parseGoogleDriveUrl_(url) {
  if (!url || typeof url !== "string") {
    return { type: null, id: null };
  }

  var trimmed = url.trim();
  if (!trimmed) {
    return { type: null, id: null };
  }

  // ファイルURL:
  // - https://drive.google.com/file/d/{fileId}/view
  // - https://docs.google.com/document/d/{fileId}/edit
  // - https://docs.google.com/spreadsheets/d/{fileId}/edit
  // - https://docs.google.com/presentation/d/{fileId}/edit
  var fileMatch = trimmed.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (!fileMatch) {
    fileMatch = trimmed.match(/docs\.google\.com\/[^/]+\/(?:u\/\d+\/)?d\/([a-zA-Z0-9_-]+)/);
  }
  if (fileMatch) {
    return { type: "file", id: fileMatch[1] };
  }

  // フォルダURL: https://drive.google.com/drive/folders/{folderId}
  var folderMatch = trimmed.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (folderMatch) {
    return { type: "folder", id: folderMatch[1] };
  }

  // open?id= 形式: https://drive.google.com/open?id={id}
  var openMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (openMatch) {
    return Forms_resolveFileOrFolder_(openMatch[1]);
  }

  // IDのみが渡された場合も試す
  if (/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
    return Forms_resolveFileOrFolder_(trimmed);
  }

  return { type: null, id: null };
}

function Forms_generateFormId_(mapping) {
  var nextId = "";
  do {
    nextId = Nfb_generateFormId_();
  } while (mapping && mapping[nextId]);
  return nextId;
}

function Forms_normalizeImportedFormData_(rawForm) {
  if (!rawForm || typeof rawForm !== "object" || Array.isArray(rawForm)) {
    return null;
  }
  if (!Array.isArray(rawForm.schema)) {
    return null;
  }

  var normalized = {};
  for (var key in rawForm) {
    if (!rawForm.hasOwnProperty(key)) continue;
    normalized[key] = rawForm[key];
  }

  var settings = rawForm.settings;
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    settings = {};
  } else {
    var copiedSettings = {};
    for (var settingsKey in settings) {
      if (!settings.hasOwnProperty(settingsKey)) continue;
      copiedSettings[settingsKey] = settings[settingsKey];
    }
    settings = copiedSettings;
  }

  normalized.settings = settings;
  return normalized;
}

/**
 * Google Drive のファイル URL / フォルダ URL（ID 単体も可）から JSON ファイルを走査し、
 * 既登録 (mapping の fileId / driveFileUrl) は skip しつつ正規化済みエントリを集める。
 * コピーは作らず元ファイルを参照する import フロー（forms / analytics 共通の本体）。
 *
 * @param {string} url      ファイル or フォルダ URL（ID 単体も可）
 * @param {Object} mapping  既登録マッピング（{ id: { fileId, driveFileUrl } } 形）
 * @param {Object} opts
 *   - normalize(rawData) -> 正規化済みオブジェクト or null（無効データ）
 *   - makeEntry(normalized, fileId, fileUrl) -> items に積むエントリ
 *   - entityLabel: string  無効データのエラーメッセージ用ラベル（例 "フォーム" / "Question"）
 * @return {{ items: Array, skipped: number, parseFailed: number, totalFiles: number }}
 */
function Nfb_scanDriveJsonImports_(url, mapping, opts) {
  if (!url || typeof url !== "string") {
    throw new Error("URLが必要です");
  }
  var parsed = Forms_parseGoogleDriveUrl_(url);
  if (!parsed.type) {
    throw new Error("無効な Google Drive URL です");
  }
  var normalize = opts.normalize;
  var makeEntry = opts.makeEntry;
  var entityLabel = opts.entityLabel ? String(opts.entityLabel) + " " : "";

  var existingFileIds = [];
  var existingDriveFileUrls = [];
  for (var key in mapping) {
    if (!mapping.hasOwnProperty(key)) continue;
    var entry = mapping[key];
    if (entry && entry.fileId) existingFileIds.push(entry.fileId);
    if (entry && entry.driveFileUrl) existingDriveFileUrls.push(entry.driveFileUrl);
  }

  var items = [];
  var skipped = 0;
  var parseFailed = 0;
  var totalFiles = 0;

  if (parsed.type === "file") {
    var file = DriveApp.getFileById(parsed.id);
    var fileUrl = file.getUrl();
    var fileName = file.getName();
    totalFiles = 1;
    if (existingFileIds.indexOf(parsed.id) !== -1 || existingDriveFileUrls.indexOf(fileUrl) !== -1) {
      throw new Error("このファイルは既に登録されています: " + fileName);
    }
    var rawData;
    try {
      rawData = JSON.parse(file.getBlob().getDataAsString());
    } catch (err) {
      throw new Error("JSON のパースに失敗しました: " + fileName);
    }
    var normalized = normalize(rawData);
    if (!normalized) {
      throw new Error(entityLabel + "形式として無効な JSON です: " + fileName);
    }
    items.push(makeEntry(normalized, parsed.id, fileUrl));
  } else if (parsed.type === "folder") {
    var folder = DriveApp.getFolderById(parsed.id);
    var files = folder.getFiles();
    while (files.hasNext()) {
      var f = files.next();
      var fName = f.getName();
      var fId = f.getId();
      var fUrl = f.getUrl();
      var mimeType = f.getMimeType();
      var isJsonByExt = fName.toLowerCase().endsWith(".json");
      var isJsonByMime = mimeType === "application/json" || mimeType === "text/plain";
      if (!isJsonByExt && !isJsonByMime) continue;
      totalFiles += 1;
      if (existingFileIds.indexOf(fId) !== -1 || existingDriveFileUrls.indexOf(fUrl) !== -1) {
        skipped += 1;
        Logger.log("[Nfb_scanDriveJsonImports_] Skipped (already registered): " + fName);
        continue;
      }
      var data;
      try {
        data = JSON.parse(f.getBlob().getDataAsString());
      } catch (parseErr) {
        parseFailed += 1;
        Logger.log("[Nfb_scanDriveJsonImports_] JSON parse failed: " + fName + " - " + parseErr);
        continue;
      }
      var normData = normalize(data);
      if (!normData) {
        parseFailed += 1;
        Logger.log("[Nfb_scanDriveJsonImports_] Invalid data: " + fName);
        continue;
      }
      items.push(makeEntry(normData, fId, fUrl));
    }
  }

  return { items: items, skipped: skipped, parseFailed: parseFailed, totalFiles: totalFiles };
}

/**
 * スプレッドシートまたはフォルダの指定を解決（ID/URLを受け取る）
 * @param {string} input
 * @return {{ type: "spreadsheet"|"folder"|null, id: string|null }}
 */

function Forms_parseSpreadsheetTarget_(input) {
  if (!input || typeof input !== "string") {
    return { type: null, id: null };
  }

  var trimmed = input.trim();
  if (!trimmed) {
    return { type: null, id: null };
  }

  var sheetMatch = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (sheetMatch) {
    return { type: "spreadsheet", id: sheetMatch[1] };
  }

  var folderMatch = trimmed.match(/\/drive\/folders\/([a-zA-Z0-9_-]+)/);
  if (folderMatch) {
    return { type: "folder", id: folderMatch[1] };
  }

  var fileMatch = trimmed.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (fileMatch) {
    return Forms_resolveSpreadsheetIdOrFolder_(fileMatch[1]);
  }

  var openMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (openMatch) {
    return Forms_resolveSpreadsheetIdOrFolder_(openMatch[1]);
  }

  if (/^[a-zA-Z0-9_-]{15,}$/.test(trimmed)) {
    return Forms_resolveSpreadsheetIdOrFolder_(trimmed);
  }

  return { type: null, id: null };
}

/**
 * IDがスプレッドシート/フォルダのどちらかを判定
 * @param {string} id
 * @return {{ type: "spreadsheet"|"folder"|null, id: string|null }}
 */

function Forms_resolveSpreadsheetIdOrFolder_(id) {
  if (!id) {
    return { type: null, id: null };
  }

  try {
    SpreadsheetApp.openById(id);
    return { type: "spreadsheet", id: id };
  } catch (e) {
    // ignore and try folder
  }

  try {
    DriveApp.getFolderById(id);
    return { type: "folder", id: id };
  } catch (e2) {
    // ignore
  }

  return { type: null, id: null };
}

function Forms_resolveFileOrFolder_(id) {
  try {
    var testFile = DriveApp.getFileById(id);
    return { type: "file", id: id };
  } catch (e) {
    try {
      var testFolder = DriveApp.getFolderById(id);
      return { type: "folder", id: id };
    } catch (e2) {
      return { type: null, id: null };
    }
  }
}
