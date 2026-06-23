const assert = require("node:assert/strict");
const test = require("node:test");
const { loadGasFiles } = require("./helpers/gasVmLoader.cjs");

// 非管理者へのソフトデリート済みレコード非送信化（gas/codeHandlers.gs と gas/codeSyncRecords.gs）
// の回帰検証。`ListRecords_` / `GetRecord_` / `SyncRecords_` の 3 経路で、
// `deletedAtUnixMs > 0`（または `deletedAt` truthy）のレコードが非管理者には返らないこと、
// 管理者には従来どおり返ることを確認する。

function loadContext({ isAdmin = false } = {}) {
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

    // purge 監視オーケストレーション用スタブ。
    // WithScriptLock_ は codeHandlers.gs 本体が定義するため、LockService を stub する。
    NFB_DEFAULT_SHEET_NAME: "Data",
    Model_normalizeSpreadsheetId_: (v) => String(v || ""),
    // Nfb_openFormSheet_ の物理優先解決（standardFolders.gs / formsCrud.gs は未ロードなのでスタブ）。
    // 既定では非空 id を生存扱い＝物理 spreadsheetId をそのまま使う（従来挙動）。論理フォールバックは空。
    StdFolders_isFileIdAlive_: (id) => !!id,
    Nfb_resolveSpreadsheetPathCached_: () => "",
    Nfb_getDeletedRecordRetentionDays_: () => 30,
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },

    __testRecords: [],
    __testGetRecord: null,
    __propsStore: {},
    __formMapping: {},
    __forms: {},
    __formSheets: {},
    __purgedSheets: [],
    __oldestBySheet: new Map(),
  };

  context.Sheets_getAllRecords_ = function () { return context.__testRecords; };
  context.Sheets_getRecordById_ = function () { return context.__testGetRecord; };

  // forms は __forms に登録があればそれを返す（無ければ既定の null）
  context.Forms_getForm_ = function (formId) { return context.__forms[formId] || null; };
  // 本来 formsCrud.gs が定義するリクエストスコープキャッシュ版。本テストでは未ロードのため委譲スタブを用意。
  context.Nfb_getFormCached_ = function (formId) { return context.Forms_getForm_(formId); };
  context.Forms_getMapping_ = function () { return context.__formMapping; };

  context.Nfb_getActiveProperties_ = function () {
    var store = context.__propsStore;
    return {
      getProperty: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      setProperty: function (k, v) { store[k] = String(v); return this; },
      deleteProperty: function (k) { delete store[k]; return this; },
      getKeys: function () { return Object.keys(store); },
    };
  };

  context.SpreadsheetApp = {
    flush: function () {},
    openById: function (id) {
      return {
        getSheetByName: function (name) {
          var key = id + "::" + name;
          return Object.prototype.hasOwnProperty.call(context.__formSheets, key) ? context.__formSheets[key] : null;
        },
      };
    },
  };

  context.Sheets_purgeExpiredDeletedRows_ = function (sheet, days) {
    context.__purgedSheets.push({ sheet: sheet, days: days });
    return { deletedCount: 0 };
  };
  context.Sheets_getOldestSoftDeletedDate_ = function (sheet) {
    return context.__oldestBySheet.has(sheet) ? context.__oldestBySheet.get(sheet) : null;
  };

  return loadGasFiles(context, ["sheetsDatetime.gs", "codeHandlers.gs", "codeSyncRecords.gs"]);
}

// Sheets_normalizeNumericToUnixMs_ は |n| < 1e11 を serial date とみなして再解釈するため、
// modifiedAtUnixMs は 1e11 以上の正規 Unix ms を使う。
const ACTIVE_MODIFIED_MS = 1700000000000;  // 2023-11-14 頃
const DELETED_AT_MS = 1714540800000;       // 2024-05-01 頃
const DELETED_MODIFIED_MS = 1714540800000;
const READ_THRESHOLD_MS = 1600000000000;   // 2020-09-13 頃（両レコードより古い）

