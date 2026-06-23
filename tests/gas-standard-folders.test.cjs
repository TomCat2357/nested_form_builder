const assert = require("node:assert/strict");
const test = require("node:test");
const { loadGasFiles } = require("./helpers/gasVmLoader.cjs");

// standardFolders.gs の純粋ヘルパー（リンク再配線・スキーマ走査）を検証する。
// DriveApp / PropertiesService を使わない関数のみが対象。
function loadGasContext() {
  const context = {
    console,
    // GAS グローバル Logger のスタブ（standardFolders.gs の catch 節などが呼ぶ）。
    Logger: { log() {} },
    NFB_DEFAULT_SHEET_NAME: "Data",
    DriveApp: {
      getFileById(id) { return { getId: () => id }; },
      getFolderById(id) { return { getId: () => id }; },
    },
    // standardFolders.gs では未定義の依存（他ファイル）の軽量スタブ。
    nfbSafeCall_(fn) { return fn(); },
    nfbErrorToString_(err) { return String((err && err.message) || err); },
    // mapping エントリから fileId を解決する共通ヘルパ（本体は gas/formsCrud.gs）。
    Nfb_resolveFileIdFromEntry_(entry) {
      if (!entry) return null;
      return entry.fileId || null;
    },
    // URL→fileId（本体は gas/properties.gs）。テストでは固定 ID を返す上書きを使う。
    ExtractFileIdFromUrl_() { return null; },
    // 文字列化＋trim（本体は gas/constants.gs）。
    Nfb_trimStr_(value) { return value ? String(value).trim() : ""; },
  };
  // standardFolders.gs は formsParsing.gs（Forms_parseGoogleDriveUrl_）と model.gs（Model_normalizeSpreadsheetId_）に依存。
  // standardFoldersCopy.gs は driveFile.gs（Nfb_readJsonFileById_ / Nfb_writeJsonToFile_）に依存。
  return loadGasFiles(context, ["formsParsing.gs", "model.gs", "driveFile.gs", "standardFoldersAlign.gs", "standardFoldersAlignRefs.gs", "standardFoldersCopy.gs", "standardFolders.gs"]);
}

// getFilesByName / getFiles / createFile / setTrashed / getLastUpdated を備えた最小フォルダモック。
function makeMockFolder(rootId) {
  const files = [];
  let clock = 1000;
  const folder = {
    _files: files,
    getId: () => rootId || "ROOT",
    getUrl: () => "https://drive.google.com/drive/folders/" + (rootId || "ROOT"),
    getFilesByName(name) {
      const matches = files.filter((f) => f._name === name);
      let i = 0;
      return { hasNext: () => i < matches.length, next: () => matches[i++] };
    },
    getFiles() {
      const live = files.slice();
      let i = 0;
      return { hasNext: () => i < live.length, next: () => live[i++] };
    },
    createFile(name, content) {
      const updated = clock++;
      const f = {
        _name: name,
        _content: content,
        _trashed: false,
        _updated: updated,
        getId: () => "FILE_" + name,
        getName: () => name,
        getMimeType: () => "application/json",
        getUrl: () => "https://drive.google.com/file/d/FILE_" + name + "/view",
        isTrashed: () => f._trashed,
        setTrashed: (v) => { f._trashed = !!v; },
        getBlob: () => ({ getDataAsString: () => f._content }),
        getLastUpdated: () => new Date(f._updated),
      };
      files.push(f);
      return f;
    },
  };
  return folder;
}

// 新しい export/import 系テスト用に、ストア関数群をインメモリ実装で差し替える。
function installStores(gas, init = {}) {
  const stores = {
    forms: { ...(init.forms || {}) },
    questions: { ...(init.questions || {}) },
    dashboards: { ...(init.dashboards || {}) },
    foldersForms: [...(init.foldersForms || [])],
    foldersQuestions: [...(init.foldersQuestions || [])],
    foldersDashboards: [...(init.foldersDashboards || [])],
    formUrls: {},
  };
  gas.Forms_getMapping_ = () => stores.forms;
  gas.Forms_saveMapping_ = (m) => { stores.forms = m; };
  gas.Analytics_getMapping_ = (t) => stores[t];
  gas.Analytics_saveMapping_ = (t, m) => { stores[t] = m; };
  gas.Forms_getFolders_ = () => stores.foldersForms;
  gas.Forms_saveFolders_ = (p) => { stores.foldersForms = p; };
  gas.Analytics_getFolders_ = (t) => (t === "questions" ? stores.foldersQuestions : stores.foldersDashboards);
  gas.Analytics_saveFoldersRegistry_ = (t, p) => {
    if (t === "questions") stores.foldersQuestions = p; else stores.foldersDashboards = p;
  };
  gas.AddFormUrl_ = (id, url) => { stores.formUrls[id] = url; };
  return stores;
}

test("StdFolders_remapFileUrl_: idMap にあるファイル URL を新 URL へ置換する", () => {
  const gas = loadGasContext();
  const idMap = { OLDID12345678901: { newFileId: "NEW", newUrl: "https://drive.google.com/file/d/NEW/view" } };
  const res = gas.StdFolders_remapFileUrl_("https://drive.google.com/file/d/OLDID12345678901/view", idMap);
  assert.equal(res.status, "remapped");
  assert.equal(res.value, "https://drive.google.com/file/d/NEW/view");
});

test("StdFolders_remapFileUrl_: idMap に無いファイル（標準構成外）はクリアする", () => {
  const gas = loadGasContext();
  const res = gas.StdFolders_remapFileUrl_("https://drive.google.com/file/d/UNKNOWNFILEID999/view", {});
  assert.equal(res.status, "cleared");
  assert.equal(res.value, "");
});

test("StdFolders_remapFileUrl_: 空文字は unchanged", () => {
  const gas = loadGasContext();
  const res = gas.StdFolders_remapFileUrl_("", {});
  assert.equal(res.status, "unchanged");
  assert.equal(res.value, "");
});

test("StdFolders_remapFileUrl_: スプレッドシート URL も idMap で置換する", () => {
  const gas = loadGasContext();
  const idMap = { SHEETID1234567890: { newFileId: "NEWSS", newUrl: "https://docs.google.com/spreadsheets/d/NEWSS/edit" } };
  const res = gas.StdFolders_remapFileUrl_("https://docs.google.com/spreadsheets/d/SHEETID1234567890/edit", idMap);
  assert.equal(res.status, "remapped");
  assert.equal(res.value, "https://docs.google.com/spreadsheets/d/NEWSS/edit");
});

test("StdFolders_remapFolderUrl_: folderIdMap にあるフォルダを置換、無ければクリア", () => {
  const gas = loadGasContext();
  const folderIdMap = { SRCFOLDER1234567: "https://drive.google.com/drive/folders/DESTFOLDER" };
  const ok = gas.StdFolders_remapFolderUrl_("https://drive.google.com/drive/folders/SRCFOLDER1234567", folderIdMap);
  assert.equal(ok.status, "remapped");
  assert.equal(ok.value, "https://drive.google.com/drive/folders/DESTFOLDER");

  const cleared = gas.StdFolders_remapFolderUrl_("https://drive.google.com/drive/folders/OTHERFOLDER9999", folderIdMap);
  assert.equal(cleared.status, "cleared");
  assert.equal(cleared.value, "");
});

test("StdFolders_walkFields_: ネストした children も全て訪問する", () => {
  const gas = loadGasContext();
  const schema = [
    { label: "a", children: [{ label: "a1" }, { label: "a2", children: [{ label: "a2x" }] }] },
    { label: "b" },
  ];
  const seen = [];
  gas.StdFolders_walkFields_(schema, (f) => seen.push(f.label));
  assert.deepEqual(seen.sort(), ["a", "a1", "a2", "a2x", "b"]);
});

// ---- 旧「相手の名前」剥取（formName / questionName / childFormName 撤去） ----

test("StdFolders_stripRefNames_: questions の formSources[].formName / gui.formName を剥取し formId/formPath は温存", () => {
  const gas = loadGasContext();
  const json = {
    query: {
      gui: { formId: "FID1", formPath: "01_forms/親", formName: "残骸名" },
      formSources: [
        { formId: "FID2", formPath: "01_forms/A", formName: "旧A" },
        { formId: "FID3", formPath: "01_forms/B" },
      ],
    },
  };
  const changed = gas.StdFolders_stripRefNames_(json, "questions");
  assert.equal(changed, true);
  assert.equal("formName" in json.query.gui, false, "gui.formName を剥取");
  assert.equal(json.query.gui.formId, "FID1");
  assert.equal(json.query.gui.formPath, "01_forms/親");
  assert.equal("formName" in json.query.formSources[0], false);
  assert.equal(json.query.formSources[0].formPath, "01_forms/A", "formPath は温存");
});

