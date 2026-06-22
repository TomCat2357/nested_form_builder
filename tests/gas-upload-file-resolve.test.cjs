const assert = require("node:assert/strict");
const test = require("node:test");
const { loadGasFiles } = require("./helpers/gasVmLoader.cjs");

// VM realm 由来オブジェクトは prototype が異なり deepStrictEqual で弾かれるため、
// JSON 往復で呼び出し側 realm のプレーンオブジェクトへ正規化してから比較する。
const plain = (value) => JSON.parse(JSON.stringify(value));

// driveFile.gs の Nfb_resolveUploadFileEntry_ / nfbResolveUploadFiles を、論理パス解決に必要な
// StdFolders_* / FormsDrive_* / DriveApp をモック注入してロードする。
function loadResolver(overrides) {
  const context = Object.assign({
    console,
    JSON,
    Math,
    NFB_RECORD_TEMP_FOLDER_PREFIX: "NFB_RECORD_TEMP_",
    NFB_MAX_UPLOAD_BYTES: 25 * 1024 * 1024,
    NFB_BLOCKED_UPLOAD_EXTENSIONS: [],
    Utilities: { getUuid: () => "uuid", base64Decode: () => [], newBlob: () => ({}) },
    Session: { getScriptTimeZone: () => "Asia/Tokyo" },
    nfbSafeCall_(fn) { return fn(); },
    nfbErrorToString_(e) { return e && e.message ? e.message : String(e); },
    Nfb_trimStr_(v) { return v ? String(v).trim() : ""; },
    Forms_parseGoogleDriveUrl_: () => ({ type: "", id: "" }),
    nfbResolveTemplateTokens_: () => "",
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
    "driveOutputDocument.gs",
    "driveGmailOutput.gs",
    "driveFile.gs",
  ]);
}

test("Nfb_resolveUploadFileEntry_: 物理 fileId が生存していればそのまま返す（高速パス）", () => {
  const gas = loadResolver({
    StdFolders_isFileIdAlive_: (id) => id === "ALIVE",
    DriveApp: { getFileById: (id) => ({ getUrl: () => "url://" + id }) },
    // 論理解決へは落ちない想定（呼ばれたら失敗させる）。
    StdFolders_autoFileFolderOrNull_: () => { throw new Error("論理解決に落ちてはいけない"); },
  });
  assert.deepEqual(
    plain(gas.Nfb_resolveUploadFileEntry_("a.pdf", "ALIVE", "rec_folder")),
    { fileId: "ALIVE", fileUrl: "url://ALIVE" },
  );
});

test("Nfb_resolveUploadFileEntry_: 物理が死んでいれば folderName ＋ ファイル名で論理解決する", () => {
  const gas = loadResolver({
    StdFolders_isFileIdAlive_: () => false,
    StdFolders_autoFileFolderOrNull_: (key) => (key === "upload" ? { id: "base06" } : null),
    FormsDrive_childFolderByName_: (base, name) => (name === "rec_folder" ? { id: "recFolder" } : null),
    StdFolders_findFileByNameInFolder_: (folder, fileName) => (
      fileName === "a.pdf" ? { getId: () => "NEWID", getUrl: () => "url://NEWID" } : null
    ),
  });
  assert.deepEqual(
    plain(gas.Nfb_resolveUploadFileEntry_("a.pdf", "DEAD", "rec_folder")),
    { fileId: "NEWID", fileUrl: "url://NEWID" },
  );
});

test("Nfb_resolveUploadFileEntry_: 物理が空でも folderName ＋ 名前で論理解決できる", () => {
  const gas = loadResolver({
    StdFolders_isFileIdAlive_: () => false,
    StdFolders_autoFileFolderOrNull_: () => ({ id: "base06" }),
    FormsDrive_childFolderByName_: () => ({ id: "recFolder" }),
    StdFolders_findFileByNameInFolder_: () => ({ getId: () => "X", getUrl: () => "url://X" }),
  });
  assert.deepEqual(
    plain(gas.Nfb_resolveUploadFileEntry_("a.pdf", "", "rec_folder")),
    { fileId: "X", fileUrl: "url://X" },
  );
});

test("Nfb_resolveUploadFileEntry_: folderName が無ければ解決不可で空を返す", () => {
  const gas = loadResolver({
    StdFolders_isFileIdAlive_: () => false,
    StdFolders_autoFileFolderOrNull_: () => { throw new Error("folderName 無しで base 解決に進んではいけない"); },
  });
  assert.deepEqual(
    plain(gas.Nfb_resolveUploadFileEntry_("a.pdf", "DEAD", "")),
    { fileId: "", fileUrl: "" },
  );
});

test("Nfb_resolveUploadFileEntry_: フォルダ/ファイルが見つからなければ空を返す", () => {
  const gas = loadResolver({
    StdFolders_isFileIdAlive_: () => false,
    StdFolders_autoFileFolderOrNull_: () => ({ id: "base06" }),
    FormsDrive_childFolderByName_: () => null, // フォルダが無い
    StdFolders_findFileByNameInFolder_: () => null,
  });
  assert.deepEqual(
    plain(gas.Nfb_resolveUploadFileEntry_("a.pdf", "DEAD", "missing_folder")),
    { fileId: "", fileUrl: "" },
  );
});

test("nfbResolveUploadFiles: エントリ配列を解決し { name, driveFileId, driveFileUrl } で返す", () => {
  const gas = loadResolver({
    StdFolders_isFileIdAlive_: (id) => id === "ALIVE",
    DriveApp: { getFileById: (id) => ({ getUrl: () => "url://" + id }) },
    StdFolders_autoFileFolderOrNull_: () => ({ id: "base06" }),
    FormsDrive_childFolderByName_: () => ({ id: "recFolder" }),
    StdFolders_findFileByNameInFolder_: (folder, fileName) => (
      fileName === "b.png" ? { getId: () => "NEWB", getUrl: () => "url://NEWB" } : null
    ),
  });
  const res = gas.nfbResolveUploadFiles({
    folderName: "rec_folder",
    files: [
      { name: "a.pdf", driveFileId: "ALIVE" }, // 物理生存 → そのまま
      { name: "b.png", driveFileId: "DEAD" },  // 物理死亡 → 論理解決
      { name: "c.txt", driveFileId: "DEAD" },  // 見つからない → 空
    ],
  });
  assert.equal(res.ok, true);
  assert.deepEqual(plain(res.files), [
    { name: "a.pdf", driveFileId: "ALIVE", driveFileUrl: "url://ALIVE" },
    { name: "b.png", driveFileId: "NEWB", driveFileUrl: "url://NEWB" },
    { name: "c.txt", driveFileId: "", driveFileUrl: "" },
  ]);
});
