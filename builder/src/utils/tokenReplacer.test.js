import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLabelValueMap,
  resolveTemplateTokens,
  extractTemplateFieldRefs,
  injectResolvedQueryTokens,
} from "./tokenReplacer.js";
import { escapeBraces, collectBalancedBraces } from "../features/expression/templateScanner.js";
import {
  _clearExpressionCacheForTest,
  _registerCompiledForTest,
} from "../features/expression/alasqlExpressionEvaluator.js";

// PR-? 移行: テンプレ構文は `{{<alasql 式>}}`（ビュー形式）のみ。単一ブレース
// `{...}` はリテラルとして出力される。バッククォート識別子でフィールド参照、
// 予約値 `_id` / `_record_url` / `_form_url` も同様にバッククォートで参照する。
// 現在時刻は alasql UDF NOW() で取得する（行に注入しない）。
// テストでは alasql 本体を使わず、precompiled wrapper を直接登録して
// オーケストレーション (row 構築 + 同期評価 + フォールバック) を検証する。

function setup() {
  _clearExpressionCacheForTest();
}

// ---------------------------------------------------------------------------
// buildLabelValueMap (アダプタ → labelValueMap.js への薄い再 export)
// 行キーは fieldPaths (`親|子`) のみ。トップレベル質問は path = leaf label と同値。
// ---------------------------------------------------------------------------

test("buildLabelValueMap: fieldValues を優先する", () => {
  const fieldPaths = { f1: "添付ファイル", f2: "名前" };
  const fieldValues = { f1: "見積書, 申請書", f2: "山田 太郎" };
  const responses = {
    f1: [
      { name: "見積書.pdf", driveFileUrl: "https://drive.google.com/file/d/abc" },
    ],
    f2: "山田 太郎",
  };
  const map = buildLabelValueMap(fieldPaths, fieldValues, responses);
  assert.equal(map["添付ファイル"], "見積書, 申請書");
  assert.equal(map["名前"], "山田 太郎");
});

test("buildLabelValueMap: fieldValues が無い場合 responses からファイル名を抽出", () => {
  const fieldPaths = { f1: "添付ファイル" };
  const fieldValues = {};
  const responses = {
    f1: [
      { name: "見積書.pdf", driveFileUrl: "https://drive.google.com/file/d/abc" },
    ],
  };
  const map = buildLabelValueMap(fieldPaths, fieldValues, responses);
  assert.equal(map["添付ファイル"], "見積書.pdf");
});

test("buildLabelValueMap: ネスト子は親|子 のフルパスでキー化される", () => {
  const fieldPaths = {
    f1: "設置場所",
    f2: "設置場所|設置開始日",
    f3: "備考|設置開始日",
  };
  const fieldValues = { f1: "ああ", f2: "2026-05-08", f3: "2025-01-01" };
  const map = buildLabelValueMap(fieldPaths, fieldValues, {});
  assert.equal(map["設置場所"], "ああ");
  assert.equal(map["設置場所|設置開始日"], "2026-05-08");
  assert.equal(map["備考|設置開始日"], "2025-01-01");
  // 葉ラベル単独 (`設置開始日`) は登録されない（後方互換廃止）
  assert.equal(map["設置開始日"], undefined);
});

// ---------------------------------------------------------------------------
// resolveTemplateTokens — sync 評価 (precompile wrapper 経由)
// ---------------------------------------------------------------------------

test("resolveTemplateTokens: バッククォート識別子でフィールド参照", () => {
  setup();
  _registerCompiledForTest("`氏名`", (row) => row["氏名"]);
  const ctx = { labelValueMap: { 氏名: "山田" } };
  assert.equal(resolveTemplateTokens("お名前: {{`氏名`}}", ctx), "お名前: 山田");
});

test("resolveTemplateTokens: ラベル中の | は __ に正規化される", () => {
  setup();
  _registerCompiledForTest("`基本情報__区`", (row) => row["基本情報__区"]);
  const ctx = { labelValueMap: { "基本情報|区": "新宿区" } };
  assert.equal(resolveTemplateTokens("{{`基本情報|区`}}", ctx), "新宿区");
});

