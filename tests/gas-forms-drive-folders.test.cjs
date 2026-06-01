const assert = require("node:assert/strict");
const test = require("node:test");
const { loadGasFiles } = require("./helpers/gasVmLoader.cjs");

// formsDriveFolders.gs（仮想フォルダ ↔ 物理 Drive フォルダのミラー）を、インメモリ Drive モックで検証する。

// path 正規化（gas/formsFolderStore.gs の Forms_normalizeFolderPath_ と同一規則）。
function normalizePath(raw) {
  if (typeof raw !== "string") return "";
  return raw.split("/").map((s) => String(s).trim()).filter((s) => s.length > 0).join("/");
}

function makeIter(arr) {
  let i = 0;
  return { hasNext: () => i < arr.length, next: () => arr[i++] };
}

// 最小のインメモリ Drive（Folder/File と DriveApp）。
function makeDrive() {
  const folders = {};
  const files = {};
  let seq = 0;
  const newId = (p) => p + ++seq;

  function makeFolder(name, parentId) {
    const id = newId("F");
    const f = {
      _id: id, _name: name, _parentId: parentId, _trashed: false,
      getId: () => id,
      getName: () => f._name,
      setName: (n) => { f._name = n; },
      isTrashed: () => f._trashed,
      setTrashed: (v) => {
        f._trashed = !!v;
        Object.keys(folders).forEach((k) => { if (folders[k]._parentId === id) folders[k].setTrashed(v); });
        Object.keys(files).forEach((k) => { if (files[k]._parentId === id) files[k]._trashed = !!v; });
      },
      moveTo: (dest) => { f._parentId = dest.getId(); },
      getFoldersByName: (n) => makeIter(Object.keys(folders).map((k) => folders[k]).filter((c) => c._parentId === id && !c._trashed && c._name === n)),
      getFolders: () => makeIter(Object.keys(folders).map((k) => folders[k]).filter((c) => c._parentId === id && !c._trashed)),
      getFiles: () => makeIter(Object.keys(files).map((k) => files[k]).filter((fl) => fl._parentId === id && !fl._trashed)),
      createFolder: (n) => makeFolder(n, id),
      createFile: (n, content) => makeFile(n, content, id),
    };
    folders[id] = f;
    return f;
  }
  function makeFile(name, content, parentId) {
    const id = newId("f");
    const fl = {
      _id: id, _name: name, _content: content, _parentId: parentId, _trashed: false,
      getId: () => id,
      getName: () => fl._name,
      getUrl: () => "https://drive/" + id,
      getMimeType: () => "application/json",
      isTrashed: () => fl._trashed,
      setTrashed: (v) => { fl._trashed = !!v; },
      getBlob: () => ({ getDataAsString: () => fl._content }),
      setContent: (c) => { fl._content = c; },
      getParents: () => makeIter([folders[fl._parentId]].filter(Boolean)),
      moveTo: (dest) => { fl._parentId = dest.getId(); },
    };
    files[id] = fl;
    return fl;
  }

  const DriveApp = {
    getFolderById: (id) => { if (!folders[id]) throw new Error("no folder " + id); return folders[id]; },
    getFileById: (id) => { if (!files[id]) throw new Error("no file " + id); return files[id]; },
  };
  return { DriveApp, makeFolder, makeFile, folders, files };
}

// 物理フォルダの相対パス（base からの）を算出するテスト用ヘルパ。
function physicalPathOf(drive, base, folder) {
  const segs = [];
  let cur = folder;
  while (cur && cur.getId() !== base.getId()) {
    segs.unshift(cur.getName());
    cur = drive.folders[cur._parentId];
  }
  return segs.join("/");
}

