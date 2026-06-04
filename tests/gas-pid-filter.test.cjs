const assert = require("node:assert/strict");
const test = require("node:test");
const { loadGasFiles } = require("./helpers/gasVmLoader.cjs");

// URL で pid（親レコード ID）を指定したときの絞り込み・刻印（gas/codeHandlers.gs /
// gas/codeSyncRecords.gs / gas/sheetsRecords.gs）の回帰検証。
//   - pid 指定中は ListRecords_ / SyncRecords_ がその pid に等しい行だけを返す
//   - pid 未指定なら従来どおり全件返る
//   - SerializeRecord_ / Sheets_buildRecordFromRow_ が pid 列を素通しする

// --- ListRecords_ / SyncRecords_ のフィルタ検証用ハーネス（Sheets_getAllRecords_ をスタブ） ---
function loadFilterContext({ isAdmin = false } = {}) {
  const fakeSheet = { __id: "sheet" };
  const context = {
    console,
    Logger: { log() {} },
    Utilities: { formatDate: () => "" },

    NFB_TZ: "Asia/Tokyo",
    NFB_MS_PER_DAY: 24 * 60 * 60 * 1000,
    NFB_JST_OFFSET_MS: 9 * 60 * 60 * 1000,
    NFB_SHEETS_EPOCH_MS: Date.UTC(1899, 11, 30) - 9 * 60 * 60 * 1000,
    NFB_RESERVED_HEADER_KEYS: {},
    NFB_ERROR_CODE_LOCK_TIMEOUT: "LOCK_TIMEOUT",
    NFB_LOCK_WAIT_TIMEOUT_MS: 10000,
    NFB_DEFAULT_SHEET_NAME: "Data",

    nfbDt_formatCanonical_: (value) => String(value),

    IsAdmin_: () => isAdmin,
    ResolveActiveUserEmail_: () => "user@example.com",

    Sheets_getOrCreateSheet_: () => fakeSheet,
    Sheets_translateOpenError_: (err) => String(err),
    Sheets_readSheetLastUpdated_: () => 0,
    Sheets_readHeaderMatrix_: () => [],
    Sheets_collectTemporalPathMap_: () => null,
    Sheets_normalizeNumericToUnixMs_: (n) => n,

    GetServerModifiedAt_: () => 0,
    SetServerModifiedAt_: () => {},
    RequireRecordId_: () => null,

    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    SpreadsheetApp: { flush() {} },

    __testRecords: [],
  };

  context.Sheets_getAllRecords_ = function () { return context.__testRecords; };

  return loadGasFiles(context, ["sheetsDatetime.gs", "codeHandlers.gs", "codeSyncRecords.gs"]);
}

const ACTIVE_MODIFIED_MS = 1700000000000;
const READ_THRESHOLD_MS = 1600000000000;

const recA = { id: "r1", pid: "p100", deletedAt: null, deletedAtUnixMs: null, modifiedAt: "", modifiedAtUnixMs: ACTIVE_MODIFIED_MS, data: {}, dataUnixMs: {} };
const recB = { id: "r2", pid: "p200", deletedAt: null, deletedAtUnixMs: null, modifiedAt: "", modifiedAtUnixMs: ACTIVE_MODIFIED_MS, data: {}, dataUnixMs: {} };
const recC = { id: "r3", pid: "p100", deletedAt: null, deletedAtUnixMs: null, modifiedAt: "", modifiedAtUnixMs: ACTIVE_MODIFIED_MS, data: {}, dataUnixMs: {} };

test("Nfb_resolvePidFromCtx_: trim し、未指定/空は空文字", () => {
  const ctx = loadFilterContext();
  assert.equal(ctx.Nfb_resolvePidFromCtx_({ raw: { pid: " p100 " } }), "p100");
  assert.equal(ctx.Nfb_resolvePidFromCtx_({ raw: {} }), "");
  assert.equal(ctx.Nfb_resolvePidFromCtx_({}), "");
  assert.equal(ctx.Nfb_resolvePidFromCtx_({ raw: { pid: null } }), "");
});

test("Nfb_recordMatchesPid_: pid 空は全許可、非空は厳密一致", () => {
  const ctx = loadFilterContext();
  assert.equal(ctx.Nfb_recordMatchesPid_(recA, ""), true);
  assert.equal(ctx.Nfb_recordMatchesPid_(recA, "p100"), true);
  assert.equal(ctx.Nfb_recordMatchesPid_(recA, "p200"), false);
  assert.equal(ctx.Nfb_recordMatchesPid_({ id: "x" }, "p100"), false);
  assert.equal(ctx.Nfb_recordMatchesPid_({ id: "x", pid: 100 }, "100"), true);
});