test("resolveTemplateTokens: 文字列連結 ||", () => {
  setup();
  _registerCompiledForTest("`姓` || `名`", (row) => String(row["姓"] || "") + String(row["名"] || ""));
  const ctx = { labelValueMap: { 姓: "山田", 名: "太郎" } };
  assert.equal(resolveTemplateTokens("{{`姓` || `名`}}", ctx), "山田太郎");
});

test("resolveTemplateTokens: { が無いテキストはそのまま返す", () => {
  assert.equal(resolveTemplateTokens("plain text", {}), "plain text");
});

test("resolveTemplateTokens: 単一ブレース {...} はリテラル、{{...}} のみ解決", () => {
  setup();
  _registerCompiledForTest("`x`", (row) => row["x"]);
  assert.equal(
    resolveTemplateTokens("a {b} {{`x`}} c", { labelValueMap: { x: "Y" } }),
    "a {b} Y c"
  );
});

test("resolveTemplateTokens: null/undefined/空", () => {
  assert.equal(resolveTemplateTokens(null, {}), "");
  assert.equal(resolveTemplateTokens(undefined, {}), "");
  assert.equal(resolveTemplateTokens("", {}), "");
});

// ---------------------------------------------------------------------------
// 予約トークン (`_id` / `_record_url` / `_form_url`)
// ---------------------------------------------------------------------------

test("resolveTemplateTokens: `_id` で recordId を取得", () => {
  setup();
  _registerCompiledForTest("`_id`", (row) => row["_id"]);
  assert.equal(
    resolveTemplateTokens("ID: {{`_id`}}", { recordId: "rec001" }),
    "ID: rec001"
  );
});

test("resolveTemplateTokens: `_record_url` / `_form_url`", () => {
  setup();
  _registerCompiledForTest("`_record_url`", (row) => row["_record_url"]);
  _registerCompiledForTest("`_form_url`", (row) => row["_form_url"]);
  const ctx = {
    recordUrl: "https://example.com/r",
    formUrl: "https://example.com/f",
  };
  assert.equal(resolveTemplateTokens("{{`_record_url`}}", ctx), "https://example.com/r");
  assert.equal(resolveTemplateTokens("{{`_form_url`}}", ctx), "https://example.com/f");
});

// ---------------------------------------------------------------------------
// fileUpload系 — fileUploadMeta から row 配列を構築して FILE_* で取り出す
// ---------------------------------------------------------------------------

test("resolveTemplateTokens: FILE_NAMES が fileUploadMeta から名前を取り出す", () => {
  setup();
  _registerCompiledForTest("FILE_NAMES(`添付`)", (row) => {
    const arr = row["添付"];
    if (!Array.isArray(arr)) return "";
    return arr.map((x) => x.name).join(", ");
  });
  const ctx = {
    fieldPaths: { f1: "添付" },
    fileUploadMeta: { f1: { fileNames: ["a.pdf", "b.pdf"], fileUrls: ["u1", "u2"] } },
  };
  assert.equal(
    resolveTemplateTokens("{{FILE_NAMES(`添付`)}}", ctx),
    "a.pdf, b.pdf"
  );
});

test("resolveTemplateTokens: FOLDER_URL が fileUploadMeta から folderUrl を取り出す", () => {
  setup();
  _registerCompiledForTest("FOLDER_URL(`添付`)", (row) => {
    const arr = row["添付"];
    if (Array.isArray(arr) && arr[0]) return arr[0].folderUrl || "";
    return "";
  });
  const ctx = {
    fieldPaths: { f1: "添付" },
    fileUploadMeta: { f1: { fileNames: ["a.pdf"], fileUrls: ["u"], folderUrl: "https://drive/x" } },
  };
  assert.equal(
    resolveTemplateTokens("{{FOLDER_URL(`添付`)}}", ctx),
    "https://drive/x"
  );
});

// ---------------------------------------------------------------------------
// フルパス (親|子) 参照
// ---------------------------------------------------------------------------

