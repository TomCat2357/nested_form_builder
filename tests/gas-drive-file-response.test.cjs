const assert = require("node:assert/strict");
const test = require("node:test");
const { loadGasFiles } = require("./helpers/gasVmLoader.cjs");

function loadGasContext(overrides) {
  const context = Object.assign({
    console,
    JSON,
    Math,
    NFB_RECORD_TEMP_FOLDER_PREFIX: "NFB_RECORD_TEMP_",
    NFB_MAX_UPLOAD_BYTES: 25 * 1024 * 1024,
    NFB_BLOCKED_UPLOAD_EXTENSIONS: ["exe", "bat", "cmd", "com", "msi", "scr", "js", "vbs", "vbe", "wsf", "wsh", "ps1", "sh", "jar", "app", "cpl", "hta", "jse"],
    Session: {
      getScriptTimeZone() {
        return "Asia/Tokyo";
      },
    },
    Utilities: {
      getUuid() {
        return "uuid-test-1234";
      },
      base64Decode(_base64) {
        return [0, 1, 2, 3];
      },
      newBlob(bytes, mimeType, name) {
        return { bytes, mimeType, name };
      },
      formatDate(_date, _tz, format) {
        return format;
      },
    },
    nfbSafeCall_(fn) {
      return fn();
    },
    nfbErrorToString_(error) {
      return error && error.message ? error.message : String(error);
    },
    Forms_parseGoogleDriveUrl_(url) {
      const normalized = String(url || "").trim();
      const folderMatch = normalized.match(/\/folders\/([^/?#]+)/);
      if (folderMatch) return { type: "folder", id: folderMatch[1] };
      const fileMatch = normalized.match(/\/d\/([^/?#]+)/);
      if (fileMatch) return { type: "file", id: fileMatch[1] };
      return { type: "", id: "" };
    },
    nfbResolveTemplateTokens_(template, context) {
      if (!template) return "";
      return String(template).replace(/\{recordId\}/g, (context && context.recordId) || "");
    },
  }, overrides || {});

  return loadGasFiles(context, [
    "vendor/alasql.min.js",
    "generated/nfbAlasqlUdfs.gs",
    "pathCodec.gs", "expressionEvaluator.gs",
    "templateEvaluator.gs",
    "driveTemplate.gs",
    "drivePrintDocument.gs",
    "driveFolder.gs",
    "driveOutput.gs",
    "driveGmailOutput.gs",
    "driveFile.gs",
  ]);
}

function makeFile(id) {
  return {
    getUrl() {
      return "https://drive.google.com/file/d/" + id + "/view";
    },
    getName() {
      return id + ".bin";
    },
    getId() {
      return id;
    },
  };
}

function makeFolder(id) {
  return {
    getUrl() {
      return "https://drive.google.com/drive/folders/" + id;
    },
    getId() {
      return id;
    },
  };
}

test("nfbBuildDriveFileResponse_ は File/Folder からレスポンス形状を組み立てる", () => {
  const gas = loadGasContext();
  const file = makeFile("f_1");
  const folder = makeFolder("fo_1");

  const result = gas.nfbBuildDriveFileResponse_(file, folder, true);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    ok: true,
    fileUrl: "https://drive.google.com/file/d/f_1/view",
    fileName: "f_1.bin",
    fileId: "f_1",
    folderUrl: "https://drive.google.com/drive/folders/fo_1",
    autoCreated: true,
  });
});

test("nfbBuildDriveFileResponse_ は autoCreated を boolean に強制する", () => {
  const gas = loadGasContext();
  const file = makeFile("f_x");
  const folder = makeFolder("fo_x");

  assert.equal(gas.nfbBuildDriveFileResponse_(file, folder, "truthy").autoCreated, false);
  assert.equal(gas.nfbBuildDriveFileResponse_(file, folder, undefined).autoCreated, false);
  assert.equal(gas.nfbBuildDriveFileResponse_(file, folder, true).autoCreated, true);
  assert.equal(gas.nfbBuildDriveFileResponse_(file, folder, false).autoCreated, false);
});

test("nfbPersistBlobToDrive_ は driveSettings=null のとき DriveApp.createFile を使う", () => {
  const gas = loadGasContext();
  const createdFile = makeFile("created");
  let createFileCalled = false;
  gas.DriveApp = {
    createFile(blob) {
      createFileCalled = true;
      assert.equal(blob.name, "test.bin");
      return createdFile;
    },
  };

  const blob = { name: "test.bin" };
  const result = gas.nfbPersistBlobToDrive_(blob, "test.bin", null);

  assert.equal(createFileCalled, true);
  assert.equal(result.file, createdFile);
  assert.equal(result.folder, null);
  assert.equal(result.autoCreated, false);
});

test("nfbPersistBlobToDrive_ は driveSettings があると nfbResolveUploadFolder_ を使って保存する", () => {
  const gas = loadGasContext();
  const folder = makeFolder("folder_1");
  const savedFile = makeFile("saved_1");
  let resolveCalled = false;
  let trashCalled = false;
  folder.createFile = function(blob) {
    assert.equal(blob.name, "upload.bin");
    return savedFile;
  };
  folder.getFilesByName = function() {
    return {
      hasNext() { return false; },
      next() { throw new Error("should not be called"); },
    };
  };

  gas.nfbResolveUploadFolder_ = function(driveSettings) {
    resolveCalled = true;
    assert.equal(driveSettings.folderUrl, "https://drive.google.com/drive/folders/folder_1");
    return { folder: folder, autoCreated: true };
  };
  gas.nfbTrashExistingFile_ = function(targetFolder, fileName) {
    trashCalled = true;
    assert.equal(targetFolder, folder);
    assert.equal(fileName, "upload.bin");
  };

  const blob = { name: "upload.bin" };
  const result = gas.nfbPersistBlobToDrive_(blob, "upload.bin", {
    folderUrl: "https://drive.google.com/drive/folders/folder_1",
  });

  assert.equal(resolveCalled, true);
  assert.equal(trashCalled, true);
  assert.equal(result.file, savedFile);
  assert.equal(result.folder, folder);
  assert.equal(result.autoCreated, true);
});

test("nfbResolveDirectFolder_ は folderUrl が空なら null を返す", () => {
  const gas = loadGasContext();
  assert.equal(gas.nfbResolveDirectFolder_({}, {}), null);
  assert.equal(gas.nfbResolveDirectFolder_({ folderUrl: "" }, {}), null);
  assert.equal(gas.nfbResolveDirectFolder_({ folderUrl: "   " }, {}), null);
  assert.equal(gas.nfbResolveDirectFolder_(null, {}), null);
});

test("nfbResolveDirectFolder_ は通常URLを nfbResolveFolderFromInput_ 経由で解決する", () => {
  const gas = loadGasContext();
  const folder = makeFolder("direct");
  let resolvedInput = null;
  gas.nfbResolveFolderFromInput_ = function(input) {
    resolvedInput = input;
    return folder;
  };

  const result = gas.nfbResolveDirectFolder_({
    folderUrl: "https://drive.google.com/drive/folders/direct",
  }, {});

  assert.equal(result, folder);
  assert.equal(resolvedInput, "https://drive.google.com/drive/folders/direct");
});

test("nfbResolveDirectFolder_ は folderUrl に {token} があればテンプレート展開してから解決する", () => {
  const gas = loadGasContext();
  const folder = makeFolder("resolved");
  let resolvedInput = null;
  gas.nfbResolveFolderFromInput_ = function(input) {
    resolvedInput = input;
    return folder;
  };
  gas.nfbResolveTemplateTokens_ = function(template, context) {
    return String(template).replace(/\{recordId\}/g, (context && context.recordId) || "");
  };

  const result = gas.nfbResolveDirectFolder_({
    folderUrl: "https://drive.google.com/drive/folders/base_{recordId}",
  }, { recordId: "rec001" });

  assert.equal(result, folder);
  assert.equal(resolvedInput, "https://drive.google.com/drive/folders/base_rec001");
});

test("nfbResolveDirectFolder_ はテンプレート展開結果が空なら null を返す", () => {
  const gas = loadGasContext();
  gas.nfbResolveFolderFromInput_ = function() {
    throw new Error("should not be called");
  };
  gas.nfbResolveTemplateTokens_ = function(template, context) {
    return String(template).replace(/\{recordId\}/g, (context && context.recordId) || "");
  };

  const result = gas.nfbResolveDirectFolder_({
    folderUrl: "{recordId}",
  }, { recordId: "" });

  assert.equal(result, null);
});

test("nfbValidateUpload_ は通常ファイルを許可する（例外を投げない）", () => {
  const gas = loadGasContext();
  assert.doesNotThrow(() => gas.nfbValidateUpload_("QUJD", "photo.png"));
  assert.doesNotThrow(() => gas.nfbValidateUpload_("QUJD", "report.PDF"));
  assert.doesNotThrow(() => gas.nfbValidateUpload_("QUJD", "no-extension"));
});

test("nfbValidateUpload_ は危険拡張子を大文字小文字問わず拒否する", () => {
  const gas = loadGasContext();
  assert.throws(() => gas.nfbValidateUpload_("QUJD", "malware.EXE"), /アップロードできません: \.exe/);
  assert.throws(() => gas.nfbValidateUpload_("QUJD", "script.js"), /アップロードできません: \.js/);
  assert.throws(() => gas.nfbValidateUpload_("QUJD", "run.Bat"), /アップロードできません: \.bat/);
});

test("nfbValidateUpload_ は概算サイズが上限超なら拒否する（パディング補正込み）", () => {
  // 上限を 12 バイトに絞ってテスト。base64 長 20（パディング無し）≈ 15 バイト → 拒否
  const gas = loadGasContext({ NFB_MAX_UPLOAD_BYTES: 12 });
  const over = "A".repeat(20);
  assert.throws(() => gas.nfbValidateUpload_(over, "data.bin"), /ファイルサイズが上限/);
  // base64 長 12 ≈ 9 バイト → 許可
  const under = "A".repeat(12);
  assert.doesNotThrow(() => gas.nfbValidateUpload_(under, "data.bin"));
});