test("ListRecords_: pid 指定でその pid の行だけ返す", () => {
  const ctx = loadFilterContext({ isAdmin: true });
  ctx.__testRecords = [recA, recB, recC];
  const result = ctx.ListRecords_({
    spreadsheetId: "ss1", sheetName: "Data", forceFullSync: true,
    raw: { authKey: "ADMIN_KEY", pid: "p100" },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(Array.from(result.records, (r) => r.id).sort(), ["r1", "r3"]);
});

test("Nfb_resolvePidsFromCtx_: 配列を trim、非配列/空は空配列", () => {
  const ctx = loadFilterContext();
  // VM 越しの配列はプロトタイプが異なるため Array.from で同レルムへ写してから比較する。
  assert.deepEqual(Array.from(ctx.Nfb_resolvePidsFromCtx_({ raw: { pids: [" p100 ", "p200", "", null] } })), ["p100", "p200"]);
  assert.deepEqual(Array.from(ctx.Nfb_resolvePidsFromCtx_({ raw: { pids: [] } })), []);
  assert.deepEqual(Array.from(ctx.Nfb_resolvePidsFromCtx_({ raw: { pids: "p100" } })), []);
  assert.deepEqual(Array.from(ctx.Nfb_resolvePidsFromCtx_({ raw: {} })), []);
  assert.deepEqual(Array.from(ctx.Nfb_resolvePidsFromCtx_({})), []);
});

test("Nfb_recordMatchesPids_: pidsSet のいずれかに一致", () => {
  const ctx = loadFilterContext();
  const set = { p100: true, p200: true };
  assert.equal(ctx.Nfb_recordMatchesPids_(recA, set), true);
  assert.equal(ctx.Nfb_recordMatchesPids_(recB, set), true);
  assert.equal(ctx.Nfb_recordMatchesPids_({ id: "x", pid: "p999" }, set), false);
  assert.equal(ctx.Nfb_recordMatchesPids_({ id: "x", pid: 100 }, { "100": true }), true);
});

test("ListRecords_: pids 配列で OR 一括取得（複数 pid の行をまとめて返す）", () => {
  const ctx = loadFilterContext({ isAdmin: true });
  ctx.__testRecords = [recA, recB, recC];
  const result = ctx.ListRecords_({
    spreadsheetId: "ss1", sheetName: "Data", forceFullSync: true,
    raw: { authKey: "ADMIN_KEY", pids: ["p100", "p200"] },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(Array.from(result.records, (r) => r.id).sort(), ["r1", "r2", "r3"]);
});

test("ListRecords_: pids が空配列なら単一 pid パスにフォールバック", () => {
  const ctx = loadFilterContext({ isAdmin: true });
  ctx.__testRecords = [recA, recB, recC];
  const result = ctx.ListRecords_({
    spreadsheetId: "ss1", sheetName: "Data", forceFullSync: true,
    raw: { authKey: "ADMIN_KEY", pids: [], pid: "p200" },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(Array.from(result.records, (r) => r.id), ["r2"]);
});

test("ListRecords_: pid 未指定なら全件", () => {
  const ctx = loadFilterContext({ isAdmin: true });
  ctx.__testRecords = [recA, recB, recC];
  const result = ctx.ListRecords_({
    spreadsheetId: "ss1", sheetName: "Data", forceFullSync: true,
    raw: { authKey: "ADMIN_KEY" },
  });
  assert.equal(result.records.length, 3);
});

test("ListRecords_: pid フィルタはデルタ経路でも効く", () => {
  const ctx = loadFilterContext({ isAdmin: true });
  ctx.__testRecords = [recA, recB, recC];
  const result = ctx.ListRecords_({
    spreadsheetId: "ss1", sheetName: "Data", forceFullSync: false,
    lastSpreadsheetReadAt: READ_THRESHOLD_MS,
    raw: { authKey: "ADMIN_KEY", pid: "p200" },
  });
  assert.equal(result.ok, true);
  assert.equal(result.isDelta, true);
  assert.deepEqual(Array.from(result.records, (r) => r.id), ["r2"]);
});

test("SyncRecords_: pid 指定で forceFullSync 経路がその pid の行だけ返す", () => {
  const ctx = loadFilterContext({ isAdmin: true });
  ctx.__testRecords = [recA, recB, recC];
  const result = ctx.SyncRecords_({
    spreadsheetId: "ss1", sheetName: "Data",
    raw: { authKey: "ADMIN_KEY", forceFullSync: true, uploadRecords: [], lastServerReadAt: 0, pid: "p100" },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(Array.from(result.records, (r) => r.id).sort(), ["r1", "r3"]);
});

test("SyncRecords_: pid 指定でデルタ経路もフィルタする", () => {
  const ctx = loadFilterContext({ isAdmin: true });
  ctx.__testRecords = [recA, recB, recC];
  const result = ctx.SyncRecords_({
    spreadsheetId: "ss1", sheetName: "Data",
    raw: { authKey: "ADMIN_KEY", forceFullSync: false, uploadRecords: [], lastServerReadAt: READ_THRESHOLD_MS, pid: "p100" },
  });
  assert.equal(result.ok, true);
  assert.equal(result.isDelta, true);
  assert.deepEqual(Array.from(result.records, (r) => r.id).sort(), ["r1", "r3"]);
});

test("SerializeRecord_: pid を文字列で素通しする", () => {
  const ctx = loadFilterContext();
  assert.equal(ctx.SerializeRecord_({ id: "r1", pid: "p100", data: {}, dataUnixMs: {} }).pid, "p100");
  assert.equal(ctx.SerializeRecord_({ id: "r1", data: {}, dataUnixMs: {} }).pid, "");
  assert.equal(ctx.SerializeRecord_({ id: "r1", pid: 100, data: {}, dataUnixMs: {} }).pid, "100");
});

// --- Sheets_buildRecordFromRow_ の pid 列抽出（reserved keys に pid を含む正規ハーネス） ---
function loadRecordsContext() {
  const fixedHeaderPaths = [
    ["id"], ["No."], ["createdAt"], ["modifiedAt"], ["deletedAt"],
    ["createdBy"], ["modifiedBy"], ["deletedBy"], ["pid"],
  ];
  const reservedKeys = {};
  for (const pathParts of fixedHeaderPaths) reservedKeys[pathParts[0]] = true;

  const context = {
    console,
    Logger: { log() {} },
    Utilities: { formatDate: () => "" },
    Date,
    NFB_TZ: "Asia/Tokyo",
    NFB_HEADER_DEPTH: 11,
    NFB_HEADER_START_ROW: 1,
    NFB_DATA_START_ROW: 12,
    NFB_MS_PER_DAY: 24 * 60 * 60 * 1000,
    NFB_JST_OFFSET_MS: 9 * 60 * 60 * 1000,
    NFB_SHEETS_EPOCH_MS: Date.UTC(1899, 11, 30) - 9 * 60 * 60 * 1000,
    NFB_FIXED_HEADER_PATHS: fixedHeaderPaths,
    NFB_RESERVED_HEADER_KEYS: reservedKeys,
    nfbDt_formatCanonical_: (value) => String(value),
    Sheets_ensureRowCapacity_: () => {},
    Sheets_ensureColumnExists_: () => {},
    Sheets_touchSheetLastUpdated_: () => {},
  };
  return loadGasFiles(context, ["sheetsDatetime.gs", "sheetsHeaders.gs", "sheetsRecords.gs"]);
}

test("Sheets_buildRecordFromRow_: pid 列の値を record.pid として取り出し、data には混ぜない", () => {
  const gas = loadRecordsContext();
  // 列順: id, No., createdAt, modifiedAt, deletedAt, createdBy, modifiedBy, deletedBy, pid, 質問1
  const columnPaths = [
    { index: 0, path: ["id"], key: "id" },
    { index: 1, path: ["No."], key: "No." },
    { index: 2, path: ["createdAt"], key: "createdAt" },
    { index: 3, path: ["modifiedAt"], key: "modifiedAt" },
    { index: 4, path: ["deletedAt"], key: "deletedAt" },
    { index: 5, path: ["createdBy"], key: "createdBy" },
    { index: 6, path: ["modifiedBy"], key: "modifiedBy" },
    { index: 7, path: ["deletedBy"], key: "deletedBy" },
    { index: 8, path: ["pid"], key: "pid" },
    { index: 9, path: ["質問1"], key: "質問1" },
  ];
  const rowData = ["r1", 1, "", "", "", "", "", "", "p100", "ans"];
  const record = gas.Sheets_buildRecordFromRow_(rowData, columnPaths);
  assert.equal(record.pid, "p100");
  assert.equal(record.data["質問1"], "ans");
  assert.equal("pid" in record.data, false);
});
