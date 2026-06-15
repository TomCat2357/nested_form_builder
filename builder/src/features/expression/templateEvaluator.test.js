import assert from "node:assert/strict";
import test from "node:test";
import {
  extractExpressions,
  resolveTemplate,
  resolveTemplateAsync,
  precompileTemplate,
  extractFieldRefs,
  extractReservedRefs,
  validateTemplateSyntax,
} from "./templateEvaluator.js";
import {
  _clearExpressionCacheForTest,
  _registerCompiledForTest,
} from "./alasqlExpressionEvaluator.js";
import { escapeBraces, collectBalancedBraces } from "./templateScanner.js";

// テストでは alasql 本体を読み込まない。代わりに precompiled wrapper を直接登録し、
// templateEvaluator のスキャン → preprocess → 同期評価のオーケストレーションを検証する。
//
// 新契約: トークンは二重ブレース `{{ ... }}` のみ。単一ブレース `{ ... }` は
// リテラルテキストとして扱われ、トークン抽出・評価の対象にならない。

function setup() {
  _clearExpressionCacheForTest();
}

// ---------------------------------------------------------------------------
// extractExpressions
// ---------------------------------------------------------------------------

test("extractExpressions: 単一", () => {
  setup();
  assert.deepEqual(
    extractExpressions("{{UPPER(`氏名`)}}"),
    ["UPPER(`氏名`)"]
  );
});

test("extractExpressions: 複数 (重複保持)", () => {
  setup();
  assert.deepEqual(
    extractExpressions("{{`a`}}-{{`b`}}-{{`a`}}"),
    ["`a`", "`b`", "`a`"]
  );
});

test("extractExpressions: パイプ列名は __ に正規化される", () => {
  setup();
  assert.deepEqual(
    extractExpressions("{{`基本情報|区`}}"),
    ["`基本情報__区`"]
  );
});

test("extractExpressions: 空テンプレートで空配列", () => {
  setup();
  assert.deepEqual(extractExpressions(""), []);
  assert.deepEqual(extractExpressions(null), []);
  assert.deepEqual(extractExpressions(undefined), []);
});

test("extractExpressions: 空 {{}} はスキップ", () => {
  setup();
  assert.deepEqual(extractExpressions("{{}} {{`a`}}"), ["`a`"]);
});

test("extractExpressions: 単一ブレース {} はトークンではない", () => {
  setup();
  // 単一ブレースはリテラル扱い → 式として抽出されない
  assert.deepEqual(extractExpressions("{`A`}"), []);
  assert.deepEqual(extractExpressions("{UPPER(`氏名`)} ただの文字列"), []);
});

// ---------------------------------------------------------------------------
// resolveTemplate (sync)
// ---------------------------------------------------------------------------

test("resolveTemplate: 単一式の評価", () => {
  setup();
  _registerCompiledForTest("UPPER(`氏名`)", (row) => String(row["氏名"] || "").toUpperCase());
  const out = resolveTemplate("Hello {{UPPER(`氏名`)}}!", { 氏名: "tanaka" });
  assert.equal(out, "Hello TANAKA!");
});

test("resolveTemplate: 文字列連結", () => {
  setup();
  _registerCompiledForTest("`姓` || `名`", (row) => String(row["姓"] || "") + String(row["名"] || ""));
  const out = resolveTemplate("{{`姓` || `名`}}", { 姓: "山田", 名: "太郎" });
  assert.equal(out, "山田太郎");
});

test("resolveTemplate: valueTransform は各トークン値に適用される（URL エンコード）", () => {
  setup();
  _registerCompiledForTest("`氏名`", (row) => row["氏名"]);
  const out = resolveTemplate(
    "https://x.com/?n={{`氏名`}}",
    { 氏名: "山田 太郎" },
    { valueTransform: encodeURIComponent },
  );
  assert.equal(out, "https://x.com/?n=" + encodeURIComponent("山田 太郎"));
});

