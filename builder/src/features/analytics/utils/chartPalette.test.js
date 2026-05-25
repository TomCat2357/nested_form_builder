import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeChartStyle, DEFAULT_CHART_STYLE } from "./chartPalette.js";

test("normalizeChartStyle: null / undefined / 非オブジェクト → 全 default", () => {
  for (const input of [null, undefined, 0, "", false, [], "string"]) {
    const out = normalizeChartStyle(input);
    assert.deepEqual(out, DEFAULT_CHART_STYLE);
    // default は破壊されない（独立コピー）
    assert.notEqual(out, DEFAULT_CHART_STYLE);
    assert.notEqual(out.grid, DEFAULT_CHART_STYLE.grid);
  }
});

test("normalizeChartStyle: 部分指定は default で埋める", () => {
  const out = normalizeChartStyle({ title: { text: "売上" } });
  assert.equal(out.title.text, "売上");
  assert.equal(out.title.fontSize, DEFAULT_CHART_STYLE.title.fontSize);
  assert.equal(out.legend.position, DEFAULT_CHART_STYLE.legend.position);
  assert.deepEqual(out.padding, DEFAULT_CHART_STYLE.padding);
});

test("normalizeChartStyle: 未知の legend.position は default に落とす", () => {
  const out = normalizeChartStyle({ legend: { position: "diagonal" } });
  assert.equal(out.legend.position, DEFAULT_CHART_STYLE.legend.position);
});

test("normalizeChartStyle: legend.position='hidden' は許容", () => {
  const out = normalizeChartStyle({ legend: { position: "hidden" } });
  assert.equal(out.legend.position, "hidden");
});

test("normalizeChartStyle: grid.x/y.display=false が反映される", () => {
  const out = normalizeChartStyle({ grid: { x: { display: false }, y: { display: false } } });
  assert.equal(out.grid.x.display, false);
  assert.equal(out.grid.y.display, false);
});

test("normalizeChartStyle: 数値項目の型安全 (非数値は default)", () => {
  const out = normalizeChartStyle({
    title: { fontSize: "abc" },
    tick: { fontSize: null },
    padding: { top: "10", right: "x", bottom: 5, left: undefined },
  });
  assert.equal(out.title.fontSize, DEFAULT_CHART_STYLE.title.fontSize);
  assert.equal(out.tick.fontSize, DEFAULT_CHART_STYLE.tick.fontSize);
  assert.equal(out.padding.top, 10);   // 数値文字列は Number で通る
  assert.equal(out.padding.right, 0);  // 非数値は 0
  assert.equal(out.padding.bottom, 5);
  assert.equal(out.padding.left, 0);
});

test("normalizeChartStyle: 色は文字列ならそのまま、非文字列は default(空文字)", () => {
  const out = normalizeChartStyle({
    title: { color: "#ff0000" },
    legend: { color: 123 },
  });
  assert.equal(out.title.color, "#ff0000");
  assert.equal(out.legend.color, "");
});