test("StdFolders_stripRefNames_: dashboards の cards[].questionName を剥取し questionId/questionPath は温存", () => {
  const gas = loadGasContext();
  const json = { cards: [{ questionId: "QID1", questionPath: "02_questions/Q", questionName: "旧Q" }, { questionId: "QID2", questionPath: "02_questions/R" }] };
  const changed = gas.StdFolders_stripRefNames_(json, "dashboards");
  assert.equal(changed, true);
  assert.equal("questionName" in json.cards[0], false);
  assert.equal(json.cards[0].questionPath, "02_questions/Q");
});

test("StdFolders_stripRefNames_: forms の formLink childFormName を剥取し childFormId/childFormPath は温存", () => {
  const gas = loadGasContext();
  const json = {
    schema: [
      { type: "formLink", childFormId: "CID1", childFormPath: "01_forms/子", childFormName: "旧子" },
      { type: "text", label: "無関係" },
    ],
  };
  const changed = gas.StdFolders_stripRefNames_(json, "forms");
  assert.equal(changed, true);
  assert.equal("childFormName" in json.schema[0], false);
  assert.equal(json.schema[0].childFormId, "CID1");
  assert.equal(json.schema[0].childFormPath, "01_forms/子");
});

test("StdFolders_stripRefNames_: 名前残骸が無ければ no-op（false）", () => {
  const gas = loadGasContext();
  const json = { cards: [{ questionId: "QID1", questionPath: "02_questions/Q" }] };
  assert.equal(gas.StdFolders_stripRefNames_(json, "dashboards"), false);
});

test("NFB_STD_FOLDER_NAMES / ORDER: 8 種の標準フォルダ名を網羅する", () => {
  const gas = loadGasContext();
  assert.equal(gas.NFB_STD_FOLDER_ORDER.length, 8);
  assert.equal(gas.NFB_STD_FOLDER_NAMES.forms, "01_forms");
  assert.equal(gas.NFB_STD_FOLDER_NAMES.documents, "08_documents");
  for (const key of gas.NFB_STD_FOLDER_ORDER) {
    assert.ok(gas.NFB_STD_FOLDER_NAMES[key], "missing name for " + key);
  }
  assert.equal(gas.NFB_STD_MAPPING_FILE_NAME, "_nfb_mapping.json");
});

// ---- export / import ----

test("StdFolders_exportMapping_: version 2・論理パスのみ（fileId/driveFileUrl は出さない）で返す", () => {
  const gas = loadGasContext();
  gas.StdFolders_resolveRootFolder_ = () => ({ getId: () => "ROOT1" });
  installStores(gas, {
    forms: { f1: { fileId: "FF1", driveFileUrl: "u1", title: "T1", folder: "a" } },
    questions: { q1: { fileId: "QF1", driveFileUrl: "qu1", name: "Q1", folder: "" } },
    dashboards: {},
    foldersForms: ["a", "a/b"],
  });
  const res = gas.StdFolders_exportMapping_();
  assert.equal(res.ok, true);
  assert.equal(res.mapping.type, "nfb-mapping");
  assert.equal(res.mapping.version, 2);
  assert.equal(res.mapping.sourceRootId, "ROOT1");
  // 論理パスのみ: fileId / driveFileUrl は含まれず、folder + 名前だけ。
  assert.equal(res.mapping.forms.f1.fileId, undefined, "fileId は出さない");
  assert.equal(res.mapping.forms.f1.driveFileUrl, undefined, "driveFileUrl は出さない");
  assert.equal(res.mapping.forms.f1.title, "T1");
  assert.equal(res.mapping.forms.f1.folder, "a");
  assert.equal(res.mapping.questions.q1.name, "Q1");
  assert.equal(res.mapping.questions.q1.fileId, undefined);
  assert.equal(res.mapping.questions.q1.folder, "");
  assert.deepEqual(res.mapping.folders.forms, ["a", "a/b"]);
});

test("StdFolders_importMapping_: export→import ラウンドトリップで件数が復元される", () => {
  const gas = loadGasContext();
  const doc = {
    type: "nfb-mapping", version: 1, exportedAt: "x", sourceRootId: "ROOT1",
    forms: { f1: { fileId: "FF1", driveFileUrl: "u1", title: "T1" } },
    questions: { q1: { fileId: "QF1", driveFileUrl: "qu1", name: "Q1" } },
    dashboards: { d1: { fileId: "DF1", driveFileUrl: "du1", name: "D1" } },
    folders: { forms: ["a"], questions: [], dashboards: [] },
  };
  const stores = installStores(gas, {});
  const res = gas.StdFolders_importMapping_(doc);
  assert.equal(res.ok, true);
  assert.equal(res.imported.forms, 1);
  assert.equal(res.imported.questions, 1);
  assert.equal(res.imported.dashboards, 1);
  assert.equal(res.skipped, 0);
  assert.equal(stores.forms.f1.fileId, "FF1");
  assert.equal(stores.dashboards.d1.name, "D1");
  // forms は AddFormUrl_ も更新される
  assert.equal(stores.formUrls.f1, "u1");
});

test("StdFolders_importMapping_: 同一 fileId の既存エントリはスキップ、新規のみ取り込む", () => {
  const gas = loadGasContext();
  const stores = installStores(gas, {
    forms: { existing: { fileId: "DUP", driveFileUrl: "ue", title: "E" } },
  });
  const doc = {
    type: "nfb-mapping", version: 1,
    forms: {
      dupe: { fileId: "DUP", driveFileUrl: "ud", title: "D" },   // 既存 fileId → skip
      fresh: { fileId: "NEW", driveFileUrl: "un", title: "N" },  // 新規 → import
    },
    questions: {}, dashboards: {}, folders: {},
  };
  const res = gas.StdFolders_importMapping_(doc);
  assert.equal(res.imported.forms, 1);
  assert.equal(res.skipped, 1);
  assert.ok(stores.forms.fresh, "新規エントリが取り込まれる");
  assert.ok(!stores.forms.dupe, "重複 fileId のエントリは取り込まれない");
});

test("StdFolders_importMapping_: 不正な doc は throw せず {ok:false}・version 2 は受理", () => {
  const gas = loadGasContext();
  installStores(gas, {});
  assert.equal(gas.StdFolders_importMapping_({ type: "x", version: 1 }).ok, false);
  // version 2（論理パスのみ）は受理する。中身が空でも ok:true（取込 0 件）。
  assert.equal(gas.StdFolders_importMapping_({ type: "nfb-mapping", version: 2 }).ok, true);
  // 未対応 version（3 等）は拒否。
  assert.equal(gas.StdFolders_importMapping_({ type: "nfb-mapping", version: 3 }).ok, false);
  assert.equal(gas.StdFolders_importMapping_(null).ok, false);
});

test("StdFolders_importMapping_: version 2（論理パスのみ）は folder+名前でローカル fileId を解決して取り込む", () => {
  const gas = loadGasContext();
  const stores = installStores(gas, {});
  // 論理パス → フォルダ → ファイル を返すモックアダプタ（FormsDrive_* は未ロードのため adapter ごと差し替える）。
  const fileFF = { getId: () => "LOCAL_FF1", getName: () => "T1.json", isTrashed: () => false, getUrl: () => "https://drive.google.com/file/d/LOCAL_FF1/view" };
  const folderForms = { getFiles() { let i = 0; const arr = [fileFF]; return { hasNext: () => i < arr.length, next: () => arr[i++] }; } };
  gas.StdFolders_entityAdapter_ = (kind) => ({
    nameField: kind === "forms" ? "title" : "name",
    lookupFolderForPath: (folder) => (kind === "forms" && folder === "a" ? folderForms : null),
  });
  const doc = {
    type: "nfb-mapping", version: 2,
    forms: { src_old_id: { title: "T1", folder: "a" } },        // 解決可能 → 取込
    questions: { q_missing: { name: "QX", folder: "z" } },       // 解決不能 → 未取込（空）
    dashboards: {}, folders: {},
  };
  const res = gas.StdFolders_importMapping_(doc);
  assert.equal(res.ok, true);
  assert.equal(res.imported.forms, 1);
  // 解決後ローカル fileId をキー兼 fileId 値で登録（コピー元 id は捨てる）。
  assert.ok(stores.forms.LOCAL_FF1, "解決後 fileId をキーに登録");
  assert.equal(stores.forms.LOCAL_FF1.fileId, "LOCAL_FF1");
  assert.equal(stores.forms.LOCAL_FF1.title, "T1");
  assert.ok(!stores.forms.src_old_id, "コピー元 id キーは残さない");
  // forms は AddFormUrl_ も解決後 fileId キーで更新される。
  assert.equal(stores.formUrls.LOCAL_FF1, "https://drive.google.com/file/d/LOCAL_FF1/view");
  // 解決不能（"" 扱い）は未取込で errors に積む（"-" は入れない）。
  assert.equal(res.imported.questions, 0);
  assert.ok(res.errors.some((e) => e.section === "questions"), "未解決は errors に記録");
});

