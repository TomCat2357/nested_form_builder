import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeTableStyle,
  buildTableStyleTokens,
  DEFAULT_TABLE_STYLE,
  DEFAULT_TRUNCATE_LENGTH,
  COLUMN_WIDTH_MIN,
  TABLE_BORDER_STYLES,
} from "./tableStyle.js";

test("normalizeTableStyle: null/undefined は null (未設定保持で後方互換)", () => {
  assert.equal(normalizeTableStyle(null), null);
  assert.equal(normalizeTableStyle(undefined), null);
});

test("normalizeTableStyle: オブジェクト以外は null", () => {
  assert.equal(normalizeTableStyle("foo"), null);
  assert.equal(normalizeTableStyle(42), null);
  assert.equal(normalizeTableStyle(true), null);
});

test("normalizeTableStyle: 空オブジェクトは DEFAULT_TABLE_STYLE と同 shape", () => {
  assert.deepEqual(normalizeTableStyle({}), DEFAULT_TABLE_STYLE);
});

test("normalizeTableStyle: 旧 border 形式 {width,color,style} を horizontal にマイグレート、vertical は OFF", () => {
  const r = normalizeTableStyle({ border: { width: 3, color: "#ff0000", style: "dashed" } });
  assert.equal(r.border.horizontal.width, 3);
  assert.equal(r.border.horizontal.color, "#ff0000");
  assert.equal(r.border.horizontal.style, "dashed");
  assert.equal(r.border.vertical.width, 0);
  assert.deepEqual(r.border.overrides, []);
});

test("normalizeTableStyle: 旧形式マイグレーション後の token は customized=true で既存見た目維持", () => {
  const ts = normalizeTableStyle({ border: { width: 2, color: "", style: "solid" } });
  const t = buildTableStyleTokens(ts);
  assert.equal(t.horizontal.width, 2);
  assert.equal(t.horizontal.color, "var(--nf-border)");
  assert.equal(t.vertical.width, 0);
});

test("normalizeTableStyle: horizontal.width は 0-10 にクランプ", () => {
  assert.equal(normalizeTableStyle({ border: { horizontal: { width: -5 } } }).border.horizontal.width, 0);
  assert.equal(normalizeTableStyle({ border: { horizontal: { width: 99 } } }).border.horizontal.width, 10);
  assert.equal(normalizeTableStyle({ border: { horizontal: { width: 3 } } }).border.horizontal.width, 3);
  assert.equal(normalizeTableStyle({ border: { horizontal: { width: "bad" } } }).border.horizontal.width, 1);
});

test("normalizeTableStyle: vertical.width も 0-10 にクランプ、既定は 0", () => {
  assert.equal(normalizeTableStyle({ border: { vertical: { width: 7 } } }).border.vertical.width, 7);
  assert.equal(normalizeTableStyle({ border: { vertical: { width: -1 } } }).border.vertical.width, 0);
  assert.equal(normalizeTableStyle({ border: {} }).border.vertical.width, 0);
});

test("normalizeTableStyle: padding と rowHeight は範囲外をクランプ", () => {
  assert.equal(normalizeTableStyle({ cell: { paddingX: 100 } }).cell.paddingX, 30);
  assert.equal(normalizeTableStyle({ cell: { paddingY: -1 } }).cell.paddingY, 0);
  assert.equal(normalizeTableStyle({ cell: { rowHeight: 200 } }).cell.rowHeight, 80);
});

test("normalizeTableStyle: border.style は enum 外を solid に落とす", () => {
  assert.equal(normalizeTableStyle({ border: { horizontal: { style: "groove" } } }).border.horizontal.style, "solid");
  for (const s of TABLE_BORDER_STYLES) {
    assert.equal(normalizeTableStyle({ border: { horizontal: { style: s } } }).border.horizontal.style, s);
  }
});

test("sanitizeColor: #hex / rgb / hsl / 名前色は受け入れる", () => {
  assert.equal(normalizeTableStyle({ header: { bg: "#fff" } }).header.bg, "#fff");
  assert.equal(normalizeTableStyle({ header: { bg: "#abcdef" } }).header.bg, "#abcdef");
  assert.equal(normalizeTableStyle({ header: { bg: "rgb(1,2,3)" } }).header.bg, "rgb(1,2,3)");
  assert.equal(normalizeTableStyle({ header: { bg: "rgba(1,2,3,0.5)" } }).header.bg, "rgba(1,2,3,0.5)");
  assert.equal(normalizeTableStyle({ header: { bg: "hsl(120,50%,50%)" } }).header.bg, "hsl(120,50%,50%)");
  assert.equal(normalizeTableStyle({ header: { bg: "red" } }).header.bg, "red");
});

