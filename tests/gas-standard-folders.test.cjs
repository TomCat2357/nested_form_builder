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
  };
  // standardFolders.gs は formsParsing.gs（Forms_parseGoogleDriveUrl_）と model.gs（Model_normalizeSpreadsheetId_）に依存。
  return loadGasFiles(context, ["formsParsing.gs", "model.gs", "standardFolders.gs"]);
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

test("StdFolders_exportMapping_: 3 マッピング＋登録簿を nfb-mapping 形で返す", () => {
  const gas = loadGasContext();
  gas.StdFolders_resolveRootFolder_ = () => ({ getId: () => "ROOT1" });
  installStores(gas, {
    forms: { f1: { fileId: "FF1", driveFileUrl: "u1", title: "T1" } },
    questions: { q1: { fileId: "QF1", driveFileUrl: "qu1", name: "Q1" } },
    dashboards: {},
    foldersForms: ["a", "a/b"],
  });
  const res = gas.StdFolders_exportMapping_();
  assert.equal(res.ok, true);
  assert.equal(res.mapping.type, "nfb-mapping");
  assert.equal(res.mapping.version, 1);
  assert.equal(res.mapping.sourceRootId, "ROOT1");
  assert.equal(res.mapping.forms.f1.fileId, "FF1");
  assert.equal(res.mapping.questions.q1.name, "Q1");
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

test("StdFolders_importMapping_: 不正な doc は throw せず {ok:false} を返す", () => {
  const gas = loadGasContext();
  installStores(gas, {});
  assert.equal(gas.StdFolders_importMapping_({ type: "x", version: 1 }).ok, false);
  assert.equal(gas.StdFolders_importMapping_({ type: "nfb-mapping", version: 2 }).ok, false);
  assert.equal(gas.StdFolders_importMapping_(null).ok, false);
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

test("StdFolders_buildCopiedMappingDoc_: idMap で新 fileId に振り直し、未収載は除外する", () => {
  const gas = loadGasContext();
  installStores(gas, {
    forms: {
      keep: { fileId: "SRC1", driveFileUrl: "su1", title: "K" },
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
  assert.equal(doc.sourceRootId, "SRCROOT");
  assert.equal(doc.forms.keep.fileId, "DST1");
  assert.equal(doc.forms.keep.driveFileUrl, "https://drive.google.com/file/d/DST1/view");
  assert.ok(!doc.forms.drop, "idMap 未収載のエントリは除外される");
  assert.equal(doc.questions.q.fileId, "DSTQ");
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

// ---- 壊れたリンクの修復（再リンク / 削除） ----

// DriveApp / ルート解決を使わずに修復ロジックを検証するため、生存判定と
// 名前インデックス、構成内コピー（既存正規化）を差し替える。
//   aliveIds   : 生存している fileId の集合
//   indexByKey : key → { ファイル名(.json除去): { fileId, fileUrl } }
// id ＝ fileId へ統一したため、壊れたリンクはキャッシュ名（title/name）で名前解決する。
function stubRepairEnv(gas, { aliveIds = [], indexByKey = {} } = {}) {
  const alive = new Set(aliveIds);
  gas.StdFolders_isFileIdAlive_ = (fileId) => alive.has(fileId);
  gas.StdFolders_indexStdFolderByName_ = (key) => indexByKey[key] || {};
  // 生存ファイルは「既に構成内」とみなし、コピーによる正規化は発生させない。
  gas.StdFolders_ensureMappingEntryInStd_ = () => ({ changed: false });
}

test("StdFolders_repairAndNormalizeMapping_: 壊れたリンクはキャッシュ名一致先へ再リンク（fileId へ再キー）する", () => {
  const gas = loadGasContext();
  stubRepairEnv(gas, {
    aliveIds: [],
    indexByKey: { forms: { T: { fileId: "NEWF1", fileUrl: "https://drive.google.com/file/d/NEWF1/view" } } },
  });
  const mapping = { f1: { fileId: "DEADF1", driveFileUrl: "https://drive.google.com/file/d/DEADF1/view", title: "T" } };
  const res = gas.StdFolders_repairAndNormalizeMapping_(mapping, "forms", null);
  assert.equal(res.relinked, 1);
  assert.equal(res.removed, 0);
  // id ＝ fileId なので、再リンク後は新 fileId をキーに張り替える（旧キーは削除）。
  assert.ok(!mapping.f1, "旧キー（死んだ fileId）は削除される");
  assert.equal(mapping.NEWF1.fileId, "NEWF1");
  assert.equal(mapping.NEWF1.driveFileUrl, "https://drive.google.com/file/d/NEWF1/view");
});

test("StdFolders_repairAndNormalizeMapping_: 張替え先が無い壊れたリンクはマッピングから削除する", () => {
  const gas = loadGasContext();
  stubRepairEnv(gas, { aliveIds: [], indexByKey: { forms: {} } });
  const mapping = { f1: { fileId: "DEADF1", driveFileUrl: "u", title: "T" } };
  const res = gas.StdFolders_repairAndNormalizeMapping_(mapping, "forms", null);
  assert.equal(res.relinked, 0);
  assert.equal(res.removed, 1);
  assert.equal(res.removedIds.length, 1);
  assert.equal(res.removedIds[0], "f1");
  assert.ok(!mapping.f1, "壊れたエントリは削除される");
});

test("StdFolders_repairAndNormalizeMapping_: 生存リンクは変更しない", () => {
  const gas = loadGasContext();
  stubRepairEnv(gas, { aliveIds: ["LIVE1"], indexByKey: { forms: {} } });
  const mapping = { f1: { fileId: "LIVE1", driveFileUrl: "u", title: "T" } };
  const res = gas.StdFolders_repairAndNormalizeMapping_(mapping, "forms", null);
  assert.equal(res.normalized, 0);
  assert.equal(res.relinked, 0);
  assert.equal(res.removed, 0);
  assert.equal(mapping.f1.fileId, "LIVE1");
});

test("StdFolders_normalizeLinkedToStd_: 再リンク時は AddFormUrl_ も更新し、合計件数を返す", () => {
  const gas = loadGasContext();
  stubRepairEnv(gas, {
    aliveIds: ["LIVEQ"],
    indexByKey: {
      forms: { T: { fileId: "NEWF1", fileUrl: "https://drive.google.com/file/d/NEWF1/view" } },
      questions: {},
      dashboards: {},
    },
  });
  const stores = installStores(gas, {
    forms: { f1: { fileId: "DEADF1", driveFileUrl: "old", title: "T" } }, // 壊れ → 名前で再リンク（fileId へ再キー）
    questions: { q1: { fileId: "LIVEQ", driveFileUrl: "qu", name: "Q" } }, // 生存 → 無変更
    dashboards: { d1: { fileId: "DEADD1", driveFileUrl: "du", name: "D" } }, // 壊れ・張替え先なし → 削除
  });
  const res = gas.StdFolders_normalizeLinkedToStd_();
  assert.equal(res.relinked, 1);
  assert.equal(res.removed, 1);
  // 再リンク後は新 fileId（NEWF1）をキーに張り替わる。
  assert.ok(!stores.forms.f1, "旧キー（死んだ fileId）は削除される");
  assert.equal(stores.forms.NEWF1.fileId, "NEWF1");
  assert.equal(stores.formUrls.NEWF1, "https://drive.google.com/file/d/NEWF1/view", "再リンクで AddFormUrl_ も新キーで更新される");
  assert.ok(!stores.dashboards.d1, "張替え先のない壊れた Dashboard リンクは削除される");
  assert.equal(stores.questions.q1.fileId, "LIVEQ", "生存 Question は無変更");
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

test("StdFolders_rewireDashboardFile_: questionId を idMap で新 fileId へ再マップ、未収載は保持し未解決として数える", () => {
  const gas = loadGasContext();
  const before = {
    cards: [
      { id: "c1", questionId: "Q_OLD_KEPT", questionName: "売上" },
      { id: "c2", questionId: "Q_OLD_MISSING", questionName: "離脱率" },
    ],
  };
  const state = installSingleFile(gas, "DASH1", JSON.stringify(before));
  // Q_OLD_KEPT のみコピー対象（idMap に収載）。Q_OLD_MISSING は構成外。
  const idMap = { Q_OLD_KEPT: { newFileId: "Q_NEW_KEPT", newUrl: "https://drive.google.com/file/d/Q_NEW_KEPT/view" } };
  const unresolved = gas.StdFolders_rewireDashboardFile_("DASH1", idMap);

  assert.equal(unresolved, 1, "idMap に無い 1 件だけ未解決として数える");
  const after = JSON.parse(state.content);
  // id は埋め込まない（id ＝ fileId）。
  assert.equal(after.id, undefined);
  // 収載済みは新 fileId へ再マップ。
  assert.equal(after.cards[0].questionId, "Q_NEW_KEPT");
  // 未収載は参照（questionId / questionName）を保持。
  assert.equal(after.cards[1].questionId, "Q_OLD_MISSING");
  assert.equal(after.cards[1].questionName, "離脱率");
});

test("StdFolders_rewireQuestionFile_: formId を idMap で新 fileId へ再マップ、未収載は保持する", () => {
  const gas = loadGasContext();
  const before = {
    query: {
      mode: "gui",
      gui: { formId: "F_OLD", formName: "売上フォーム" },
      formSources: [{ formId: "F_OLD", variant: "data" }, { formId: "F_OUT", variant: "view" }],
    },
  };
  const state = installSingleFile(gas, "Q1", JSON.stringify(before));
  const idMap = { F_OLD: { newFileId: "F_NEW", newUrl: "https://drive.google.com/file/d/F_NEW/view" } };
  gas.StdFolders_rewireQuestionFile_("Q1", idMap);

  const after = JSON.parse(state.content);
  assert.equal(after.id, undefined, "id は埋め込まない");
  assert.equal(after.query.gui.formId, "F_NEW");
  assert.equal(after.query.formSources[0].formId, "F_NEW");
  assert.equal(after.query.formSources[1].formId, "F_OUT", "idMap に無い formId は保持");
});

// ---------------------------------------------------------------------------
// リンク診断レポートの参照ステータス判定（Fix 1: 実行時リゾルバ相当の名前フォールバック）
// ---------------------------------------------------------------------------

test("StdFolders_resolveRefByName_: 保持名・id をファイル名候補に名前解決する（id-as-name 救済）", () => {
  const gas = loadGasContext();
  const nameToIds = { "売上フォーム": ["FID_A"], "q_01KOLD": ["QID_B"], "重複名": ["X1", "X2"] };
  // 保持名で一意解決。
  const a = gas.StdFolders_resolveRefByName_("f_old", "売上フォーム", nameToIds);
  assert.equal(a.count, 1); assert.equal(a.fileId, "FID_A");
  // 名前なし・id がファイル名（旧 ULID をそのままファイル名にしているエンティティ）で解決。
  const b = gas.StdFolders_resolveRefByName_("q_01KOLD", "", nameToIds);
  assert.equal(b.count, 1); assert.equal(b.fileId, "QID_B");
  // 同名複数は曖昧（count>1）。
  assert.equal(gas.StdFolders_resolveRefByName_("zzz", "重複名", nameToIds).count, 2);
  // どれにも一致しない。
  const d = gas.StdFolders_resolveRefByName_("none", "なし", nameToIds);
  assert.equal(d.count, 0); assert.equal(d.fileId, null);
});

test("StdFolders_reportRefStatus_: id実在→OK / 名前一意→再リンク / 同名複数→曖昧 / マップのみ→要確認 / それ以外→真のリンク切れ", () => {
  const gas = loadGasContext();
  const present = { FID_PRESENT: true };
  const map = { F_MAPPED: true };
  const nameToIds = { "実在名": ["FID_PRESENT"], "別名": ["FID_PRESENT"], "重複名": ["X1", "X2"] };

  assert.equal(gas.StdFolders_reportRefStatus_("FID_PRESENT", "", present, map, nameToIds), "OK（構成内）");
  assert.equal(gas.StdFolders_reportRefStatus_("f_old", "別名", present, map, nameToIds), "名前一致・要再リンク（実行時は解決）");
  assert.equal(gas.StdFolders_reportRefStatus_("f_old", "重複名", present, map, nameToIds), "名前重複・要手動再リンク（曖昧）");
  assert.equal(gas.StdFolders_reportRefStatus_("F_MAPPED", "", present, map, nameToIds), "要確認（マッピング有・構成内に実体なし）");
  assert.equal(gas.StdFolders_reportRefStatus_("f_dead", "消えた名", present, map, nameToIds), "未解決（真のリンク切れ）");
  assert.equal(gas.StdFolders_reportRefStatus_("", "", present, map, nameToIds), "未設定");
});

test("StdFolders_statusSeverity_ / isBrokenStatus_: 重大度の分類", () => {
  const gas = loadGasContext();
  assert.equal(gas.StdFolders_statusSeverity_("未解決（真のリンク切れ）"), "manual");
  assert.equal(gas.StdFolders_statusSeverity_("名前重複・要手動再リンク（曖昧）"), "manual");
  assert.equal(gas.StdFolders_statusSeverity_("要確認（マッピング有・構成内に実体なし）"), "manual");
  assert.equal(gas.StdFolders_statusSeverity_("名前一致・要再リンク（実行時は解決）"), "auto");
  assert.equal(gas.StdFolders_statusSeverity_("構成外/外部（未検査）"), "external");
  assert.equal(gas.StdFolders_statusSeverity_("OK（構成内）"), "ok");
  assert.equal(gas.StdFolders_statusSeverity_("構成内"), "ok");
  // ok 以外は候補として surfacing。
  assert.equal(gas.StdFolders_isBrokenStatus_("名前一致・要再リンク（実行時は解決）"), true);
  assert.equal(gas.StdFolders_isBrokenStatus_("OK（構成内）"), false);
});

test("StdFolders_countBySeverity_: broken を重大度別に集計する", () => {
  const gas = loadGasContext();
  const broken = [
    { severity: "manual" }, { severity: "manual" },
    { severity: "auto" },
    { severity: "external" },
    { status: "OK（構成内）" }, // severity 無し → status から ok 判定（カウント外）
  ];
  const c = gas.StdFolders_countBySeverity_(broken);
  assert.equal(c.manual, 2);
  assert.equal(c.auto, 1);
  assert.equal(c.external, 1);
});

test("StdFolders_planRefRelink_: ok / relink / ambiguous / unresolved を返す", () => {
  const gas = loadGasContext();
  const index = {
    idSet: { CUR: true },
    nameToIds: { "名前A": ["CUR"], "重複": ["A", "B"] },
    idToName: { CUR: "名前A" },
  };
  assert.equal(gas.StdFolders_planRefRelink_("CUR", "", index).action, "ok");
  const relink = gas.StdFolders_planRefRelink_("old", "名前A", index);
  assert.equal(relink.action, "relink"); assert.equal(relink.toId, "CUR"); assert.equal(relink.toName, "名前A");
  assert.equal(gas.StdFolders_planRefRelink_("old", "重複", index).action, "ambiguous");
  assert.equal(gas.StdFolders_planRefRelink_("old", "なし", index).action, "unresolved");
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
