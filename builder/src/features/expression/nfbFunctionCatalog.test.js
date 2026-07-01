import test from "node:test";
import assert from "node:assert/strict";

import { ensureNfbUdfsRegistered } from "./registerNfbUdfs.js";
import { NFB_FUNCTION_CATALOG, catalogInsertSnippet } from "./nfbFunctionCatalog.js";

// ────────────────────────────────────────────────────────────
// ドリフト検知: 手書きカタログ（kind:"udf"/"aggr"）と registerNfbUdfs.js の
// 登録実体が一致していることを担保する。新 UDF 追加時にカタログ更新を促す。
// ────────────────────────────────────────────────────────────

// registerNfbUdfs.js は alasql.fn.* / alasql.aggr.* に代入するだけなので、
// スタブ {} を渡せば登録名の集合が得られる。
function registeredNames() {
  const alasql = {};
  ensureNfbUdfsRegistered(alasql);
  const fn = Object.keys(alasql.fn || {}).filter((k) => typeof alasql.fn[k] === "function");
  const aggr = Object.keys(alasql.aggr || {}).filter((k) => typeof alasql.aggr[k] === "function");
  return { fn: new Set(fn), aggr: new Set(aggr) };
}

// カタログから kind 別の name 集合を取り出す。
function catalogNamesByKind(kind) {
  const out = new Set();
  for (const group of NFB_FUNCTION_CATALOG) {
    for (const item of group.items) {
      if (item.kind === kind) out.add(item.name);
    }
  }
  return out;
}

// 登録済みだがカタログに載せないもの（現状なし）。内部専用 UDF を足したらここに記す。
const CATALOG_EXCLUDE_UDF = new Set();
const CATALOG_EXCLUDE_AGGR = new Set();

test("カタログの kind:'udf' はすべて alasql.fn に登録済み", () => {
  const { fn } = registeredNames();
  for (const name of catalogNamesByKind("udf")) {
    assert.ok(fn.has(name), `UDF '${name}' が registerNfbUdfs.js に登録されていない`);
  }
});

test("カタログの kind:'aggr' はすべて alasql.aggr に登録済み", () => {
  const { aggr } = registeredNames();
  for (const name of catalogNamesByKind("aggr")) {
    assert.ok(aggr.has(name), `集計 UDF '${name}' が registerNfbUdfs.js に登録されていない`);
  }
});

test("登録済み UDF はすべてカタログに載っている（除外リストを除く）", () => {
  const { fn } = registeredNames();
  const catalog = catalogNamesByKind("udf");
  for (const name of fn) {
    if (CATALOG_EXCLUDE_UDF.has(name)) continue;
    assert.ok(catalog.has(name), `登録済み UDF '${name}' がカタログに未掲載（nfbFunctionCatalog.js を更新）`);
  }
});

test("登録済み集計 UDF はすべてカタログに載っている（除外リストを除く）", () => {
  const { aggr } = registeredNames();
  const catalog = catalogNamesByKind("aggr");
  for (const name of aggr) {
    if (CATALOG_EXCLUDE_AGGR.has(name)) continue;
    assert.ok(catalog.has(name), `登録済み集計 UDF '${name}' がカタログに未掲載（nfbFunctionCatalog.js を更新）`);
  }
});

// ────────────────────────────────────────────────────────────
// カタログ整合性
// ────────────────────────────────────────────────────────────

test("全 item に name / kind / description がある", () => {
  const kinds = new Set(["udf", "aggr", "native", "token"]);
  for (const group of NFB_FUNCTION_CATALOG) {
    for (const item of group.items) {
      assert.ok(item.name, `name 欠落: ${JSON.stringify(item)}`);
      assert.ok(kinds.has(item.kind), `未知の kind '${item.kind}' (${item.name})`);
      assert.ok(item.description, `description 欠落: ${item.name}`);
    }
  }
});

test("name はカタログ全体で一意", () => {
  const seen = new Set();
  for (const group of NFB_FUNCTION_CATALOG) {
    for (const item of group.items) {
      assert.ok(!seen.has(item.name), `name 重複: ${item.name}`);
      seen.add(item.name);
    }
  }
});

// ────────────────────────────────────────────────────────────
// 挿入スニペット組み立て
// ────────────────────────────────────────────────────────────

test("catalogInsertSnippet: 関数系は snippet か NAME()", () => {
  assert.equal(catalogInsertSnippet({ kind: "udf", name: "NENDO" }), "NENDO()");
  assert.equal(catalogInsertSnippet({ kind: "udf", name: "LPAD", snippet: "LPAD(, , '0')" }), "LPAD(, , '0')");
  assert.equal(catalogInsertSnippet({ kind: "native", name: "COUNT", snippet: "COUNT(*)" }), "COUNT(*)");
});

test("catalogInsertSnippet: token はバッククォート参照", () => {
  assert.equal(catalogInsertSnippet({ kind: "token", name: "_id" }), "`_id`");
});
