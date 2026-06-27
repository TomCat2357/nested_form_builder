import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptyGui,
  emptyVizOptions,
  buildQuestionEditPath,
  questionVisualizationToState,
  buildVizPreview,
} from "./questionEditorState.js";

test("emptyGui: formId を埋めた既定値", () => {
  assert.deepEqual(emptyGui("F1"), {
    schemaVersion: 1,
    formId: "F1",
    aggregations: [{ id: "a_1", type: "count" }],
    groupBy: [],
    filters: [],
    orderBy: [],
    limit: null,
  });
  assert.equal(emptyGui("").formId, "");
  assert.equal(emptyGui(undefined).formId, "");
});

test("emptyVizOptions: 既定構造を返す", () => {
  const vo = emptyVizOptions();
  assert.equal(vo.goal, null);
  assert.equal(vo.tableStyle, null);
  assert.equal(vo.chartStyle, null);
  assert.deepEqual(vo.format, { prefix: "", suffix: "", decimals: null, locale: "" });
  assert.deepEqual(vo.axis.x, { auto: true, min: null, max: null, title: "" });
  assert.deepEqual(vo.series, {});
  // lineStyle は DEFAULT_LINE_STYLE のコピー（参照非共有）。
  const a = emptyVizOptions();
  const b = emptyVizOptions();
  assert.notStrictEqual(a.lineStyle, b.lineStyle);
});

test("buildQuestionEditPath: ID をパスに埋め込む", () => {
  assert.equal(buildQuestionEditPath("abc"), "/admin/questions/abc");
});

test("questionVisualizationToState: undefined / 空でも既定値", () => {
  const s = questionVisualizationToState(undefined);
  assert.equal(s.vizType, "table");
  assert.equal(s.xField, "");
  assert.equal(s.yFields, "");
  assert.deepEqual(s.heatmap, {
    enabled: false,
    direction: "column",
    excludeRows: "",
    excludeColumns: "",
    minColor: "",
    maxColor: "",
  });
  assert.equal(s.vizOptions.goal, null);
});

test("questionVisualizationToState: yFields 配列を CSV 文字列化", () => {
  const s = questionVisualizationToState({ yFields: ["a", "b", "c"] });
  assert.equal(s.yFields, "a,b,c");
});

test("questionVisualizationToState: heatmap 文字列フィールドを引き継ぐ", () => {
  const s = questionVisualizationToState({
    heatmap: {
      enabled: true,
      direction: "row",
      excludeRows: "1,2",
      excludeColumns: "x",
      minColor: "#fff",
      maxColor: "#000",
    },
  });
  assert.deepEqual(s.heatmap, {
    enabled: true,
    direction: "row",
    excludeRows: "1,2",
    excludeColumns: "x",
    minColor: "#fff",
    maxColor: "#000",
  });
});

test("questionVisualizationToState: heatmap の非文字列は既定に落とす", () => {
  const s = questionVisualizationToState({
    heatmap: { excludeRows: 123, minColor: null },
  });
  assert.equal(s.heatmap.excludeRows, "");
  assert.equal(s.heatmap.minColor, "");
});

test("questionVisualizationToState: goal=undefined は null、明示値は保持", () => {
  assert.equal(questionVisualizationToState({}).vizOptions.goal, null);
  assert.equal(questionVisualizationToState({ goal: 100 }).vizOptions.goal, 100);
  assert.equal(questionVisualizationToState({ goal: 0 }).vizOptions.goal, 0);
});

test("questionVisualizationToState: format/axis は既定をベースにマージ", () => {
  const s = questionVisualizationToState({
    format: { prefix: "$" },
    axis: { x: { title: "X 軸" } },
  });
  assert.deepEqual(s.vizOptions.format, { prefix: "$", suffix: "", decimals: null, locale: "" });
  assert.deepEqual(s.vizOptions.axis.x, { auto: true, min: null, max: null, title: "X 軸" });
});

test("questionVisualizationToState: series は object のみ採用", () => {
  assert.deepEqual(questionVisualizationToState({ series: { s1: { color: "#f00" } } }).vizOptions.series, { s1: { color: "#f00" } });
  assert.deepEqual(questionVisualizationToState({ series: null }).vizOptions.series, {});
  assert.deepEqual(questionVisualizationToState({ series: "x" }).vizOptions.series, {});
});

test("buildVizPreview: columnIndex 無しはトークンをそのまま使う", () => {
  const viz = buildVizPreview({
    vizType: "bar",
    xField: "  col_x  ",
    yFields: "a, b ,,c",
    heatmap: { enabled: false },
    vizOptions: emptyVizOptions(),
    columnIndex: null,
  });
  assert.equal(viz.type, "bar");
  assert.equal(viz.xField, "col_x");
  assert.deepEqual(viz.yFields, ["a", "b", "c"]);
  assert.deepEqual(viz.heatmap, { enabled: false });
});

test("buildVizPreview: vizOptions の各設定を素通しする", () => {
  const vo = emptyVizOptions();
  vo.goal = 42;
  const viz = buildVizPreview({
    vizType: "line",
    xField: "",
    yFields: "",
    heatmap: {},
    vizOptions: vo,
    columnIndex: null,
  });
  assert.equal(viz.goal, 42);
  assert.equal(viz.format, vo.format);
  assert.equal(viz.pivot, vo.pivot);
  assert.equal(viz.geo, vo.geo);
  assert.equal(viz.sankey, vo.sankey);
  assert.equal(viz.axis, vo.axis);
  assert.equal(viz.lineStyle, vo.lineStyle);
  assert.equal(viz.series, vo.series);
  assert.equal(viz.tableStyle, vo.tableStyle);
  assert.equal(viz.chartStyle, vo.chartStyle);
  assert.deepEqual(viz.yFields, []);
});
