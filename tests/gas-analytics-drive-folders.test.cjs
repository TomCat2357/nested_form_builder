const assert = require("node:assert/strict");
const test = require("node:test");
const { loadGasFiles } = require("./helpers/gasVmLoader.cjs");

// analyticsDriveFolders.gs（Question/Dashboard の仮想フォルダ ↔ 物理 Drive フォルダのミラー）を、
// インメモリ Drive モックで検証する。forms 版（gas-forms-drive-folders.test.cjs）と対称。

// path 正規化（gas/formsFolderStore.gs の Forms_normalizeFolderPath_ と同一規則）。
function normalizePath(raw) {
  if (typeof raw !== "string") return "";
  return raw.split("/").map((s) => String(s).trim()).filter((s) => s.length > 0).join("/");
}

function makeIter(arr) {
  let i = 0;
  return { hasNext: () => i < arr.length, next: () => arr[i++] };
}

// 最小のインメモリ Drive（Folder/File と DriveApp）。folder.getParents() を備える。
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
      getParents: () => makeIter([folders[f._parentId]].filter(Boolean)),
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
      setName: (n) => { fl._name = n; },
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
  // questions / dashboards のベースを別々に用意し、type で切り替わることも確認する。
  const qBase = drive.makeFolder("02_questions", "ROOT");
  const dBase = drive.makeFolder("03_dashboards", "ROOT");
  const store = {};
  const props = {
    getProperty: (k) => (k in store ? store[k] : null),
    setProperty: (k, v) => { store[k] = v; },
    deleteProperty: (k) => { delete store[k]; },
  };

  const context = {
    console,
    Logger: { log() {} },
    Utilities: { base64EncodeWebSafe: () => "", formatDate: () => "" },
    DriveApp: drive.DriveApp,
    Forms_normalizeFolderPath_: normalizePath,
    Nfb_getActiveProperties_: () => props,
    Forms_normalizeFormTitle_: (s) => String(s == null ? "" : s).trim(),
    StdFolders_autoFileFolderOrNull_: (key) => {
      if (baseNull) return null;
      return key === "questions" ? qBase : dBase;
    },
    Nfb_resolveFileIdFromEntry_: (e) => (e && e.fileId) || null,
    Analytics_collectFolders_: () => [],
    Analytics_getMapping_: () => ({}),
  };
  // constants.gs（drivemap キー・version）→ driveFile.gs（Nfb_readJsonFileById_）→
  // sharedDriveFolders.gs（型汎用コア）→ formsDriveFolders.gs（汎用ヘルパ）→ analyticsDriveFolders.gs。
  loadGasFiles(context, ["constants.gs", "driveFile.gs", "sharedDriveFolders.gs", "formsDriveFolders.gs", "analyticsDriveFolders.gs"]);
  return { context, drive, qBase, dBase, props, store };
}

test("ensureFolderForPath_: 階層作成・map記録・base返却・冪等", () => {
  const { context, drive, qBase } = loadContext();
  assert.equal(context.AnalyticsDrive_ensureFolderForPath_("questions", "").getId(), qBase.getId());

  const leaf = context.AnalyticsDrive_ensureFolderForPath_("questions", "a/b/c");
  assert.equal(physicalPathOf(drive, qBase, leaf), "a/b/c");

  const map = context.AnalyticsDrive_getPathMap_("questions");
  assert.ok(map["a"] && map["a/b"] && map["a/b/c"], "祖先含めて map に記録される");
  assert.equal(map["a/b/c"], leaf.getId());

  const again = context.AnalyticsDrive_ensureFolderForPath_("questions", "a/b/c");
  assert.equal(again.getId(), leaf.getId(), "冪等");
});

test("drivemap は type ごとに独立（questions / dashboards で衝突しない）", () => {
  const { context, drive, qBase, dBase } = loadContext();
  const q = context.AnalyticsDrive_ensureFolderForPath_("questions", "shared");
  const d = context.AnalyticsDrive_ensureFolderForPath_("dashboards", "shared");
  assert.notEqual(q.getId(), d.getId(), "同名パスでも別ベース配下の別フォルダ");
  assert.equal(physicalPathOf(drive, qBase, q), "shared");
  assert.equal(physicalPathOf(drive, dBase, d), "shared");
  const qMap = context.AnalyticsDrive_getPathMap_("questions");
  const dMap = context.AnalyticsDrive_getPathMap_("dashboards");
  assert.equal(qMap["shared"], q.getId());
  assert.equal(dMap["shared"], d.getId());
});

