import assert from "node:assert/strict";
import test from "node:test";
import {
  globalSyncState,
  hasAnyUnsynced,
  updateGlobalMeta,
} from "./globalSyncState.js";

const resetMeta = () => {
  globalSyncState.meta.clear();
};

test("hasAnyUnsynced returns false when meta is empty", () => {
  resetMeta();
  assert.equal(hasAnyUnsynced(), false);
});

test("hasAnyUnsynced returns false when no form has hasUnsynced", () => {
  resetMeta();
  updateGlobalMeta("form-a", { hasUnsynced: false, unsyncedCount: 0 });
  updateGlobalMeta("form-b", { hasUnsynced: false, unsyncedCount: 0 });
  assert.equal(hasAnyUnsynced(), false);
});

test("hasAnyUnsynced returns true if any form has hasUnsynced=true", () => {
  resetMeta();
  updateGlobalMeta("form-a", { hasUnsynced: false, unsyncedCount: 0 });
  updateGlobalMeta("form-b", { hasUnsynced: true, unsyncedCount: 3 });
  assert.equal(hasAnyUnsynced(), true);
});

test("hasAnyUnsynced flips back to false after sync clears the flag", () => {
  resetMeta();
  updateGlobalMeta("form-a", { hasUnsynced: true, unsyncedCount: 1 });
  assert.equal(hasAnyUnsynced(), true);
  updateGlobalMeta("form-a", { hasUnsynced: false, unsyncedCount: 0 });
  assert.equal(hasAnyUnsynced(), false);
});
