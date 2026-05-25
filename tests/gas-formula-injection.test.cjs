const assert = require("node:assert/strict");
const test = require("node:test");
const { loadGasFiles } = require("./helpers/gasVmLoader.cjs");

function loadGasContext() {
  const context = {
    console,
    Logger: { log() {} },
    NFB_HEADER_DEPTH: 11,
    NFB_HEADER_START_ROW: 1,
    NFB_DATA_START_ROW: 12,
    NFB_FIXED_HEADER_PATHS: [],
    NFB_RESERVED_HEADER_KEYS: {},
    NFB_SHEETS_DATE_FORMAT: "yyyy/mm/dd",
    NFB_SHEETS_TIME_FORMAT: "hh:mm:ss",
    NFB_SHEETS_DATETIME_FORMAT: "yyyy/mm/dd hh:mm:ss",
    Sheets_ensureRowCapacity_: () => {},
    Sheets_ensureColumnExists_: () => {},
    Sheets_touchSheetLastUpdated_: () => {},
  };

  // Sheets_resolveTemporalCell_ は nfbDt_formatCanonical_（expressionEvaluator.gs → NfbAlasqlRuntime）と
  // Sheets_canonicalToSheetDate_（sheetsDatetime.gs）に依存。
  return loadGasFiles(context, [
    "generated/nfbAlasqlUdfs.gs",
    "expressionEvaluator.gs",
    "sheetsDatetime.gs",
    "sheetsRowOps.gs",
  ]);
}

function toPlain(value) {
  return JSON.parse(JSON.stringify(value));
}

test("Sheets_neutralizeFormulaPrefix_ は = で始まる文字列に ' を前置する", () => {
  const gas = loadGasContext();
  assert.equal(gas.Sheets_neutralizeFormulaPrefix_("=HYPERLINK(\"x\",\"y\")"), "'=HYPERLINK(\"x\",\"y\")");
});

test("Sheets_neutralizeFormulaPrefix_ は + - @ で始まる文字列に ' を前置する", () => {
  const gas = loadGasContext();
  assert.equal(gas.Sheets_neutralizeFormulaPrefix_("+1"), "'+1");
  assert.equal(gas.Sheets_neutralizeFormulaPrefix_("-2"), "'-2");
  assert.equal(gas.Sheets_neutralizeFormulaPrefix_("@SUM(A:A)"), "'@SUM(A:A)");
});

test("Sheets_neutralizeFormulaPrefix_ は TAB / CR で始まる文字列に ' を前置する", () => {
  const gas = loadGasContext();
  assert.equal(gas.Sheets_neutralizeFormulaPrefix_("\tfoo"), "'\tfoo");
  assert.equal(gas.Sheets_neutralizeFormulaPrefix_("\rfoo"), "'\rfoo");
});

test("Sheets_neutralizeFormulaPrefix_ は通常文字列・空文字を変更しない", () => {
  const gas = loadGasContext();
  assert.equal(gas.Sheets_neutralizeFormulaPrefix_("hello"), "hello");
  assert.equal(gas.Sheets_neutralizeFormulaPrefix_(""), "");
  assert.equal(gas.Sheets_neutralizeFormulaPrefix_("123"), "123");
});

test("Sheets_neutralizeFormulaPrefix_ は非文字列をそのまま返す", () => {
  const gas = loadGasContext();
  assert.equal(gas.Sheets_neutralizeFormulaPrefix_(null), null);
  assert.equal(gas.Sheets_neutralizeFormulaPrefix_(undefined), undefined);
  assert.equal(gas.Sheets_neutralizeFormulaPrefix_(42), 42);
});

test("Sheets_neutralizeFormulaPrefix_ は既に ' で始まる文字列を二重プレフィックスしない", () => {
  const gas = loadGasContext();
  assert.equal(gas.Sheets_neutralizeFormulaPrefix_("'=raw"), "'=raw");
});

test("Sheets_resolveTemporalCell_ は非 temporal 値の formula プレフィックスを中和する", () => {
  const gas = loadGasContext();
  const result = gas.Sheets_resolveTemporalCell_("=A1+1", null);
  assert.deepEqual(toPlain(result), { value: "'=A1+1", numberFormat: null });
});

test("Sheets_resolveTemporalCell_ は date パース失敗時に formula プレフィックスを中和しテキスト書式にする", () => {
  const gas = loadGasContext();
  const result = gas.Sheets_resolveTemporalCell_("=A1+1", "date");
  assert.deepEqual(toPlain(result), { value: "'=A1+1", numberFormat: "@" });
});

test("Sheets_resolveTemporalCell_ は空文字をそのまま返す", () => {
  const gas = loadGasContext();
  const result = gas.Sheets_resolveTemporalCell_("", null);
  assert.deepEqual(toPlain(result), { value: "", numberFormat: null });
});

test("Sheets_resolveTemporalCell_ は通常文字列を変更しない", () => {
  const gas = loadGasContext();
  const result = gas.Sheets_resolveTemporalCell_("普通の回答", null);
  assert.deepEqual(toPlain(result), { value: "普通の回答", numberFormat: null });
});

test("Sheets_resolveTemporalCell_ は date / time 値を数値の日時シリアル値 (Date) + 日付/時刻書式 で返す", () => {
  const gas = loadGasContext();
  // vm コンテキスト内で生成された Date は test 側 realm と別コンストラクタなので getTime() で比較する
  const result = gas.Sheets_resolveTemporalCell_("2026/1/1", "date");
  assert.equal(result.value.getTime(), new Date(2026, 0, 1, 0, 0, 0, 0).getTime());
  assert.equal(result.numberFormat, "yyyy/mm/dd");
  const t = gas.Sheets_resolveTemporalCell_("13:01", "time");
  // 時刻シリアルの基準日 1899-12-30
  assert.equal(t.value.getTime(), new Date(1899, 11, 30, 13, 1, 0, 0).getTime());
  assert.equal(t.numberFormat, "hh:mm:ss");
  // datetime を time フィールドに入れたら時刻のみ残す
  const t2 = gas.Sheets_resolveTemporalCell_("2026-01-01 22:23:34", "time");
  assert.equal(t2.value.getTime(), new Date(1899, 11, 30, 22, 23, 34, 0).getTime());
  assert.equal(t2.numberFormat, "hh:mm:ss");
});
