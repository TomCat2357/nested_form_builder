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
    "sharedDriveFolders.gs", "formsDriveFolders.gs", "analyticsDriveFolders.gs",
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

test("整合エンジン: 同一フォルダ同名の重複は最新を残し余りを候補化＋参照を寄せる（⑤化けしない）", () => {
  const env = buildContext();
  const { context, drive, formsA, store } = env;
  const qBase = Object.keys(drive.folders).map((k) => drive.folders[k]).find((f) => f._name === "02_questions");

  // 同一フォルダ a に同名 "dup" のフォームが 2 つ（古い→新しい）。
  const dupOld = drive.makeFile("dup.json", formJson("a"), formsA.getId()); dupOld._updated = 100;
  const dupNew = drive.makeFile("dup.json", formJson("a"), formsA.getId()); dupNew._updated = 200;
  // 登録簿は古い方を指す。
  store.formsMapping = {
    [dupOld.getId()]: { fileId: dupOld.getId(), driveFileUrl: dupOld.getUrl(), title: "dup", folder: "a" },
  };
  // 古い方を参照するクエスチョン。
  const qFile = drive.makeFile(
    "q.json",
    JSON.stringify({ folder: "", query: { mode: "sql", formSources: [{ formId: dupOld.getId(), formName: "a/dup" }] } }),
    qBase.getId()
  );

  const r = context.StdFolders_alignFolders_({}); // 削除フラグ無し（候補収集のみ）
  assert.equal(r.ok, true);
  assert.equal(r.dedup.forms.losers, 1, "余り 1 件");
  assert.equal(r.duplicateCandidates.length, 1);
  assert.equal(r.duplicateCandidates[0].fileId, dupOld.getId(), "loser=古い方");
  assert.equal(r.duplicateCandidates[0].survivorId, dupNew.getId(), "survivor=新しい方");
  assert.ok(store.formsMapping[dupNew.getId()], "登録簿は survivor へ振替");
  assert.ok(!store.formsMapping[dupOld.getId()], "loser は登録簿から除去");
  assert.equal(r.orphans.forms.registered, 0, "重複は ⑤ 新規登録に化けない");
  // 参照は survivor（新しい方）へ寄る。
  const q = JSON.parse(drive.files[qFile.getId()]._content);
  assert.equal(q.query.formSources[0].formId, dupNew.getId());
  // 候補は未削除（applyDeleteDuplicates 既定 false）。
  assert.equal(drive.files[dupOld.getId()]._trashed, false);

  // applyDeleteDuplicates:true で loser をゴミ箱へ。
  const r2 = context.StdFolders_alignFolders_({ applyDeleteDuplicates: true });
  assert.ok(r2.trashedDuplicates.indexOf(dupOld.getId()) !== -1, "loser を trash");
  assert.equal(drive.files[dupOld.getId()]._trashed, true);
});

test("整合エンジン: 同一 fileId の論理パス重複は ①物理一致 を優先して 1 件に畳む", () => {
  const env = buildContext();
  const { context, drive, formsA, store } = env;
  const qBase = Object.keys(drive.folders).map((k) => drive.folders[k]).find((f) => f._name === "02_questions");

  // 物理は a に 1 ファイルだけ存在（json.folder=a）。
  const file = drive.makeFile("dup.json", formJson("a"), formsA.getId());
  const fid = file.getId();
  // 同一 fileId に解決される論理パスが 2 つ:
  //   - canonical キー(=fileId) だが論理パス folder=b（物理 a と不一致）
  //   - 別キー "ALT" で論理パス folder=a（物理 a と一致）→ ① でこちらが survivor。
  store.formsMapping = {
    [fid]: { fileId: fid, driveFileUrl: file.getUrl(), title: "dup", folder: "b" },
    ALT: { fileId: fid, driveFileUrl: file.getUrl(), title: "dup", folder: "a" },
  };
  // 旧キー "ALT" を参照するクエスチョン（再リンクで fileId へ寄るはず）。
  const qFile = drive.makeFile(
    "q.json",
    JSON.stringify({ folder: "", query: { mode: "sql", formSources: [{ formId: "ALT", formName: "a/dup" }] } }),
    qBase.getId()
  );

  const r = context.StdFolders_alignFolders_({});
  assert.equal(r.ok, true);
  assert.equal(r.fileIdDedup.forms.groups, 1, "重複グループ 1 件");
  assert.equal(r.fileIdDedup.forms.removed, 1, "余りの論理パス 1 件を除去");

  // ① 物理一致した folder=a 側が survivor として fileId キーへ正規化される。
  const keys = Object.keys(store.formsMapping);
  assert.deepEqual(keys, [fid], "mapping は fileId キー 1 件のみ");
  assert.equal(store.formsMapping[fid].folder, "a", "survivor=物理一致の論理パス a");

  // 物理ファイルは共有のため削除されない。
  assert.equal(drive.files[fid]._trashed, false, "共有物理ファイルはゴミ箱に入れない");

  // 参照は survivor の fileId へ寄る（旧キー ALT → fileId の remap）。
  const q = JSON.parse(drive.files[qFile.getId()]._content);
  assert.equal(q.query.formSources[0].formId, fid);
});