test("StdFolders_importMappingFromSource_: URL 空 → ルートの最新 .json を読む", () => {
  const gas = loadGasContext();
  const root = makeMockFolder("DESTROOT");
  // 古い方を先に作成（無関係 JSON）→ 新しい方に有効な mapping を作成
  root.createFile("old.json", JSON.stringify({ type: "nfb-mapping", version: 1, forms: { old: { fileId: "OLD" } }, questions: {}, dashboards: {}, folders: {} }));
  root.createFile(gas.NFB_STD_MAPPING_FILE_NAME, JSON.stringify({ type: "nfb-mapping", version: 1, forms: { neo: { fileId: "NEW" } }, questions: {}, dashboards: {}, folders: {} }));
  gas.StdFolders_resolveRootFolder_ = () => root;
  const stores = installStores(gas, {});

  const res = gas.StdFolders_importMappingFromSource_({ url: "" });
  assert.equal(res.ok, true);
  assert.equal(res.imported.forms, 1);
  assert.ok(stores.forms.neo, "最新 .json（_nfb_mapping.json）の内容が取り込まれる");
  assert.ok(!stores.forms.old, "古い .json は読まれない");
});

test("StdFolders_importMappingFromSource_: URL 指定 → その Drive ファイルを読む", () => {
  const gas = loadGasContext();
  const doc = { type: "nfb-mapping", version: 1, forms: { u: { fileId: "UF" } }, questions: {}, dashboards: {}, folders: {} };
  gas.ExtractFileIdFromUrl_ = () => "FID";
  gas.DriveApp = { getFileById: () => ({ getBlob: () => ({ getDataAsString: () => JSON.stringify(doc) }) }) };
  const stores = installStores(gas, {});

  const res = gas.StdFolders_importMappingFromSource_({ url: "https://drive.google.com/file/d/FID/view" });
  assert.equal(res.ok, true);
  assert.equal(res.imported.forms, 1);
  assert.ok(stores.forms.u);
});

test("StdFolders_importMappingFromSource_: URL 不正は {ok:false}", () => {
  const gas = loadGasContext();
  gas.ExtractFileIdFromUrl_ = () => null;
  installStores(gas, {});
  const res = gas.StdFolders_importMappingFromSource_({ url: "not-a-url" });
  assert.equal(res.ok, false);
});

// ---- copy 同梱 ----

test("StdFolders_buildCopiedMappingDoc_: version 2・論理パスのみ（fileId 無し）、idMap 未収載は除外する", () => {
  const gas = loadGasContext();
  installStores(gas, {
    forms: {
      keep: { fileId: "SRC1", driveFileUrl: "su1", title: "K", folder: "営業" },
      drop: { fileId: "SRC9", driveFileUrl: "su9", title: "D" }, // idMap 未収載 → 除外
    },
    questions: { q: { fileId: "SRCQ", driveFileUrl: "suq", name: "Q" } },
    dashboards: {},
  });
  const idMap = {
    SRC1: { newFileId: "DST1", newUrl: "https://drive.google.com/file/d/DST1/view" },
    SRCQ: { newFileId: "DSTQ", newUrl: "https://drive.google.com/file/d/DSTQ/view" },
  };
  const doc = gas.StdFolders_buildCopiedMappingDoc_(idMap, "SRCROOT");
  assert.equal(doc.type, "nfb-mapping");
  assert.equal(doc.version, 2);
  assert.equal(doc.sourceRootId, "SRCROOT");
  // 論理パスのみ: コピー先/コピー元いずれの fileId も書き出さない。
  assert.equal(doc.forms.keep.fileId, undefined, "fileId は出さない");
  assert.equal(doc.forms.keep.driveFileUrl, undefined, "driveFileUrl は出さない");
  assert.equal(doc.forms.keep.title, "K");
  assert.equal(doc.forms.keep.folder, "営業");
  assert.ok(!doc.forms.drop, "idMap 未収載のエントリは除外される");
  assert.equal(doc.questions.q.name, "Q");
  assert.equal(doc.questions.q.fileId, undefined);
  assert.equal(doc.questions.q.folder, "");
});

test("StdFolders_writeMappingFile_: destRoot に _nfb_mapping.json を 1 件作る", () => {
  const gas = loadGasContext();
  const dest = makeMockFolder("DEST");
  const doc = { type: "nfb-mapping", version: 1, forms: { a: { fileId: "DST1" } } };
  gas.StdFolders_writeMappingFile_(dest, doc);
  assert.equal(dest._files.length, 1);
  assert.equal(dest._files[0]._name, gas.NFB_STD_MAPPING_FILE_NAME);
  const written = JSON.parse(dest._files[0]._content);
  assert.equal(written.forms.a.fileId, "DST1");
});

// DriveApp.getFileById を差し替えて、JSON 本体を読み書きできる 1 ファイルを用意する。
function installSingleFile(gas, fileId, content) {
  const state = { content };
  gas.DriveApp = {
    getFileById(id) {
      if (id !== fileId) throw new Error("not found: " + id);
      return {
        getId: () => fileId,
        getBlob: () => ({ getDataAsString: () => state.content }),
        setContent: (c) => { state.content = c; },
      };
    },
  };
  return state;
}

test("StdFolders_rewireDashboardFile_: questionId を物理全消去し questionPath を保持（コピー対象外は未解決として数える）", () => {
  const gas = loadGasContext();
  const before = {
    cards: [
      { id: "c1", questionId: "Q_OLD_KEPT", questionName: "売上", questionPath: "02_questions/売上" },
      { id: "c2", questionId: "Q_OLD_MISSING", questionName: "離脱率", questionPath: "02_questions/離脱率" },
    ],
  };
  const state = installSingleFile(gas, "DASH1", JSON.stringify(before));
  // Q_OLD_KEPT のみコピー対象（idMap に収載）。Q_OLD_MISSING は構成外。
  const idMap = { Q_OLD_KEPT: { newFileId: "Q_NEW_KEPT", newUrl: "https://drive.google.com/file/d/Q_NEW_KEPT/view" } };
  const unresolved = gas.StdFolders_rewireDashboardFile_("DASH1", idMap);

  assert.equal(unresolved, 1, "idMap に無い 1 件だけ未解決（コピー先で再解決不能）として数える");
  const after = JSON.parse(state.content);
  assert.equal(after.id, undefined);
  // 物理 ID は全消去（コピー元 fileId を残さない）。論理パス（questionPath）は復旧アンカーとして温存。
  assert.equal(after.cards[0].questionId, "", "収載済みも物理は消去（コピー先で *Path から再解決）");
  assert.equal(after.cards[0].questionPath, "02_questions/売上", "論理パスは温存");
  assert.equal(after.cards[1].questionId, "", "未収載も物理は消去");
  assert.equal(after.cards[1].questionPath, "02_questions/離脱率", "未収載でも論理パスは保持");
  assert.equal(after.cards[1].questionName, "離脱率");
});

test("StdFolders_rewireQuestionFile_: formId を物理全消去し formPath を保持（コピー対象外は未解決数に数える）", () => {
  const gas = loadGasContext();
  const before = {
    query: {
      mode: "gui",
      gui: { formId: "F_OLD", formName: "売上フォーム", formPath: "01_forms/売上" },
      formSources: [
        { formId: "F_OLD", variant: "data", formPath: "01_forms/売上" },
        { formId: "F_OUT", variant: "view", formPath: "01_forms/外" },
      ],
    },
  };
  const state = installSingleFile(gas, "Q1", JSON.stringify(before));
  const idMap = { F_OLD: { newFileId: "F_NEW", newUrl: "https://drive.google.com/file/d/F_NEW/view" } };
  const unresolved = gas.StdFolders_rewireQuestionFile_("Q1", idMap);

  assert.equal(unresolved, 1, "idMap に無い F_OUT を未解決として数える");
  const after = JSON.parse(state.content);
  assert.equal(after.id, undefined, "id は埋め込まない");
  assert.equal(after.query.gui.formId, "", "物理全消去（コピー先で formPath から再解決）");
  assert.equal(after.query.gui.formPath, "01_forms/売上", "論理パスは温存");
  assert.equal(after.query.formSources[0].formId, "", "収載済みも物理消去");
  assert.equal(after.query.formSources[1].formId, "", "未収載も物理消去");
  assert.equal(after.query.formSources[1].formPath, "01_forms/外", "未収載でも論理パスは保持");
});

