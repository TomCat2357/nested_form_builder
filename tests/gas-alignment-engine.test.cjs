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
    "constants.gs", "formsParsing.gs", "model.gs", "driveFile.gs",
    "sharedDriveFolders.gs", "formsDriveFolders.gs", "analyticsDriveFolders.gs",
    "standardFoldersAlign.gs", "standardFoldersAlignRefs.gs", "standardFoldersCopy.gs", "standardFolders.gs",
  ]);
  // Nfb_withLockedSafeCall_（errors.gs）は本テストではロードしないため、shim 済みプリミティブの合成で代替。
  // WithScriptLock_ は各テストで後付け設定されるため、呼び出し時に動的解決する。
  context.Nfb_withLockedSafeCall_ = (label, fn) => context.nfbSafeCall_(() => context.WithScriptLock_(label, fn));
  // ルート解決をモックへ差し替え（後付け上書き。autoFileFolderOrNull_ もこれ経由で解決される）。
  context.StdFolders_resolveRootFolder_ = () => root;

  return { context, drive, root, forms, formsA, formsB, ext, store };
}

const formJson = (folder) => JSON.stringify({ folder, schema: [{ id: "q1", type: "text" }] });

// formLink フィールドを持つ親フォーム json。links = [{ id, path }]。
const parentFormJson = (folder, links) => JSON.stringify({
  folder,
  schema: [{ id: "p1", type: "text" }].concat(
    (links || []).map((l, i) => ({ id: "fl" + i, type: "formLink", childFormId: l.id, childFormPath: l.path }))
  ),
});

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

test("保存時参照整合: ①ホーム内移動は物理優先で論理パスを追従（移動しない・id 保持）", () => {
  const env = buildContext();
  const { context, drive, formsA, formsB, store } = env;
  const qBase = findFolderByName(drive, "02_questions");

  // 物理フォームは 01_forms/b にあるが json.folder=a・登録簿も a（生存 id）。
  // 新方針 ①: 物理がホーム配下なので物理優先 → 論理（json.folder / entry.folder）を b へ合わせる。move しない。
  const fForm = drive.makeFile("mv.json", formJson("a"), formsB.getId());
  store.formsMapping = { [fForm.getId()]: { fileId: fForm.getId(), driveFileUrl: fForm.getUrl(), title: "mv", folder: "a" } };
  const qFile = drive.makeFile(
    "q.json",
    JSON.stringify({ folder: "", query: { mode: "sql", formSources: [{ formId: fForm.getId(), formName: "mv" }] } }),
    qBase.getId()
  );

  const r = context.StdFolders_alignReferencesOnSave_("questions", qFile.getId());
  assert.equal(r.forms.aligned, 1, "① 物理優先で整合");
  assert.equal(r.forms.moved, 0, "物理移動しない");
  assert.equal(drive.files[fForm.getId()]._parentId, formsB.getId(), "物理は b のまま");
  // 論理が物理 b に追従。
  assert.equal(store.formsMapping[fForm.getId()].folder, "b", "entry.folder が物理 b へ追従");
  assert.equal(JSON.parse(drive.files[fForm.getId()]._content).folder, "b", "json.folder が物理 b へ追従");
  // id は保持されるが論理パスが a→b へ変化したので、逆方向再リンクで参照元の formPath アンカーを更新する。
  assert.equal(r.relinkedFiles, 1, "論理パス変化で参照元のパスアンカーを再 stamp");
  const q = JSON.parse(drive.files[qFile.getId()]._content);
  assert.equal(q.query.formSources[0].formId, fForm.getId(), "id 保持なので formId 不変");
  assert.equal(q.query.formSources[0].formPath, "b/mv", "formPath が物理 b の論理パスへ追従");
});

