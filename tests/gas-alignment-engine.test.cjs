const assert = require("node:assert/strict");
const test = require("node:test");
const { loadGasFiles } = require("./helpers/gasVmLoader.cjs");

// 論理↔物理 整合同期エンジン（standardFolders.gs の StdFolders_alignFolders_ ほか）を、
// インメモリ Drive モックで 6 ケース ①〜⑥ + 冪等性について検証する。
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
      _id: id, _name: name, _content: content, _parentId: parentId, _trashed: false,
      getId: () => id,
      getName: () => fl._name,
      setName: (n) => { fl._name = n; },
      getUrl: () => "https://drive/file/" + id,
      getMimeType: () => (String(fl._name).toLowerCase().endsWith(".json") ? "application/json" : (fl._mime || "text/plain")),
      isTrashed: () => fl._trashed,
      setTrashed: (v) => { fl._trashed = !!v; },
      getBlob: () => ({ getDataAsString: () => fl._content }),
      setContent: (c) => { fl._content = c; },
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

test("整合エンジン: ①〜⑥ を一括で正しく処理する", () => {
  const env = buildContext();
  const { context, drive, forms, formsA, formsB, ext, store } = env;

  // ① 一致: 01_forms/a に置かれ json.folder=a、登録済み。
  const fOk = drive.makeFile("ok.json", formJson("a"), formsA.getId());
  // ② プロジェクト内・P≠L: 物理は b、json.folder=a。
  const fMoved = drive.makeFile("moved.json", formJson("a"), formsB.getId());
  // ② プロジェクト外: 物理は EXTERNAL、json.folder=a → a へコピー取り込み。
  const fExt = drive.makeFile("ext.json", formJson("a"), ext.getId());
  // ③ fileId 未解決・L(a) に同名別 id: reborn.json が a に物理存在。
  const fReborn = drive.makeFile("reborn.json", formJson("a"), formsA.getId());
  // ⑤ 有効オーファン（物理 a, json.folder は wrong → 物理 a へ揃え直す）。
  const fNew = drive.makeFile("newbie.json", formJson("wrong"), formsA.getId());
  // ⑥ 不正オーファン: schema 無し json と 非json。
  drive.makeFile("junk.json", JSON.stringify({ foo: 1 }), forms.getId());
  const png = drive.makeFile("note.png", "binary", forms.getId());
  png._mime = "image/png";

  store.formsMapping = {
    [fOk.getId()]: { fileId: fOk.getId(), driveFileUrl: fOk.getUrl(), title: "ok", folder: "a" },
    [fMoved.getId()]: { fileId: fMoved.getId(), driveFileUrl: fMoved.getUrl(), title: "moved", folder: "a" },
    [fExt.getId()]: { fileId: fExt.getId(), driveFileUrl: fExt.getUrl(), title: "ext", folder: "a" },
    DEAD_REBORN: { fileId: "DEAD_REBORN", driveFileUrl: "x", title: "reborn", folder: "a" },
    DEAD_LOST: { fileId: "DEAD_LOST", driveFileUrl: "x", title: "lost", folder: "b" }, // ④
  };

  const r = context.StdFolders_alignFolders_({}); // applyDelete 既定 false（⑥ は候補のみ）
  assert.equal(r.ok, true);
  assert.equal(r.mode, "dryRun");

  const a = r.align.forms;
  assert.equal(a.aligned, 1, "① 一致は 1 件");
  assert.equal(a.moved, 1, "② 内部移動は 1 件");
  assert.equal(a.copiedExternal, 1, "② 外部コピーは 1 件");
  assert.equal(a.rekeyed, 1, "③ id 再採用は 1 件");
  assert.equal(a.errors, 1, "④ エラーは 1 件");

  // ② 内部移動: moved.json の親が a になった。
  assert.equal(drive.files[fMoved.getId()]._parentId, formsA.getId());

  // ② 外部コピー: 旧 EXTID は mapping から消え、コピー先 id が a 配下に登録され、remap が relink へ流れた。
  assert.ok(!store.formsMapping[fExt.getId()], "外部元 id は mapping から除去");
  const copied = Object.keys(drive.files).map((k) => drive.files[k])
    .find((fl) => fl._name === "ext.json" && fl._parentId === formsA.getId() && !fl._trashed);
  assert.ok(copied, "コピー先ファイルが 01_forms/a に作成された");
  assert.ok(store.formsMapping[copied.getId()], "コピー先 id が mapping に採用された");
  assert.equal(store.formsMapping[copied.getId()].folder, "a");

  // ③ 再採用: DEAD_REBORN は消え、reborn.json の id が採用された。
  assert.ok(!store.formsMapping.DEAD_REBORN);
  assert.ok(store.formsMapping[fReborn.getId()], "reborn.json の id へ振替え");

  // ④ エラー: DEAD_LOST は削除されず保持され、errors に出る。
  assert.ok(store.formsMapping.DEAD_LOST, "④ は mapping から削除しない");
  assert.equal(r.errors.filter((e) => e.id === "DEAD_LOST").length, 1);

  // ⑤ 登録: newbie.json が folder=a で登録され、json.folder が物理 a へ書き換わった。
  assert.equal(r.orphans.forms.registered, 1);
  assert.ok(store.formsMapping[fNew.getId()], "⑤ 有効オーファンを登録");
  assert.equal(store.formsMapping[fNew.getId()].folder, "a");
  assert.equal(JSON.parse(drive.files[fNew.getId()]._content).folder, "a", "json.folder を物理へ揃える");
  assert.ok(store.formsFolders.indexOf("a") !== -1);

  // ⑥ 候補: junk.json と note.png が候補化され、applyDelete=false なので未削除。
  const invForms = r.invalidCandidates.filter((c) => c.kind === "forms");
  assert.equal(invForms.length, 2);
  assert.ok(drive.files[png.getId()] && !drive.files[png.getId()]._trashed, "⑥ は dryRun では削除しない");
});

