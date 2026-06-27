import { test } from "node:test";
import assert from "node:assert/strict";
import { isFormSpreadsheetLinked, applyUnlinkSpreadsheetForRecreate } from "./spreadsheetLinkState.js";

test("isFormSpreadsheetLinked: spreadsheetId があれば連結済み", () => {
  assert.equal(isFormSpreadsheetLinked({ spreadsheetId: "AAA" }), true);
});

test("isFormSpreadsheetLinked: spreadsheetPath があれば連結済み", () => {
  assert.equal(isFormSpreadsheetLinked({ spreadsheetPath: "売上/集計2026" }), true);
});

test("isFormSpreadsheetLinked: 両方空・空白のみ・未指定は未連結", () => {
  assert.equal(isFormSpreadsheetLinked({ spreadsheetPath: "", spreadsheetId: "" }), false);
  assert.equal(isFormSpreadsheetLinked({ spreadsheetPath: "   ", spreadsheetId: "  " }), false);
  assert.equal(isFormSpreadsheetLinked({}), false);
  assert.equal(isFormSpreadsheetLinked(null), false);
  assert.equal(isFormSpreadsheetLinked(undefined), false);
});

test("applyUnlinkSpreadsheetForRecreate: 物理 ID と論理パスを両方空にし無関係キーは保持", () => {
  const input = { spreadsheetPath: "売上/集計", spreadsheetId: "AAA", sheetName: "Data" };
  const next = applyUnlinkSpreadsheetForRecreate(input);
  assert.equal(next.spreadsheetPath, "");
  assert.equal(next.spreadsheetId, "");
  assert.equal(next.sheetName, "Data", "無関係キーは保持");
});

test("applyUnlinkSpreadsheetForRecreate: 入力を破壊しない", () => {
  const input = { spreadsheetPath: "売上/集計", spreadsheetId: "AAA" };
  applyUnlinkSpreadsheetForRecreate(input);
  assert.equal(input.spreadsheetPath, "売上/集計", "入力は非破壊");
  assert.equal(input.spreadsheetId, "AAA", "入力は非破壊");
});

test("applyUnlinkSpreadsheetForRecreate: null/undefined でも安全に空フィールドを返す", () => {
  assert.deepEqual(applyUnlinkSpreadsheetForRecreate(null), { spreadsheetPath: "", spreadsheetId: "" });
  assert.deepEqual(applyUnlinkSpreadsheetForRecreate(undefined), { spreadsheetPath: "", spreadsheetId: "" });
});