test("StdFolders_rewireFormFile_: childFormId / spreadsheetId を物理全消去し各 *Path を温存（ネスト含む）", () => {
  const gas = loadGasContext();
  const before = {
    settings: {
      spreadsheetId: "https://docs.google.com/spreadsheets/d/SHEETID1234567890/edit",
      spreadsheetPath: "04/売上集計",
    },
    schema: [
      { id: "s1", type: "section", children: [
        { id: "l1", type: "formLink", childFormId: "CF_KEPT", childFormPath: "01_forms/子A" },
        { id: "l2", type: "formLink", childFormId: "CF_MISSING", childFormPath: "01_forms/子B" },
      ] },
      { id: "t1", type: "text", label: "名前" },
    ],
  };
  const state = installSingleFile(gas, "FORM1", JSON.stringify(before));
  const idMap = {
    CF_KEPT: { newFileId: "CF_NEW", newUrl: "https://drive.google.com/file/d/CF_NEW/view" },
    SHEETID1234567890: { newFileId: "NEWSS", newUrl: "https://docs.google.com/spreadsheets/d/NEWSS/edit" },
  };
  const res = gas.StdFolders_rewireFormFile_("FORM1", idMap, {}, false);

  assert.equal(res.cleared, 0, "外部アクション以外のクリアは cleared に数えない");
  assert.equal(res.unresolved, 1, "未収載の子フォームリンク 1 件を未解決として数える");
  const after = JSON.parse(state.content);
  // ネスト配下（section.children）の formLink も walkFields の再帰で物理消去される。
  const links = after.schema[0].children;
  assert.equal(links[0].childFormId, "", "収載済みも物理消去（コピー先で childFormPath から再解決）");
  assert.equal(links[0].childFormPath, "01_forms/子A", "論理パスは温存");
  assert.equal(links[1].childFormId, "", "未収載も物理消去");
  assert.equal(links[1].childFormPath, "01_forms/子B", "未収載でも論理パスは保持");
  // spreadsheet は物理消去し論理（spreadsheetPath）を温存（コピー先で再解決）。
  assert.equal(after.settings.spreadsheetId, "", "spreadsheetId は物理消去");
  assert.equal(after.settings.spreadsheetPath, "04/売上集計", "spreadsheetPath は温存");
});

test("StdFolders_rewireFormFile_: settings.spreadsheetPath は触らず保持し spreadsheetId は物理消去", () => {
  const gas = loadGasContext();
  const before = {
    settings: { spreadsheetPath: "売上/集計2026", spreadsheetId: "https://docs.google.com/spreadsheets/d/SRCSS/edit" },
    schema: [{ id: "t1", type: "text", label: "名前" }],
  };
  const state = installSingleFile(gas, "FORM_PATH", JSON.stringify(before));
  const res = gas.StdFolders_rewireFormFile_("FORM_PATH", {}, {}, false);
  assert.equal(res.cleared, 0, "spreadsheet 物理消去は cleared に数えない（論理で再解決可能）");
  assert.equal(res.unresolved, 0);
  const after = JSON.parse(state.content);
  assert.equal(after.settings.spreadsheetPath, "売上/集計2026", "論理パスは相対構造のまま保持（コピー先で再解決）");
  assert.equal(after.settings.spreadsheetId, "", "物理 spreadsheetId はコピー元を指さないよう消去");
});

test("StdFolders_rewireFormFile_: フォームレベル standardPrintTemplateUrl を物理消去し standardPrintTemplatePath を温存", () => {
  const gas = loadGasContext();
  const kept = {
    settings: {
      standardPrintTemplateUrl: "https://docs.google.com/document/d/TPL_OLD/edit",
      standardPrintTemplatePath: "05/標準様式",
    },
    schema: [
      { id: "p1", type: "printTemplate", printTemplateAction: { useCustomTemplate: true, templateUrl: "https://docs.google.com/document/d/FIELD_TPL/edit", templatePath: "05/個別様式" } },
    ],
  };
  const stateKept = installSingleFile(gas, "FORM_TPL_KEPT", JSON.stringify(kept));
  const idMap = { TPL_OLD: { newFileId: "TPL_NEW", newUrl: "https://docs.google.com/document/d/TPL_NEW/edit" } };
  const resKept = gas.StdFolders_rewireFormFile_("FORM_TPL_KEPT", idMap, {}, false);
  assert.equal(resKept.cleared, 0, "印刷様式の物理消去は cleared に数えない（論理で再解決可能）");
  const afterKept = JSON.parse(stateKept.content);
  assert.equal(afterKept.settings.standardPrintTemplateUrl, "", "フォームレベル様式 URL は物理消去");
  assert.equal(afterKept.settings.standardPrintTemplatePath, "05/標準様式", "論理パスは温存");
  assert.equal(afterKept.schema[0].printTemplateAction.templateUrl, "", "field 個別様式 URL も物理消去");
  assert.equal(afterKept.schema[0].printTemplateAction.templatePath, "05/個別様式", "field の論理パスは温存");
});

// ---------------------------------------------------------------------------
// コピー先 初回解決ゲート: 論理パス（*Path）→ 物理（fileId / URL）再解決（Phase 5）
// ---------------------------------------------------------------------------

test("StdFolders_reresolveRefsFromLogical_: 空/死んだエンティティ id を *Path からローカル fileId へ貼り直す", () => {
  const gas = loadGasContext();
  const json = {
    cards: [
      { id: "c1", questionId: "", questionPath: "02_questions/売上" },        // 物理消去済 → 再解決対象
      { id: "c2", questionId: "ALIVE", questionPath: "02_questions/生存" },   // 物理生存 → 触らない
      { id: "c3", questionId: "", questionPath: "" },                         // *Path 無し → 据え置き
    ],
  };
  const written = {};
  gas.Nfb_readJsonFileById_ = () => ({ file: { _id: "DASH" }, json });
  gas.Nfb_writeJsonToFile_ = (file, j) => { written.json = j; };
  gas.StdFolders_isFileIdAlive_ = (id) => id === "ALIVE";
  gas.StdFolders_entityAdapter_ = () => ({ baseFolderOrNull: () => ({}), lookupFolderForPath: () => null });
  gas.StdFolders_recoverRefByPath_ = (adapter, brokenId, path) => (path === "02_questions/売上" ? "Q_LOCAL_NEW" : null);

  const changed = gas.StdFolders_reresolveRefsFromLogical_("DASH", "dashboards");
  assert.equal(changed, true);
  assert.equal(written.json.cards[0].questionId, "Q_LOCAL_NEW", "空 id を *Path からローカル fileId へ");
  assert.equal(written.json.cards[1].questionId, "ALIVE", "物理生存はそのまま");
  assert.equal(written.json.cards[2].questionId, "", "*Path 無しは据え置き");
});

test("StdFolders_reresolveFormPhysicalFromLogical_: spreadsheetId を spreadsheetPath から再解決", () => {
  const gas = loadGasContext();
  gas.Model_normalizeSpreadsheetId_ = (v) => (v || "");
  gas.StdFolders_isFileIdAlive_ = () => false;   // 物理は空/死
  gas.StdFolders_resolveSpreadsheetPathToFileId_ = (p) => (p === "04/売上集計" ? "SS_LOCAL" : "");
  const json = { settings: { spreadsheetId: "", spreadsheetPath: "04/売上集計" }, schema: [] };
  const changed = gas.StdFolders_reresolveFormPhysicalFromLogical_(json);
  assert.equal(changed, true);
  assert.equal(json.settings.spreadsheetId, "SS_LOCAL", "spreadsheetPath からローカル SS へ再解決");
});

test("StdFolders_reresolveTemplateUrlFromPath_: 空 templateUrl を templatePath から URL 再解決（物理生存は no-op）", () => {
  const gas = loadGasContext();
  gas.StdFolders_isFileIdAlive_ = (id) => id === "ALIVE_TPL";
  gas.StdFolders_resolvePathToFileId_ = (key, p) => (p === "05/様式" ? "TPL_LOCAL" : "");
  gas.DriveApp = { getFileById: (id) => ({ getUrl: () => "https://docs.google.com/document/d/" + id + "/edit" }) };

  // 空 URL + path → 再解決。
  const holderEmpty = { templateUrl: "", templatePath: "05/様式" };
  assert.equal(gas.StdFolders_reresolveTemplateUrlFromPath_(holderEmpty, "templateUrl", "templatePath"), true);
  assert.equal(holderEmpty.templateUrl, "https://docs.google.com/document/d/TPL_LOCAL/edit");

  // 物理生存 URL → 触らない（physical-first）。
  gas.Forms_parseGoogleDriveUrl_ = () => ({ type: "file", id: "ALIVE_TPL" });
  const holderAlive = { templateUrl: "https://docs.google.com/document/d/ALIVE_TPL/edit", templatePath: "05/様式" };
  assert.equal(gas.StdFolders_reresolveTemplateUrlFromPath_(holderAlive, "templateUrl", "templatePath"), false);
  assert.equal(holderAlive.templateUrl, "https://docs.google.com/document/d/ALIVE_TPL/edit", "物理生存は据え置き");
});