test("保存時参照整合: ②プロジェクト内の別標準フォルダにある form はホームへ move（id 保持）", () => {
  const env = buildContext();
  const { context, drive, formsA, store } = env;
  const qBase = findFolderByName(drive, "02_questions");

  // 物理フォームが 02_questions 内に在る（ホーム 01_forms 外だがプロジェクト内）。json.folder=a・登録簿も a。
  // 新方針 ②: 論理優先 → ホーム 01_forms/a へ移動（id 保持）。
  const fForm = drive.makeFile("stray.json", formJson("a"), qBase.getId());
  store.formsMapping = { [fForm.getId()]: { fileId: fForm.getId(), driveFileUrl: fForm.getUrl(), title: "stray", folder: "a" } };
  const qFile = drive.makeFile(
    "q.json",
    JSON.stringify({ folder: "", query: { mode: "sql", formSources: [{ formId: fForm.getId(), formName: "stray" }] } }),
    qBase.getId()
  );

  const r = context.StdFolders_alignReferencesOnSave_("questions", qFile.getId());
  assert.equal(r.forms.moved, 1, "② プロジェクト内別フォルダから move");
  assert.equal(drive.files[fForm.getId()]._parentId, formsA.getId(), "物理が 01_forms/a へ移動");
  assert.equal(store.formsMapping[fForm.getId()].folder, "a", "entry.folder は a 維持");
  // id 保持なのでリンク不変。
  assert.equal(r.relinkedFiles, 0);
  const q = JSON.parse(drive.files[qFile.getId()]._content);
  assert.equal(q.query.formSources[0].formId, fForm.getId());
});

test("全件整列: プロジェクト外フォームをコピー取り込みし、参照クエスチョンのリンクを追従する（冪等）", () => {
  const env = buildContext();
  const { context, drive, store, formsA, ext } = env;
  const qBase = findFolderByName(drive, "02_questions");

  // 全件オーケストレータが必要とする依存をモックへ後付け（ロック素通し・forms フォルダ収集は空）。
  context.WithScriptLock_ = (label, fn) => fn();
  context.Forms_collectFolders_ = () => [];

  // プロジェクト外フォーム（EXTERNAL 配下、json.folder=a）。
  const extForm = drive.makeFile("ext.json", formJson("a"), ext.getId());
  const extId = extForm.getId();
  store.formsMapping = {
    [extId]: { fileId: extId, driveFileUrl: extForm.getUrl(), title: "ext", folder: "a" },
  };
  // EXTID を参照するクエスチョン（02_questions 直下・登録済み）。
  const qFile = drive.makeFile(
    "q.json",
    JSON.stringify({ folder: "", query: { mode: "sql", formSources: [{ formId: extId, formName: "ext" }] } }),
    qBase.getId()
  );
  store.analyticsMapping.questions = {
    [qFile.getId()]: { fileId: qFile.getId(), driveFileUrl: qFile.getUrl(), name: "q", folder: "" },
  };

  const r = context.StdFolders_alignAllEntries_();
  assert.equal(r.ok, true);
  assert.equal(r.forms.copiedExternal, 1, "② プロジェクト外コピー取り込み 1 件");
  assert.ok(!store.formsMapping[extId], "旧 id（プロジェクト外）は登録簿から除去");
  const newIds = Object.keys(store.formsMapping);
  assert.equal(newIds.length, 1, "コピー先 id 1 件に振替");
  const newId = newIds[0];
  assert.notEqual(newId, extId);
  assert.equal(drive.files[newId]._parentId, formsA.getId(), "コピー先は 01_forms/a 配下");
  // 参照クエスチョンの formId が新 id へ追従。
  assert.ok(r.relinkedFiles >= 1, "参照リンク再構成あり");
  const q = JSON.parse(drive.files[qFile.getId()]._content);
  assert.equal(q.query.formSources[0].formId, newId);

  // 冪等: 2 回目は全件整合・コピー 0・再構成 0。
  const r2 = context.StdFolders_alignAllEntries_();
  assert.equal(r2.forms.copiedExternal, 0);
  assert.equal(r2.forms.aligned, 1, "コピー済みファイルは ① 整合");
  assert.equal(r2.relinkedFiles, 0);
});