test("resolveTemplate: valueTransform はトークン間のリテラルには適用されない", () => {
  setup();
  _registerCompiledForTest("`a`", (row) => row["a"]);
  // 区切りの & や = はリテラルなのでそのまま、トークン値だけエンコードされる。
  const out = resolveTemplate(
    "https://x.com/?a={{`a`}}&b=1",
    { a: "x/y" },
    { valueTransform: encodeURIComponent },
  );
  assert.equal(out, "https://x.com/?a=x%2Fy&b=1");
});

test("resolveTemplate: 複数トークン", () => {
  setup();
  _registerCompiledForTest("`a`", (row) => row["a"]);
  _registerCompiledForTest("`b`", (row) => row["b"]);
  const out = resolveTemplate("{{`a`}}+{{`b`}}", { a: "X", b: "Y" });
  assert.equal(out, "X+Y");
});

test("resolveTemplate: 数値結果は文字列化", () => {
  setup();
  _registerCompiledForTest("`x` + 1", (row) => Number(row["x"]) + 1);
  const out = resolveTemplate("[{{`x` + 1}}]", { x: 41 });
  assert.equal(out, "[42]");
});

test("resolveTemplate: 統一行は数値を保持し算術評価される", () => {
  setup();
  // 統一行が数値を保持するため `a` + `b` は数値加算になる
  _registerCompiledForTest("`a` + `b`", (row) => row["a"] + row["b"]);
  const out = resolveTemplate("{{`a` + `b`}}", { a: 2, b: 3 });
  assert.equal(out, "5");
});

test("resolveTemplate: null/undefined は空文字", () => {
  setup();
  _registerCompiledForTest("`miss`", () => null);
  const out = resolveTemplate("[{{`miss`}}]", {});
  assert.equal(out, "[]");
});

test("resolveTemplate: 未 precompile の式は fallback (既定 \"\")", () => {
  setup();
  // 何も登録しない
  const origWarn = console.warn;
  console.warn = () => {};
  try {
    const out = resolveTemplate("{{UPPER(`氏名`)}}", { 氏名: "tanaka" });
    assert.equal(out, "");
  } finally {
    console.warn = origWarn;
  }
});

test("resolveTemplate: 評価エラー時は fallback、logError が呼ばれる", () => {
  setup();
  _registerCompiledForTest("THROW(`x`)", () => { throw new Error("boom"); });
  let captured = null;
  const out = resolveTemplate("{{THROW(`x`)}}", { x: 1 }, {
    fallback: "<err>",
    logError: (err, fullToken) => { captured = { msg: err.message, fullToken }; },
  });
  assert.equal(out, "<err>");
  assert.equal(captured.msg, "boom");
  assert.equal(captured.fullToken, "{{THROW(`x`)}}");
});

test("resolveTemplate: { が無いテキストはそのまま", () => {
  setup();
  assert.equal(resolveTemplate("plain text", {}), "plain text");
});

test("resolveTemplate: 単一ブレース { ... } はリテラルとして残る", () => {
  setup();
  _registerCompiledForTest("`氏名`", (row) => row["氏名"]);
  // 単一ブレースはトークンではないのでそのまま出力。二重ブレースのみ評価される。
  assert.equal(resolveTemplate("lit {plain} end", {}), "lit {plain} end");
  const out = resolveTemplate("a {b} {{`氏名`}}", { 氏名: "山田" });
  assert.equal(out, "a {b} 山田");
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
  const out = resolveTemplate("\\{not\\}-{{`x`}}", { x: "Y" });
  assert.equal(out, "{not}-Y");
});

test("resolveTemplate: 真偽値は true/false 文字列", () => {
  setup();
  _registerCompiledForTest("`flag`", (row) => row["flag"]);
  assert.equal(resolveTemplate("{{`flag`}}", { flag: true }), "true");
  assert.equal(resolveTemplate("{{`flag`}}", { flag: false }), "false");
});

test("resolveTemplate: 配列はカンマ区切り、name 抽出を尊重", () => {
  setup();
  _registerCompiledForTest("`files`", (row) => row["files"]);
  const out = resolveTemplate("{{`files`}}", { files: ["a.pdf", "b.pdf"] });
  assert.equal(out, "a.pdf, b.pdf");
});

