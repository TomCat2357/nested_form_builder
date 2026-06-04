import assert from "node:assert/strict";
import test from "node:test";
import { formsToOptions, questionsToOptions, columnsToOptions } from "./searchableSelectOptions.js";

// formQualifiedName は settings.formTitle（無ければ name）+ folder からフォルダ込み名を作る。
const mkForm = (id, title, folder) => ({ id, settings: { formTitle: title }, folder });

test("formsToOptions はフォルダ込み label（論理パス）を組む", () => {
  const opts = formsToOptions([mkForm("f1", "苦情データ", "受付/2024")]);
  assert.deepEqual(opts, [{ value: "f1", label: "受付/2024/苦情データ", folder: "受付/2024" }]);
});

test("formsToOptions は folder 空なら label=葉名のみ・folder=空文字", () => {
  const opts = formsToOptions([mkForm("f1", "単独", "")]);
  assert.deepEqual(opts, [{ value: "f1", label: "単独", folder: "" }]);
});

test("formsToOptions は label が空なら value(id) へフォールバックする", () => {
  const opts = formsToOptions([{ id: "f1", settings: {}, folder: "" }]);
  assert.deepEqual(opts, [{ value: "f1", label: "f1", folder: "" }]);
});

test("formsToOptions は null / id 欠落の要素をスキップする", () => {
  const opts = formsToOptions([null, { settings: { formTitle: "x" } }, mkForm("f1", "残る", "")]);
  assert.deepEqual(opts, [{ value: "f1", label: "残る", folder: "" }]);
});

test("formsToOptions は非配列入力で空配列を返す", () => {
  assert.deepEqual(formsToOptions(undefined), []);
  assert.deepEqual(formsToOptions(null), []);
});

test("questionsToOptions はフォルダ込み label（論理パス）を組む", () => {
  const opts = questionsToOptions([{ id: "q1", name: "件数集計", folder: "分析/月次" }]);
  assert.deepEqual(opts, [{ value: "q1", label: "分析/月次/件数集計", folder: "分析/月次" }]);
});

test("questionsToOptions は folder 空なら label=名前のみ・folder=空文字", () => {
  const opts = questionsToOptions([{ id: "q1", name: "件数集計", folder: "" }]);
  assert.deepEqual(opts, [{ value: "q1", label: "件数集計", folder: "" }]);
});

test("questionsToOptions は name が空なら value(id) へフォールバックする", () => {
  const opts = questionsToOptions([{ id: "q1", name: "", folder: "" }]);
  assert.deepEqual(opts, [{ value: "q1", label: "q1", folder: "" }]);
});

test("questionsToOptions は null / id 欠落の要素をスキップする", () => {
  const opts = questionsToOptions([null, { name: "x" }, { id: "q1", name: "残る", folder: "" }]);
  assert.deepEqual(opts, [{ value: "q1", label: "残る", folder: "" }]);
});

test("questionsToOptions は非配列入力で空配列を返す", () => {
  assert.deepEqual(questionsToOptions(undefined), []);
  assert.deepEqual(questionsToOptions(null), []);
});

test("columnsToOptions は通常列を value=key / label=key / folder=空文字 にする", () => {
  const opts = columnsToOptions([{ key: "基本情報|区", label: "区", isMeta: false }]);
  assert.deepEqual(opts, [{ value: "基本情報|区", label: "基本情報|区", folder: "" }]);
});

test("columnsToOptions はメタ列の label に（メタ）を付ける", () => {
  const opts = columnsToOptions([{ key: "createdAt", label: "作成日時", isMeta: true }]);
  assert.deepEqual(opts, [{ value: "createdAt", label: "createdAt（メタ）", folder: "" }]);
});

test("columnsToOptions は key 欠落の要素をスキップする", () => {
  const opts = columnsToOptions([null, { label: "x" }, { key: "氏名", label: "氏名" }]);
  assert.deepEqual(opts, [{ value: "氏名", label: "氏名", folder: "" }]);
});

test("columnsToOptions は非配列入力で空配列を返す", () => {
  assert.deepEqual(columnsToOptions(undefined), []);
  assert.deepEqual(columnsToOptions(null), []);
});