test("resolveTemplateTokens: 親|子 フルパスでネスト子の値を解決", () => {
  setup();
  _registerCompiledForTest("`設置場所__設置開始日`", (row) => row["設置場所__設置開始日"]);
  const ctx = { labelValueMap: { "設置場所|設置開始日": "2026-05-08" } };
  assert.equal(
    resolveTemplateTokens("{{`設置場所|設置開始日`}}", ctx),
    "2026-05-08"
  );
});

test("resolveTemplateTokens: ネスト子の葉ラベル単独参照は解決されない (空文字)", () => {
  setup();
  _registerCompiledForTest("`設置開始日`", (row) => row["設置開始日"]);
  const ctx = { labelValueMap: { "設置場所|設置開始日": "2026-05-08" } };
  // 葉ラベル `設置開始日` は row に存在しないので alasql は undefined を返す → safeStringify で ""
  assert.equal(
    resolveTemplateTokens("{{`設置開始日`}}", ctx),
    ""
  );
});

// ---------------------------------------------------------------------------
// fallback / エラー
// ---------------------------------------------------------------------------

test("resolveTemplateTokens: 未 precompile はフォールバック (空文字)", () => {
  setup();
  const origWarn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(resolveTemplateTokens("{{UPPER(`氏名`)}}", { labelValueMap: { 氏名: "x" } }), "");
  } finally {
    console.warn = origWarn;
  }
});

test("resolveTemplateTokens: 評価エラー時はフォールバック (空文字)", () => {
  setup();
  _registerCompiledForTest("BAD(`x`)", () => { throw new Error("bad"); });
  const origWarn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(resolveTemplateTokens("{{BAD(`x`)}}", { labelValueMap: { x: "1" } }), "");
  } finally {
    console.warn = origWarn;
  }
});

test("resolveTemplateTokens: 複数トークン (一部未 precompile)", () => {
  setup();
  _registerCompiledForTest("`a`", (row) => row["a"]);
  // `b` は登録しない
  const origWarn = console.warn;
  console.warn = () => {};
  try {
    const ctx = { labelValueMap: { a: "X", b: "Y" } };
    assert.equal(resolveTemplateTokens("{{`a`}}-{{`b`}}", ctx), "X-");
  } finally {
    console.warn = origWarn;
  }
});

// ---------------------------------------------------------------------------
// extractTemplateFieldRefs (computedFields の依存抽出に使う)
// ---------------------------------------------------------------------------

test("extractTemplateFieldRefs: 単一フィールド", () => {
  assert.deepEqual(extractTemplateFieldRefs("{{`氏名`}}"), ["氏名"]);
});

test("extractTemplateFieldRefs: 関数内ネスト", () => {
  assert.deepEqual(extractTemplateFieldRefs("{{UPPER(LEFT(`氏名`, 3))}}"), ["氏名"]);
});

test("extractTemplateFieldRefs: 予約名は除外", () => {
  assert.deepEqual(extractTemplateFieldRefs("{{`_id`}}-{{`_record_url`}}-{{`氏名`}}"), ["氏名"]);
});

test("extractTemplateFieldRefs: 重複除去 + 順序維持", () => {
  assert.deepEqual(extractTemplateFieldRefs("{{`a`}}-{{`b`}}-{{`a`}}-{{`c`}}"), ["a", "b", "c"]);
});

test("extractTemplateFieldRefs: 空入力", () => {
  assert.deepEqual(extractTemplateFieldRefs(""), []);
  assert.deepEqual(extractTemplateFieldRefs(null), []);
});

// ---------------------------------------------------------------------------
// エスケープ \{ \}
// ---------------------------------------------------------------------------

test("resolveTemplateTokens: \\{ \\} はリテラル", () => {
  setup();
  _registerCompiledForTest("`x`", (row) => row["x"]);
  assert.equal(
    resolveTemplateTokens("\\{not a token\\} - {{`x`}}", { labelValueMap: { x: "Y" } }),
    "{not a token} - Y"
  );
});

// ---------------------------------------------------------------------------
// カンマ列リスト構文（{{ e1, e2, ... }} で複数値をカンマ連結）
// ---------------------------------------------------------------------------