test("resolveTemplate: ネストした {} はトップレベルの 1 トークンとして渡される", () => {
  setup();
  // ネスト式は templateEvaluator のスコープ外。body は `a{b{c}d}e` という生文字列のまま
  // preprocess + eval する。eval で正常な alasql 式でなければ fallback。
  _registerCompiledForTest("a{b{c}d}e", (row) => row["raw"]);
  const out = resolveTemplate("X{{a{b{c}d}e}}Y", { raw: "Z" });
  assert.equal(out, "XZY");
});

// ---------------------------------------------------------------------------
// 二重ブレース {{ ... }} のみがトークン。単一 { ... } はリテラル。
// ---------------------------------------------------------------------------

test("resolveTemplate: 単一ブレースはリテラル、二重ブレースのみ評価", () => {
  setup();
  _registerCompiledForTest("`性別`", (row) => row["性別"]);
  const row = { 性別: "男" };
  // 単一ブレース → リテラルのまま残る
  assert.equal(resolveTemplate("{`性別`}", row), "{`性別`}");
  // 二重ブレース → 行を引いて評価
  assert.equal(resolveTemplate("{{`性別`}}", row), "男");
});

test("resolveTemplate: 単一行 1 テンプレートで複数トークンを評価", () => {
  setup();
  _registerCompiledForTest("`性別__男`", (row) => row["性別__男"]);
  _registerCompiledForTest("`性別`", (row) => row["性別"]);
  const row = { "性別__男": true, 性別: "男" };
  const out = resolveTemplate("元:{{`性別|男`}}/ビュー:{{`性別`}}", row);
  assert.equal(out, "元:true/ビュー:男");
});

test("resolveTemplate: 二重ブレースは単一行を評価する", () => {
  setup();
  _registerCompiledForTest("`x`", (row) => row["x"]);
  assert.equal(resolveTemplate("{{`x`}}", { x: "Z" }), "Z");
});

// ---------------------------------------------------------------------------
// resolveTemplateAsync
// ---------------------------------------------------------------------------

test("resolveTemplateAsync: 単一式の評価", async () => {
  setup();
  _registerCompiledForTest("UPPER(`氏名`)", (row) => String(row["氏名"] || "").toUpperCase());
  const out = await resolveTemplateAsync("Hello {{UPPER(`氏名`)}}!", { 氏名: "yamada" });
  assert.equal(out, "Hello YAMADA!");
});

test("resolveTemplateAsync: 単一ブレースはリテラル", async () => {
  setup();
  _registerCompiledForTest("`氏名`", (row) => row["氏名"]);
  const out = await resolveTemplateAsync("a {b} {{`氏名`}}", { 氏名: "山田" });
  assert.equal(out, "a {b} 山田");
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
  assert.deepEqual(extractFieldRefs("{{`氏名`}}"), ["氏名"]);
});

test("extractFieldRefs: 複数フィールドを重複除去", () => {
  assert.deepEqual(
    extractFieldRefs("{{`姓`}}{{`名`}}{{`姓`}}"),
    ["姓", "名"]
  );
});

test("extractFieldRefs: 関数引数内のフィールド", () => {
  assert.deepEqual(
    extractFieldRefs("{{UPPER(LEFT(`氏名`, 3))}}"),
    ["氏名"]
  );
});

test("extractFieldRefs: 予約名 (_ 始まり) は除外", () => {
  assert.deepEqual(extractFieldRefs("{{TIME_FORMAT(NOW(), 'YYYY')}}"), []);
  assert.deepEqual(extractFieldRefs("{{`_id`}}"), []);
  assert.deepEqual(extractFieldRefs("{{`_record_url`}}"), []);
});

test("extractFieldRefs: 空入力", () => {
  assert.deepEqual(extractFieldRefs(""), []);
  assert.deepEqual(extractFieldRefs(null), []);
  assert.deepEqual(extractFieldRefs(undefined), []);
});

test("extractFieldRefs: { が無いと空配列", () => {
  assert.deepEqual(extractFieldRefs("`氏名`"), []);
});