test("全件整列: Phase C で論理→物理の参照復旧を実行し結果を reresolved に含める", () => {
  const env = buildContext();
  const { context } = env;
  context.WithScriptLock_ = (label, fn) => fn();
  context.Forms_collectFolders_ = () => [];
  // Phase C は汎用の Admin_reresolveAllRefsFromLogical_ を流用する（このテスト context では
  // adminMigrations.gs 未ロードのためスパイで差し替えて呼び出し回数と結果伝播を検証する）。
  let called = 0;
  context.Admin_reresolveAllRefsFromLogical_ = () => {
    called++;
    return { forms: 3, questions: 1, dashboards: 2 };
  };

  const r = context.StdFolders_alignAllEntries_();
  assert.equal(r.ok, true);
  assert.equal(called, 1, "Phase C は 1 回だけ実行");
  // VM realm 跨ぎで deepStrictEqual はプロトタイプ差で落ちるためフィールド単位で検証。
  assert.equal(r.reresolved.forms, 3, "復旧件数(forms)を結果に含める");
  assert.equal(r.reresolved.questions, 1, "復旧件数(questions)を結果に含める");
  assert.equal(r.reresolved.dashboards, 2, "復旧件数(dashboards)を結果に含める");
});

test("全件整列: Phase C が失敗しても整列結果は返す（非致命）", () => {
  const env = buildContext();
  const { context } = env;
  context.WithScriptLock_ = (label, fn) => fn();
  context.Forms_collectFolders_ = () => [];
  context.Admin_reresolveAllRefsFromLogical_ = () => { throw new Error("boom"); };

  const r = context.StdFolders_alignAllEntries_();
  assert.equal(r.ok, true, "Phase C 失敗でも ok");
  assert.equal(r.reresolved.forms, 0, "失敗時は forms 0 件で degrade");
  assert.equal(r.reresolved.questions, 0, "失敗時は questions 0 件で degrade");
  assert.equal(r.reresolved.dashboards, 0, "失敗時は dashboards 0 件で degrade");
});

test("全件整列: Phase C-2 で forms 物理参照の再配置を実行し formPhysicalAligned に件数を返す", () => {
  const env = buildContext();
  const { context } = env;
  context.WithScriptLock_ = (label, fn) => fn();
  context.Forms_collectFolders_ = () => [];
  context.Admin_reresolveAllRefsFromLogical_ = () => ({ forms: 0, questions: 0, dashboards: 0 });
  let called = 0;
  context.StdFolders_alignAllFormPhysicalRefs_ = () => { called++; return 4; };

  const r = context.StdFolders_alignAllEntries_();
  assert.equal(r.ok, true);
  assert.equal(called, 1, "Phase C-2 を 1 回実行");
  assert.equal(r.formPhysicalAligned, 4, "再配置件数を結果に含める");
});

test("organize: spreadsheet 参照に ①② 整合を適用（生存物理の再配置で物理URLを更新）", () => {
  const env = buildContext();
  const { context } = env;
  // alignFileRefIntoStdFolder_ をスタブ: ② move 相当の整合結果を返す。
  context.StdFolders_alignFileRefIntoStdFolder_ = (key, urlOrId, path) => {
    assert.equal(key, "spreadsheets");
    return { fileId: "SS1", url: "https://docs.google.com/spreadsheets/d/SS1/edit", path: "経理/2025", status: "moved" };
  };
  const json = { settings: { spreadsheetId: "https://docs.google.com/spreadsheets/d/OLD/edit", spreadsheetPath: "経理/2025" } };
  assert.equal(context.StdFolders_alignFormSpreadsheetRefInJson_(json), true);
  assert.equal(json.settings.spreadsheetId, "SS1", "物理は素の fileId を整合先へ更新");
  assert.equal(json.settings.spreadsheetPath, "経理/2025", "論理パスを保持");
});

test("organize: spreadsheet 参照が無いフォームは align を呼ばず no-op", () => {
  const env = buildContext();
  const { context } = env;
  let called = 0;
  context.StdFolders_alignFileRefIntoStdFolder_ = () => { called++; return { status: "unresolved" }; };
  assert.equal(context.StdFolders_alignFormSpreadsheetRefInJson_({ settings: {} }), false);
  assert.equal(context.StdFolders_alignFormSpreadsheetRefInJson_({}), false);
  assert.equal(called, 0, "参照が無ければ align を呼ばない（新規作成もしない）");
});

