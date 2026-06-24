const assert = require("node:assert/strict");
const test = require("node:test");
const { loadGasFiles } = require("./helpers/gasVmLoader.cjs");

// プロジェクト外ファイル参照の禁止＝論理パス化（standardFolders.gs の正規化器）を検証する。
// 統一正規化器 StdFolders_alignFileRefIntoStdFolder_ / StdFolders_alignFolderRefIntoStdFolder_ は
// 葉ヘルパ（parse / alive / 構成内判定 / move / copy / 相対パス導出）をスタブして分岐ロジックを直接検証する。
// 取り込み方針: ホーム=据置(aligned) / プロジェクト内別フォルダ=move / プロジェクト外=copy。
function loadCtx() {
  const context = {
    console,
    Logger: { log() {} },
    NFB_DEFAULT_SHEET_NAME: "Data",
    DriveApp: {
      getFileById(id) { return { getId: () => id, getUrl: () => "URL_" + id }; },
      getFolderById(id) { return { getId: () => id, getUrl: () => "FURL_" + id }; },
    },
    nfbSafeCall_(fn) { return fn(); },
    nfbErrorToString_(err) { return String((err && err.message) || err); },
    Nfb_resolveFileIdFromEntry_(entry) { return entry ? (entry.fileId || null) : null; },
    ExtractFileIdFromUrl_() { return null; },
    Nfb_trimStr_(value) { return value ? String(value).trim() : ""; },
  };
  return loadGasFiles(context, ["formsParsing.gs", "model.gs", "driveFile.gs", "standardFoldersAlign.gs", "standardFoldersAlignRefs.gs", "standardFoldersCopy.gs", "standardFolders.gs"]);
}

// 葉ヘルパをスタブして alignFileRefIntoStdFolder_ の分岐だけを駆動する。
function stubFileLeaves(gas, opts) {
  gas.Forms_parseGoogleDriveUrl_ = (u) => (u ? { type: "file", id: opts.parsedId || "" } : { type: null, id: null });
  gas.StdFolders_isFileIdAlive_ = (id) => (opts.aliveIds ? opts.aliveIds.indexOf(id) !== -1 : true);
  gas.StdFolders_isFileInStdSubfolder_ = () => !!opts.home;
  gas.StdFolders_isFileUnderProjectRoot_ = () => !!opts.underRoot;
  gas.StdFolders_resolvePathToFileId_ = () => opts.byPath || "";
  gas.StdFolders_relativePathOfFile_ = () => (opts.relPath === undefined ? "sub/leaf" : opts.relPath);
  gas._moves = [];
  gas._copies = [];
  gas.StdFolders_moveFileIntoStdPath_ = (key, id, p) => { gas._moves.push({ key, id, p }); return opts.moveOk !== false; };
  gas.StdFolders_copyFileIntoStdPath_ = (key, id, p) => { gas._copies.push({ key, id, p }); return opts.copyTo || ""; };
}

// ---------------------------------------------------------------------------
// StdFolders_alignFileRefIntoStdFolder_（ファイル参照の統一正規化）
// ---------------------------------------------------------------------------

test("alignFileRefIntoStdFolder_: ホーム配下は据置（aligned・move/copy しない）", () => {
  const gas = loadCtx();
  stubFileLeaves(gas, { parsedId: "F1", aliveIds: ["F1"], home: true, relPath: "tpl/見積" });
  const r = gas.StdFolders_alignFileRefIntoStdFolder_("report_templates", "https://x/d/F1/edit", "");
  assert.equal(r.status, "aligned");
  assert.equal(r.fileId, "F1");
  assert.equal(r.url, "URL_F1");
  assert.equal(r.path, "tpl/見積");
  assert.equal(gas._moves.length, 0);
  assert.equal(gas._copies.length, 0);
});

