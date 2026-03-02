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

  normalized.settings = settings;
  return normalized;
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
