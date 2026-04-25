const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadGasContext({ parseDateLikeReturn } = {}) {
  const context = {
    console,
    Logger: { log() {} },
    NFB_HEADER_DEPTH: 11,
    NFB_HEADER_START_ROW: 1,
    NFB_DATA_START_ROW: 12,
    NFB_FIXED_HEADER_PATHS: [],
    NFB_RESERVED_HEADER_KEYS: {},
    Sheets_ensureRowCapacity_: () => {},
    Sheets_ensureColumnExists_: () => {},
    Sheets_touchSheetLastUpdated_: () => {},
    Sheets_parseDateLikeToJstDate_: () => parseDateLikeReturn || null,
  };

  vm.createContext(context);

  const projectRoot = path.join(__dirname, "..");
  const sourceFile = path.join(projectRoot, "gas", "sheetsRowOps.gs");
  const code = fs.readFileSync(sourceFile, "utf8");
  vm.runInContext(code, context, { filename: sourceFile });

  return context;
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

test("Sheets_resolveTemporalCell_ は date parser 失敗時の formula プレフィックスを中和する", () => {
  const gas = loadGasContext({ parseDateLikeReturn: null });
  const result = gas.Sheets_resolveTemporalCell_("=A1+1", "date");
  assert.deepEqual(toPlain(result), { value: "'=A1+1", numberFormat: null });
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

test("Sheets_resolveTemporalCell_ は正常な日付値で Date と numberFormat を返す", () => {
  const fakeDate = new Date(2026, 0, 1);
  const gas = loadGasContext({ parseDateLikeReturn: fakeDate });
  const result = gas.Sheets_resolveTemporalCell_("2026/01/01", "date");
  assert.equal(result.value, fakeDate);
  assert.equal(result.numberFormat, "yyyy/MM/dd");
});