test("alignFileRefIntoStdFolder_: プロジェクト内の別フォルダは move（fileId 保持）", () => {
  const gas = loadCtx();
  stubFileLeaves(gas, { parsedId: "F1", aliveIds: ["F1"], home: false, underRoot: true, relPath: "moved/見積" });
  const r = gas.StdFolders_alignFileRefIntoStdFolder_("report_templates", "https://x/d/F1/edit", "");
  assert.equal(r.status, "moved");
  assert.equal(r.fileId, "F1", "move は fileId を保持");
  assert.equal(gas._moves.length, 1);
  assert.equal(gas._copies.length, 0);
  assert.equal(r.path, "moved/見積");
});

test("alignFileRefIntoStdFolder_: プロジェクト外は copy（新 fileId 採用）", () => {
  const gas = loadCtx();
  stubFileLeaves(gas, { parsedId: "F1", aliveIds: ["F1", "F2"], home: false, underRoot: false, copyTo: "F2", relPath: "ext/見積" });
  const r = gas.StdFolders_alignFileRefIntoStdFolder_("report_templates", "https://x/d/F1/edit", "");
  assert.equal(r.status, "copiedExternal");
  assert.equal(r.fileId, "F2", "copy 先の新 fileId");
  assert.equal(r.url, "URL_F2");
  assert.equal(gas._copies.length, 1);
  assert.equal(gas._moves.length, 0);
});

test("alignFileRefIntoStdFolder_: 物理 dead + 論理パスで復旧（recoveredByPath）", () => {
  const gas = loadCtx();
  // 物理 DEAD は死亡、論理パスで F3 を引き当て（home 扱い）。
  stubFileLeaves(gas, { parsedId: "DEAD", aliveIds: ["F3"], byPath: "F3", home: true, relPath: "tpl/復旧" });
  const r = gas.StdFolders_alignFileRefIntoStdFolder_("report_templates", "https://x/d/DEAD/edit", "tpl/復旧");
  assert.equal(r.status, "recoveredByPath");
  assert.equal(r.fileId, "F3");
  assert.equal(r.path, "tpl/復旧");
  assert.equal(gas._moves.length, 0);
  assert.equal(gas._copies.length, 0);
});

test("alignFileRefIntoStdFolder_: 物理も論理も解決不能なら unresolved（呼出側は据置）", () => {
  const gas = loadCtx();
  stubFileLeaves(gas, { parsedId: "", aliveIds: [], byPath: "" });
  const r = gas.StdFolders_alignFileRefIntoStdFolder_("report_templates", "", "");
  assert.equal(r.status, "unresolved");
  assert.equal(r.fileId, "");
});

test("alignFileRefIntoStdFolder_: 外部 copy 失敗は noop（呼出側は据置）", () => {
  const gas = loadCtx();
  stubFileLeaves(gas, { parsedId: "F1", aliveIds: ["F1"], home: false, underRoot: false, copyTo: "" });
  const r = gas.StdFolders_alignFileRefIntoStdFolder_("report_templates", "https://x/d/F1/edit", "");
  assert.equal(r.status, "noop");
});

// ---------------------------------------------------------------------------
// StdFolders_alignFolderRefIntoStdFolder_（アップロードフォルダ参照の統一正規化）
// ---------------------------------------------------------------------------

function stubFolderLeaves(gas, opts) {
  gas.Forms_parseGoogleDriveUrl_ = (u) => (u ? { type: "folder", id: opts.parsedId || "" } : { type: null, id: null });
  gas.StdFolders_isFolderIdAlive_ = (id) => (opts.aliveIds ? opts.aliveIds.indexOf(id) !== -1 : true);
  gas.StdFolders_isFolderInStdSubfolder_ = () => !!opts.home;
  gas.StdFolders_isFolderUnderProjectRoot_ = () => !!opts.underRoot;
  gas.StdFolders_resolveFolderPathToId_ = () => opts.byPath || "";
  gas.StdFolders_relativeFolderPathOf_ = () => (opts.relPath === undefined ? "rec/f" : opts.relPath);
  gas._fmoves = [];
  gas.StdFolders_moveFolderIntoStdPath_ = (key, id, p) => { gas._fmoves.push({ key, id, p }); return opts.moveOk !== false; };
  gas.StdFolders_copyFolderIntoStdPath_ = (key, id, p) => (opts.copyResult || null);
}

