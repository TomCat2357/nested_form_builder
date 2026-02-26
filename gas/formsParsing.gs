// Split from forms.gs



function Forms_parseGoogleDriveUrl_(url) {
  if (!url || typeof url !== "string") {
    return { type: null, id: null };
  }

  var trimmed = url.trim();
  if (!trimmed) {
    return { type: null, id: null };
  }

  // ファイルURL: https://drive.google.com/file/d/{fileId}/view
  var fileMatch = trimmed.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
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

  if (!settings.formTitle && typeof rawForm.name === "string" && rawForm.name.trim()) {
    settings.formTitle = rawForm.name.trim();
  }

  normalized.settings = settings;
  return normalized;
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

/**
 * スプレッドシート名を生成
 * @param {Object} form
 * @return {string}
 */

function Forms_computeContentHash_(form) {
  // ハッシュ計算用にタイムスタンプとURL以外の内容を抽出
  var hashContent = {
    id: form.id || "",
    description: form.description || "",
    schema: form.schema || [],
    settings: form.settings || {},
    importantFields: form.importantFields || [],
    displayFieldSettings: form.displayFieldSettings || [],
    archived: !!form.archived,
    schemaVersion: form.schemaVersion || 1,
  };

  var contentStr = JSON.stringify(hashContent);
  var rawHash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, contentStr);

  // バイト配列を16進数文字列に変換
  var hexHash = rawHash.map(function(byte) {
    var hex = (byte < 0 ? byte + 256 : byte).toString(16);
    return hex.length === 1 ? "0" + hex : hex;
  }).join("");

  // 先頭16文字を返す（ファイル名として扱いやすい長さに）
  return hexHash.substring(0, 16);
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
