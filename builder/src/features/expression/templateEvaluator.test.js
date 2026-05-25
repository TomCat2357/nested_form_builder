import assert from "node:assert/strict";
import test from "node:test";
import {
  extractExpressions,
  resolveTemplate,
  resolveTemplateAsync,
  precompileTemplate,
  extractFieldRefs,
} from "./templateEvaluator.js";
import {
  _clearExpressionCacheForTest,
  _registerCompiledForTest,
} from "./alasqlExpressionEvaluator.js";

// テストでは alasql 本体を読み込まない。代わりに precompiled wrapper を直接登録し、
// templateEvaluator のスキャン → preprocess → 同期評価のオーケストレーションを検証する。

function setup() {
  _clearExpressionCacheForTest();
}

// ---------------------------------------------------------------------------
// extractExpressions
// ---------------------------------------------------------------------------

test("extractExpressions: 単一", () => {
  setup();
  assert.deepEqual(
    extractExpressions("{UPPER(`氏名`)}"),
    ["UPPER(`氏名`)"]
  );
});

test("extractExpressions: 複数 (重複保持)", () => {
  setup();
  assert.deepEqual(
    extractExpressions("{`a`}-{`b`}-{`a`}"),
    ["`a`", "`b`", "`a`"]
  );
});

test("extractExpressions: パイプ列名は __ に正規化される", () => {
  setup();
  assert.deepEqual(
    extractExpressions("{`基本情報|区`}"),
    ["`基本情報__区`"]
  );
});

test("extractExpressions: 空テンプレートで空配列", () => {
  setup();
  assert.deepEqual(extractExpressions(""), []);
  assert.deepEqual(extractExpressions(null), []);
  assert.deepEqual(extractExpressions(undefined), []);
});

test("extractExpressions: 空 {} はスキップ", () => {
  setup();
  assert.deepEqual(extractExpressions("{} {`a`}"), ["`a`"]);
});

// ---------------------------------------------------------------------------
// resolveTemplate (sync)
// ---------------------------------------------------------------------------

test("resolveTemplate: 単一式の評価", () => {
  setup();
  _registerCompiledForTest("UPPER(`氏名`)", (row) => String(row["氏名"] || "").toUpperCase());
  const out = resolveTemplate("Hello {UPPER(`氏名`)}!", { 氏名: "tanaka" });
  assert.equal(out, "Hello TANAKA!");
});

test("resolveTemplate: 文字列連結", () => {
  setup();
  _registerCompiledForTest("`姓` || `名`", (row) => String(row["姓"] || "") + String(row["名"] || ""));
  const out = resolveTemplate("{`姓` || `名`}", { 姓: "山田", 名: "太郎" });
  assert.equal(out, "山田太郎");
});

test("resolveTemplate: 複数トークン", () => {
  setup();
  _registerCompiledForTest("`a`", (row) => row["a"]);
  _registerCompiledForTest("`b`", (row) => row["b"]);
  const out = resolveTemplate("{`a`}+{`b`}", { a: "X", b: "Y" });
  assert.equal(out, "X+Y");
});

test("resolveTemplate: 数値結果は文字列化", () => {
  setup();
  _registerCompiledForTest("`x` + 1", (row) => Number(row["x"]) + 1);
  const out = resolveTemplate("[{`x` + 1}]", { x: 41 });
  assert.equal(out, "[42]");
});

test("resolveTemplate: null/undefined は空文字", () => {
  setup();
  _registerCompiledForTest("`miss`", () => null);
  const out = resolveTemplate("[{`miss`}]", {});
  assert.equal(out, "[]");
});

test("resolveTemplate: 未 precompile の式は fallback (既定 \"\")", () => {
  setup();
  // 何も登録しない
  const origWarn = console.warn;
  console.warn = () => {};
  try {
    const out = resolveTemplate("{UPPER(`氏名`)}", { 氏名: "tanaka" });
    assert.equal(out, "");
  } finally {
    console.warn = origWarn;
  }
});

test("resolveTemplate: 評価エラー時は fallback、logError が呼ばれる", () => {
  setup();
  _registerCompiledForTest("THROW(`x`)", () => { throw new Error("boom"); });
  let captured = null;
  const out = resolveTemplate("{THROW(`x`)}", { x: 1 }, {
    fallback: "<err>",
    logError: (err, fullToken) => { captured = { msg: err.message, fullToken }; },
  });
  assert.equal(out, "<err>");
  assert.equal(captured.msg, "boom");
  assert.equal(captured.fullToken, "{THROW(`x`)}");
});

test("resolveTemplate: { が無いテキストはそのまま", () => {
  setup();
  assert.equal(resolveTemplate("plain text", {}), "plain text");
});

test("resolveTemplate: null/undefined は空", () => {
  setup();
  assert.equal(resolveTemplate(null, {}), "");
  assert.equal(resolveTemplate(undefined, {}), "");
  assert.equal(resolveTemplate("", {}), "");
});