test("alignFolderRefIntoStdFolder_: ホーム配下は据置（aligned）", () => {
  const gas = loadCtx();
  stubFolderLeaves(gas, { parsedId: "FD1", aliveIds: ["FD1"], home: true, relPath: "rec/2026" });
  const r = gas.StdFolders_alignFolderRefIntoStdFolder_("upload", "https://x/folders/FD1", "");
  assert.equal(r.status, "aligned");
  assert.equal(r.folderId, "FD1");
  assert.equal(r.url, "FURL_FD1");
  assert.equal(r.path, "rec/2026");
  assert.equal(r.idMap, null);
});

test("alignFolderRefIntoStdFolder_: 内部別フォルダは move（folderId 保持）", () => {
  const gas = loadCtx();
  stubFolderLeaves(gas, { parsedId: "FD1", aliveIds: ["FD1"], home: false, underRoot: true, relPath: "rec/移動" });
  const r = gas.StdFolders_alignFolderRefIntoStdFolder_("upload", "https://x/folders/FD1", "");
  assert.equal(r.status, "moved");
  assert.equal(r.folderId, "FD1");
  assert.equal(gas._fmoves.length, 1);
});

test("alignFolderRefIntoStdFolder_: プロジェクト外は再帰 copy（新 folderId + idMap）", () => {
  const gas = loadCtx();
  stubFolderLeaves(gas, {
    parsedId: "FD1", aliveIds: ["FD1"], home: false, underRoot: false,
    copyResult: { folderId: "FD2", idMap: { OLD1: "NEW1" } }, relPath: "rec/コピー",
  });
  const r = gas.StdFolders_alignFolderRefIntoStdFolder_("upload", "https://x/folders/FD1", "");
  assert.equal(r.status, "copiedExternal");
  assert.equal(r.folderId, "FD2");
  assert.deepEqual(r.idMap, { OLD1: "NEW1" });
  assert.equal(r.url, "FURL_FD2");
});

// ---------------------------------------------------------------------------
// StdFolders_normalizeUploadCellValue_（レコードセルの正規化 + ファイル id remap）
// ---------------------------------------------------------------------------

test("normalizeUploadCellValue_: 非 JSON / フォルダ参照なしはそのまま返す", () => {
  const gas = loadCtx();
  gas.StdFolders_alignFolderRefIntoStdFolder_ = () => { throw new Error("should not be called"); };
  assert.equal(gas.StdFolders_normalizeUploadCellValue_("●"), "●");
  assert.equal(gas.StdFolders_normalizeUploadCellValue_('[{"name":"a","driveFileUrl":"u"}]'), '[{"name":"a","driveFileUrl":"u"}]', "素配列は対象外");
  assert.equal(gas.StdFolders_normalizeUploadCellValue_('{"files":[]}'), '{"files":[]}', "folder 参照なしは対象外");
});

