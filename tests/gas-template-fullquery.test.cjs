/**
 * GAS テンプレート評価器の full-query ハードニング検証。
 *
 * GAS にはクエリエンジンが無いため、`{{SELECT ...}}`（full-query トークン）は
 * 評価せずリテラル/フォールバックで残す（クライアントが出力前に事前解決する前提。
 * Google Doc 本文などクライアント payload を通らない経路では原文が残る）。
 *
 * gas/templateEvaluator.gs を vm で読み込み（module.exports 経路は通らない＝
 * context のグローバルに関数が定義される）、full-query 単独テンプレを検証する。
 * 非 full-query トークンは nfbEvaluateExpression_（別ファイル）を要するため本テストでは扱わない。
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadGasTemplateEvaluator() {
  const context = { console };
  vm.createContext(context);
  const gasFile = path.join(__dirname, "..", "gas", "templateEvaluator.gs");
  vm.runInContext(fs.readFileSync(gasFile, "utf8"), context, { filename: gasFile });
  return context;
}

const gas = loadGasTemplateEvaluator();

test("nfbTplIsFullQueryBody_: 先頭 SELECT のみ true", () => {
  assert.equal(typeof gas.nfbTplIsFullQueryBody_, "function");
  assert.ok(gas.nfbTplIsFullQueryBody_("SELECT [a] FROM _form"));
  assert.ok(gas.nfbTplIsFullQueryBody_("  select 1"));
  assert.ok(!gas.nfbTplIsFullQueryBody_("`氏名`"));
  assert.ok(!gas.nfbTplIsFullQueryBody_("UPPER(`x`)"));
  assert.ok(!gas.nfbTplIsFullQueryBody_(""));
});

test("nfbEvaluateTemplate_: full-query トークンは原文のまま残す（fallback 未指定）", () => {
  const out = gas.nfbEvaluateTemplate_("件数: {{SELECT COUNT(*) FROM [子]}} 件", {});
  assert.equal(out, "件数: {{SELECT COUNT(*) FROM [子]}} 件");
});

test("nfbEvaluateTemplate_: full-query トークンは fallback 指定で置換", () => {
  const out = gas.nfbEvaluateTemplate_("x {{SELECT 1}} y", {}, { fallback: "" });
  assert.equal(out, "x  y");
});

test("nfbEvaluateTemplate_: full-query を式評価に渡さず throw しない", () => {
  // nfbEvaluateExpression_ は本 vm に無いが、full-query は評価前に分岐するので呼ばれない。
  assert.doesNotThrow(() => gas.nfbEvaluateTemplate_("{{SELECT 1}}", {}));
});

test("nfbEvaluateTemplate_: 著者エスケープ \\{ \\} は従来どおりリテラル化", () => {
  // クライアントが \{ でエスケープした full-query 結果が GAS でリテラル { } に戻ることの担保。
  assert.equal(gas.nfbEvaluateTemplate_("a \\{x\\} b", {}), "a {x} b");
});
