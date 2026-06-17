import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isChartStyleSupported,
  getChartControlVisibility,
  dashToString,
  stringToDash,
} from "./chartStyleControlsLogic.js";

test("isChartStyleSupported: line/bar/pie/scatter 系は true", () => {
  ["line", "area", "combo", "bar", "stackedBar", "row", "pie", "donut", "scatter"].forEach((t) => {
    assert.equal(isChartStyleSupported(t), true, t);
  });
});

test("isChartStyleSupported: 未対応 vizType は false", () => {
  ["table", "map", "", undefined, null, "unknown"].forEach((t) => {
    assert.equal(isChartStyleSupported(t), false, String(t));
  });
});

test("getChartControlVisibility: line は線種/ポイント/系列色/軸を表示", () => {
  assert.deepEqual(getChartControlVisibility("line"), {
    showLineControls: true,
    showPointControls: true,
    showAxisLabels: true,
    showSeriesColors: true,
    showAxisCustomization: true,
  });
});

test("getChartControlVisibility: bar は線種/ポイント非表示・系列色/軸は表示", () => {
  assert.deepEqual(getChartControlVisibility("bar"), {
    showLineControls: false,
    showPointControls: false,
    showAxisLabels: true,
    showSeriesColors: true,
    showAxisCustomization: true,
  });
});

test("getChartControlVisibility: pie は系列色のみ・軸関連は非表示", () => {
  assert.deepEqual(getChartControlVisibility("pie"), {
    showLineControls: false,
    showPointControls: false,
    showAxisLabels: false,
    showSeriesColors: true,
    showAxisCustomization: false,
  });
});

test("getChartControlVisibility: scatter はポイント/系列色/軸を表示・線種は非表示", () => {
  assert.deepEqual(getChartControlVisibility("scatter"), {
    showLineControls: false,
    showPointControls: true,
    showAxisLabels: true,
    showSeriesColors: true,
    showAxisCustomization: true,
  });
});

test("dashToString: 配列をカンマ連結。空/非配列は空文字", () => {
  assert.equal(dashToString([5, 5]), "5,5");
  assert.equal(dashToString([8, 4, 2, 4]), "8,4,2,4");
  assert.equal(dashToString([]), "");
  assert.equal(dashToString(null), "");
  assert.equal(dashToString(undefined), "");
  assert.equal(dashToString("5,5"), "");
});

test("stringToDash: カンマ区切りを正の有限数のみへ。空白除去・不正値は除外", () => {
  assert.deepEqual(stringToDash("5,5"), [5, 5]);
  assert.deepEqual(stringToDash(" 8 , 4 , 2 , 4 "), [8, 4, 2, 4]);
  assert.deepEqual(stringToDash("5,abc,3"), [5, 3]);
  assert.deepEqual(stringToDash("0,-2,4"), [4]); // 0 と負値は除外
  assert.deepEqual(stringToDash(""), []);
  assert.deepEqual(stringToDash(null), []);
  assert.deepEqual(stringToDash(["5", "5"]), []);
});