// ---------------------------------------------------------------------------
// 04_spreadsheets 配下の論理パス ⇄ fileId 解決
// ---------------------------------------------------------------------------

test("StdFolders_resolveSpreadsheetPathToFileId_: 04_spreadsheets 配下を walk して fileId を解決（拡張子なし葉）", () => {
  const gas = loadGasContext();
  const rootSheet = { getName: () => "直下シート", getId: () => "SS_ROOT", isTrashed: () => false };
  const salesSheet = { getName: () => "集計2026", getId: () => "SS_RESOLVED", isTrashed: () => false };
  const salesFolder = {
    getFiles() { let i = 0; const arr = [salesSheet]; return { hasNext: () => i < arr.length, next: () => arr[i++] }; },
  };
  const base = {
    getFiles() { let i = 0; const arr = [rootSheet]; return { hasNext: () => i < arr.length, next: () => arr[i++] }; },
  };
  // 汎用版 StdFolders_resolvePathToFileId_ は base を StdFolders_autoFileFolderOrNull_(key) から得る
  // （spreadsheetsBaseFolderOrNull_ もこれに委譲）。spreadsheets キーのときだけ base を返す。
  gas.StdFolders_autoFileFolderOrNull_ = (key) => (key === "spreadsheets" ? base : null);
  gas.FormsDrive_childFolderByName_ = (parent, name) => (parent === base && name === "売上" ? salesFolder : null);

  assert.equal(gas.StdFolders_resolveSpreadsheetPathToFileId_("売上/集計2026"), "SS_RESOLVED");
  assert.equal(gas.StdFolders_resolveSpreadsheetPathToFileId_("直下シート"), "SS_ROOT", "base 直下も解決");
  assert.equal(gas.StdFolders_resolveSpreadsheetPathToFileId_("売上/存在しない"), "", "葉が無ければ空");
  assert.equal(gas.StdFolders_resolveSpreadsheetPathToFileId_("無いフォルダ/集計2026"), "", "途中フォルダが無ければ空");
  assert.equal(gas.StdFolders_resolveSpreadsheetPathToFileId_(""), "", "空パスは空");
});

// ---------------------------------------------------------------------------
// 取り込みの move 優先化（Fix 3: コピーで fileId が変わり参照が孤立するのを防ぐ）
// ---------------------------------------------------------------------------

// ルート/サブフォルダ/ファイルを備えた最小 Drive ツリーのモック。
function makeDriveTreeForEnsure() {
  const ops = { moved: [], copied: [] };
  const sub = {
    getId: () => "SUB_FORMS",
    getName: () => "01_forms",
    getUrl: () => "https://drive.google.com/drive/folders/SUB_FORMS",
  };
  const root = {
    getId: () => "ROOT",
    getFoldersByName(name) {
      const matches = name === "01_forms" ? [sub] : [];
      let i = 0;
      return { hasNext: () => i < matches.length, next: () => matches[i++] };
    },
    createFolder() { throw new Error("should not create"); },
  };
  const files = {};
  const makeFile = (id, parentId) => ({
    getId: () => id,
    getName: () => id + ".json",
    getUrl: () => "https://drive.google.com/file/d/" + id + "/view",
    isTrashed: () => false,
    getParents() {
      const ps = parentId ? [{ getId: () => parentId, getParents: () => ({ hasNext: () => false, next: () => null }) }] : [];
      let i = 0;
      return { hasNext: () => i < ps.length, next: () => ps[i++] };
    },
    moveTo(dest) { ops.moved.push({ id, to: dest.getId() }); },
    makeCopy(name, dest) { ops.copied.push({ id, to: dest.getId() }); return makeFile("COPY_" + id, dest.getId()); },
  });
  const DriveApp = { getFileById: (id) => files[id] || (files[id] = makeFile(id, "OTHER")) };
  return { DriveApp, root, ops, makeFile, files };
}

test("StdFolders_ensureFileInStdFolder_: 構成外ファイルは moveTo で fileId 保持（makeCopy しない）", () => {
  const gas = loadGasContext();
  const tree = makeDriveTreeForEnsure();
  gas.DriveApp = tree.DriveApp;
  gas.StdFolders_resolveRootFolder_ = () => tree.root;

  const res = gas.StdFolders_ensureFileInStdFolder_("FILE_X", "forms");
  assert.equal(res.fileId, "FILE_X", "moveTo なので fileId は不変");
  assert.equal(tree.ops.moved.length, 1, "moveTo が呼ばれる");
  assert.equal(tree.ops.moved[0].to, "SUB_FORMS");
  assert.equal(tree.ops.copied.length, 0, "makeCopy は呼ばれない");
});

test("StdFolders_ensureFileInStdFolder_: moveTo 不可なら makeCopy にフォールバック（新 fileId）", () => {
  const gas = loadGasContext();
  const tree = makeDriveTreeForEnsure();
  gas.DriveApp = tree.DriveApp;
  gas.StdFolders_resolveRootFolder_ = () => tree.root;
  // moveTo が例外（他者所有等）になるファイルを登録。
  tree.files.FILE_Y = (function () {
    const f = tree.makeFile("FILE_Y", "OTHER");
    f.moveTo = () => { throw new Error("permission"); };
    return f;
  })();

  const res = gas.StdFolders_ensureFileInStdFolder_("FILE_Y", "forms");
  assert.equal(tree.ops.copied.length, 1, "makeCopy にフォールバック");
  assert.equal(res.fileId, "COPY_FILE_Y", "コピー先の新 fileId を返す");
});

test("StdFolders_ensureFileInStdFolder_: 既に構成内（サブフォルダ配下）なら no-op", () => {
  const gas = loadGasContext();
  const tree = makeDriveTreeForEnsure();
  gas.DriveApp = tree.DriveApp;
  gas.StdFolders_resolveRootFolder_ = () => tree.root;
  // 親が SUB_FORMS のファイル（＝構成内）。
  tree.files.FILE_IN = tree.makeFile("FILE_IN", "SUB_FORMS");

  const res = gas.StdFolders_ensureFileInStdFolder_("FILE_IN", "forms");
  assert.equal(res.fileId, "FILE_IN");
  assert.equal(tree.ops.moved.length, 0, "移動しない");
  assert.equal(tree.ops.copied.length, 0, "コピーしない");
});

// ---------------------------------------------------------------------------
// カテゴリ選択の正規化（StdFolders_normalizeCategorySelection_）
// ---------------------------------------------------------------------------

test("StdFolders_normalizeCategorySelection_: categories 未指定なら全 8 キー true（後方互換）", () => {
  const gas = loadGasContext();
  const sel = gas.StdFolders_normalizeCategorySelection_(undefined, undefined);
  assert.equal(Object.keys(sel).length, 8);
  for (const key of gas.NFB_STD_FOLDER_ORDER) assert.equal(sel[key], true, key);
});

test("StdFolders_normalizeCategorySelection_: categories 未指定 + copyExternalActions=false は externalActions のみ false（旧クライアント互換）", () => {
  const gas = loadGasContext();
  const sel = gas.StdFolders_normalizeCategorySelection_(undefined, false);
  assert.equal(sel.externalActions, false);
  assert.equal(sel.forms, true);
  assert.equal(sel.documents, true);
});

test("StdFolders_normalizeCategorySelection_: 一部キー指定 → 指定外キーは true（後方互換）", () => {
  const gas = loadGasContext();
  const sel = gas.StdFolders_normalizeCategorySelection_({ forms: true, questions: false }, undefined);
  assert.equal(sel.forms, true);
  assert.equal(sel.questions, false);
  assert.equal(sel.dashboards, true, "未指定キーは true");
  assert.equal(sel.documents, true);
});

test("StdFolders_normalizeCategorySelection_: categories 明示時は copyExternalActions 引数を無視する", () => {
  const gas = loadGasContext();
  // categories.externalActions=false なのに copyExternalActions=true が来ても false を維持する。
  const sel = gas.StdFolders_normalizeCategorySelection_({ externalActions: false }, true);
  assert.equal(sel.externalActions, false);
});

test("StdFolders_normalizeCategorySelection_: 文字列 'true'/'false' も bool 化する", () => {
  const gas = loadGasContext();
  const sel = gas.StdFolders_normalizeCategorySelection_({ forms: "false", questions: "true" }, undefined);
  assert.equal(sel.forms, false);
  assert.equal(sel.questions, true);
});