test("normalizeUploadCellValue_: folderUrl/folderName を更新し、外部コピー時は files の id を remap する", () => {
  const gas = loadCtx();
  let seenLogical = null;
  gas.StdFolders_alignFolderRefIntoStdFolder_ = (key, url, logical) => {
    seenLogical = logical;
    return { folderId: "FD2", url: "FURL_FD2", path: "rec/新", status: "copiedExternal", idMap: { OLD1: "NEW1" } };
  };
  const cell = JSON.stringify({
    files: [{ name: "a.pdf", driveFileId: "OLD1", driveFileUrl: "https://drive.google.com/file/d/OLD1/view" }],
    folderUrl: "https://drive.google.com/drive/folders/EXT",
    folderName: "rec/旧",
  });
  const out = JSON.parse(gas.StdFolders_normalizeUploadCellValue_(cell));
  assert.equal(seenLogical, "rec/旧", "論理入力は folderName を渡す（フォルダはフォルダ）");
  assert.equal(out.folderUrl, "FURL_FD2");
  assert.equal(out.folderName, "rec/新", "論理は folderName で更新");
  assert.equal("folderPath" in out, false, "旧 folderPath は新規に書かない");
  // ファイルはファイルとして id を追従（論理は name の葉のみ・フォルダ名を混ぜない）。
  assert.equal(out.files[0].driveFileId, "NEW1", "コピー先 id へ remap");
  assert.equal(out.files[0].driveFileUrl, "https://drive.google.com/file/d/NEW1/view");
  assert.equal(out.files[0].name, "a.pdf", "ファイルの論理は名前のみ");
});

test("normalizeUploadCellValue_: 旧 folderPath だけのセルも後方互換で論理入力に使い folderName へ移行する", () => {
  const gas = loadCtx();
  let seenLogical = null;
  gas.StdFolders_alignFolderRefIntoStdFolder_ = (key, url, logical) => {
    seenLogical = logical;
    return { folderId: "FD", url: "U", path: "rec/x", status: "aligned", idMap: null };
  };
  const cell = JSON.stringify({ files: [{ name: "a.pdf", driveFileId: "" }], folderUrl: "", folderPath: "rec/旧" });
  const out = JSON.parse(gas.StdFolders_normalizeUploadCellValue_(cell));
  assert.equal(seenLogical, "rec/旧", "folderPath を論理入力にフォールバック（後方互換）");
  assert.equal(out.folderName, "rec/x", "folderName へ移行");
  assert.equal("folderPath" in out, false, "旧 folderPath は除去（folderName へ一本化）");
});

test("normalizeUploadCellValue_: align が noop/unresolved ならセルを据え置く", () => {
  const gas = loadCtx();
  gas.StdFolders_alignFolderRefIntoStdFolder_ = () => ({ folderId: "", url: "", path: "", status: "noop", idMap: null });
  const cell = JSON.stringify({ files: [], folderUrl: "https://drive.google.com/drive/folders/EXT" });
  assert.equal(gas.StdFolders_normalizeUploadCellValue_(cell), cell);
});

// ---------------------------------------------------------------------------
// 物理優先 fast-path（uploadCellInPlaceFolderOrNull_ / normalizeUploadCellValue_ 高速パス）
// 正常系（06 直下の生存フォルダ＋folderName あり）は move/copy/祖先判定/相対パス再走査を
// 省略し Drive 往復を ~8-12 → 2 へ削減する。論理パスは既にセルにあるので「必ず保存」も満たす。
// ---------------------------------------------------------------------------

function iterOf(items) {
  let i = 0;
  return { hasNext: () => i < items.length, next: () => items[i++] };
}
function folderStub(opts) {
  return {
    getId: () => opts.id,
    getUrl: () => (opts.url === undefined ? ("https://drive.google.com/drive/folders/" + opts.id) : opts.url),
    isTrashed: () => !!opts.trashed,
    getParents: () => iterOf((opts.parents || []).map((pid) => ({ getId: () => pid }))),
  };
}
// fast-path 用に base id を固定し、getFolderById を計数するスタブを仕込む。
function stubFastPath(gas, opts) {
  gas.StdFolders_baseFolderIdCached_ = () => (opts.baseId === undefined ? "base06" : opts.baseId);
  gas._getFolderByIdCalls = 0;
  gas.DriveApp = {
    getFolderById(id) {
      gas._getFolderByIdCalls += 1;
      if (opts.folderById && Object.prototype.hasOwnProperty.call(opts.folderById, id)) {
        const f = opts.folderById[id];
        if (f === null) throw new Error("not found: " + id);
        return f;
      }
      throw new Error("unexpected getFolderById: " + id);
    },
  };
}