const activeRecord = { id: "r1", deletedAt: null, deletedAtUnixMs: null, modifiedAt: "", modifiedAtUnixMs: ACTIVE_MODIFIED_MS, data: {}, dataUnixMs: {} };
const deletedRecord = { id: "r2", deletedAt: "2026-05-01_12:00:00", deletedAtUnixMs: DELETED_AT_MS, modifiedAt: "", modifiedAtUnixMs: DELETED_MODIFIED_MS, data: {}, dataUnixMs: {} };

test("ListRecords_: 管理者は削除済みを含む全レコードを取得", () => {
  const ctx = loadContext({ isAdmin: true });
  ctx.__testRecords = [activeRecord, deletedRecord];
  const result = ctx.ListRecords_({
    spreadsheetId: "ss1",
    sheetName: "Data",
    forceFullSync: true,
    raw: { authKey: "ADMIN_KEY" },
  });
  assert.equal(result.ok, true);
  assert.equal(result.records.length, 2);
  assert.deepEqual(result.records.map((r) => r.id).sort(), ["r1", "r2"]);
});

test("ListRecords_: 非管理者は削除済みを除外", () => {
  const ctx = loadContext({ isAdmin: false });
  ctx.__testRecords = [activeRecord, deletedRecord];
  const result = ctx.ListRecords_({
    spreadsheetId: "ss1",
    sheetName: "Data",
    forceFullSync: true,
    raw: { authKey: "" },
  });
  assert.equal(result.ok, true);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].id, "r1");
});

test("ListRecords_: 非管理者でデルタ経路も削除済みを除外", () => {
  const ctx = loadContext({ isAdmin: false });
  ctx.__testRecords = [activeRecord, deletedRecord];
  const result = ctx.ListRecords_({
    spreadsheetId: "ss1",
    sheetName: "Data",
    forceFullSync: false,
    lastSpreadsheetReadAt: READ_THRESHOLD_MS,
    raw: { authKey: "" },
  });
  assert.equal(result.ok, true);
  assert.equal(result.isDelta, true);
  // r1 のみ更新閾値 < modifiedAt で残り、削除済み r2 はフィルタ除外
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].id, "r1");
});

test("GetRecord_: 非管理者が削除済み ID 取得 → Record not found", () => {
  const ctx = loadContext({ isAdmin: false });
  ctx.__testGetRecord = { ok: true, record: deletedRecord, rowIndex: 2 };
  const result = ctx.GetRecord_({
    id: "r2",
    spreadsheetId: "ss1",
    sheetName: "Data",
    raw: { authKey: "" },
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "Record not found");
});

test("GetRecord_: 管理者は削除済み ID も取得可", () => {
  const ctx = loadContext({ isAdmin: true });
  ctx.__testGetRecord = { ok: true, record: deletedRecord, rowIndex: 2 };
  const result = ctx.GetRecord_({
    id: "r2",
    spreadsheetId: "ss1",
    sheetName: "Data",
    raw: { authKey: "ADMIN_KEY" },
  });
  assert.equal(result.ok, true);
  assert.ok(result.record);
  assert.equal(result.record.id, "r2");
});

test("GetRecord_: 非管理者でも未削除レコードは取得可", () => {
  const ctx = loadContext({ isAdmin: false });
  ctx.__testGetRecord = { ok: true, record: activeRecord, rowIndex: 1 };
  const result = ctx.GetRecord_({
    id: "r1",
    spreadsheetId: "ss1",
    sheetName: "Data",
    raw: { authKey: "" },
  });
  assert.equal(result.ok, true);
  assert.equal(result.record.id, "r1");
});

test("SyncRecords_: 非管理者は forceFullSync 経路で削除済みを除外", () => {
  const ctx = loadContext({ isAdmin: false });
  ctx.__testRecords = [activeRecord, deletedRecord];
  const result = ctx.SyncRecords_({
    spreadsheetId: "ss1",
    sheetName: "Data",
    raw: { authKey: "", forceFullSync: true, uploadRecords: [], lastServerReadAt: 0 },
  });
  assert.equal(result.ok, true);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].id, "r1");
});