// ---------------------------------------------------------------------------
// 構成コピー本体（StdFolders_copy_）の統合テスト
// ---------------------------------------------------------------------------

const COPY_SS_ID = "SS1ID0000000001";
const COPY_SS_URL = "https://docs.google.com/spreadsheets/d/" + COPY_SS_ID + "/edit";
const COPY_DEST_URL = "https://drive.google.com/drive/folders/DESTROOT";

// 全 8 カテゴリに 1 ファイルずつ持つソース構成。
// フォームは spreadsheet 参照と外部アクション URL を持ち、Question→Form / Dashboard→Question の
// リンクを張る（再配線・クリア挙動の検証用）。
function fullSrcSpec() {
  return {
    forms: [{ id: "F1", content: { settings: { spreadsheetId: COPY_SS_URL }, schema: [{ label: "f", externalAction: { url: "https://script.google.com/macros/s/AAA/exec" } }] } }],
    questions: [{ id: "Q1", content: { query: { mode: "gui", gui: { formId: "F1", formName: "F" }, formSources: [{ formId: "F1" }] } } }],
    dashboards: [{ id: "D1", content: { cards: [{ id: "c1", questionId: "Q1", questionName: "Q" }] } }],
    spreadsheets: [{ id: COPY_SS_ID, content: "spreadsheet-binary" }],
    report_templates: [{ id: "T1", content: "doc" }],
    upload: [{ id: "U1", content: "blob" }],
    externalActions: [{ id: "E1", content: { url: "x" } }],
    documents: [{ id: "DOC1", content: "doc" }],
  };
}

// StdFolders_copy_ を駆動するための最小 Drive 環境を gas コンテキストへ差し込む。
// - src ルート: 各標準フォルダに srcSpec のファイルを持つ
// - dest ルート: getFoldersByName / createFolder / createFile を備え、ensureAllSubfolders_ で
//   8 フォルダが lazy 作成される
// - DriveApp.getFileById: makeCopy で複製した JSON ファイルを読み書きできる（再配線用）
// - SpreadsheetApp.openById: 12 行目以降クリアの呼び出しを記録する
function makeCopyEnv(gas, srcSpec) {
  const registry = {};          // fileId -> file（DriveApp.getFileById 用）
  const copies = [];            // makeCopy 記録: { srcId, newId, toKey }
  const clearedSpreadsheets = []; // StdFolders_clearSpreadsheetData_ が開いた spreadsheetId
  const clearedRanges = [];     // クリアした range（row 起点の検証用）
  const NAMES = gas.NFB_STD_FOLDER_NAMES;

  function makeFile(id, name, contentStr) {
    const f = {
      _id: id, _name: name, _content: contentStr, _trashed: false,
      getId: () => id,
      getName: () => name,
      getUrl: () => "https://drive.google.com/file/d/" + id + "/view",
      isTrashed: () => f._trashed,
      getBlob: () => ({ getDataAsString: () => f._content }),
      setContent: (c) => { f._content = c; },
      makeCopy(newName, destFolder) {
        const newId = "COPY_" + id;
        const nf = makeFile(newId, newName, f._content);
        copies.push({ srcId: id, newId: newId, toKey: destFolder._key });
        destFolder._files.push(nf);
        return nf;
      },
    };
    registry[id] = f;
    return f;
  }

  // src フォルダ（ネスト対応）。node = { files: [{id,content}], folders: { name: node } }。
  // 後方互換: 配列はファイルのみ（folders 無し）として正規化する。
  function makeSrcFolder(id, name, rawNode) {
    const node = Array.isArray(rawNode) ? { files: rawNode, folders: {} } : (rawNode || {});
    const fileObjs = (node.files || []).map((spec) => {
      const contentStr = typeof spec.content === "string" ? spec.content : JSON.stringify(spec.content);
      return makeFile(spec.id, spec.id + ".json", contentStr);
    });
    const childFolders = Object.keys(node.folders || {}).map((childName) =>
      makeSrcFolder(id + "__" + childName, childName, node.folders[childName]));
    return {
      _name: name, _files: fileObjs,
      getId: () => id,
      getName: () => name,
      getUrl: () => "https://drive.google.com/drive/folders/" + id,
      getFiles() {
        const live = fileObjs.slice();
        let i = 0;
        return { hasNext: () => i < live.length, next: () => live[i++] };
      },
      getFolders() {
        const live = childFolders.slice();
        let i = 0;
        return { hasNext: () => i < live.length, next: () => live[i++] };
      },
    };
  }

  // dest フォルダ（ネスト対応）。get-or-create で子フォルダを再現し makeCopy 先になる。
  // _key は属する標準カテゴリ（copies.toKey 用）。ネスト配下も同カテゴリとして数える。
  function makeDestFolder(id, name, key) {
    const children = {}; // childName -> folder
    const sub = {
      _key: key, _name: name, _files: [],
      getId: () => id,
      getUrl: () => "https://drive.google.com/drive/folders/" + id,
      getFoldersByName(n) {
        const matches = children[n] ? [children[n]] : [];
        let i = 0;
        return { hasNext: () => i < matches.length, next: () => matches[i++] };
      },
      createFolder(n) {
        const child = makeDestFolder(id + "__" + n, n, key);
        children[n] = child;
        return child;
      },
      getFiles() {
        const live = sub._files.slice();
        let i = 0;
        return { hasNext: () => i < live.length, next: () => live[i++] };
      },
    };
    return sub;
  }

  // src サブフォルダ（物理名キー）。
  const srcSubs = {};
  Object.keys(srcSpec || {}).forEach((key) => {
    const name = NAMES[key];
    srcSubs[name] = makeSrcFolder("SRC_FOLDER_" + key, name, srcSpec[key]);
  });

  const srcRoot = {
    getId: () => "SRCROOT",
    getFoldersByName(name) {
      const matches = srcSubs[name] ? [srcSubs[name]] : [];
      let i = 0;
      return { hasNext: () => i < matches.length, next: () => matches[i++] };
    },
  };

  const destSubs = {};          // 物理名キー
  const destCreatedFiles = [];  // destRoot.createFile（_nfb_mapping.json）
  const destRoot = {
    getId: () => "DESTROOT",
    getUrl: () => COPY_DEST_URL,
    getFoldersByName(name) {
      const matches = destSubs[name] ? [destSubs[name]] : [];
      let i = 0;
      return { hasNext: () => i < matches.length, next: () => matches[i++] };
    },
    createFolder(name) {
      let key = name;
      for (const k of gas.NFB_STD_FOLDER_ORDER) { if (NAMES[k] === name) { key = k; break; } }
      const sub = makeDestFolder("DEST_FOLDER_" + key, name, key);
      destSubs[name] = sub;
      return sub;
    },
    createFile(name, content) {
      destCreatedFiles.push({ name: name, content: content });
      return { getId: () => "DESTFILE_" + name, getName: () => name };
    },
  };

  gas.DriveApp = {
    getFileById(id) {
      if (registry[id]) return registry[id];
      throw new Error("not found: " + id);
    },
    getFolderById(id) { return { getId: () => id, isTrashed: () => false }; },
  };
  gas.NFB_DATA_START_ROW = 12;
  gas.StdFolders_resolveRootFolder_ = () => srcRoot;
  gas.nfbResolveFolderFromInput_ = () => destRoot;
  gas.StdFolders_copyAppsScriptBody_ = () => ({ ok: true, reason: "" });
  const uploadPhysicalScanned = []; // StdFolders_clearUploadPhysicalInSpreadsheet_ が getValues した spreadsheetId
  gas.SpreadsheetApp = {
    openById(id) {
      const sheet = {
        getLastRow: () => 20,
        getLastColumn: () => 5,
        getRange: (row, col, numRows, numCols) => ({
          // 全データクリア（!copyData 経路）。clearContent が呼ばれたときだけ記録する。
          clearContent: () => {
            clearedSpreadsheets.push(id);
            clearedRanges.push({ id: id, row: row, col: col, numRows: numRows, numCols: numCols });
          },
          // アップロード物理クリア（copyData=true 経路）。セル走査で getValues/setValues を使う。
          getValues: () => {
            uploadPhysicalScanned.push(id);
            return Array.from({ length: numRows }, () => Array.from({ length: numCols }, () => ""));
          },
          setValues: () => {},
        }),
      };
      return { getSheets: () => [sheet] };
    },
  };

  return { srcRoot, destRoot, registry, copies, clearedSpreadsheets, clearedRanges, uploadPhysicalScanned, destSubs, srcSubs, destCreatedFiles };
}

