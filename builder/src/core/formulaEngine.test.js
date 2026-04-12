import test from "node:test";
import assert from "node:assert/strict";
import { extractFormulaDependencies, compileFormula, evaluateFormula } from "./formulaEngine.js";

// ---------------------------------------------------------------------------
// extractFormulaDependencies
// ---------------------------------------------------------------------------

test("extractFormulaDependencies はフィールドラベルを抽出する", () => {
  assert.deepEqual(extractFormulaDependencies("{売上} + {経費}"), ["売上", "経費"]);
});

test("extractFormulaDependencies は null/undefined/空文字で空配列を返す", () => {
  assert.deepEqual(extractFormulaDependencies(null), []);
  assert.deepEqual(extractFormulaDependencies(undefined), []);
  assert.deepEqual(extractFormulaDependencies(""), []);
});

test("extractFormulaDependencies は重複するラベルを除去する", () => {
  assert.deepEqual(extractFormulaDependencies("{売上} + {売上}"), ["売上"]);
});

test("extractFormulaDependencies はブレース内の空白をトリムする", () => {
  assert.deepEqual(extractFormulaDependencies("{ 売上 } + { 経費 }"), ["売上", "経費"]);
});

test("extractFormulaDependencies はトークンなしの数式で空配列を返す", () => {
  assert.deepEqual(extractFormulaDependencies("100 + 200"), []);
});

// ---------------------------------------------------------------------------
// compileFormula
// ---------------------------------------------------------------------------

test("compileFormula は有効な数式をコンパイルする", () => {
  const result = compileFormula("{売上} + {経費}");
  assert.equal(typeof result.fn, "function");
  assert.deepEqual(result.dependencies, ["売上", "経費"]);
  assert.equal(result.error, null);
});

test("compileFormula は空/nullで fn: null, error: null を返す", () => {
  const r1 = compileFormula("");
  assert.equal(r1.fn, null);
  assert.equal(r1.error, null);

  const r2 = compileFormula(null);
  assert.equal(r2.fn, null);
  assert.equal(r2.error, null);

  const r3 = compileFormula(undefined);
  assert.equal(r3.fn, null);
  assert.equal(r3.error, null);
});

test("compileFormula は構文エラーを検出する", () => {
  const result = compileFormula("{売上} +");
  assert.equal(result.fn, null);
  assert.ok(result.error);
  assert.ok(result.error.includes("構文エラー"));
});

test("compileFormula は eval を拒否する", () => {
  const result = compileFormula("eval({x})");
  assert.equal(result.fn, null);
  assert.ok(result.error);
  assert.ok(result.error.includes("使用できないパターン"));
});

test("compileFormula は window を拒否する", () => {
  const result = compileFormula("window.location");
  assert.equal(result.fn, null);
  assert.ok(result.error);
});

test("compileFormula は代入演算子を拒否する", () => {
  const result = compileFormula("{x} = 5");
  assert.equal(result.fn, null);
  assert.ok(result.error);
});

test("compileFormula は文字列リテラルを拒否する", () => {
  const r1 = compileFormula('{x} + "hello"');
  assert.equal(r1.fn, null);
  assert.ok(r1.error);
});

test("compileFormula は Math 関数をサポートする", () => {
  const r1 = compileFormula("max({a}, {b})");
  assert.equal(typeof r1.fn, "function");
  assert.equal(r1.error, null);

  const r2 = compileFormula("Math.floor({a})");
  assert.equal(typeof r2.fn, "function");
  assert.equal(r2.error, null);
});

test("compileFormula は定数 PI, E をサポートする", () => {
  const result = compileFormula("{半径} * PI");
  assert.equal(typeof result.fn, "function");
  assert.equal(result.error, null);
});

test("compileFormula はキャッシュが動作する（同一入力で同一結果）", () => {
  const r1 = compileFormula("{a} + {b}");
  const r2 = compileFormula("{a} + {b}");
  assert.equal(r1, r2);
});

// ---------------------------------------------------------------------------
// evaluateFormula
// ---------------------------------------------------------------------------

