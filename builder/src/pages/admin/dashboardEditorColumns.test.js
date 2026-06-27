import { test } from "node:test";
import assert from "node:assert/strict";
import { columnTypeToValueType, computeAvailableColumns } from "./dashboardEditorColumns.js";

test("columnTypeToValueType: number/date はそのまま、その他は text", () => {
  assert.equal(columnTypeToValueType("number"), "number");
  assert.equal(columnTypeToValueType("date"), "date");
  assert.equal(columnTypeToValueType("string"), "text");
  assert.equal(columnTypeToValueType("boolean"), "text");
  assert.equal(columnTypeToValueType("unknown"), "text");
  assert.equal(columnTypeToValueType(undefined), "text");
});

// getFormColumns を注入してフォームごとの列メタを差し替える。
function makeGetFormColumns(map) {
  return (form) => map[form.id] || [];
}

test("computeAvailableColumns: gui モードのカードが参照するフォーム列を集約", () => {
  const cards = [{ questionId: "Q1" }];
  const questionsById = new Map([
    ["Q1", { id: "Q1", query: { mode: "gui", gui: { formId: "F1" } } }],
  ]);
  const forms = [{ id: "F1" }];
  const getFormColumns = makeGetFormColumns({
    F1: [{ alaSqlKey: "k1", key: "売上", label: "売上額", type: "number" }],
  });
  const out = computeAvailableColumns({ cards, questionsById, forms, getFormColumns });
  assert.deepEqual(out, [{ alaSqlKey: "k1", key: "売上", label: "売上額", type: "number" }]);
});

test("computeAvailableColumns: sql モードの複数 formSources を集約", () => {
  const cards = [{ questionId: "Q1" }];
  const questionsById = new Map([
    ["Q1", { id: "Q1", query: { mode: "sql", formSources: [{ formId: "F1" }, { formId: "F2" }] } }],
  ]);
  const forms = [{ id: "F1" }, { id: "F2" }];
  const getFormColumns = makeGetFormColumns({
    F1: [{ alaSqlKey: "a", key: "ka", label: "la", type: "string" }],
    F2: [{ alaSqlKey: "b", key: "kb", label: "lb", type: "date" }],
  });
  const out = computeAvailableColumns({ cards, questionsById, forms, getFormColumns });
  assert.deepEqual(out.map((c) => c.alaSqlKey), ["a", "b"]);
});

test("computeAvailableColumns: alaSqlKey で重複排除（先勝ち）", () => {
  const cards = [{ questionId: "Q1" }, { questionId: "Q2" }];
  const questionsById = new Map([
    ["Q1", { id: "Q1", query: { mode: "gui", gui: { formId: "F1" } } }],
    ["Q2", { id: "Q2", query: { mode: "gui", gui: { formId: "F2" } } }],
  ]);
  const forms = [{ id: "F1" }, { id: "F2" }];
  const getFormColumns = makeGetFormColumns({
    F1: [{ alaSqlKey: "dup", key: "first", label: "L1", type: "number" }],
    F2: [{ alaSqlKey: "dup", key: "second", label: "L2", type: "string" }],
  });
  const out = computeAvailableColumns({ cards, questionsById, forms, getFormColumns });
  assert.equal(out.length, 1);
  assert.equal(out[0].key, "first", "先に出現した列を採用");
});

test("computeAvailableColumns: query 無し / 未知フォーム / message カードは無視", () => {
  const cards = [
    { questionId: "Q1" }, // query 無し
    { questionId: "Q2" }, // 未知フォーム
    { type: "message" }, // questionId 無し
  ];
  const questionsById = new Map([
    ["Q1", { id: "Q1" }],
    ["Q2", { id: "Q2", query: { mode: "gui", gui: { formId: "MISSING" } } }],
  ]);
  const forms = [{ id: "F1" }];
  const getFormColumns = makeGetFormColumns({ F1: [{ alaSqlKey: "x", key: "kx", label: "lx", type: "number" }] });
  const out = computeAvailableColumns({ cards, questionsById, forms, getFormColumns });
  assert.deepEqual(out, []);
});

test("computeAvailableColumns: cards/forms 未定義でも空配列", () => {
  assert.deepEqual(
    computeAvailableColumns({ cards: undefined, questionsById: new Map(), forms: undefined, getFormColumns: () => [] }),
    []
  );
});
