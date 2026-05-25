import assert from "node:assert/strict";
import test from "node:test";
import { normalizeTableStyle, buildTableStyleTokens } from "./tableStyle.js";
import {
  borderLineDeclaration,
  buildCompiledOverrides,
  resolveCellBorders,
} from "./tableStyleCellBorders.js";
import {
  _clearExpressionCacheForTest,
  _registerCompiledForTest,
} from "../../expression/alasqlExpressionEvaluator.js";

function tokensFor(input) {
  return buildTableStyleTokens(normalizeTableStyle(input));
}

function buildOverrides(tokens, exprMap = {}) {
  _clearExpressionCacheForTest();
  for (const [expr, wrapper] of Object.entries(exprMap)) {
    _registerCompiledForTest(expr, wrapper);
  }
  const { compiled } = buildCompiledOverrides(tokens);
  return compiled;
}

test("resolveCellBorders: base (horizontal=1, vertical=0) — bottom のみ", () => {
  const tokens = tokensFor({});
  const compiled = buildOverrides(tokens);
  const r = resolveCellBorders({
    tokens, compiledOverrides: compiled,
    rowData: {}, displayRowIndex: 1, columnName: "X",
  });
  assert.equal(r.borderTop, "none");
  assert.match(r.borderBottom, /^1px solid /);
  assert.equal(r.borderLeft, "none");
  assert.equal(r.borderRight, "none");
});

test("resolveCellBorders: vertical=2 → borderRight に縦罫線 (borderLeft は none、隣接セルの right と collapse)", () => {
  const tokens = tokensFor({ border: { vertical: { width: 2, color: "#0f0", style: "solid" } } });
  const compiled = buildOverrides(tokens);
  const r = resolveCellBorders({
    tokens, compiledOverrides: compiled,
    rowData: {}, displayRowIndex: 1, columnName: "X",
  });
  assert.equal(r.borderLeft, "none");
  assert.equal(r.borderRight, "2px solid #0f0");
});

test("resolveCellBorders: ヘッダ行は bottom が 2 倍幅", () => {
  const tokens = tokensFor({ border: { horizontal: { width: 2, color: "#000", style: "solid" } } });
  const compiled = buildOverrides(tokens);
  const r = resolveCellBorders({
    tokens, compiledOverrides: compiled,
    columnName: "X", isHeader: true,
  });
  assert.equal(r.borderBottom, "4px solid #000");
});

test("resolveCellBorders: 列オーバーライド right が当該列セルの borderRight のみに反映", () => {
  const tokens = tokensFor({
    border: {
      horizontal: { width: 1 },
      vertical: { width: 0 },
      overrides: [
        { target: "column", selector: "項目", edges: "right", width: 3, color: "#f00", style: "solid" },
      ],
    },
  });
  const compiled = buildOverrides(tokens);
  const hit = resolveCellBorders({
    tokens, compiledOverrides: compiled,
    rowData: {}, displayRowIndex: 1, columnName: "項目",
  });
  assert.equal(hit.borderRight, "3px solid #f00");
  assert.equal(hit.borderLeft, "none");
  const miss = resolveCellBorders({
    tokens, compiledOverrides: compiled,
    rowData: {}, displayRowIndex: 1, columnName: "他",
  });
  assert.equal(miss.borderRight, "none");
});

test("resolveCellBorders: 列オーバーライド left は borderLeft に反映 (base は none)", () => {
  const tokens = tokensFor({
    border: {
      overrides: [
        { target: "column", selector: "項目", edges: "left", width: 2, color: "#000", style: "solid" },
      ],
    },
  });
  const compiled = buildOverrides(tokens);
  const r = resolveCellBorders({
    tokens, compiledOverrides: compiled,
    rowData: {}, displayRowIndex: 1, columnName: "項目",
  });
  assert.equal(r.borderLeft, "2px solid #000");
});

test("resolveCellBorders: 行オーバーライド (_dispRow 式) top が反映", () => {
  const expr = "_dispRow = 3";
  const tokens = tokensFor({
    border: {
      overrides: [
        { target: "row", selector: expr, edges: "top", width: 2, color: "#00f", style: "dashed" },
      ],
    },
  });
  const compiled = buildOverrides(tokens, { [expr]: (row) => row._dispRow === 3 });
  const r3 = resolveCellBorders({
    tokens, compiledOverrides: compiled,
    rowData: { _dispRow: 3 }, displayRowIndex: 3, columnName: "X",
  });
  assert.equal(r3.borderTop, "2px dashed #00f");
  const r2 = resolveCellBorders({
    tokens, compiledOverrides: compiled,
    rowData: { _dispRow: 2 }, displayRowIndex: 2, columnName: "X",
  });
  assert.equal(r2.borderTop, "none", "他行の base borderTop は none (隣の bottom と collapse)");
});

test("resolveCellBorders: 行オーバーライド (列名 = 値 式) — 該当行のみ", () => {
  const expr = "`項目` = '合計'";
  const tokens = tokensFor({
    border: {
      overrides: [
        { target: "row", selector: expr, edges: "both", width: 3, color: "#000", style: "solid" },
      ],
    },
  });
  const compiled = buildOverrides(tokens, { [expr]: (row) => row["項目"] === "合計" });
  const hit = resolveCellBorders({
    tokens, compiledOverrides: compiled,
    rowData: { "項目": "合計", _dispRow: 5 }, displayRowIndex: 5, columnName: "X",
  });
  assert.equal(hit.borderTop, "3px solid #000");
  assert.equal(hit.borderBottom, "3px solid #000");
  const miss = resolveCellBorders({
    tokens, compiledOverrides: compiled,
    rowData: { "項目": "他", _dispRow: 5 }, displayRowIndex: 5, columnName: "X",
  });
  assert.equal(miss.borderTop, "none");
});