test("uploadCellInPlaceFolderOrNull_: base 直下の生存フォルダなら Folder を返す（getFolderById 1 回）", () => {
  const gas = loadCtx();
  stubFastPath(gas, { baseId: "base06", folderById: { FD1: folderStub({ id: "FD1", parents: ["base06"] }) } });
  const folder = gas.StdFolders_uploadCellInPlaceFolderOrNull_("https://drive.google.com/drive/folders/FD1", "upload");
  assert.ok(folder, "in-place なら Folder を返す");
  assert.equal(folder.getId(), "FD1");
  assert.equal(gas._getFolderByIdCalls, 1, "Drive 往復は最小");
});

test("uploadCellInPlaceFolderOrNull_: 親≠base / 多親 / 死亡 / 解析不可 / base 未解決 は null", () => {
  let gas = loadCtx();
  stubFastPath(gas, { baseId: "base06", folderById: { FD1: folderStub({ id: "FD1", parents: ["other"] }) } });
  assert.equal(gas.StdFolders_uploadCellInPlaceFolderOrNull_("https://drive.google.com/drive/folders/FD1", "upload"), null, "親≠base");

  gas = loadCtx();
  stubFastPath(gas, { baseId: "base06", folderById: { FD1: folderStub({ id: "FD1", parents: ["base06", "extra"] }) } });
  assert.equal(gas.StdFolders_uploadCellInPlaceFolderOrNull_("https://drive.google.com/drive/folders/FD1", "upload"), null, "多親");

  gas = loadCtx();
  stubFastPath(gas, { baseId: "base06", folderById: { FD1: folderStub({ id: "FD1", parents: ["base06"], trashed: true }) } });
  assert.equal(gas.StdFolders_uploadCellInPlaceFolderOrNull_("https://drive.google.com/drive/folders/FD1", "upload"), null, "ゴミ箱");

  gas = loadCtx();
  stubFastPath(gas, { baseId: "base06", folderById: { FD1: null } });
  assert.equal(gas.StdFolders_uploadCellInPlaceFolderOrNull_("https://drive.google.com/drive/folders/FD1", "upload"), null, "getFolderById throw");

  gas = loadCtx();
  stubFastPath(gas, { baseId: "base06", folderById: {} });
  assert.equal(gas.StdFolders_uploadCellInPlaceFolderOrNull_("not-a-url", "upload"), null, "解析不可");

  gas = loadCtx();
  stubFastPath(gas, { baseId: "", folderById: { FD1: folderStub({ id: "FD1", parents: ["base06"] }) } });
  assert.equal(gas.StdFolders_uploadCellInPlaceFolderOrNull_("https://drive.google.com/drive/folders/FD1", "upload"), null, "base 未解決");
});

test("normalizeUploadCellValue_: fast-path — 06 直下の生存フォルダ＋folderName ありは align を呼ばず据え置く", () => {
  const gas = loadCtx();
  gas.StdFolders_alignFolderRefIntoStdFolder_ = () => { throw new Error("fast-path では align を呼ばない"); };
  stubFastPath(gas, {
    baseId: "base06",
    folderById: { FD1: folderStub({ id: "FD1", url: "https://drive.google.com/drive/folders/FD1", parents: ["base06"] }) },
  });
  const cell = JSON.stringify({
    files: [{ name: "a.pdf", driveFileId: "F", driveFileUrl: "u" }],
    folderUrl: "https://drive.google.com/drive/folders/FD1",
    folderName: "record_x",
  });
  assert.equal(gas.StdFolders_normalizeUploadCellValue_(cell), cell, "正準 URL 一致・folderPath 無しなら元文字列を返す（churn 回避）");
  assert.equal(gas._getFolderByIdCalls, 1, "Drive 往復は最小（getFolderById 1 回）");
});