test("evaluateFormula は基本的な四則演算を評価する", () => {
  const compiled = compileFormula("{売上} - {経費} * 0.1");
  const result = evaluateFormula(compiled, { "売上": "1000", "経費": "200" });
  assert.equal(result.value, 980);
  assert.equal(result.error, null);
});

test("evaluateFormula は未定義の値を 0 として扱う", () => {
  const compiled = compileFormula("{a} + {b}");
  const result = evaluateFormula(compiled, { "a": "5" });
  assert.equal(result.value, 5);
  assert.equal(result.error, null);
});

test("evaluateFormula は非数値を 0 として扱う", () => {
  const compiled = compileFormula("{a} + 1");
  const result = evaluateFormula(compiled, { "a": "hello" });
  assert.equal(result.value, 1);
  assert.equal(result.error, null);
});

test("evaluateFormula はゼロ除算をエラーとして返す", () => {
  const compiled = compileFormula("{a} / {b}");
  const result = evaluateFormula(compiled, { "a": "1", "b": "0" });
  assert.equal(result.value, null);
  assert.ok(result.error);
  assert.ok(result.error.includes("ゼロ除算"));
});

test("evaluateFormula は 0/0 を NaN エラーとして返す", () => {
  const compiled = compileFormula("{a} / {b}");
  const result = evaluateFormula(compiled, { "a": "0", "b": "0" });
  assert.equal(result.value, null);
  assert.ok(result.error);
  assert.ok(result.error.includes("数値ではありません"));
});

test("evaluateFormula は labelValueMap が undefined でも例外を投げない", () => {
  const compiled = compileFormula("{a} + {b}");
  const result = evaluateFormula(compiled, undefined);
  assert.equal(result.value, 0);
  assert.equal(result.error, null);
});

test("evaluateFormula は labelValueMap が null でも例外を投げない", () => {
  const compiled = compileFormula("{a} + {b}");
  const result = evaluateFormula(compiled, null);
  assert.equal(result.value, 0);
  assert.equal(result.error, null);
});

test("evaluateFormula は compiled.fn が null の場合に空文字を返す", () => {
  const compiled = compileFormula("");
  const result = evaluateFormula(compiled, {});
  assert.equal(result.value, "");
  assert.equal(result.error, null);
});

test("evaluateFormula は compiled.error がある場合にそれを伝搬する", () => {
  const compiled = compileFormula("eval(1)");
  const result = evaluateFormula(compiled, {});
  assert.equal(result.value, null);
  assert.ok(result.error);
});

test("evaluateFormula は浮動小数点精度の問題を緩和する", () => {
  const compiled = compileFormula("{a} + {b}");
  const result = evaluateFormula(compiled, { "a": "0.1", "b": "0.2" });
  assert.equal(result.value, 0.3);
  assert.equal(result.error, null);
});

test("evaluateFormula は Math 関数を正しく評価する", () => {
  const compiled = compileFormula("max({a}, {b})");
  const result = evaluateFormula(compiled, { "a": "3", "b": "7" });
  assert.equal(result.value, 7);
  assert.equal(result.error, null);
});

test("evaluateFormula は PI 定数を使って計算できる", () => {
  const compiled = compileFormula("{r} * {r} * PI");
  const result = evaluateFormula(compiled, { "r": "1" });
  // toPrecision(15) を通るため精度が若干落ちる
  assert.ok(Math.abs(result.value - Math.PI) < 1e-14);
  assert.equal(result.error, null);
});

test("evaluateFormula は sqrt を正しく評価する", () => {
  const compiled = compileFormula("sqrt({a})");
  const result = evaluateFormula(compiled, { "a": "9" });
  assert.equal(result.value, 3);
  assert.equal(result.error, null);
});

test("evaluateFormula はべき乗演算子を評価する", () => {
  const compiled = compileFormula("{a} ** 2");
  const result = evaluateFormula(compiled, { "a": "5" });
  assert.equal(result.value, 25);
  assert.equal(result.error, null);
});

test("evaluateFormula は剰余演算子を評価する", () => {
  const compiled = compileFormula("{a} % {b}");
  const result = evaluateFormula(compiled, { "a": "10", "b": "3" });
  assert.equal(result.value, 1);
  assert.equal(result.error, null);
});