test("SyncRecords_: 管理者は forceFullSync 経路で全件取得", () => {
  const ctx = loadContext({ isAdmin: true });
  ctx.__testRecords = [activeRecord, deletedRecord];
  const result = ctx.SyncRecords_({
    spreadsheetId: "ss1",
    sheetName: "Data",
    raw: { authKey: "ADMIN_KEY", forceFullSync: true, uploadRecords: [], lastServerReadAt: 0 },
  });
  assert.equal(result.ok, true);
  assert.equal(result.records.length, 2);
});

test("SyncRecords_: 非管理者はデルタ経路でも削除済みを除外", () => {
  const ctx = loadContext({ isAdmin: false });
  ctx.__testRecords = [activeRecord, deletedRecord];
  const result = ctx.SyncRecords_({
    spreadsheetId: "ss1",
    sheetName: "Data",
    raw: { authKey: "", forceFullSync: false, uploadRecords: [], lastServerReadAt: READ_THRESHOLD_MS },
  });
  assert.equal(result.ok, true);
  assert.equal(result.isDelta, true);
  // r1 のみ更新閾値 < modifiedAt で残り、削除済み r2 はフィルタ除外
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].id, "r1");
});

test("Nfb_isSoftDeletedRecord_: deletedAtUnixMs 数値 / deletedAt 文字列いずれも検出", () => {
  const ctx = loadContext();
  assert.equal(ctx.Nfb_isSoftDeletedRecord_(null), false);
  assert.equal(ctx.Nfb_isSoftDeletedRecord_({}), false);
  assert.equal(ctx.Nfb_isSoftDeletedRecord_({ deletedAt: null, deletedAtUnixMs: null }), false);
  assert.equal(ctx.Nfb_isSoftDeletedRecord_({ deletedAt: "", deletedAtUnixMs: 0 }), false);
  assert.equal(ctx.Nfb_isSoftDeletedRecord_({ deletedAt: null, deletedAtUnixMs: 1714540800000 }), true);
  assert.equal(ctx.Nfb_isSoftDeletedRecord_({ deletedAt: "2026-05-01_12:00:00", deletedAtUnixMs: null }), true);
});

// === purge 監視オーケストレーション（gas/codeHandlers.gs） ===

const DAY_MS = 24 * 60 * 60 * 1000;
const isoDaysAgo = (days) => new Date(Date.now() - days * DAY_MS).toISOString();
const formWithSheet = (ssId, sheetName, retentionDays) => ({
  settings: {
    spreadsheetId: ssId,
    sheetName: sheetName,
    ...(retentionDays ? { deletedRetentionDays: retentionDays } : {}),
  },
});

test("Nfb_registerSoftDeleteForPurge_: 未登録なら現在時刻でマーク、既存値は保持", () => {
  const ctx = loadContext();
  ctx.Nfb_registerSoftDeleteForPurge_("f1");
  const first = ctx.__propsStore["purge:f1"];
  assert.ok(first && !Number.isNaN(Date.parse(first)), "ISO 文字列が登録される");

  // 2 回目は上書きしない（最古を保持）
  ctx.Nfb_registerSoftDeleteForPurge_("f1");
  assert.equal(ctx.__propsStore["purge:f1"], first);

  // formId 空は何もしない
  ctx.Nfb_registerSoftDeleteForPurge_("");
  assert.equal(ctx.__propsStore["purge:"], undefined);
});

test("Nfb_runPurgeCheckForForm_: 監視対象外(null)/未削除(空)/保持期間内は purge しない", () => {
  const ctx = loadContext();
  // null
  ctx.Nfb_runPurgeCheckForForm_("f1");
  assert.equal(ctx.__purgedSheets.length, 0);
  // 空
  ctx.__propsStore["purge:f1"] = "";
  ctx.Nfb_runPurgeCheckForForm_("f1");
  assert.equal(ctx.__purgedSheets.length, 0);
  // 保持期間内（5 日前 < 30 日）
  ctx.__propsStore["purge:f1"] = isoDaysAgo(5);
  ctx.__forms.f1 = formWithSheet("ss1", "Data");
  ctx.__formSheets["ss1::Data"] = { __id: "s1" };
  ctx.Nfb_runPurgeCheckForForm_("f1");
  assert.equal(ctx.__purgedSheets.length, 0);
});