test("resolveTemplate: \\{ と \\} はリテラル", () => {
  setup();
  _registerCompiledForTest("`x`", (row) => row["x"]);
  const out = resolveTemplate("\\{not\\}-{`x`}", { x: "Y" });
  assert.equal(out, "{not}-Y");
});

test("resolveTemplate: 真偽値は true/false 文字列", () => {
  setup();
  _registerCompiledForTest("`flag`", (row) => row["flag"]);
  assert.equal(resolveTemplate("{`flag`}", { flag: true }), "true");
  assert.equal(resolveTemplate("{`flag`}", { flag: false }), "false");
});

test("resolveTemplate: 配列はカンマ区切り、name 抽出を尊重", () => {
  setup();
  _registerCompiledForTest("`files`", (row) => row["files"]);
  const out = resolveTemplate("{`files`}", { files: ["a.pdf", "b.pdf"] });
  assert.equal(out, "a.pdf, b.pdf");
});

test("resolveTemplate: ネストした {} はトップレベルの 1 トークンとして渡される", () => {
  setup();
  // ネスト式は templateEvaluator のスコープ外。bodyは {b{c}d} という生文字列のまま
  // preprocess + eval する。eval で正常な alasql 式でなければ fallback。
  _registerCompiledForTest("a{b{c}d}e", (row) => row["raw"]);
  const out = resolveTemplate("X{a{b{c}d}e}Y", { raw: "Z" });
  assert.equal(out, "XZY");
});

// ---------------------------------------------------------------------------
// resolveTemplateAsync
// ---------------------------------------------------------------------------

test("resolveTemplateAsync: 単一式の評価", async () => {
  setup();
  _registerCompiledForTest("UPPER(`氏名`)", (row) => String(row["氏名"] || "").toUpperCase());
  const out = await resolveTemplateAsync("Hello {UPPER(`氏名`)}!", { 氏名: "yamada" });
  assert.equal(out, "Hello YAMADA!");
});

test("resolveTemplateAsync: { が無いテキストはそのまま", async () => {
  setup();
  assert.equal(await resolveTemplateAsync("plain", {}), "plain");
});

test("resolveTemplateAsync: null は空", async () => {
  setup();
  assert.equal(await resolveTemplateAsync(null, {}), "");
});

// ---------------------------------------------------------------------------
// precompileTemplate
// ---------------------------------------------------------------------------

test("precompileTemplate: 空テンプレートは何もしない", async () => {
  setup();
  await precompileTemplate("");
  await precompileTemplate(null);
  // エラーが投げられなければ OK
  assert.ok(true);
});

// ---------------------------------------------------------------------------
// extractFieldRefs
// ---------------------------------------------------------------------------

test("extractFieldRefs: 単一フィールド", () => {
  assert.deepEqual(extractFieldRefs("{`氏名`}"), ["氏名"]);
});

test("extractFieldRefs: 複数フィールドを重複除去", () => {
  assert.deepEqual(
    extractFieldRefs("{`姓`}{`名`}{`姓`}"),
    ["姓", "名"]
  );
});

test("extractFieldRefs: 関数引数内のフィールド", () => {
  assert.deepEqual(
    extractFieldRefs("{UPPER(LEFT(`氏名`, 3))}"),
    ["氏名"]
  );
});

test("extractFieldRefs: 予約名 (_ 始まり) は除外", () => {
  assert.deepEqual(extractFieldRefs("{TIME_FORMAT(NOW(), 'YYYY')}"), []);
  assert.deepEqual(extractFieldRefs("{`_id`}"), []);
  assert.deepEqual(extractFieldRefs("{`_record_url`}"), []);
});

test("extractFieldRefs: 空入力", () => {
  assert.deepEqual(extractFieldRefs(""), []);
  assert.deepEqual(extractFieldRefs(null), []);
  assert.deepEqual(extractFieldRefs(undefined), []);
});

test("extractFieldRefs: { が無いと空配列", () => {
  assert.deepEqual(extractFieldRefs("`氏名`"), []);
});

test("extractFieldRefs: 演算子で連結された複数参照", () => {
  assert.deepEqual(
    extractFieldRefs("{`a` || `b` || `c`}"),
    ["a", "b", "c"]
  );
});

test("extractFieldRefs: トークン跨ぎでも重複除去", () => {
  assert.deepEqual(
    extractFieldRefs("{`a`}-{`b`}-{`a`}"),
    ["a", "b"]
  );
});

test("extractFieldRefs: 文字列リテラルは識別子と区別される", () => {
  // バッククォート以外は識別子扱いされない
  assert.deepEqual(extractFieldRefs("{IIF(`x` = 'リテラル', 1, 0)}"), ["x"]);
});
