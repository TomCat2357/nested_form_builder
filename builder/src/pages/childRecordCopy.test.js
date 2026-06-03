import test from "node:test";
import assert from "node:assert/strict";
import { selectFormLinkCopyTargets, buildChildCopyPayload } from "./childRecordCopy.js";

test("selectFormLinkCopyTargets: formLink かつ childFormId を持つ項目だけ抽出する", () => {
  const topLevelFieldMap = {
    t1: { id: "t1", type: "text" },
    f1: { id: "f1", type: "formLink", childFormId: "child-A" },
    f2: { id: "f2", type: "formLink", childFormId: "  child-B  " },
    f3: { id: "f3", type: "formLink", childFormId: "" }, // childFormId 無し → 除外
  };
  const result = selectFormLinkCopyTargets(["t1", "f1", "f2", "f3"], topLevelFieldMap);
  assert.deepEqual(result, [
    { fieldId: "f1", childFormId: "child-A" },
    { fieldId: "f2", childFormId: "child-B" },
  ]);
});

test("selectFormLinkCopyTargets: 未選択・未知IDは無視する", () => {
  const topLevelFieldMap = { f1: { id: "f1", type: "formLink", childFormId: "child-A" } };
  assert.deepEqual(selectFormLinkCopyTargets([], topLevelFieldMap), []);
  assert.deepEqual(selectFormLinkCopyTargets(["unknown"], topLevelFieldMap), []);
  assert.deepEqual(selectFormLinkCopyTargets(null, topLevelFieldMap), []);
  // 選択していない formLink は抽出されない
  assert.deepEqual(selectFormLinkCopyTargets(["other"], topLevelFieldMap), []);
});

test("buildChildCopyPayload: pid を新親 id に刻み、data を responses/order として複製する", () => {
  const child = { id: "old-child-id", pid: "old-parent", data: { "a|b": "1", "c": "●" } };
  const payload = buildChildCopyPayload(child, "new-parent-id");
  assert.equal(payload.version, 1);
  assert.equal(payload.pid, "new-parent-id");
  assert.deepEqual(payload.responses, { "a|b": "1", "c": "●" });
  assert.deepEqual(payload.order, ["a|b", "c"]);
  // 新しい id が採番される（コピー元の id は引き継がない）
  assert.notEqual(payload.id, "old-child-id");
  assert.match(payload.id, /^r/);
});

test("buildChildCopyPayload: data 欠落でも空オブジェクトとして安全に組む", () => {
  const payload = buildChildCopyPayload({}, "p");
  assert.deepEqual(payload.responses, {});
  assert.deepEqual(payload.order, []);
  assert.equal(payload.pid, "p");
});
