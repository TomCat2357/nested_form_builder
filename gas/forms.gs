var NFB_FORMS_FILE_PREFIX = "nested-form-builder-forms";

function Nfb_parseImportedForm_(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  var schema = Array.isArray(raw.schema) ? raw.schema : [];
  return {
    name: typeof raw.name === "string" ? raw.name : "",
    description: typeof raw.description === "string" ? raw.description : "",
    schema: schema,
    settings: raw && typeof raw.settings === "object" && !Array.isArray(raw.settings) ? raw.settings : {},
    archived: !!raw.archived,
    schemaVersion: Number(raw.schemaVersion) || 1,
  };
}

function Nfb_extractFormsFromContent_(content) {
  var forms = [];
  if (!content) return forms;
  try {
    var parsed = JSON.parse(content);
    if (Array.isArray(parsed)) {
      parsed.forEach(function (item) {
        var form = Nfb_parseImportedForm_(item);
        if (form) forms.push(form);
      });
    } else {
      var form = Nfb_parseImportedForm_(parsed);
      if (form) forms.push(form);
    }
  } catch (err) {
    console.warn("[nfb] Failed to parse imported JSON", err);
  }
  return forms;
}

function Drive_extractFileId_(urlOrId) {
  if (!urlOrId) return "";
  var id = String(urlOrId).trim();
  var match = id.match(/[-\w]{25,}/);
  return match ? match[0] : "";
}

function Nfb_getFormsFile_(urlOrId) {
  var fileId = Drive_extractFileId_(urlOrId);
  if (!fileId) return null;
  return DriveApp.getFileById(fileId);
}

function Nfb_generateFileName_() {
  var uuid = Utilities.getUuid();
  return NFB_FORMS_FILE_PREFIX + "-" + uuid.slice(0, 8) + ".json";
}

function Nfb_createFileInFolder_(folder) {
  var name = Nfb_generateFileName_();
  var file = folder ? folder.createFile(name, "[]", MimeType.PLAIN_TEXT) : DriveApp.createFile(name, "[]", MimeType.PLAIN_TEXT);
  return { file: file, url: file.getUrl() };
}

function Nfb_resolveDriveTarget_(urlOrId) {
  if (!urlOrId) return { type: "root" };
  var id = Drive_extractFileId_(urlOrId);
  if (!id) return { type: "root" };

  try {
    var file = DriveApp.getFileById(id);
    return { type: "file", file: file, url: file.getUrl() };
  } catch (err) {
    // noop; try folder lookup next
  }

  try {
    var folder = DriveApp.getFolderById(id);
    return { type: "folder", folder: folder, url: folder.getUrl() };
  } catch (err) {
    console.warn("[nfb] Failed to resolve Drive target", err);
  }

  return { type: "invalid" };
}

function Nfb_ensureFormsFile_(fileUrlOrId) {
  var target = Nfb_resolveDriveTarget_(fileUrlOrId);

  if (target.type === "file") {
    return { file: target.file, url: target.url };
  }

  if (target.type === "folder") {
    return Nfb_createFileInFolder_(target.folder);
  }

  return Nfb_createFileInFolder_(null);
}

function nfbLoadFormsFromDrive() {
  var props = PropertiesService.getUserProperties();
  var storedUrl = props.getProperty(NFB_USER_SETTINGS_KEYS.formsFileUrl) || "";
  var fileInfo = null;

  try {
    if (storedUrl) {
      var target = Nfb_resolveDriveTarget_(storedUrl);
      if (target.type === "file") {
        fileInfo = { file: target.file, url: target.url };
      } else if (target.type === "folder") {
        fileInfo = Nfb_createFileInFolder_(target.folder);
      }
    }
  } catch (err) {
    console.warn("[nfb] Failed to load stored forms file", err);
  }

  if (!fileInfo || !fileInfo.file) {
    fileInfo = Nfb_ensureFormsFile_(storedUrl);
  }

  var formsJson = fileInfo.file.getBlob().getDataAsString("utf-8");
  var forms;
  try {
    forms = JSON.parse(formsJson);
    if (!Array.isArray(forms)) forms = [];
  } catch (err) {
    console.warn("[nfb] Failed to parse forms JSON; reinitializing", err);
    forms = [];
  }

  props.setProperty(NFB_USER_SETTINGS_KEYS.formsFileUrl, fileInfo.url);

  return {
    ok: true,
    forms: forms,
    fileUrl: fileInfo.url,
  };
}

function nfbSaveFormsToDrive(payload) {
  var props = PropertiesService.getUserProperties();
  var forms = (payload && Array.isArray(payload.forms)) ? payload.forms : null;

  if (!forms) {
    return { ok: false, error: "forms array is required" };
  }

  var desiredUrl = payload && payload.fileUrl;
  var storedUrl = props.getProperty(NFB_USER_SETTINGS_KEYS.formsFileUrl) || "";
  var fileInfo = Nfb_ensureFormsFile_(desiredUrl || storedUrl);

  fileInfo.file.setContent(JSON.stringify(forms, null, 2));
  props.setProperty(NFB_USER_SETTINGS_KEYS.formsFileUrl, fileInfo.url);

  return {
    ok: true,
    fileUrl: fileInfo.url,
    count: forms.length,
  };
}

function nfbImportFormsFromDrive(payload) {
  var props = PropertiesService.getUserProperties();
  var storedUrl = props.getProperty(NFB_USER_SETTINGS_KEYS.formsFileUrl) || "";
  var targetUrl = payload && payload.targetUrl;
  var target = Nfb_resolveDriveTarget_(targetUrl);

  if (target.type === "invalid") {
    return { ok: false, error: "有効なファイルまたはフォルダURLを指定してください" };
  }

  var skipped = [];
  var files = [];
  var forms = [];

  try {
    if (target.type === "file") {
      var fileUrl = target.url || target.file.getUrl();
      if (storedUrl && storedUrl === fileUrl) {
        skipped.push({ url: fileUrl, reason: "stored" });
      } else {
        files.push(fileUrl);
        var content = target.file.getBlob().getDataAsString("utf-8");
        forms = Nfb_extractFormsFromContent_(content);
      }
    } else {
      var folder = target.folder || DriveApp.getRootFolder();
      var iter = folder.getFiles();
      while (iter.hasNext()) {
        var file = iter.next();
        var name = file.getName();
        if (!/\.json$/i.test(name)) continue;
        var url = file.getUrl();
        if (storedUrl && storedUrl === url) {
          skipped.push({ url: url, reason: "stored" });
          continue;
        }
        files.push(url);
        var json = file.getBlob().getDataAsString("utf-8");
        var extracted = Nfb_extractFormsFromContent_(json);
        if (extracted && extracted.length) {
          forms = forms.concat(extracted);
        }
      }
    }
  } catch (err) {
    console.warn("[nfb] Failed to import from Drive", err);
    return { ok: false, error: err && err.message ? err.message : "Driveからの読込に失敗しました" };
  }

  return { ok: true, forms: forms, files: files, skipped: skipped };
}