test("movePathFolder_: リネーム（setName + map 再キー）と親変更", () => {
  const { context, drive, qBase } = loadContext();
  const before = context.AnalyticsDrive_ensureFolderForPath_("questions", "a/b");
  const id = before.getId();

  assert.equal(context.AnalyticsDrive_movePathFolder_("questions", "a/b", "a/c"), true);
  assert.equal(drive.folders[id].getName(), "c");
  assert.equal(physicalPathOf(drive, qBase, drive.folders[id]), "a/c");
  let map = context.AnalyticsDrive_getPathMap_("questions");
  assert.equal(map["a/c"], id);
  assert.ok(!map["a/b"], "旧キーは消える");

  assert.equal(context.AnalyticsDrive_movePathFolder_("questions", "a/c", "c"), true);
  assert.equal(drive.folders[id]._parentId, qBase.getId(), "トップレベルへ移動");
  map = context.AnalyticsDrive_getPathMap_("questions");
  assert.equal(map["c"], id);
});

test("trashPathFolder_: 物理フォルダを trash し map から除去", () => {
  const { context, drive } = loadContext();
  const leaf = context.AnalyticsDrive_ensureFolderForPath_("questions", "a/b");
  const aId = context.AnalyticsDrive_getPathMap_("questions")["a"];

  assert.equal(context.AnalyticsDrive_trashPathFolder_("questions", "a"), true);
  assert.equal(drive.folders[aId].isTrashed(), true);
  assert.equal(leaf.isTrashed(), true, "子も一括 trash");
  const map = context.AnalyticsDrive_getPathMap_("questions");
  assert.ok(!map["a"] && !map["a/b"]);
});

test("moveItemFileToPath_: ファイル移動と no-op ガード", () => {
  const { context, drive, qBase } = loadContext();
  const file = qBase.createFile("q1.json", "{}");
  const fileId = file.getId();

  assert.equal(context.AnalyticsDrive_moveItemFileToPath_("questions", fileId, "a/b"), true);
  const target = context.AnalyticsDrive_getPathMap_("questions")["a/b"];
  assert.equal(drive.files[fileId]._parentId, target);

  assert.equal(context.AnalyticsDrive_moveItemFileToPath_("questions", fileId, "a/b"), true);
  assert.equal(drive.files[fileId]._parentId, target, "既に正しい親 → 親不変");
});

test("relativeFolderOfFile_: base直下は空、ネストは相対パス、構成外は null", () => {
  const { context, drive, qBase } = loadContext();
  const direct = qBase.createFile("flat.json", "{}");
  assert.equal(context.AnalyticsDrive_relativeFolderOfFile_("questions", direct.getId()), "");

  const sub = context.AnalyticsDrive_ensureFolderForPath_("questions", "a/b");
  const nested = sub.createFile("nested.json", "{}");
  assert.equal(context.AnalyticsDrive_relativeFolderOfFile_("questions", nested.getId()), "a/b");

  // 別ベース（dashboards）配下のファイルは questions から見ると構成外 → null
  const dSub = context.AnalyticsDrive_ensureFolderForPath_("dashboards", "x");
  const outside = dSub.createFile("o.json", "{}");
  assert.equal(context.AnalyticsDrive_relativeFolderOfFile_("questions", outside.getId()), null);
});

test("findFileByNameInTree_: ネストされた name+.json を引き当てる", () => {
  const { context } = loadContext();
  const sub = context.AnalyticsDrive_ensureFolderForPath_("questions", "a/b");
  sub.createFile("ヒグマ集計.json", "{}");

  const hit = context.AnalyticsDrive_findFileByNameInTree_("questions", "ヒグマ集計");
  assert.ok(hit, "見つかる");
  assert.equal(hit.getName(), "ヒグマ集計.json");
  assert.equal(context.AnalyticsDrive_findFileByNameInTree_("questions", "存在しない"), null);
});

test("auto-organize off（base=null）: 全操作が安全に no-op", () => {
  const { context } = loadContext({ baseNull: true });
  assert.equal(context.AnalyticsDrive_ensureFolderForPath_("questions", "a/b"), null);
  assert.equal(context.AnalyticsDrive_movePathFolder_("questions", "a/b", "a/c"), false);
  assert.equal(context.AnalyticsDrive_trashPathFolder_("questions", "a"), false);
  assert.equal(context.AnalyticsDrive_moveItemFileToPath_("questions", "f1", "a/b"), false);
  assert.equal(context.AnalyticsDrive_relativeFolderOfFile_("questions", "f1"), null);
  assert.equal(context.AnalyticsDrive_findFileByNameInTree_("questions", "x"), null);
});

