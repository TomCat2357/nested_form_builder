/**
 * テンプレート式の戻り値 → 文字列変換のフロント / GAS 等価性テスト。
 *
 * 双子実装:
 *   フロント: builder/src/features/expression/templateEvaluator.js の coerceResultToString
 *             (テスト用フック _coerceResultToStringForTest 経由)
 *   GAS:      gas/templateEvaluator.gs の nfbTplCoerceToString_
 *
 * 物理的に1ファイルへ統合はせず、このテストで両者が同じ入力に同じ文字列を返すことを
 * 担保してドリフトを検知する。
 */

const assert = require("node:assert/strict");
const test = require("node:test");
const { loadGasFiles } = require("./helpers/gasVmLoader.cjs");

// nfbTplCoerceToString_ は NfbAlasqlRuntime（共有ランタイム）へのデリゲート。
// 本テストは「GAS 側デリゲート配線＝フロント実装」の等価性スモークとして維持する。
function loadGasCoerce() {
  const context = loadGasFiles({ console }, ["templateEvaluator.gs"]);
  return context.nfbTplCoerceToString_;
}

async function loadFrontendCoerce() {
  const mod = await import("../builder/src/features/expression/templateEvaluator.js");
  return mod._coerceResultToStringForTest;
}

const circular = {};
circular.self = circular;

const CASES = [
  { name: "null", value: null },
  { name: "undefined", value: undefined },
  { name: "空文字", value: "" },
  { name: "文字列", value: "あいう" },
  { name: "有限数", value: 12.5 },
  { name: "0", value: 0 },
  { name: "Infinity", value: Infinity },
  { name: "-Infinity", value: -Infinity },
  { name: "NaN", value: NaN },
  { name: "true", value: true },
  { name: "false", value: false },
  { name: "Date(valid)", value: new Date("2025-01-02T03:04:05.000Z") },
  { name: "Date(NaN)", value: new Date("not-a-date") },
  { name: "配列(混在 + ネスト + 空フィルタ)", value: [1, "", null, "x", ["y", ""], undefined] },
  { name: "空配列", value: [] },
  { name: "object with .name", value: { name: "Taro", extra: 1 } },
  { name: "object with non-string .name", value: { name: 42 } },
  { name: "object without .name", value: { x: 1, y: 2 } },
  { name: "circular object", value: circular },
];

test("coerceResultToString ≡ nfbTplCoerceToString_", async () => {
  const gasCoerce = loadGasCoerce();
  const feCoerce = await loadFrontendCoerce();
  assert.equal(typeof gasCoerce, "function", "nfbTplCoerceToString_ should load from gas/templateEvaluator.gs");
  assert.equal(typeof feCoerce, "function", "_coerceResultToStringForTest should be exported");
  for (const { name, value } of CASES) {
    const fe = feCoerce(value);
    const gas = gasCoerce(value);
    assert.equal(typeof fe, "string", `frontend coerce should return a string for ${name}`);
    assert.equal(typeof gas, "string", `gas coerce should return a string for ${name}`);
    assert.equal(fe, gas, `coerce mismatch for ${name}: frontend=${JSON.stringify(fe)} gas=${JSON.stringify(gas)}`);
  }
});