test("sanitizeColor: 不正値は空文字に落とす (XSS 防護)", () => {
  assert.equal(normalizeTableStyle({ header: { bg: "javascript:alert(1)" } }).header.bg, "");
  assert.equal(normalizeTableStyle({ header: { bg: "url(evil.png)" } }).header.bg, "");
  assert.equal(normalizeTableStyle({ header: { bg: "; background: red" } }).header.bg, "");
});

test("sanitizeColor: 空文字は空文字のまま (fallback センチネル)", () => {
  assert.equal(normalizeTableStyle({ header: { bg: "" } }).header.bg, "");
  assert.equal(normalizeTableStyle({ header: { bg: "  " } }).header.bg, "");
});

test("normalizeTableStyle: zebra.enabled は boolean 化", () => {
  assert.equal(normalizeTableStyle({ zebra: { enabled: 1 } }).zebra.enabled, true);
  assert.equal(normalizeTableStyle({ zebra: { enabled: 0 } }).zebra.enabled, false);
  assert.equal(normalizeTableStyle({ zebra: { enabled: "yes" } }).zebra.enabled, true);
});

test("normalizeTableStyle: overrides は配列以外なら [] に落ちる", () => {
  assert.deepEqual(normalizeTableStyle({ border: { overrides: null } }).border.overrides, []);
  assert.deepEqual(normalizeTableStyle({ border: { overrides: "x" } }).border.overrides, []);
});

test("normalizeTableStyle: overrides の不正エントリ (target, 空 selector) は除外", () => {
  const r = normalizeTableStyle({
    border: {
      overrides: [
        { target: "bogus", selector: "1", edges: "top" },
        { target: "row", selector: "", edges: "top" },
        { target: "row", selector: "1", edges: "top", width: 2, color: "#0f0", style: "solid" },
        { target: "column", selector: "x", edges: "BAD", width: 99, color: "##", style: "wat" },
      ],
    },
  });
  assert.equal(r.border.overrides.length, 2);
  const a = r.border.overrides[0];
  assert.equal(a.target, "row");
  assert.equal(a.selector, "1");
  assert.equal(a.edges, "top");
  assert.equal(a.width, 2);
  assert.equal(a.color, "#0f0");
  assert.equal(a.style, "solid");
  const b = r.border.overrides[1];
  assert.equal(b.target, "column");
  assert.equal(b.edges, "both", "不正 edges は both にフォールバック");
  assert.equal(b.width, 10, "99 は 10 にクランプ");
  assert.equal(b.color, "", "不正色は空文字");
  assert.equal(b.style, "solid", "不正 style は solid");
});

test("normalizeTableStyle: column 未指定でも空 widths と null min/max が入る", () => {
  const r = normalizeTableStyle({});
  assert.deepEqual(r.column.widths, []);
  assert.equal(r.column.minWidth, null);
  assert.equal(r.column.maxWidth, null);
  assert.equal("defaultWidth" in r.column, false);
});

test("normalizeTableStyle: defaultWidth は schema から撤廃済み（入力されても保持しない）", () => {
  const r = normalizeTableStyle({ column: { defaultWidth: 240 } });
  assert.equal("defaultWidth" in r.column, false);
});

test("normalizeTableStyle: column.widths は配列以外なら []", () => {
  assert.deepEqual(normalizeTableStyle({ column: { widths: null } }).column.widths, []);
  assert.deepEqual(normalizeTableStyle({ column: { widths: "x" } }).column.widths, []);
  assert.deepEqual(normalizeTableStyle({ column: { widths: {} } }).column.widths, []);
});

test("normalizeTableStyle: column.widths の不正エントリ (空 column / 不正 width) を除外・クランプ", () => {
  const r = normalizeTableStyle({
    column: {
      widths: [
        { column: "", width: 100 },         // 空 column は除外
        { column: "  ", width: 100 },       // trim で空は除外
        { column: "x", width: -5 },          // width 20 にクランプ
        { column: "y", width: 9999 },        // width 2000 にクランプ
        { column: "z", width: "bad" },       // 不正 width は最小値 fallback
        null,                                // null は除外
        { column: 12, width: 100 },          // 文字列以外の column は除外
      ],
    },
  });
  assert.equal(r.column.widths.length, 3);
  assert.deepEqual(r.column.widths[0], { column: "x", width: 20 });
  assert.deepEqual(r.column.widths[1], { column: "y", width: 2000 });
  assert.deepEqual(r.column.widths[2], { column: "z", width: COLUMN_WIDTH_MIN });
});

