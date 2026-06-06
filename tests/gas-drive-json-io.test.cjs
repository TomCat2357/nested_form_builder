const assert = require("node:assert/strict");
const test = require("node:test");
const { loadGasFiles } = require("./helpers/gasVmLoader.cjs");

// driveFile.gs の Drive JSON I/O 共通ヘルパ（Nfb_readJsonFileById_ / Nfb_writeJsonToFile_）を
// インメモリ Drive モックで検証する。

function makeIter(arr) {
  let i = 0;
  return { hasNext: () => i < arr.length, next: () => arr[i++] };
}

function makeDrive() {
  const files = {};
  let seq = 0;
  function makeFile(name, content) {
    const id = "f" + ++seq;
    const fl = {
      _id: id,
      _name: name,
      _content: content,
      getId: () => id,
      getName: () => fl._name,
      getBlob: () => ({ getDataAsString: () => fl._content }),
      setContent: (c) => { fl._content = c; },
    };
    files[id] = fl;
    return fl;
  }
  const folders = {};
  function makeFolder(name) {
    const id = "d" + ++seq;
    const fd = { _id: id, getId: () => id, getName: () => name };
    folders[id] = fd;
    return fd;
  }
  const DriveApp = {
    getFileById: (id) => { if (!files[id]) throw new Error("no file " + id); return files[id]; },
    getFolderById: (id) => { if (!folders[id]) throw new Error("no folder " + id); return folders[id]; },
  };
  return { DriveApp, makeFile, makeFolder, files, folders };
}

function loadContext() {
  const drive = makeDrive();
  const context = {
    console,
    Logger: { log() {} },
    JSON,
    DriveApp: drive.DriveApp,
    nfbErrorToString_: (e) => String(e && e.message ? e.message : e),
  };
  loadGasFiles(context, ["driveFile.gs"]);
  return { context, drive };
}

test("Nfb_readJsonFileById_: file と parse 済み json を返す", () => {
  const { context, drive } = loadContext();
  const file = drive.makeFile("a.json", JSON.stringify({ folder: "x/y", n: 3 }));
  const res = context.Nfb_readJsonFileById_(file.getId());
  assert.equal(res.file.getId(), file.getId());
  assert.deepEqual(res.json, { folder: "x/y", n: 3 });
});

test("Nfb_readJsonFileById_: 取得不能・parse 失敗は throw", () => {
  const { context, drive } = loadContext();
  assert.throws(() => context.Nfb_readJsonFileById_("missing"));
  const bad = drive.makeFile("bad.json", "{not json");
  assert.throws(() => context.Nfb_readJsonFileById_(bad.getId()));
});

test("nfbGetDriveFolderById_: 取得できればフォルダを返す", () => {
  const { context, drive } = loadContext();
  const folder = drive.makeFolder("F1");
  const res = context.nfbGetDriveFolderById_(folder.getId(), "フォルダへのアクセスに失敗しました: ");
  assert.equal(res.getId(), folder.getId());
});

test("nfbGetDriveFolderById_: 取得不能は errorPrefix 付きで throw", () => {
  const { context } = loadContext();
  assert.throws(
    () => context.nfbGetDriveFolderById_("missing", "フォルダへのアクセスに失敗しました: "),
    /フォルダへのアクセスに失敗しました: /,
  );
});

test("Nfb_writeJsonToFile_: 2スペース整形で書き戻し、read で往復一致", () => {
  const { context, drive } = loadContext();
  const file = drive.makeFile("a.json", "{}");
  const obj = { folder: "a/b", schema: [1, 2] };
  const returned = context.Nfb_writeJsonToFile_(file, obj);
  assert.equal(returned.getId(), file.getId());
  // 2 スペース整形で書かれていること
  assert.equal(file._content, JSON.stringify(obj, null, 2));
  // 往復一致
  const round = context.Nfb_readJsonFileById_(file.getId());
  assert.deepEqual(round.json, obj);
});