test("organize: spreadsheet が unresolved/noop のときは据え置き（書き換えない）", () => {
  const env = buildContext();
  const { context } = env;
  context.StdFolders_alignFileRefIntoStdFolder_ = () => ({ fileId: "", status: "unresolved" });
  const json = { settings: { spreadsheetId: "x", spreadsheetPath: "p" } };
  assert.equal(context.StdFolders_alignFormSpreadsheetRefInJson_(json), false);
  assert.equal(json.settings.spreadsheetId, "x", "未解決は据え置き");
  assert.equal(json.settings.spreadsheetPath, "p");
});

test("formLink: 親保存でプロジェクト外の子フォームを③コピー取り込みし childFormId/childFormPath を追従", () => {
  const env = buildContext();
  const { context, drive, store, formsA, ext, forms } = env;

  // プロジェクト外の子フォーム（EXTERNAL 配下、json.folder=a, title=child）。登録済み。
  const childExt = drive.makeFile("child.json", formJson("a"), ext.getId());
  const childExtId = childExt.getId();
  store.formsMapping = { [childExtId]: { fileId: childExtId, driveFileUrl: childExt.getUrl(), title: "child", folder: "a" } };

  // 親フォーム（01_forms 直下）。formLink で childExtId を参照。
  const parent = drive.makeFile("parent.json", parentFormJson("", [{ id: childExtId, path: "a/child" }]), forms.getId());

  const r = context.StdFolders_alignReferencesOnSave_("forms", parent.getId());
  assert.equal(r.ok, true);
  assert.equal(r.forms.copiedExternal, 1, "子フォームを ③ コピー取り込み");
  assert.ok(!store.formsMapping[childExtId], "旧外部 id は登録簿から除去");
  const newIds = Object.keys(store.formsMapping);
  assert.equal(newIds.length, 1, "コピー先 id 1 件");
  const newId = newIds[0];
  assert.notEqual(newId, childExtId);
  assert.equal(drive.files[newId]._parentId, formsA.getId(), "コピー先は 01_forms/a 配下");
  // 親の childFormId / childFormPath が追従。
  assert.equal(r.relinkedFiles, 1);
  const pj = JSON.parse(drive.files[parent.getId()]._content);
  const fl = pj.schema.find((f) => f.type === "formLink");
  assert.equal(fl.childFormId, newId, "childFormId が新 id へ");
  assert.equal(fl.childFormPath, "a/child", "childFormPath が新 id の論理パスへ");
});

test("stampRefPaths_: 中央辞書から formPath/questionPath/childFormPath を冗長保存する", () => {
  const env = buildContext();
  const { context, store } = env;

  store.formsMapping = { FORM1: { fileId: "FORM1", title: "売上", folder: "営業" } };
  store.analyticsMapping.questions = { Q1: { fileId: "Q1", name: "集計", folder: "" } };

  // questions: gui.formId / formSources[].formId に formPath を stamp。
  const qjson = { query: { mode: "gui", gui: { formId: "FORM1" }, formSources: [{ formId: "FORM1" }] } };
  assert.equal(context.StdFolders_stampRefPaths_(qjson, "questions"), true);
  assert.equal(qjson.query.gui.formPath, "営業/売上");
  assert.equal(qjson.query.formSources[0].formPath, "営業/売上");

  // dashboards: cards[].questionId に questionPath を stamp（folder 空なら葉名のみ）。
  const djson = { cards: [{ questionId: "Q1" }] };
  assert.equal(context.StdFolders_stampRefPaths_(djson, "dashboards"), true);
  assert.equal(djson.cards[0].questionPath, "集計");

  // forms: formLink の childFormId に childFormPath を stamp。
  const fjson = { schema: [{ id: "fl0", type: "formLink", childFormId: "FORM1" }] };
  assert.equal(context.StdFolders_stampRefPaths_(fjson, "forms"), true);
  assert.equal(fjson.schema[0].childFormPath, "営業/売上");

  // 未解決 id は据え置き（変更なし）。
  const unresolved = { query: { mode: "gui", gui: { formId: "MISSING", formPath: "旧/パス" } } };
  assert.equal(context.StdFolders_stampRefPaths_(unresolved, "questions"), false);
  assert.equal(unresolved.query.gui.formPath, "旧/パス");
});