test("StdFolders_copy_: categories 未指定なら全カテゴリを複製しフォルダも全作成（後方互換）", () => {
  const gas = loadGasContext();
  const env = makeCopyEnv(gas, fullSrcSpec());
  const res = gas.StdFolders_copy_({ destRootUrl: COPY_DEST_URL, rebuildMapping: false });
  assert.equal(res.ok, true);
  for (const key of gas.NFB_STD_FOLDER_ORDER) {
    assert.equal(res.summary[key], 1, key + " が複製される");
    assert.ok(env.destSubs[gas.NFB_STD_FOLDER_NAMES[key]], key + " フォルダが作成される");
  }
});

test("StdFolders_copy_: 旧クライアント互換（copyExternalActions=false, categories 無し）は 07 を除外、フォルダは作成", () => {
  const gas = loadGasContext();
  const env = makeCopyEnv(gas, fullSrcSpec());
  const res = gas.StdFolders_copy_({ destRootUrl: COPY_DEST_URL, copyExternalActions: false, rebuildMapping: false });
  assert.equal(res.summary.externalActions, 0, "externalActions は複製されない");
  assert.equal(res.summary.forms, 1);
  assert.equal(env.copies.filter((c) => c.toKey === "externalActions").length, 0);
  assert.ok(env.destSubs["07_external_actions"], "07 フォルダ自体は作成される");
});

test("StdFolders_copy_: 未選択カテゴリもフォルダは作成され中身は空（documents:false）", () => {
  const gas = loadGasContext();
  const env = makeCopyEnv(gas, fullSrcSpec());
  const res = gas.StdFolders_copy_({ destRootUrl: COPY_DEST_URL, categories: { documents: false }, rebuildMapping: false });
  assert.equal(res.summary.documents, 0);
  assert.ok(env.destSubs["08_documents"], "08_documents フォルダは作成される");
  assert.equal(env.copies.filter((c) => c.toKey === "documents").length, 0, "documents のファイルは複製されない");
  assert.equal(res.summary.forms, 1, "未指定キー（forms）は複製される");
});

test("StdFolders_copy_: spreadsheets 除外でファイル非複製・フォームの spreadsheet 物理は消去（論理は温存）", () => {
  const gas = loadGasContext();
  const env = makeCopyEnv(gas, fullSrcSpec());
  const res = gas.StdFolders_copy_({ destRootUrl: COPY_DEST_URL, categories: { spreadsheets: false }, rebuildMapping: false });
  assert.equal(res.summary.spreadsheets, 0);
  assert.equal(env.copies.filter((c) => c.toKey === "spreadsheets").length, 0);
  const formJson = JSON.parse(env.registry["COPY_F1"]._content);
  // 物理 spreadsheetId は常に消去（コピー元 SS を指さない）。論理（spreadsheetPath）があればコピー先で再解決。
  assert.equal(formJson.settings.spreadsheetId, "", "spreadsheet 物理参照は消去される");
});

test("StdFolders_copy_: questions 除外で dashboard の questionId は空にし論理パスを保持・未解決として数える", () => {
  const gas = loadGasContext();
  const env = makeCopyEnv(gas, fullSrcSpec());
  const res = gas.StdFolders_copy_({ destRootUrl: COPY_DEST_URL, categories: { questions: false }, rebuildMapping: false });
  assert.equal(res.summary.questions, 0);
  assert.equal(res.unresolvedQuestionLinks, 1);
  assert.equal(res.unresolvedLinks, 1, "3 種合算の未解決数に数える");
  const dashJson = JSON.parse(env.registry["COPY_D1"]._content);
  assert.equal(dashJson.cards[0].questionId, "", "未配線はコピー元へ残さず空にする");
  assert.equal(dashJson.cards[0].questionName, "Q", "questionName は保持");
});

test("StdFolders_copy_: 親フォームの childFormId(formLink) を物理消去し childFormPath を温存（コピー先で再解決）", () => {
  const gas = loadGasContext();
  const env = makeCopyEnv(gas, {
    forms: [
      { id: "PARENT", content: { settings: {}, schema: [{ id: "l1", type: "formLink", label: "子", childFormId: "CHILD", childFormPath: "01_forms/子" }] } },
      { id: "CHILD", content: { settings: {}, schema: [{ id: "t1", type: "text", label: "c" }] } },
    ],
  });
  const res = gas.StdFolders_copy_({ destRootUrl: COPY_DEST_URL, categories: { forms: true }, rebuildMapping: false });
  assert.equal(res.summary.forms, 2);
  assert.equal(res.unresolvedLinks, 0, "親子ともコピー対象なので未解決なし（コピー先で childFormPath から再解決可能）");
  const parentJson = JSON.parse(env.registry["COPY_PARENT"]._content);
  // 物理 ID は消去（コピー元 fileId を残さない）。論理パスを温存し、コピー先の rebuild → reresolve で貼り直す。
  assert.equal(parentJson.schema[0].childFormId, "", "子フォームリンクの物理 ID は消去される");
  assert.equal(parentJson.schema[0].childFormPath, "01_forms/子", "論理パスは温存（コピー先で再解決）");
});

test("StdFolders_copy_: categories.externalActions=false で 07 非複製＋フォーム内 URL クリア", () => {
  const gas = loadGasContext();
  const env = makeCopyEnv(gas, fullSrcSpec());
  const res = gas.StdFolders_copy_({ destRootUrl: COPY_DEST_URL, categories: { externalActions: false }, rebuildMapping: false });
  assert.equal(res.summary.externalActions, 0);
  assert.equal(env.copies.filter((c) => c.toKey === "externalActions").length, 0);
  const formJson = JSON.parse(env.registry["COPY_F1"]._content);
  assert.equal(formJson.schema[0].externalAction.url, "", "フォーム内の外部アクション URL がクリアされる");
});

test("StdFolders_copy_: categories.externalActions=true で 07 複製＋フォーム内 URL 温存", () => {
  const gas = loadGasContext();
  const env = makeCopyEnv(gas, fullSrcSpec());
  const res = gas.StdFolders_copy_({ destRootUrl: COPY_DEST_URL, categories: { externalActions: true }, rebuildMapping: false });
  assert.equal(res.summary.externalActions, 1);
  const formJson = JSON.parse(env.registry["COPY_F1"]._content);
  assert.equal(formJson.schema[0].externalAction.url, "https://script.google.com/macros/s/AAA/exec");
});

test("StdFolders_copy_: copyData=false でコピー先スプレッドシートの 12 行目以降をクリア", () => {
  const gas = loadGasContext();
  const env = makeCopyEnv(gas, fullSrcSpec());
  gas.StdFolders_copy_({ destRootUrl: COPY_DEST_URL, categories: { spreadsheets: true }, copyData: false, rebuildMapping: false });
  assert.deepEqual(env.clearedSpreadsheets, ["COPY_" + COPY_SS_ID]);
  assert.equal(env.clearedRanges[0].row, 12, "12 行目を起点にクリアする");
});

test("StdFolders_copy_: copyData=true では全データはクリアせず、アップロードセルの物理だけ走査する", () => {
  const gas = loadGasContext();
  const env = makeCopyEnv(gas, fullSrcSpec());
  gas.StdFolders_copy_({ destRootUrl: COPY_DEST_URL, categories: { spreadsheets: true }, copyData: true, rebuildMapping: false });
  // 全データクリア（clearContent）は呼ばれない。
  assert.equal(env.clearedSpreadsheets.length, 0);
  // アップロードセルの物理（fileId/url/folderUrl）を空にするためセルを走査する。
  assert.ok(env.uploadPhysicalScanned.length > 0, "アップロード物理クリアのためデータ行を走査する");
});

test("StdFolders_copy_: 戻り値に正規化済み categories を含み copyExternalActions と一致", () => {
  const gas = loadGasContext();
  makeCopyEnv(gas, fullSrcSpec());
  const res = gas.StdFolders_copy_({ destRootUrl: COPY_DEST_URL, categories: { forms: true, questions: false }, rebuildMapping: false });
  assert.equal(res.categories.forms, true);
  assert.equal(res.categories.questions, false);
  assert.equal(res.categories.dashboards, true, "未指定は true");
  assert.equal(res.copyExternalActions, res.categories.externalActions);
});

test("StdFolders_copy_: rebuildMapping=true は未選択カテゴリを _nfb_mapping.json から除外", () => {
  const gas = loadGasContext();
  const env = makeCopyEnv(gas, fullSrcSpec());
  installStores(gas, {
    forms: { F1: { fileId: "F1", driveFileUrl: "u", title: "T" } },
    questions: { Q1: { fileId: "Q1", driveFileUrl: "qu", name: "Q" } },
    dashboards: {},
  });
  gas.StdFolders_copy_({ destRootUrl: COPY_DEST_URL, categories: { forms: true, questions: false }, rebuildMapping: true });
  const mapFile = env.destCreatedFiles.find((f) => f.name === gas.NFB_STD_MAPPING_FILE_NAME);
  assert.ok(mapFile, "_nfb_mapping.json が書き出される");
  const doc = JSON.parse(mapFile.content);
  assert.ok(doc.forms.F1, "選択した forms はマッピングに含まれる");
  assert.ok(!doc.questions.Q1, "除外した questions はマッピングから除外される");
});