test("整合エンジン: applyDelete で ⑥ をゴミ箱へ移す", () => {
  const env = buildContext();
  const { context, drive, forms, store } = env;
  const junk = drive.makeFile("junk.json", JSON.stringify({ foo: 1 }), forms.getId());
  store.formsMapping = {};

  const r = context.StdFolders_alignFolders_({ applyDelete: true });
  assert.equal(r.mode, "apply");
  assert.equal(r.invalidCandidates.filter((c) => c.kind === "forms").length, 1);
  assert.equal(drive.files[junk.getId()]._trashed, true, "applyDelete で trash される");
});

test("整合エンジン: 冪等（2 回目は移動/コピー/再採用/登録なし）", () => {
  const env = buildContext();
  const { context, drive, formsA, formsB, ext, store } = env;
  const fMoved = drive.makeFile("moved.json", formJson("a"), formsB.getId());
  const fExt = drive.makeFile("ext.json", formJson("a"), ext.getId());
  const fNew = drive.makeFile("newbie.json", formJson("a"), formsA.getId());
  store.formsMapping = {
    [fMoved.getId()]: { fileId: fMoved.getId(), driveFileUrl: fMoved.getUrl(), title: "moved", folder: "a" },
    [fExt.getId()]: { fileId: fExt.getId(), driveFileUrl: fExt.getUrl(), title: "ext", folder: "a" },
  };

  context.StdFolders_alignFolders_({});
  const r2 = context.StdFolders_alignFolders_({});
  const a = r2.align.forms;
  assert.equal(a.moved, 0);
  assert.equal(a.copiedExternal, 0);
  assert.equal(a.rekeyed, 0);
  assert.equal(a.errors, 0);
  assert.equal(r2.orphans.forms.registered, 0, "2 回目は再登録しない");
  assert.ok(a.aligned >= 2, "全て ① 一致に収束");
});

test("整合エンジン: Question(analytics) でも ⑤ 登録が機能する（型汎用）", () => {
  const env = buildContext();
  const { context, drive, root, store } = env;
  // 02_questions 配下に有効な question json（object なら有効）。
  const qBase = Object.keys(drive.folders).map((k) => drive.folders[k]).find((f) => f._name === "02_questions");
  const qFile = drive.makeFile("q1.json", JSON.stringify({ folder: "", query: {} }), qBase.getId());

  const r = context.StdFolders_alignFolders_({});
  assert.equal(r.orphans.questions.registered, 1);
  assert.ok(store.analyticsMapping.questions[qFile.getId()], "question を登録");
  assert.equal(store.analyticsMapping.questions[qFile.getId()].name, "q1");
});