test("extractFieldRefs: 単一ブレース内のフィールドは抽出されない", () => {
  // 単一ブレースはトークンではないので、その中のフィールド参照は無視される
  assert.deepEqual(extractFieldRefs("{`A`} {{`B`}}"), ["B"]);
  assert.deepEqual(extractFieldRefs("{`氏名`}"), []);
});

test("extractFieldRefs: 演算子で連結された複数参照", () => {
  assert.deepEqual(
    extractFieldRefs("{{`a` || `b` || `c`}}"),
    ["a", "b", "c"]
  );
});

test("extractFieldRefs: トークン跨ぎでも重複除去", () => {
  assert.deepEqual(
    extractFieldRefs("{{`a`}}-{{`b`}}-{{`a`}}"),
    ["a", "b"]
  );
});

test("extractFieldRefs: 文字列リテラルは識別子と区別される", () => {
  // バッククォート以外は識別子扱いされない
  assert.deepEqual(extractFieldRefs("{{IIF(`x` = 'リテラル', 1, 0)}}"), ["x"]);
});

// ---------------------------------------------------------------------------
// extractReservedRefs（extractFieldRefs の逆：予約名だけ収集）
// ---------------------------------------------------------------------------

test("extractReservedRefs: 予約名 (_ 始まり) のみ収集する", () => {
  assert.deepEqual(
    extractReservedRefs("{{`_id`}} {{`氏名`}} {{`_spreadsheet_id`}}"),
    ["_id", "_spreadsheet_id"],
  );
});

test("extractReservedRefs: 通常フィールドのみなら空", () => {
  assert.deepEqual(extractReservedRefs("{{`氏名`}}{{`金額`}}"), []);
});

test("extractReservedRefs: 重複除去・単一ブレースは無視", () => {
  assert.deepEqual(extractReservedRefs("{{`_id`}}-{{`_id`}}"), ["_id"]);
  assert.deepEqual(extractReservedRefs("{`_id`}"), []);
  assert.deepEqual(extractReservedRefs(""), []);
});

// ---------------------------------------------------------------------------
// validateTemplateSyntax
// ---------------------------------------------------------------------------

test("validateTemplateSyntax: null/空/トークン無しは ok", async () => {
  setup();
  assert.deepEqual(await validateTemplateSyntax(null), { ok: true });
  assert.deepEqual(await validateTemplateSyntax(""), { ok: true });
  assert.deepEqual(await validateTemplateSyntax("ただの文字列"), { ok: true });
});

test("validateTemplateSyntax: precompile 済みの式は ok", async () => {
  setup();
  _registerCompiledForTest("`氏名`", (row) => row["氏名"]);
  assert.deepEqual(await validateTemplateSyntax("こんにちは {{`氏名`}} 様"), { ok: true });
});

test("validateTemplateSyntax: 未閉じ波括弧でエラー", async () => {
  setup();
  const result = await validateTemplateSyntax("氏名は {{`氏名` です");
  assert.equal(result.ok, false);
  assert.match(result.message, /波括弧/);
});

test("validateTemplateSyntax: ネストした未閉じもエラー", async () => {
  setup();
  const result = await validateTemplateSyntax("text {{`b`{");
  assert.equal(result.ok, false);
  assert.match(result.message, /波括弧/);
});

test("validateTemplateSyntax: エスケープした波括弧はトークンではない", async () => {
  setup();
  // \\{ \\} はリテラルなので未閉じ扱いされない
  assert.deepEqual(await validateTemplateSyntax("\\{リテラル\\}"), { ok: true });
});

// ---------------------------------------------------------------------------
// full-query モード（{{SELECT ...}}）
// ---------------------------------------------------------------------------

test("extractExpressions: full-query トークンは式抽出の対象外", () => {
  setup();
  assert.deepEqual(extractExpressions("{{SELECT [a] FROM _form WHERE [id]=_id}}"), []);
  // 式トークンと混在しても full-query は除外、式だけ拾う
  assert.deepEqual(
    extractExpressions("{{`氏名`}} と {{SELECT COUNT(*) FROM [子]}}"),
    ["`氏名`"]
  );
});

