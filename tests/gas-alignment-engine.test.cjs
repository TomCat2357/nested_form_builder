const assert = require("node:assert/strict");
const test = require("node:test");
const { loadGasFiles } = require("./helpers/gasVmLoader.cjs");

// 保存時の参照整合（standardFoldersAlign.gs の StdFolders_alignReferencesOnSave_ ほか ①〜④）を、
// インメモリ Drive モックで検証する。手動の「同期（フォルダ走査）」は廃止済み。
// 物理操作（move/copy/relativeFolder）は formsDriveFolders.gs / analyticsDriveFolders.gs の実体を使う。
// ルート解決のみ読み込み後にモックへ差し替える（VM は単一グローバルなので後付け上書きが効く）。

function normalizePath(raw) {
  if (typeof raw !== "string") return "";
  return raw.split("/").map((s) => String(s).trim()).filter((s) => s.length > 0).join("/");
}
function makeIter(arr) {
  let i = 0;
  return { hasNext: () => i < arr.length, next: () => arr[i++] };
}

// 最小のインメモリ Drive（root + サブフォルダ + ファイル）。makeCopy/moveTo/getParents を備える。
function makeDrive() {
  const folders = {};
  const files = {};
  let seq = 0;
  const newId = (p) => p + ++seq;

  function makeFolder(name, parentId) {
    const id = newId("FOLDER_");
    const f = {
      _id: id, _name: name, _parentId: parentId, _trashed: false,
      getId: () => id,
      getName: () => f._name,
      setName: (n) => { f._name = n; },
      getUrl: () => "https://drive/folder/" + id,
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
    const id = newId("file_");
    const fl = {
      _id: id, _name: name, _content: content, _parentId: parentId, _trashed: false, _updated: 0,
      getId: () => id,
      getName: () => fl._name,
      setName: (n) => { fl._name = n; },
      getUrl: () => "https://drive/file/" + id,
      getMimeType: () => (String(fl._name).toLowerCase().endsWith(".json") ? "application/json" : (fl._mime || "text/plain")),
      isTrashed: () => fl._trashed,
      setTrashed: (v) => { fl._trashed = !!v; },
      getBlob: () => ({ getDataAsString: () => fl._content }),
      setContent: (c) => { fl._content = c; },
      getLastUpdated: () => ({ getTime: () => fl._updated }),
      getParents: () => makeIter([folders[fl._parentId]].filter(Boolean)),
      moveTo: (dest) => { fl._parentId = dest.getId(); },
      makeCopy: (n, dest) => makeFile(n, fl._content, dest.getId()),
    };
    files[id] = fl;
    return fl;
  }
  const DriveApp = {
    getFolderById: (id) => { if (!folders[id] || folders[id]._trashed) throw new Error("no folder " + id); return folders[id]; },
    getFileById: (id) => { if (!files[id] || files[id]._trashed) throw new Error("no file " + id); return files[id]; },
  };
  return { DriveApp, makeFolder, makeFile, folders, files };
}

function buildContext() {
  const drive = makeDrive();
  const root = drive.makeFolder("NFB_ROOT", null);
  const forms = drive.makeFolder("01_forms", root.getId());
  drive.makeFolder("02_questions", root.getId());
  drive.makeFolder("03_dashboards", root.getId());
  const formsA = drive.makeFolder("a", forms.getId());
  const formsB = drive.makeFolder("b", forms.getId());
  // プロジェクト外（root 配下でない）フォルダとファイル。
  const ext = drive.makeFolder("EXTERNAL", null);

  const props = {};
  const propsApi = {
    getProperty: (k) => (k in props ? props[k] : null),
    setProperty: (k, v) => { props[k] = v; },
    deleteProperty: (k) => { delete props[k]; },
  };

  const store = {
    formsMapping: {},
    analyticsMapping: { questions: {}, dashboards: {} },
    formsFolders: [],
    analyticsFolders: { questions: [], dashboards: [] },
  };
  const clone = (x) => JSON.parse(JSON.stringify(x));

  const context = {
    console,
    Logger: { log() {} },
    DriveApp: drive.DriveApp,
    // 物理ヘルパが使う依存。
    Forms_normalizeFolderPath_: normalizePath,
    Forms_normalizeFormTitle_: (s) => String(s == null ? "" : s).trim(),
    Forms_getActiveProps_: () => propsApi,
    Nfb_getActiveProperties_: () => propsApi,
    // ストア（プロパティ往復を模してクローンで返す/保存する）。
    Forms_getMapping_: () => clone(store.formsMapping),
    Forms_saveMapping_: (m) => { store.formsMapping = clone(m); },
    Analytics_getMapping_: (t) => clone(store.analyticsMapping[t]),
    Analytics_saveMapping_: (t, m) => { store.analyticsMapping[t] = clone(m); },
    Forms_getFolders_: () => clone(store.formsFolders),
    Forms_saveFolders_: (p) => { store.formsFolders = clone(p); },
    Analytics_getFolders_: (t) => clone(store.analyticsFolders[t]),
    Analytics_saveFoldersRegistry_: (t, p) => { store.analyticsFolders[t] = clone(p); },
    Analytics_collectFolders_: (t) => clone(store.analyticsFolders[t]),
    // id/名前ヘルパ。
    Nfb_resolveFileIdFromEntry_: (e) => (e && e.fileId) || null,
    Nfb_nameFromFile_: (f) => String(f.getName()).replace(/\.json$/i, ""),
    Nfb_nameFromFileName_: (n) => String(n == null ? "" : n).replace(/\.json$/i, ""),
    AddFormUrl_: () => {},
    nfbSafeCall_: (fn) => fn(),
    nfbErrorToString_: (e) => String((e && e.message) || e),
  };

  loadGasFiles(context, [
    "constants.gs", "formsParsing.gs", "model.gs",
    "formsDriveFolders.gs", "analyticsDriveFolders.gs",
    "standardFoldersAlign.gs", "standardFoldersCopy.gs", "standardFolders.gs",
  ]);
  // ルート解決をモックへ差し替え（後付け上書き。autoFileFolderOrNull_ もこれ経由で解決される）。
  context.StdFolders_resolveRootFolder_ = () => root;

  return { context, drive, root, forms, formsA, formsB, ext, store };
}

const formJson = (folder) => JSON.stringify({ folder, schema: [{ id: "q1", type: "text" }] });

// 標準フォルダ（02_questions / 03_dashboards 等）を名前で引く。
function findFolderByName(drive, name) {
  return Object.keys(drive.folders).map((k) => drive.folders[k]).find((f) => f._name === name);
}

test("保存時参照整合: クエスチョン保存で参照フォームを③再採用しリンクを追従する", () => {
  const env = buildContext();
  const { context, drive, formsA, store } = env;
  const qBase = findFolderByName(drive, "02_questions");

  // 物理フォーム（a に存在、json.folder=a）。登録簿は DEAD_FORM（死んだ id）を指す。
  const fForm = drive.makeFile("salesForm.json", formJson("a"), formsA.getId());
  store.formsMapping = {
    DEAD_FORM: { fileId: "DEAD_FORM", driveFileUrl: "x", title: "salesForm", folder: "a" },
  };
  // DEAD_FORM を参照するクエスチョンを 02_questions に置く。
  const qFile = drive.makeFile(
    "q1.json",
    JSON.stringify({ folder: "", query: { mode: "sql", formSources: [{ formId: "DEAD_FORM", formName: "salesForm" }] } }),
    qBase.getId()
  );

  const r = context.StdFolders_alignReferencesOnSave_("questions", qFile.getId());
  assert.equal(r.ok, true);
  assert.equal(r.forms.rekeyed, 1, "③ 再採用 1 件");
  assert.ok(!store.formsMapping.DEAD_FORM, "死んだ id は登録簿から除去");
  assert.ok(store.formsMapping[fForm.getId()], "物理フォーム id へ振替");

  // リンク追従: クエスチョンの formId が live id へ書き換わった。
  const q = JSON.parse(drive.files[qFile.getId()]._content);
  assert.equal(q.query.formSources[0].formId, fForm.getId());
  assert.equal(r.relinkedFiles, 1);
});

test("保存時参照整合: ダッシュボード保存でクエスチョン→フォームを整合しリンクを追従する", () => {
  const env = buildContext();
  const { context, drive, formsA, store } = env;
  const qBase = findFolderByName(drive, "02_questions");
  const dBase = findFolderByName(drive, "03_dashboards");

  // 物理フォーム a。登録簿は DEAD_FORM（死んだ id）。
  const fForm = drive.makeFile("f.json", formJson("a"), formsA.getId());
  store.formsMapping = { DEAD_FORM: { fileId: "DEAD_FORM", driveFileUrl: "x", title: "f", folder: "a" } };

  // 02_questions 直下のクエスチョン（生存・登録済み）。DEAD_FORM を参照。
  const qFile = drive.makeFile(
    "q.json",
    JSON.stringify({ folder: "", query: { mode: "sql", formSources: [{ formId: "DEAD_FORM", formName: "f" }] } }),
    qBase.getId()
  );
  store.analyticsMapping.questions = { [qFile.getId()]: { fileId: qFile.getId(), driveFileUrl: qFile.getUrl(), name: "q", folder: "" } };

  // qFile を参照するダッシュボード。
  const dFile = drive.makeFile(
    "d.json",
    JSON.stringify({ folder: "", cards: [{ questionId: qFile.getId(), questionName: "q" }] }),
    dBase.getId()
  );

  const r = context.StdFolders_alignReferencesOnSave_("dashboards", dFile.getId());
  assert.equal(r.ok, true);
  assert.equal(r.questions.aligned, 1, "クエスチョンは ① 一致");
  assert.equal(r.forms.rekeyed, 1, "クエスチョンが参照するフォームは ③ 再採用");

  // 中間クエスチョンの formId が live form id へ追従。
  const q = JSON.parse(drive.files[qFile.getId()]._content);
  assert.equal(q.query.formSources[0].formId, fForm.getId());
  // クエスチョン id は保持されるのでダッシュボードのリンクは不変。
  const d = JSON.parse(drive.files[dFile.getId()]._content);
  assert.equal(d.cards[0].questionId, qFile.getId());
});

test("保存時参照整合: ②内部移動は id 保持のためリンク不変", () => {
  const env = buildContext();
  const { context, drive, formsA, formsB, store } = env;
  const qBase = findFolderByName(drive, "02_questions");

  // 物理フォームは b にあるが json.folder=a・登録簿も a（生存 id）→ ② 内部移動。
  const fForm = drive.makeFile("mv.json", formJson("a"), formsB.getId());
  store.formsMapping = { [fForm.getId()]: { fileId: fForm.getId(), driveFileUrl: fForm.getUrl(), title: "mv", folder: "a" } };
  const qFile = drive.makeFile(
    "q.json",
    JSON.stringify({ folder: "", query: { mode: "sql", formSources: [{ formId: fForm.getId(), formName: "mv" }] } }),
    qBase.getId()
  );

  const r = context.StdFolders_alignReferencesOnSave_("questions", qFile.getId());
  assert.equal(r.forms.moved, 1, "② 内部移動");
  assert.equal(drive.files[fForm.getId()]._parentId, formsA.getId(), "物理が a へ移動");
  // id 保持なのでリンク不変・追従ファイルなし。
  assert.equal(r.relinkedFiles, 0);
  const q = JSON.parse(drive.files[qFile.getId()]._content);
  assert.equal(q.query.formSources[0].formId, fForm.getId());
});