test("逆方向再リンク: 外部フォーム③コピー取り込みで、保存していない他の参照元クエスチョンも追従する", () => {
  const env = buildContext();
  const { context, drive, store, ext } = env;
  const qBase = findFolderByName(drive, "02_questions");

  // プロジェクト外フォーム（登録済み, folder=a）。これを参照する 2 クエスチョンのうち q1 だけ保存する。
  const extForm = drive.makeFile("ext.json", formJson("a"), ext.getId());
  const extId = extForm.getId();
  store.formsMapping = { [extId]: { fileId: extId, driveFileUrl: extForm.getUrl(), title: "ext", folder: "a" } };

  const q1 = drive.makeFile("q1.json",
    JSON.stringify({ folder: "", query: { mode: "sql", formSources: [{ formId: extId, formName: "ext" }] } }),
    qBase.getId());
  const q2 = drive.makeFile("q2.json",
    JSON.stringify({ folder: "", query: { mode: "sql", formSources: [{ formId: extId, formName: "ext" }] } }),
    qBase.getId());
  store.analyticsMapping.questions = {
    [q1.getId()]: { fileId: q1.getId(), driveFileUrl: q1.getUrl(), name: "q1", folder: "" },
    [q2.getId()]: { fileId: q2.getId(), driveFileUrl: q2.getUrl(), name: "q2", folder: "" },
  };

  const r = context.StdFolders_alignReferencesOnSave_("questions", q1.getId());
  assert.equal(r.ok, true);
  assert.equal(r.forms.copiedExternal, 1, "外部フォームを ③ コピー取り込み");
  const newIds = Object.keys(store.formsMapping);
  assert.equal(newIds.length, 1, "コピー先 id 1 件に振替");
  const newId = newIds[0];
  assert.notEqual(newId, extId);
  // 保存した q1 だけでなく、保存していない q2 のリンクも逆方向再リンクで追従する（本機能の主目的）。
  assert.equal(JSON.parse(drive.files[q1.getId()]._content).query.formSources[0].formId, newId, "q1 追従");
  assert.equal(JSON.parse(drive.files[q2.getId()]._content).query.formSources[0].formId, newId, "q2（他参照元）も追従");
  assert.ok(r.relinkedFiles >= 2, "保存本体＋他参照元の 2 件以上を再リンク");

  // 冪等: 2 回目はコピー済み（① 整合）・remap/pathChanged 空でゲート不成立 → 再リンク 0。
  const r2 = context.StdFolders_alignReferencesOnSave_("questions", q1.getId());
  assert.equal(r2.forms.aligned, 1, "コピー済みは ① 整合");
  assert.equal(r2.relinkedFiles, 0, "冪等: 再リンク 0");
});

test("逆方向再リンク: ②move（論理パス不変）では参照元を再リンクしない（ゲート不成立）", () => {
  const env = buildContext();
  const { context, drive, store, formsA } = env;
  const qBase = findFolderByName(drive, "02_questions");

  // 物理フォームが 02_questions 内（ホーム外・プロジェクト内）。json.folder=a・登録簿も a。
  // ② で 01_forms/a へ move されるが entry.folder は a のまま（論理パス不変）。
  const fForm = drive.makeFile("stray.json", formJson("a"), qBase.getId());
  store.formsMapping = { [fForm.getId()]: { fileId: fForm.getId(), driveFileUrl: fForm.getUrl(), title: "stray", folder: "a" } };
  // この form を参照する別クエスチョン（保存しない）。
  const q2 = drive.makeFile("q2.json",
    JSON.stringify({ folder: "", query: { mode: "sql", formSources: [{ formId: fForm.getId(), formName: "stray", formPath: "a/stray" }] } }),
    qBase.getId());
  store.analyticsMapping.questions = { [q2.getId()]: { fileId: q2.getId(), driveFileUrl: q2.getUrl(), name: "q2", folder: "" } };
  const q1 = drive.makeFile("q1.json",
    JSON.stringify({ folder: "", query: { mode: "sql", formSources: [{ formId: fForm.getId(), formName: "stray" }] } }),
    qBase.getId());

  const r = context.StdFolders_alignReferencesOnSave_("questions", q1.getId());
  assert.equal(r.forms.moved, 1, "② move");
  assert.equal(drive.files[fForm.getId()]._parentId, formsA.getId(), "物理は 01_forms/a へ移動");
  // 論理パス（entry.folder=a）は不変なので逆方向再リンクは発火しない。
  assert.equal(r.relinkedFiles, 0, "論理パス不変なら再リンクしない（重い走査をスキップ）");
  assert.equal(JSON.parse(drive.files[q2.getId()]._content).query.formSources[0].formPath, "a/stray", "他参照元の path 据え置き");
});