test("normalizeTableStyle: column.widths の重複 column キーは先勝ちで 1 件", () => {
  const r = normalizeTableStyle({
    column: {
      widths: [
        { column: "x", width: 100 },
        { column: "x", width: 200 },  // 先勝ちで除外
        { column: "y", width: 150 },
      ],
    },
  });
  assert.equal(r.column.widths.length, 2);
  assert.deepEqual(r.column.widths[0], { column: "x", width: 100 });
  assert.deepEqual(r.column.widths[1], { column: "y", width: 150 });
});

test("buildTableStyleTokens: null は widthMap=空 Map, customized=false, defaultWidth は撤廃", () => {
  const t = buildTableStyleTokens(null);
  assert.ok(t.column.widthMap instanceof Map);
  assert.equal(t.column.widthMap.size, 0);
  assert.equal(t.column.customized, false);
  assert.equal("defaultWidth" in t.column, false);
});

test("buildTableStyleTokens: column.widths は widthMap (Map) に変換され get でアクセス可能", () => {
  const ts = normalizeTableStyle({
    column: {
      widths: [
        { column: "項目", width: 320 },
        { column: "件数", width: 60 },
      ],
    },
  });
  const t = buildTableStyleTokens(ts);
  assert.ok(t.column.widthMap instanceof Map);
  assert.equal(t.column.widthMap.get("項目"), 320);
  assert.equal(t.column.widthMap.get("件数"), 60);
  assert.equal(t.column.widthMap.get("存在しない"), undefined);
  assert.equal(t.column.customized, true);
});

test("buildTableStyleTokens: null は現状ハードコード値を返す (後方互換)", () => {
  const t = buildTableStyleTokens(null);
  assert.equal(t.horizontal.width, 1);
  assert.equal(t.horizontal.color, "var(--nf-border)");
  assert.equal(t.horizontal.style, "solid");
  assert.equal(t.vertical.width, 0);
  assert.equal(t.headerBg, "var(--nf-bg-subtle, #f5f5f5)");
  assert.equal(t.headerColor, undefined);
  assert.equal(t.paddingY, 6);
  assert.equal(t.paddingX, 10);
  assert.equal(t.rowHeight, 0);
  assert.equal(t.zebra.enabled, false);
  assert.deepEqual(t.overrides, []);
  assert.equal(t.customized, false);
});

test("buildTableStyleTokens: 色未指定は CSS 変数フォールバックに置換", () => {
  const ts = normalizeTableStyle({ border: { horizontal: { width: 2, color: "" } } });
  const t = buildTableStyleTokens(ts);
  assert.equal(t.horizontal.color, "var(--nf-border)");
  assert.equal(t.horizontal.width, 2);
  assert.equal(t.headerBg, "var(--nf-bg-subtle, #f5f5f5)");
});

test("buildTableStyleTokens: 明示色を採用、overrides も渡る", () => {
  const ts = normalizeTableStyle({
    border: {
      horizontal: { color: "#ff0000" },
      vertical: { width: 2, color: "#00ff00" },
      overrides: [
        { target: "column", selector: "項目", edges: "right", width: 3, color: "#0000ff", style: "solid" },
      ],
    },
    header: { bg: "#003366", color: "#ffffff" },
  });
  const t = buildTableStyleTokens(ts);
  assert.equal(t.horizontal.color, "#ff0000");
  assert.equal(t.vertical.color, "#00ff00");
  assert.equal(t.headerBg, "#003366");
  assert.equal(t.headerColor, "#ffffff");
  assert.equal(t.customized, true);
  assert.equal(t.overrides.length, 1);
  assert.equal(t.overrides[0].color, "#0000ff");
});


test("normalizeTableStyle: cell.truncateLength 未指定は default 50", () => {
  assert.equal(normalizeTableStyle({}).cell.truncateLength, DEFAULT_TRUNCATE_LENGTH);
  assert.equal(normalizeTableStyle({ cell: {} }).cell.truncateLength, DEFAULT_TRUNCATE_LENGTH);
});

test("normalizeTableStyle: cell.truncateLength は 0-5000 にクランプ、不正値は 50", () => {
  assert.equal(normalizeTableStyle({ cell: { truncateLength: -10 } }).cell.truncateLength, 0);
  assert.equal(normalizeTableStyle({ cell: { truncateLength: 0 } }).cell.truncateLength, 0);
  assert.equal(normalizeTableStyle({ cell: { truncateLength: 100 } }).cell.truncateLength, 100);
  assert.equal(normalizeTableStyle({ cell: { truncateLength: 99999 } }).cell.truncateLength, 5000);
  assert.equal(normalizeTableStyle({ cell: { truncateLength: "bad" } }).cell.truncateLength, DEFAULT_TRUNCATE_LENGTH);
  assert.equal(normalizeTableStyle({ cell: { truncateLength: "100" } }).cell.truncateLength, 100);
});