function loadContext({ baseNull = false } = {}) {
  const drive = makeDrive();
  const base = drive.makeFolder("01_forms", "ROOT");
  const store = {};
  const props = {
    getProperty: (k) => (k in store ? store[k] : null),
    setProperty: (k, v) => { store[k] = v; },
    deleteProperty: (k) => { delete store[k]; },
  };

  const context = {
    console,
    Logger: { log() {} },
    DriveApp: drive.DriveApp,
    Forms_normalizeFolderPath_: normalizePath,
    Forms_getActiveProps_: () => props,
    StdFolders_autoFileFolderOrNull_: () => (baseNull ? null : base),
    // backfill 用スタブ（テストごとに上書きする）。
    WithScriptLock_: (label, fn) => fn(),
    Forms_getMapping_: () => ({}),
    Forms_getForm_: () => null,
    Forms_collectFolders_: () => [],
    Nfb_resolveFileIdFromEntry_: (e) => (e && e.fileId) || null,
  };
  loadGasFiles(context, ["constants.gs", "sharedDriveFolders.gs", "formsDriveFolders.gs"]);
  return { context, drive, base, props, store };
}

test("rekeyMapForRelocate_: リネーム/移動/no-op/対象外", () => {
  const { context } = loadContext();
  const fn = context.FormsDrive_rekeyMapForRelocate_;
  const map = { a: "id1", "a/b": "id2", "a/b/c": "id3", x: "idx" };

  const renamed = fn(map, "a/b", "a/x");
  assert.deepEqual({ ...renamed }, { a: "id1", "a/x": "id2", "a/x/c": "id3", x: "idx" });

  const moved = fn(map, "a/b", "z/b");
  assert.deepEqual({ ...moved }, { a: "id1", "z/b": "id2", "z/b/c": "id3", x: "idx" });

  // 対象外のパスは不変（"a" 自身は old="a/b" のとき置換されない）
  assert.equal(renamed.a, "id1");
});

test("ensureFolderForPath_: 階層作成・map記録・base返却・冪等", () => {
  const { context, drive, base } = loadContext();
  // "" は base を返す
  assert.equal(context.FormsDrive_ensureFolderForPath_("").getId(), base.getId());

  const leaf = context.FormsDrive_ensureFolderForPath_("a/b/c");
  assert.equal(physicalPathOf(drive, base, leaf), "a/b/c");

  const map = context.FormsDrive_getPathMap_();
  assert.ok(map["a"] && map["a/b"] && map["a/b/c"], "祖先含めて map に記録される");
  assert.equal(map["a/b/c"], leaf.getId());

  // 冪等: 同じパスを再 ensure しても新規作成しない（同一 id）
  const again = context.FormsDrive_ensureFolderForPath_("a/b/c");
  assert.equal(again.getId(), leaf.getId());

  // 物理上のフォルダ総数 = base + a + b + c = 4
  assert.equal(Object.keys(drive.folders).length, 4);
});

test("ensureFolderForPath_: map が空でも name 探索で既存を再利用（自己修復）", () => {
  const { context, drive, base, store } = loadContext();
  const leaf = context.FormsDrive_ensureFolderForPath_("a/b");
  const beforeCount = Object.keys(drive.folders).length;
  // drivemap を消す → name 探索にフォールバックして再作成しないこと
  store["nfb.forms.folders.drivemap"] = undefined;
  delete store["nfb.forms.folders.drivemap"];
  const again = context.FormsDrive_ensureFolderForPath_("a/b");
  assert.equal(again.getId(), leaf.getId());
  assert.equal(Object.keys(drive.folders).length, beforeCount, "既存を再利用し新規作成しない");
});

test("movePathFolder_: リネームは同一フォルダの setName + map 再キー", () => {
  const { context, drive, base } = loadContext();
  const before = context.FormsDrive_ensureFolderForPath_("a/b");
  const beforeId = before.getId();

  const ok = context.FormsDrive_movePathFolder_("a/b", "a/c");
  assert.equal(ok, true);
  // 同一 folderId のまま名前が変わる（再生成でない）
  assert.equal(drive.folders[beforeId].getName(), "c");
  assert.equal(physicalPathOf(drive, base, drive.folders[beforeId]), "a/c");

  const map = context.FormsDrive_getPathMap_();
  assert.equal(map["a/c"], beforeId);
  assert.ok(!map["a/b"], "旧キーは消える");
});