test("逆方向再リンク: ルート未解決でも保存フックは ok（ゲート不成立で no-op）", () => {
  const env = buildContext();
  const { context, drive } = env;
  const qBase = findFolderByName(drive, "02_questions");
  const q1 = drive.makeFile("q.json",
    JSON.stringify({ folder: "", query: { mode: "sql", formSources: [{ formId: "X", formName: "x" }] } }),
    qBase.getId());
  context.StdFolders_resolveRootFolder_ = () => { throw new Error("root unresolved"); };
  const r = context.StdFolders_alignReferencesOnSave_("questions", q1.getId());
  assert.equal(r.ok, true, "root 未解決でも ok（degrade）");
  assert.equal(r.relinkedFiles, 0, "no-op");
});

test("逆方向再リンク: selfChangedHint で保存本体の rename を他参照元へ伝播する", () => {
  const env = buildContext();
  const { context, drive, store, formsA } = env;
  const qBase = findFolderByName(drive, "02_questions");

  // 物理フォーム a（登録済み, title=mv, folder=a）。保存層が rename を検知して selfChangedHint=true を渡す想定。
  const fForm = drive.makeFile("mv.json", formJson("a"), formsA.getId());
  store.formsMapping = { [fForm.getId()]: { fileId: fForm.getId(), driveFileUrl: fForm.getUrl(), title: "mv", folder: "a" } };
  // この form を参照する別クエスチョン（古い formPath を保持）。
  const q2 = drive.makeFile("q2.json",
    JSON.stringify({ folder: "", query: { mode: "sql", formSources: [{ formId: fForm.getId(), formName: "mv", formPath: "旧/mv" }] } }),
    qBase.getId());
  store.analyticsMapping.questions = { [q2.getId()]: { fileId: q2.getId(), driveFileUrl: q2.getUrl(), name: "q2", folder: "" } };

  // savedFileId は form 自身。selfChangedHint=true で発火。
  const r = context.StdFolders_alignReferencesOnSave_("forms", fForm.getId(), true);
  assert.equal(r.ok, true);
  // 参照元 q2 の formPath が中央辞書の現値（a/mv）へ再 stamp される。
  assert.equal(JSON.parse(drive.files[q2.getId()]._content).query.formSources[0].formPath, "a/mv", "他参照元の path アンカーを追従");
  assert.ok(r.relinkedFiles >= 1, "保存本体の rename を参照元へ伝播");

  // selfChangedHint なしなら発火しない（ゲート）。
  const q2b = drive.makeFile("q2b.json",
    JSON.stringify({ folder: "", query: { mode: "sql", formSources: [{ formId: fForm.getId(), formName: "mv", formPath: "旧/mv" }] } }),
    qBase.getId());
  store.analyticsMapping.questions[q2b.getId()] = { fileId: q2b.getId(), driveFileUrl: q2b.getUrl(), name: "q2b", folder: "" };
  const r2 = context.StdFolders_alignReferencesOnSave_("forms", fForm.getId());
  assert.equal(r2.relinkedFiles, 0, "hint なしは no-op（論理パス変化を申告しない限り走らせない）");
  assert.equal(JSON.parse(drive.files[q2b.getId()]._content).query.formSources[0].formPath, "旧/mv", "据え置き");
});