test("resolveTemplate: full-query トークンは queryTokenValues から引く", () => {
  setup();
  const tpl = "件数: {{SELECT COUNT(*) FROM [子] WHERE [pid]=_id}}";
  const escaped = escapeBraces(tpl);
  const tok = collectBalancedBraces(escaped)[0];
  const map = new Map([[tok.fullToken, "3"]]);
  assert.equal(resolveTemplate(tpl, {}, { queryTokenValues: map }), "件数: 3");
});

test("resolveTemplate: full-query の内部カンマは SELECT リストとして分割されない", () => {
  setup();
  const tpl = "{{SELECT [a], [b] FROM _form WHERE [id]=_id}}";
  const escaped = escapeBraces(tpl);
  const tok = collectBalancedBraces(escaped)[0];
  // トークンは 1 つ（カンマで割れていない）= body にカンマを含む単一トークン
  assert.equal(collectBalancedBraces(escaped).length, 1);
  const map = new Map([[tok.fullToken, "x, y"]]);
  assert.equal(resolveTemplate(tpl, {}, { queryTokenValues: map }), "x, y");
});

test("resolveTemplate: 未 prefetch の full-query は fallback", () => {
  setup();
  assert.equal(
    resolveTemplate("v={{SELECT 1}}", {}, { fallback: "?", queryTokenValues: new Map() }),
    "v=?"
  );
});

test("resolveTemplate: 未解決 full-query は queryTokensReady=false で logError を呼ばない", () => {
  setup();
  let called = 0;
  const out = resolveTemplate("v={{SELECT 1}}", {}, {
    fallback: "?",
    queryTokenValues: new Map(),
    logError: () => { called++; },
    // queryTokensReady 省略 → 既定 false
  });
  assert.equal(out, "v=?");
  assert.equal(called, 0);
});

test("resolveTemplate: 未解決 full-query は queryTokensReady=true で logError を呼ぶ", () => {
  setup();
  let captured = null;
  const out = resolveTemplate("v={{SELECT 1}}", {}, {
    fallback: "?",
    queryTokenValues: new Map(),
    logError: (err, ft) => { captured = { msg: err.message, ft }; },
    queryTokensReady: true,
  });
  assert.equal(out, "v=?");
  assert.match(captured.msg, /not prefetched/);
});

test("resolveTemplate: full-query が map にあれば flag に依らず値を返し警告しない", () => {
  setup();
  const tpl = "件数: {{SELECT COUNT(*) FROM [子] WHERE [pid]=_id}}";
  const escaped = escapeBraces(tpl);
  const tok = collectBalancedBraces(escaped)[0];
  const map = new Map([[tok.fullToken, "3"]]);
  let called = 0;
  const log = () => { called++; };
  assert.equal(resolveTemplate(tpl, {}, { queryTokenValues: map, logError: log, queryTokensReady: false }), "件数: 3");
  assert.equal(resolveTemplate(tpl, {}, { queryTokenValues: map, logError: log, queryTokensReady: true }), "件数: 3");
  assert.equal(called, 0);
});

test("resolveTemplate: 式トークンと full-query トークンの混在", () => {
  setup();
  _registerCompiledForTest("`氏名`", (row) => row["氏名"]);
  const tpl = "{{`氏名`}} / {{SELECT COUNT(*) FROM [子]}}";
  const escaped = escapeBraces(tpl);
  const qtok = collectBalancedBraces(escaped).find((t) => t.body.trim().toUpperCase().startsWith("SELECT"));
  const map = new Map([[qtok.fullToken, "5"]]);
  assert.equal(resolveTemplate(tpl, { 氏名: "山田" }, { queryTokenValues: map }), "山田 / 5");
});

test("validateTemplateSyntax: full-query トークンは式コンパイル検証をスキップ（ok）", async () => {
  setup();
  // alasql を読み込まずとも full-query は extractExpressions が除外するので ok 判定。
  assert.deepEqual(
    await validateTemplateSyntax("{{SELECT [a] FROM _form WHERE [id]=_id}}"),
    { ok: true }
  );
});