test("normalizeUploadCellValue_: fast-path — folderUrl を正準化し folderName は維持（align は呼ばない）", () => {
  const gas = loadCtx();
  gas.StdFolders_alignFolderRefIntoStdFolder_ = () => { throw new Error("fast-path では align を呼ばない"); };
  stubFastPath(gas, {
    baseId: "base06",
    folderById: { FD1: folderStub({ id: "FD1", url: "CANON_FD1", parents: ["base06"] }) },
  });
  const cell = JSON.stringify({
    files: [{ name: "a.pdf", driveFileId: "F" }],
    folderUrl: "https://drive.google.com/drive/folders/FD1",
    folderName: "record_x",
  });
  const out = JSON.parse(gas.StdFolders_normalizeUploadCellValue_(cell));
  assert.equal(out.folderUrl, "CANON_FD1", "正準 URL に更新");
  assert.equal(out.folderName, "record_x", "論理パスは維持（必ず保存される）");
});

test("normalizeUploadCellValue_: fast-path — folderPath 残骸は除去し folderName 維持（align は呼ばない）", () => {
  const gas = loadCtx();
  gas.StdFolders_alignFolderRefIntoStdFolder_ = () => { throw new Error("fast-path では align を呼ばない"); };
  stubFastPath(gas, {
    baseId: "base06",
    folderById: { FD1: folderStub({ id: "FD1", url: "https://drive.google.com/drive/folders/FD1", parents: ["base06"] }) },
  });
  const cell = JSON.stringify({
    files: [{ name: "a.pdf", driveFileId: "F" }],
    folderUrl: "https://drive.google.com/drive/folders/FD1",
    folderName: "record_x",
    folderPath: "record_x_old",
  });
  const out = JSON.parse(gas.StdFolders_normalizeUploadCellValue_(cell));
  assert.equal("folderPath" in out, false, "folderPath 残骸を除去");
  assert.equal(out.folderName, "record_x", "folderName は維持");
  assert.equal(out.folderUrl, "https://drive.google.com/drive/folders/FD1");
});

test("normalizeUploadCellValue_: folderName が無いセルは fast-path を使わずフル align が folderName を stamp", () => {
  const gas = loadCtx();
  let called = false;
  gas.StdFolders_alignFolderRefIntoStdFolder_ = (key, url, logical) => {
    called = true;
    return { folderId: "FD1", url: "https://drive.google.com/drive/folders/FD1", path: "record_x", status: "recoveredByPath", idMap: null };
  };
  gas.StdFolders_uploadCellInPlaceFolderOrNull_ = () => { throw new Error("folderName 無しでは probe しない"); };
  const cell = JSON.stringify({ files: [{ name: "a.pdf", driveFileId: "" }], folderUrl: "https://drive.google.com/drive/folders/FD1" });
  const out = JSON.parse(gas.StdFolders_normalizeUploadCellValue_(cell));
  assert.equal(called, true, "folderName 無し → フル align");
  assert.equal(out.folderName, "record_x", "論理パスを stamp（必ず保存）");
});

test("normalizeUploadCellValue_: コピー後クリア（folderUrl 空・folderName のみ）は fast-path を使わずフル align", () => {
  const gas = loadCtx();
  let seenLogical = null;
  gas.StdFolders_alignFolderRefIntoStdFolder_ = (key, url, logical) => {
    seenLogical = logical;
    return { folderId: "FD1", url: "FURL_FD1", path: "record_x", status: "recoveredByPath", idMap: null };
  };
  gas.StdFolders_uploadCellInPlaceFolderOrNull_ = () => { throw new Error("folderUrl 空では probe しない"); };
  const cell = JSON.stringify({ files: [{ name: "a.pdf", driveFileId: "" }], folderUrl: "", folderName: "record_x" });
  const out = JSON.parse(gas.StdFolders_normalizeUploadCellValue_(cell));
  assert.equal(seenLogical, "record_x");
  assert.equal(out.folderName, "record_x");
});