test("整合エンジン: 同一 fileId 重複は ①同点なら ②キー===fileId、それも同点なら ③登録順で後勝ち", () => {
  // --- ② キー===fileId 優先（① は両者とも物理一致で同点） ---
  {
    const env = buildContext();
    const { context, drive, formsA, store } = env;
    const file = drive.makeFile("two.json", formJson("a"), formsA.getId());
    const fid = file.getId();
    store.formsMapping = {
      OLD: { fileId: fid, driveFileUrl: file.getUrl(), title: "two", folder: "a" },   // 先・非canonical
      [fid]: { fileId: fid, driveFileUrl: file.getUrl(), title: "two", folder: "a" }, // 後・canonical
    };
    const r = context.StdFolders_alignFolders_({});
    assert.equal(r.fileIdDedup.forms.removed, 1);
    assert.deepEqual(Object.keys(store.formsMapping), [fid], "② キー===fileId を残す");
  }

  // --- ③ 登録順で後勝ち（① も ② も同点: どちらも物理不一致＆非canonical） ---
  {
    const env = buildContext();
    const { context, drive, formsA, store } = env;
    const file = drive.makeFile("three.json", formJson("a"), formsA.getId()); // 物理=a
    const fid = file.getId();
    store.formsMapping = {
      OLD1: { fileId: fid, driveFileUrl: file.getUrl(), title: "three", folder: "b" }, // 先（物理不一致）
      OLD2: { fileId: fid, driveFileUrl: file.getUrl(), title: "three", folder: "c" }, // 後（物理不一致）→ ③ で survivor
    };
    const r = context.StdFolders_alignFolders_({});
    assert.equal(r.fileIdDedup.forms.removed, 1);
    // survivor=OLD2（後勝ち）だが fileId キーへ正規化される。OLD2 の論理パス c を引き継ぐが、
    // 後続の ①〜④ が json.folder=a に揃えるため最終 folder は a。
    assert.deepEqual(Object.keys(store.formsMapping), [fid], "survivor を fileId キーへ正規化");
    assert.equal(store.formsMapping[fid].folder, "a", "①〜④ が物理 a へ整合");
  }
});

test("整合エンジン: id 変化が無くても毎回再リンクで腐れ参照を修復する（フォルダ込み名解決）", () => {
  const env = buildContext();
  const { context, drive, formsA, store } = env;
  const qBase = Object.keys(drive.folders).map((k) => drive.folders[k]).find((f) => f._name === "02_questions");

  // 生存・登録済みフォーム rep（a）。整合済み（① のみ・remap 無し）。
  const fRep = drive.makeFile("rep.json", formJson("a"), formsA.getId());
  store.formsMapping = { [fRep.getId()]: { fileId: fRep.getId(), driveFileUrl: fRep.getUrl(), title: "rep", folder: "a" } };
  // 腐れ参照（存在しない id）だがフォルダ込み名 "a/rep" を保持するクエスチョン。
  const qFile = drive.makeFile(
    "q.json",
    JSON.stringify({ folder: "", query: { mode: "sql", formSources: [{ formId: "GONE", formName: "a/rep" }] } }),
    qBase.getId()
  );

  const r = context.StdFolders_alignFolders_({});
  assert.equal(r.ok, true);
  // 今回の走査で id 変化は無い（① のみ）が、再リンクは毎回走り参照を現 id へ。
  const q = JSON.parse(drive.files[qFile.getId()]._content);
  assert.equal(q.query.formSources[0].formId, fRep.getId());
  assert.ok(r.relink && r.relink.questions && r.relink.questions.refsRelinked >= 1, "再リンクが発火");
});