test("resolveCellBorders: 行オーバーライド AND 式", () => {
  const expr = "`a` = 1 AND `b` = 2";
  const tokens = tokensFor({
    border: {
      overrides: [
        { target: "row", selector: expr, edges: "top", width: 2, color: "#000", style: "solid" },
      ],
    },
  });
  const compiled = buildOverrides(tokens, { [expr]: (row) => row.a === 1 && row.b === 2 });
  const hit = resolveCellBorders({
    tokens, compiledOverrides: compiled,
    rowData: { a: 1, b: 2, _dispRow: 1 }, displayRowIndex: 1, columnName: "X",
  });
  assert.equal(hit.borderTop, "2px solid #000");
  const miss = resolveCellBorders({
    tokens, compiledOverrides: compiled,
    rowData: { a: 1, b: 3, _dispRow: 1 }, displayRowIndex: 1, columnName: "X",
  });
  assert.equal(miss.borderTop, "none");
});

test("resolveCellBorders: 先勝ち — 同辺に複数ヒットしたら最初のものが採用", () => {
  const tokens = tokensFor({
    border: {
      overrides: [
        { target: "column", selector: "X", edges: "right", width: 3, color: "#f00", style: "solid" },
        { target: "column", selector: "X", edges: "right", width: 5, color: "#0f0", style: "solid" },
      ],
    },
  });
  const compiled = buildOverrides(tokens);
  const r = resolveCellBorders({
    tokens, compiledOverrides: compiled,
    rowData: {}, displayRowIndex: 1, columnName: "X",
  });
  assert.equal(r.borderRight, "3px solid #f00");
});

test("resolveCellBorders: ヘッダ・合計行には行オーバーライド適用なし", () => {
  const expr = "_dispRow = 1";
  const tokens = tokensFor({
    border: {
      overrides: [
        { target: "row", selector: expr, edges: "top", width: 9, color: "#f00", style: "solid" },
      ],
    },
  });
  const compiled = buildOverrides(tokens, { [expr]: (row) => row._dispRow === 1 });
  const header = resolveCellBorders({
    tokens, compiledOverrides: compiled,
    rowData: {}, displayRowIndex: 1, columnName: "X", isHeader: true,
  });
  assert.equal(header.borderTop, "none");
  const total = resolveCellBorders({
    tokens, compiledOverrides: compiled,
    rowData: {}, displayRowIndex: 1, columnName: "X", isTotalRow: true,
  });
  assert.equal(total.borderTop, "none");
});

test("resolveCellBorders: 列オーバーライドはヘッダ行にも適用される", () => {
  const tokens = tokensFor({
    border: {
      overrides: [
        { target: "column", selector: "前年度出前講座回数", edges: "left", width: 2, color: "#f00", style: "solid" },
      ],
    },
  });
  const compiled = buildOverrides(tokens);
  const header = resolveCellBorders({
    tokens, compiledOverrides: compiled,
    rowData: {}, displayRowIndex: 0, columnName: "前年度出前講座回数", isHeader: true,
  });
  assert.equal(header.borderLeft, "2px solid #f00");
  const headerMiss = resolveCellBorders({
    tokens, compiledOverrides: compiled,
    rowData: {}, displayRowIndex: 0, columnName: "他列", isHeader: true,
  });
  assert.equal(headerMiss.borderLeft, "none");
});

test("resolveCellBorders: 列オーバーライドは合計行にも適用される", () => {
  const tokens = tokensFor({
    border: {
      overrides: [
        { target: "column", selector: "X", edges: "right", width: 3, color: "#f00", style: "solid" },
      ],
    },
  });
  const compiled = buildOverrides(tokens);
  const total = resolveCellBorders({
    tokens, compiledOverrides: compiled,
    rowData: {}, displayRowIndex: 9, columnName: "X", isTotalRow: true,
  });
  assert.equal(total.borderRight, "3px solid #f00");
});

test("buildCompiledOverrides: 行 override の式リストを exprs に集約する", () => {
  const tokens = tokensFor({
    border: {
      overrides: [
        { target: "row", selector: "_dispRow = 1", edges: "top", width: 1, color: "#000", style: "solid" },
        { target: "column", selector: "X", edges: "right", width: 1, color: "#000", style: "solid" },
        { target: "row", selector: "`a` = 1", edges: "both", width: 1, color: "#000", style: "solid" },
      ],
    },
  });
  const { exprs } = buildCompiledOverrides(tokens);
  assert.deepEqual(exprs, ["_dispRow = 1", "`a` = 1"]);
});

test("borderLineDeclaration: width 0 / style none は 'none'", () => {
  assert.equal(borderLineDeclaration({ width: 0, style: "solid", color: "#000" }), "none");
  assert.equal(borderLineDeclaration({ width: 2, style: "none", color: "#000" }), "none");
  assert.equal(borderLineDeclaration(null), "none");
});

test("borderLineDeclaration: 通常ケースは width style color を結合", () => {
  assert.equal(
    borderLineDeclaration({ width: 2, style: "dashed", color: "#ff0000" }),
    "2px dashed #ff0000",
  );
});