test("Nfb_runPurgeCheckForForm_: 保持期間超なら purge し、残存最古日でキー更新", () => {
  const ctx = loadContext();
  const sheet = { __id: "s1" };
  ctx.__propsStore["purge:f1"] = isoDaysAgo(40);  // 40 日前 > 30 日
  ctx.__forms.f1 = formWithSheet("ss1", "Data");
  ctx.__formSheets["ss1::Data"] = sheet;
  const remainingOldest = new Date(Date.now() - 10 * DAY_MS);
  ctx.__oldestBySheet.set(sheet, remainingOldest);

  ctx.Nfb_runPurgeCheckForForm_("f1");

  assert.equal(ctx.__purgedSheets.length, 1);
  assert.equal(ctx.__purgedSheets[0].sheet, sheet);
  assert.equal(ctx.__propsStore["purge:f1"], remainingOldest.toISOString());
});

test("Nfb_runPurgeCheckForForm_: purge 後に残存なしならキーを空にする", () => {
  const ctx = loadContext();
  const sheet = { __id: "s1" };
  ctx.__propsStore["purge:f1"] = isoDaysAgo(40);
  ctx.__forms.f1 = formWithSheet("ss1", "Data");
  ctx.__formSheets["ss1::Data"] = sheet;
  ctx.__oldestBySheet.set(sheet, null);  // 残存なし

  ctx.Nfb_runPurgeCheckForForm_("f1");

  assert.equal(ctx.__purgedSheets.length, 1);
  assert.equal(ctx.__propsStore["purge:f1"], "");
});

test("Nfb_runPurgeCheckForForm_: シートが開けなければキーを空にして purge しない", () => {
  const ctx = loadContext();
  ctx.__propsStore["purge:f1"] = isoDaysAgo(40);
  ctx.__forms.f1 = formWithSheet("ss-missing", "Data");  // __formSheets に登録なし → null

  ctx.Nfb_runPurgeCheckForForm_("f1");

  assert.equal(ctx.__purgedSheets.length, 0);
  assert.equal(ctx.__propsStore["purge:f1"], "");
});

test("Nfb_syncPurgeKeysWithForms_: 新規フォームを登録し、削除済みフォームのキーを除去", () => {
  const ctx = loadContext();
  // f1: mapping にあり未監視・シートあり（残存最古 = 7 日前）
  const sheet1 = { __id: "s1" };
  ctx.__formMapping = { f1: { fileId: "file1" }, f3: { fileId: "file3" } };
  ctx.__forms.f1 = formWithSheet("ss1", "Data");
  ctx.__formSheets["ss1::Data"] = sheet1;
  const oldest1 = new Date(Date.now() - 7 * DAY_MS);
  ctx.__oldestBySheet.set(sheet1, oldest1);
  // f3: mapping にあり未監視・シート未設定 → 空登録
  ctx.__forms.f3 = { settings: {} };
  // f2: 監視中だが mapping に無い → キー削除対象
  ctx.__propsStore["purge:f2"] = isoDaysAgo(3);

  ctx.Nfb_syncPurgeKeysWithForms_();

  assert.equal(ctx.__propsStore["purge:f1"], oldest1.toISOString(), "新規 f1 はスキャンして最古日を登録");
  assert.equal(ctx.__propsStore["purge:f3"], "", "シート未設定 f3 は空登録");
  assert.equal(Object.prototype.hasOwnProperty.call(ctx.__propsStore, "purge:f2"), false, "削除済み f2 のキーは除去");
});

test("Nfb_syncPurgeKeysWithForms_: 既に監視中のフォームは再スキャンしない", () => {
  const ctx = loadContext();
  ctx.__formMapping = { f1: { fileId: "file1" } };
  ctx.__forms.f1 = formWithSheet("ss1", "Data");
  ctx.__formSheets["ss1::Data"] = { __id: "s1" };
  const existing = isoDaysAgo(3);
  ctx.__propsStore["purge:f1"] = existing;  // 既に監視中

  ctx.Nfb_syncPurgeKeysWithForms_();

  assert.equal(ctx.__purgedSheets.length, 0, "監視中フォームは突合で再スキャンされない");
  assert.equal(ctx.__propsStore["purge:f1"], existing, "監視中フォームの値は不変");
});