test("resolveTemplateTokens: カンマ列リスト基本 — 複数フィールドをカンマ連結", () => {
  setup();
  _registerCompiledForTest("`A`", (row) => row["A"]);
  _registerCompiledForTest("`B`", (row) => row["B"]);
  const ctx = { labelValueMap: { A: "売上日値", B: "担当者値" } };
  assert.equal(resolveTemplateTokens("{{`A`,`B`}}", ctx), "売上日値,担当者値");
});

test("resolveTemplateTokens: カンマ列リスト — 空白を含むカンマ区切りも分割される", () => {
  setup();
  _registerCompiledForTest("`A`", (row) => row["A"]);
  _registerCompiledForTest("`B`", (row) => row["B"]);
  const ctx = { labelValueMap: { A: "X", B: "Y" } };
  assert.equal(resolveTemplateTokens("{{`A`, `B`}}", ctx), "X,Y");
});

test("resolveTemplateTokens: || と , の混在 — || は部分式内に閉じる", () => {
  setup();
  _registerCompiledForTest("`姓` || `名`", (row) => String(row["姓"] || "") + String(row["名"] || ""));
  _registerCompiledForTest("`所属`", (row) => row["所属"]);
  const ctx = { labelValueMap: { 姓: "山田", 名: "太郎", 所属: "営業" } };
  assert.equal(resolveTemplateTokens("{{`姓` || `名`, `所属`}}", ctx), "山田太郎,営業");
});

test("resolveTemplateTokens: カンマ列リスト — 関数引数のカンマは保護される", () => {
  setup();
  _registerCompiledForTest("IIF(`a`>0, 'pos', 'neg')", (row) => (row["a"] > 0 ? "pos" : "neg"));
  _registerCompiledForTest("`b`", (row) => row["b"]);
  const ctx = { labelValueMap: { a: 1, b: "B値" } };
  assert.equal(resolveTemplateTokens("{{IIF(`a`>0, 'pos', 'neg'), `b`}}", ctx), "pos,B値");
});

test("resolveTemplateTokens: カンマ列リスト — 末尾カンマは空要素を保持", () => {
  setup();
  _registerCompiledForTest("`A`", (row) => row["A"]);
  const ctx = { labelValueMap: { A: "X" } };
  assert.equal(resolveTemplateTokens("{{`A`,}}", ctx), "X,");
});

test("resolveTemplateTokens: カンマ列リスト — 連続カンマは空要素を保持", () => {
  setup();
  _registerCompiledForTest("`A`", (row) => row["A"]);
  _registerCompiledForTest("`B`", (row) => row["B"]);
  const ctx = { labelValueMap: { A: "X", B: "Y" } };
  assert.equal(resolveTemplateTokens("{{`A`,,`B`}}", ctx), "X,,Y");
});

test("resolveTemplateTokens: カンマ列リスト — null/undefined は空文字として連結", () => {
  setup();
  _registerCompiledForTest("`A`", (row) => row["A"]);
  _registerCompiledForTest("`B`", (row) => row["B"]);
  const ctx = { labelValueMap: { A: "X", B: null } };
  assert.equal(resolveTemplateTokens("{{`A`,`B`}}", ctx), "X,");
});

test("resolveTemplateTokens: カンマ列リスト — 文字列リテラル内のカンマは保護される", () => {
  setup();
  _registerCompiledForTest("'a,b'", () => "a,b");
  _registerCompiledForTest("`c`", (row) => row["c"]);
  const ctx = { labelValueMap: { c: "C値" } };
  assert.equal(resolveTemplateTokens("{{'a,b', `c`}}", ctx), "a,b,C値");
});

test("resolveTemplateTokens: カンマ列リスト — 数値の和は単一値（カンマで割れない）", () => {
  setup();
  _registerCompiledForTest("`売上数量` + `売掛数量`", (row) => Number(row["売上数量"]) + Number(row["売掛数量"]));
  const ctx = { labelValueMap: { 売上数量: 3, 売掛数量: 4 } };
  assert.equal(resolveTemplateTokens("{{`売上数量` + `売掛数量`}}", ctx), "7");
});

