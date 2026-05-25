import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeFileBaseName, resolveDialogTargetIds } from "./listActionsShared.js";

test("sanitizeFileBaseName: 使用不可文字を _ に / 空なら fallback", () => {
  assert.equal(sanitizeFileBaseName("a/b:c", "x"), "a_b_c");
  assert.equal(sanitizeFileBaseName("a*?\"<>|d", "x"), "a______d");
  assert.equal(sanitizeFileBaseName("...", "x"), "x");
  assert.equal(sanitizeFileBaseName("", "x"), "x");
  assert.equal(sanitizeFileBaseName(null, "x"), "x");
  assert.equal(sanitizeFileBaseName(undefined, "x"), "x");
  assert.equal(sanitizeFileBaseName("普通の名前", "x"), "普通の名前");
  assert.equal(sanitizeFileBaseName(".hidden", "x"), "hidden");
});

test("resolveDialogTargetIds: targetIds 優先 → idKey → []", () => {
  assert.deepEqual(resolveDialogTargetIds({ targetIds: ["a", "b"], id: "c" }, "id"), ["a", "b"]);
  assert.deepEqual(resolveDialogTargetIds({ targetIds: [], id: "c" }, "id"), ["c"]);
  assert.deepEqual(resolveDialogTargetIds({ targetIds: [], formId: "f" }, "formId"), ["f"]);
  assert.deepEqual(resolveDialogTargetIds({ targetIds: [] }, "id"), []);
  assert.deepEqual(resolveDialogTargetIds({}, "id"), []);
  assert.deepEqual(resolveDialogTargetIds(null, "id"), []);
});