test("movePathFolder_: 親変更（トップレベルへ移動）", () => {
  const { context, drive, base } = loadContext();
  const folder = context.FormsDrive_ensureFolderForPath_("a/b");
  const id = folder.getId();

  const ok = context.FormsDrive_movePathFolder_("a/b", "b");
  assert.equal(ok, true);
  assert.equal(drive.folders[id]._parentId, base.getId(), "親が 01_forms 直下に");
  assert.equal(physicalPathOf(drive, base, drive.folders[id]), "b");
  const map = context.FormsDrive_getPathMap_();
  assert.equal(map["b"], id);
  assert.ok(!map["a/b"]);
});

test("trashPathFolder_: 物理フォルダを trash し map から除去", () => {
  const { context, drive } = loadContext();
  const leaf = context.FormsDrive_ensureFolderForPath_("a/b");
  const aId = context.FormsDrive_getPathMap_()["a"];

  const ok = context.FormsDrive_trashPathFolder_("a");
  assert.equal(ok, true);
  assert.equal(drive.folders[aId].isTrashed(), true);
  assert.equal(leaf.isTrashed(), true, "子フォルダも一括 trash");

  const map = context.FormsDrive_getPathMap_();
  assert.ok(!map["a"] && !map["a/b"], "path と子孫が map から除去される");
});

test("moveFormFileToPath_: ファイル移動と no-op ガード", () => {
  const { context, drive, base } = loadContext();
  const file = base.createFile("form1.json", "{}");
  const fileId = file.getId();

  const ok = context.FormsDrive_moveFormFileToPath_(fileId, "a/b");
  assert.equal(ok, true);
  const target = context.FormsDrive_getPathMap_()["a/b"];
  assert.equal(drive.files[fileId]._parentId, target);

  // 既に正しい親にある → no-op（true 返却・親不変）
  const ok2 = context.FormsDrive_moveFormFileToPath_(fileId, "a/b");
  assert.equal(ok2, true);
  assert.equal(drive.files[fileId]._parentId, target);
});

test("auto-organize off（base=null）: 全操作が安全に no-op", () => {
  const { context } = loadContext({ baseNull: true });
  assert.equal(context.FormsDrive_ensureFolderForPath_("a/b"), null);
  assert.equal(context.FormsDrive_movePathFolder_("a/b", "a/c"), false);
  assert.equal(context.FormsDrive_trashPathFolder_("a"), false);
  assert.equal(context.FormsDrive_moveFormFileToPath_("f1", "a/b"), false);
  // ensure("") も null（base 解決不能）
  assert.equal(context.FormsDrive_ensureFolderForPath_(""), null);
});

test("backfillPhysicalFolders_: 既知フォルダ作成 + フォームファイル移動", () => {
  const { context, drive, base } = loadContext();
  // フラット保存されたフォーム 2 件（base 直下）。
  const f1 = base.createFile("alpha.json", "{}");
  const f2 = base.createFile("beta.json", "{}");
  context.Forms_collectFolders_ = () => ["a", "a/b"];
  context.Forms_getMapping_ = () => ({ id1: { fileId: f1.getId() }, id2: { fileId: f2.getId() } });
  context.Forms_getForm_ = (id) => (id === "id1" ? { folder: "a/b" } : { folder: "" });

  const res = context.FormsDrive_backfillPhysicalFolders_();
  assert.equal(res.ok, true);
  assert.equal(res.folders, 2);
  // f1 は a/b へ、f2 は base 直下のまま
  assert.equal(physicalPathOf(drive, base, drive.folders[drive.files[f1.getId()]._parentId]), "a/b");
  assert.equal(drive.files[f2.getId()]._parentId, base.getId());
});

test("backfillPhysicalFolders_: auto-organize off では skip", () => {
  const { context } = loadContext({ baseNull: true });
  const res = context.FormsDrive_backfillPhysicalFolders_();
  assert.equal(res.ok, true);
  assert.equal(res.skipped, true);
});
