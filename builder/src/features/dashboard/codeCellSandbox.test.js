import test from "node:test";
import assert from "node:assert/strict";
import { runCustomCodeCell } from "./codeCellSandbox.js";

const baseInput = {
  records: [
    { id: "a", data: { Q1: "X" }, dataUnixMs: {} },
    { id: "b", data: { Q1: "Y" }, dataUnixMs: {} },
    { id: "c", data: { Q1: "X" }, dataUnixMs: {} },
  ],
  forms: [],
  formsById: {},
  recordsByForm: {},
  selectedFormIds: [],
};

test("returns chart spec from helpers", () => {
  const code = `
    const data = ctx.helpers.groupBy(ctx.records, "Q1").map((r) => ({ name: r.key, value: r.count }));
    return ctx.chart.bar({ data });
  `;
  const result = runCustomCodeCell(code, baseInput);
  assert.equal(result.ok, true);
  assert.equal(result.spec.kind, "chart");
  assert.equal(result.spec.type, "bar");
  assert.deepEqual(result.spec.data, [
    { name: "X", value: 2 },
    { name: "Y", value: 1 },
  ]);
});

test("captures syntax errors", () => {
  const result = runCustomCodeCell("return ;;;not valid", baseInput);
  assert.equal(result.ok, false);
  assert.match(result.error, /構文エラー/);
});

test("captures runtime errors", () => {
  const result = runCustomCodeCell("throw new Error('boom')", baseInput);
  assert.equal(result.ok, false);
  assert.match(result.error, /実行時エラー/);
  assert.match(result.error, /boom/);
});

test("rejects non-object return values", () => {
  const result = runCustomCodeCell("return 123", baseInput);
  assert.equal(result.ok, false);
});

test("rejects missing return", () => {
  const result = runCustomCodeCell("/* no return */", baseInput);
  assert.equal(result.ok, false);
});

test("table spec passes through", () => {
  const code = `return ctx.table({ rows: [{a:1, b:2}], columns: ["a","b"] })`;
  const result = runCustomCodeCell(code, baseInput);
  assert.equal(result.ok, true);
  assert.equal(result.spec.kind, "table");
  assert.equal(result.spec.rows.length, 1);
});