test("逆方向再リンク(05): 様式 Doc 再配置で、同じ Doc を旧 URL で指す他フォームの参照を張り替える", () => {
  const env = buildContext();
  const { context, drive, store, forms } = env;

  // 2 フォームが同じ外部様式 Doc（OLD_DOC）を参照。A の保存で OLD_DOC を 05 へコピー(NEW_DOC)した想定。
  const oldUrl = "https://docs.google.com/document/d/OLD_DOC/edit";
  const newUrl = "https://docs.google.com/document/d/NEW_DOC/edit";
  const formA = drive.makeFile("a.json",
    JSON.stringify({ folder: "", schema: [], settings: { standardPrintTemplateUrl: newUrl, standardPrintTemplatePath: "x/tpl" } }),
    forms.getId());
  const formB = drive.makeFile("b.json",
    JSON.stringify({
      folder: "",
      schema: [{ id: "c1", type: "text", printTemplateAction: { useCustomTemplate: true, templateUrl: oldUrl, templatePath: "旧" } }],
      settings: { standardPrintTemplateUrl: oldUrl, standardPrintTemplatePath: "旧/tpl" },
    }),
    forms.getId());
  store.formsMapping = {
    [formA.getId()]: { fileId: formA.getId(), driveFileUrl: formA.getUrl(), title: "a", folder: "" },
    [formB.getId()]: { fileId: formB.getId(), driveFileUrl: formB.getUrl(), title: "b", folder: "" },
  };

  const relocations = [{ oldFileId: "OLD_DOC", newId: "NEW_DOC", newPath: "x/tpl" }];
  const n = context.StdFolders_propagateTemplateRelinkToForms_(relocations, formA.getId());
  assert.equal(n, 1, "他フォーム B を 1 件張り替え（保存本体 A は skip）");
  const b = JSON.parse(drive.files[formB.getId()]._content);
  assert.equal(b.settings.standardPrintTemplateId, "NEW_DOC", "B settings 様式 id 追従");
  assert.equal("standardPrintTemplateUrl" in b.settings, false, "B settings 旧 URL キーを剥がす");
  assert.equal(b.settings.standardPrintTemplatePath, "x/tpl", "B settings 様式 path 追従");
  assert.equal(b.schema[0].printTemplateAction.templateId, "NEW_DOC", "B カード様式 id 追従");
  assert.equal("templateUrl" in b.schema[0].printTemplateAction, false, "B カード旧 URL キーを剥がす");
  assert.equal(b.schema[0].printTemplateAction.templatePath, "x/tpl", "B カード様式 path 追従");

  // 冪等: 2 回目は変化なし。
  assert.equal(context.StdFolders_propagateTemplateRelinkToForms_(relocations, formA.getId()), 0, "冪等");
  // 無関係な Doc を指すフォームは対象外。
  assert.equal(context.StdFolders_propagateTemplateRelinkToForms_([{ oldFileId: "ZZZ", newId: "u", newPath: "p" }], formA.getId()), 0, "一致なしは no-op");
});

test("formLink: childFormId 切れ・未登録でも childFormPath で物理を再探索して貼り直す", () => {
  const env = buildContext();
  const { context, drive, store, formsA, forms } = env;

  // 物理子フォームは 01_forms/a/child.json に存在（登録簿には無い）。
  const child = drive.makeFile("child.json", formJson("a"), formsA.getId());
  store.formsMapping = {}; // 未登録

  // 親は死んだ childFormId を参照、childFormPath="a/child"。
  const parent = drive.makeFile("parent.json", parentFormJson("", [{ id: "DEAD_CHILD", path: "a/child" }]), forms.getId());

  const r = context.StdFolders_alignReferencesOnSave_("forms", parent.getId());
  assert.equal(r.ok, true);
  assert.equal(r.relinkedFiles, 1, "path 復旧で親リンク貼り直し");
  const pj = JSON.parse(drive.files[parent.getId()]._content);
  const fl = pj.schema.find((f) => f.type === "formLink");
  assert.equal(fl.childFormId, child.getId(), "childFormId が物理 child へ復旧");
});