test("alignFolderRefIntoStdFolder_: 正常系での isFolderIdAlive_ は 1 回だけ（冗長呼び出し除去）", () => {
  const gas = loadCtx();
  stubFolderLeaves(gas, { parsedId: "FD1", aliveIds: ["FD1"], home: true, relPath: "rec/2026" });
  let aliveCalls = 0;
  const realAlive = gas.StdFolders_isFolderIdAlive_;
  gas.StdFolders_isFolderIdAlive_ = (id) => { aliveCalls += 1; return realAlive(id); };
  const r = gas.StdFolders_alignFolderRefIntoStdFolder_("upload", "https://x/folders/FD1", "");
  assert.equal(r.status, "aligned");
  assert.equal(aliveCalls, 1, "正常系では folderId の生存判定は 1 回（旧コードは二重・三重呼び）");
});

// ---------------------------------------------------------------------------
// StdFolders_normalizePrintTemplateRefsOnSave_（保存時: 様式 Doc 参照の url+path 両更新）
// ---------------------------------------------------------------------------

test("normalizePrintTemplateRefsOnSave_: フォーム全体 + カード個別を 05 へ寄せ url/path を両方書き戻す", () => {
  const gas = loadCtx();
  // 任意の参照を新 url/path へ寄せたとみなす（実 Drive 非依存）。
  gas.StdFolders_alignFileRefIntoStdFolder_ = (key, url, path) => ({
    fileId: "X", url: "NEW_URL", path: "NEW_PATH", status: "copiedExternal",
  });
  const form = {
    settings: { standardPrintTemplateUrl: "https://old/d/A/edit", standardPrintTemplatePath: "" },
    schema: [
      {
        type: "printTemplate", label: "様式",
        printTemplateAction: { useCustomTemplate: true, templateUrl: "https://old/d/B/edit", templatePath: "" },
        children: [
          { type: "printTemplate", label: "ネスト様式", printTemplateAction: { useCustomTemplate: true, templateUrl: "https://old/d/C/edit" } },
        ],
      },
      { type: "text", label: "無関係" },
    ],
  };
  gas.StdFolders_normalizePrintTemplateRefsOnSave_(form);

  assert.equal(form.settings.standardPrintTemplateUrl, "NEW_URL");
  assert.equal(form.settings.standardPrintTemplatePath, "NEW_PATH");
  assert.equal(form.schema[0].printTemplateAction.templateUrl, "NEW_URL");
  assert.equal(form.schema[0].printTemplateAction.templatePath, "NEW_PATH");
  assert.equal(form.schema[0].children[0].printTemplateAction.templateUrl, "NEW_URL", "ネスト配下も走査される");
  assert.equal(form.schema[0].children[0].printTemplateAction.templatePath, "NEW_PATH");
});

test("normalizePrintTemplateRefsOnSave_: useCustomTemplate=false や unresolved は据え置く", () => {
  const gas = loadCtx();
  gas.StdFolders_alignFileRefIntoStdFolder_ = () => ({ fileId: "", url: "", path: "", status: "unresolved" });
  const form = {
    settings: { standardPrintTemplateUrl: "https://old/d/A/edit", standardPrintTemplatePath: "keep" },
    schema: [
      { type: "printTemplate", printTemplateAction: { useCustomTemplate: false, templateUrl: "https://old/d/B/edit", templatePath: "keepB" } },
    ],
  };
  gas.StdFolders_normalizePrintTemplateRefsOnSave_(form);
  assert.equal(form.settings.standardPrintTemplateUrl, "https://old/d/A/edit", "unresolved は据え置き");
  assert.equal(form.settings.standardPrintTemplatePath, "keep");
  assert.equal(form.schema[0].printTemplateAction.templateUrl, "https://old/d/B/edit", "useCustomTemplate=false は対象外");
  assert.equal(form.schema[0].printTemplateAction.templatePath, "keepB");
});