test("resolveTemplateTokens: カンマ列リスト — 部分式の1つでもエラーで全体フォールバック", () => {
  setup();
  _registerCompiledForTest("`A`", (row) => row["A"]);
  _registerCompiledForTest("BAD(`x`)", () => { throw new Error("bad"); });
  const origWarn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(
      resolveTemplateTokens("{{`A`, BAD(`x`)}}", { labelValueMap: { A: "X", x: "Y" } }),
      ""
    );
  } finally {
    console.warn = origWarn;
  }
});

// ---------------------------------------------------------------------------
// full-query モード（{{SELECT ...}}）— queryTokenValues 経由 / 出力用注入
// ---------------------------------------------------------------------------

// escape 済み fullToken をキーにした queryTokenValues Map を組むヘルパ。
function buildQueryMap(template, values) {
  const tokens = collectBalancedBraces(escapeBraces(template));
  const map = new Map();
  let i = 0;
  for (const tok of tokens) {
    if (tok.body.trim().toUpperCase().startsWith("SELECT")) {
      map.set(tok.fullToken, values[i++]);
    }
  }
  return map;
}

test("resolveTemplateTokens: full-query は context.queryTokenValues から解決", () => {
  setup();
  const tpl = "件数: {{SELECT COUNT(*) FROM [子] WHERE [pid]=_id}}";
  const queryTokenValues = buildQueryMap(tpl, ["3"]);
  assert.equal(resolveTemplateTokens(tpl, { queryTokenValues }), "件数: 3");
});

test("resolveTemplateTokens: 未解決 full-query は queryTokensReady 未指定なら warn しない", () => {
  setup();
  const origWarn = console.warn;
  let warned = 0;
  console.warn = () => { warned++; };
  try {
    const out = resolveTemplateTokens("v={{SELECT 1}}", { queryTokenValues: new Map() });
    assert.equal(out, "v=");
    assert.equal(warned, 0);
  } finally {
    console.warn = origWarn;
  }
});

test("resolveTemplateTokens: 未解決 full-query は queryTokensReady=true で warn する", () => {
  setup();
  const origWarn = console.warn;
  let warned = 0;
  console.warn = () => { warned++; };
  try {
    resolveTemplateTokens("v={{SELECT 1}}", { queryTokenValues: new Map(), queryTokensReady: true });
    assert.equal(warned, 1);
  } finally {
    console.warn = origWarn;
  }
});

test("injectResolvedQueryTokens: full-query を解決値に差し替え、式トークンは原文温存", () => {
  const tpl = "{{`氏名`}}-{{SELECT COUNT(*) FROM [子]}}";
  const queryTokenValues = buildQueryMap(tpl, ["5"]);
  const out = injectResolvedQueryTokens(tpl, queryTokenValues);
  // full-query は解決され、式トークンは GAS 用に原文のまま
  assert.equal(out, "{{`氏名`}}-5");
});

test("injectResolvedQueryTokens: 結果中のブレースは \\{ \\} にエスケープ", () => {
  const tpl = "{{SELECT 1}}";
  const queryTokenValues = buildQueryMap(tpl, ["a{b}c"]);
  assert.equal(injectResolvedQueryTokens(tpl, queryTokenValues), "a\\{b\\}c");
});

test("injectResolvedQueryTokens: 著者エスケープ \\{ は \\{ のまま温存（GAS が後段で解決）", () => {
  const tpl = "\\{lit\\} {{SELECT 1}}";
  const queryTokenValues = buildQueryMap(tpl, ["v"]);
  assert.equal(injectResolvedQueryTokens(tpl, queryTokenValues), "\\{lit\\} v");
});

test("injectResolvedQueryTokens: full-query 無しは原文そのまま", () => {
  assert.equal(injectResolvedQueryTokens("{{`氏名`}} plain", new Map()), "{{`氏名`}} plain");
  assert.equal(injectResolvedQueryTokens("plain", new Map([["x", "y"]])), "plain");
});