test("normalizeTableStyle: column.minWidth / maxWidth 未指定は null（後方互換）", () => {
  assert.equal(normalizeTableStyle({}).column.minWidth, null);
  assert.equal(normalizeTableStyle({}).column.maxWidth, null);
  assert.equal(normalizeTableStyle({ column: {} }).column.minWidth, null);
  assert.equal(normalizeTableStyle({ column: {} }).column.maxWidth, null);
});

test("normalizeTableStyle: column.minWidth / maxWidth は 20-2000 にクランプ", () => {
  assert.equal(normalizeTableStyle({ column: { minWidth: 5 } }).column.minWidth, 20);
  assert.equal(normalizeTableStyle({ column: { minWidth: 9999 } }).column.minWidth, 2000);
  assert.equal(normalizeTableStyle({ column: { minWidth: 100 } }).column.minWidth, 100);
  assert.equal(normalizeTableStyle({ column: { maxWidth: 5 } }).column.maxWidth, 20);
  assert.equal(normalizeTableStyle({ column: { maxWidth: 9999 } }).column.maxWidth, 2000);
  assert.equal(normalizeTableStyle({ column: { maxWidth: 400 } }).column.maxWidth, 400);
});

test("normalizeTableStyle: 不正・空・null の minWidth/maxWidth は null", () => {
  assert.equal(normalizeTableStyle({ column: { minWidth: "bad" } }).column.minWidth, null);
  assert.equal(normalizeTableStyle({ column: { minWidth: "" } }).column.minWidth, null);
  assert.equal(normalizeTableStyle({ column: { minWidth: null } }).column.minWidth, null);
  assert.equal(normalizeTableStyle({ column: { maxWidth: "bad" } }).column.maxWidth, null);
});

test("normalizeTableStyle: min > max のときは両方 null に戻す（矛盾排除）", () => {
  const r = normalizeTableStyle({ column: { minWidth: 500, maxWidth: 100 } });
  assert.equal(r.column.minWidth, null);
  assert.equal(r.column.maxWidth, null);
});

test("normalizeTableStyle: min <= max なら両方保持", () => {
  const r = normalizeTableStyle({ column: { minWidth: 100, maxWidth: 400 } });
  assert.equal(r.column.minWidth, 100);
  assert.equal(r.column.maxWidth, 400);
});

test("buildTableStyleTokens(null): truncateLength=50 を default 適用、min/max は null", () => {
  const t = buildTableStyleTokens(null);
  assert.equal(t.truncateLength, DEFAULT_TRUNCATE_LENGTH);
  assert.equal(t.column.minWidth, null);
  assert.equal(t.column.maxWidth, null);
});

test("buildTableStyleTokens: truncateLength は ts.cell.truncateLength を反映", () => {
  const ts = normalizeTableStyle({ cell: { truncateLength: 0 } });
  assert.equal(buildTableStyleTokens(ts).truncateLength, 0);
  const ts2 = normalizeTableStyle({ cell: { truncateLength: 200 } });
  assert.equal(buildTableStyleTokens(ts2).truncateLength, 200);
});

test("buildTableStyleTokens: column.minWidth / maxWidth は設定値をそのまま反映", () => {
  assert.equal(buildTableStyleTokens(normalizeTableStyle({ column: { minWidth: 80 } })).column.minWidth, 80);
  assert.equal(buildTableStyleTokens(normalizeTableStyle({ column: { maxWidth: 400 } })).column.maxWidth, 400);
  const both = buildTableStyleTokens(normalizeTableStyle({ column: { minWidth: 80, maxWidth: 400 } })).column;
  assert.equal(both.minWidth, 80);
  assert.equal(both.maxWidth, 400);
});

test("JSON-serializable: 構造体が circular でない (column 含む)", () => {
  const ts = normalizeTableStyle({
    border: {
      horizontal: { width: 5, color: "#aaa", style: "dotted" },
      vertical: { width: 2, color: "#bbb", style: "solid" },
      overrides: [
        { target: "row", selector: "1,3", edges: "bottom", width: 4, color: "#f00", style: "solid" },
      ],
    },
    cell: { paddingY: 12, paddingX: 16, rowHeight: 32 },
    header: { bg: "#003366", color: "#ffffff" },
    zebra: { enabled: true, color: "#eef" },
    column: {
      widths: [{ column: "項目", width: 320 }],
    },
  });
  const json = JSON.stringify(ts);
  assert.equal(typeof json, "string");
  assert.deepEqual(JSON.parse(json), ts);
});