// ---------------------------------------------------------------------------
// ネスト配下（サブフォルダ）の再帰コピー（06_upload_files/<レコード>/… 等）
// ---------------------------------------------------------------------------

// upload にネストした構成（直下 1 + REC1 直下 1 + REC1/thumbs 1）を持つソース。
function nestedUploadSrcSpec() {
  return {
    upload: {
      files: [{ id: "U_TOP", content: "top" }],
      folders: {
        REC1: {
          files: [{ id: "U_PHOTO", content: "photo-bytes" }],
          folders: { thumbs: { files: [{ id: "U_THUMB", content: "thumb" }], folders: {} } },
        },
      },
    },
  };
}

test("StdFolders_copy_: サブフォルダ配下のファイルも再帰的に複製する（06_upload_files ネスト）", () => {
  const gas = loadGasContext();
  const env = makeCopyEnv(gas, nestedUploadSrcSpec());
  const res = gas.StdFolders_copy_({ destRootUrl: COPY_DEST_URL, rebuildMapping: false });
  assert.equal(res.ok, true);
  // 直下 1 + REC1 直下 1 + REC1/thumbs 1 = 3
  assert.equal(res.summary.upload, 3, "ネスト配下を含め全ファイルが数えられる");
  const copiedIds = env.copies.map((c) => c.srcId);
  assert.ok(copiedIds.includes("U_TOP"), "直下ファイルが複製される");
  assert.ok(copiedIds.includes("U_PHOTO"), "サブフォルダ配下のファイルが複製される");
  assert.ok(copiedIds.includes("U_THUMB"), "深いネストのファイルも複製される");
  // ネスト配下も同カテゴリ（upload）として複製される
  assert.equal(env.copies.filter((c) => c.toKey === "upload").length, 3);
  assert.equal(res.truncated, false, "上限未満なので truncated は false");
});

test("StdFolders_copy_: driveRootFolderUrl はもう再マップしない（アップロードは常に 06_upload_files 直下）", () => {
  const gas = loadGasContext();
  const spec = nestedUploadSrcSpec();
  // 旧フォームに driveRootFolderUrl が残っていても、アップロード先はユーザー指定不可・06 直下固定になったため
  // コピー時の再マップは行わない（残骸は次回フォーム保存の正規化で除去される）。
  spec.forms = [{ id: "F1", content: { schema: [{ label: "u", driveRootFolderUrl: "https://drive.google.com/drive/folders/SRC_FOLDER_upload__REC1" }] } }];
  const env = makeCopyEnv(gas, spec);
  const res = gas.StdFolders_copy_({ destRootUrl: COPY_DEST_URL, rebuildMapping: false });
  assert.equal(res.ok, true);
  const formJson = JSON.parse(env.registry["COPY_F1"]._content);
  assert.equal(
    formJson.schema[0].driveRootFolderUrl,
    "https://drive.google.com/drive/folders/SRC_FOLDER_upload__REC1",
    "driveRootFolderUrl はコピー時に書き換えられない（無視され、保存時に除去される）"
  );
});

// ---- 再帰ヘルパー単体（ガード・多親保護） ----

// getFiles/getFolders/makeCopy を備えた最小 src フォルダ。makeCopy 先は dest._copied に記録。
function tinySrcFolder(id, name, fileIds, childFolders) {
  const files = (fileIds || []).map((fid) => ({
    getId: () => fid,
    getName: () => fid + ".bin",
    getUrl: () => "https://drive.google.com/file/d/" + fid + "/view",
    isTrashed: () => false,
    makeCopy(n, dest) {
      dest._copied.push(fid);
      return { getId: () => "COPY_" + fid, getUrl: () => "https://drive.google.com/file/d/COPY_" + fid + "/view" };
    },
  }));
  const subs = childFolders || [];
  return {
    getId: () => id,
    getName: () => name,
    getUrl: () => "https://drive.google.com/drive/folders/" + id,
    getFiles() { let i = 0; return { hasNext: () => i < files.length, next: () => files[i++] }; },
    getFolders() { let i = 0; return { hasNext: () => i < subs.length, next: () => subs[i++] }; },
  };
}

function tinyDestFolder() {
  const dest = {
    _copied: [],
    getId: () => "D",
    getUrl: () => "https://drive.google.com/drive/folders/D",
    getFoldersByName: () => ({ hasNext: () => false, next: () => null }),
    createFolder: () => dest, // ネストはすべて自分へ畳む（コピー件数だけ検証）
  };
  return dest;
}

test("StdFolders_copyFolderTree_: maxNodes 到達で truncated=true・以降を打ち切る", () => {
  const gas = loadGasContext();
  const dest = tinyDestFolder();
  const guard = { count: 0, maxNodes: 2, maxDepth: 20, truncated: false };
  const ctx = { key: "upload", copyData: true, idMap: {}, folderIdMap: {}, copied: [], visited: {}, guard };
  gas.StdFolders_copyFolderTree_(tinySrcFolder("S", "06_upload_files", ["A", "B", "C"]), dest, ctx, 0);
  assert.equal(guard.truncated, true, "上限到達で truncated が立つ");
  assert.equal(ctx.copied.length, 2, "maxNodes=2 で 2 件だけコピーして打ち切る");
  assert.equal(dest._copied.length, 2);
});

test("StdFolders_copyFolderTree_: visited で同一サブフォルダを二重コピーしない（多親/循環保護）", () => {
  const gas = loadGasContext();
  const dest = tinyDestFolder();
  // 同一 id のサブフォルダが 2 回現れる（多親）。1 回だけ辿る。
  const shared = tinySrcFolder("SHARED", "shared", ["X"], []);
  const root = tinySrcFolder("R", "06_upload_files", [], [shared, shared]);
  const guard = { count: 0, maxNodes: 5000, maxDepth: 20, truncated: false };
  const ctx = { key: "upload", copyData: true, idMap: {}, folderIdMap: {}, copied: [], visited: {}, guard };
  gas.StdFolders_copyFolderTree_(root, dest, ctx, 0);
  assert.equal(ctx.copied.length, 1, "共有サブフォルダ配下のファイルは 1 回だけコピー");
});

// ---------------------------------------------------------------------------
// StdFolders_clearUploadPhysicalInCell_: コピー時のアップロードセル物理クリア（純変換）
// ---------------------------------------------------------------------------

test("StdFolders_clearUploadPhysicalInCell_: オブジェクト形は物理を空にし name/folderName を保持", () => {
  const gas = loadGasContext();
  const cell = JSON.stringify({
    files: [{ name: "a.pdf", driveFileId: "ID1", driveFileUrl: "https://drive/ID1" }],
    folderUrl: "https://drive.google.com/drive/folders/F1",
    folderName: "record_01_abcd",
  });
  const res = gas.StdFolders_clearUploadPhysicalInCell_(cell);
  assert.equal(res.changed, true);
  assert.deepEqual(JSON.parse(res.value), {
    files: [{ name: "a.pdf", driveFileId: "", driveFileUrl: "" }],
    folderUrl: "",
    folderName: "record_01_abcd",
  });
});

test("StdFolders_clearUploadPhysicalInCell_: 配列形も物理を空にし name を保持", () => {
  const gas = loadGasContext();
  const cell = JSON.stringify([{ name: "b.png", driveFileId: "ID2", driveFileUrl: "https://drive/ID2" }]);
  const res = gas.StdFolders_clearUploadPhysicalInCell_(cell);
  assert.equal(res.changed, true);
  assert.deepEqual(JSON.parse(res.value), [{ name: "b.png", driveFileId: "", driveFileUrl: "" }]);
});

test("StdFolders_clearUploadPhysicalInCell_: fileUpload でない JSON/文字列は変更しない", () => {
  const gas = loadGasContext();
  assert.equal(gas.StdFolders_clearUploadPhysicalInCell_('{"foo":1}').changed, false);
  assert.equal(gas.StdFolders_clearUploadPhysicalInCell_("ただのテキスト").changed, false);
  assert.equal(gas.StdFolders_clearUploadPhysicalInCell_("2026-06-22").changed, false);
  assert.equal(gas.StdFolders_clearUploadPhysicalInCell_("").changed, false);
  assert.equal(gas.StdFolders_clearUploadPhysicalInCell_(42).changed, false);
});
