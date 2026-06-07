import assert from "node:assert/strict";
import test from "node:test";
import {
  getSidebarCollapsed,
  setSidebarCollapsed,
  toggleSidebarCollapsed,
  subscribeSidebarCollapsed,
} from "./sidebarCollapseStore.js";

// localStorage の無い Node 環境ではメモリ状態のみで動作する（初期値は展開＝false）。
test("初期状態は展開（false）", () => {
  setSidebarCollapsed(false); // 他テストからの汚染を避けるためリセット
  assert.equal(getSidebarCollapsed(), false);
});

test("setSidebarCollapsed で状態を更新できる", () => {
  setSidebarCollapsed(true);
  assert.equal(getSidebarCollapsed(), true);
  setSidebarCollapsed(false);
  assert.equal(getSidebarCollapsed(), false);
});

test("toggleSidebarCollapsed で反転する", () => {
  setSidebarCollapsed(false);
  toggleSidebarCollapsed();
  assert.equal(getSidebarCollapsed(), true);
  toggleSidebarCollapsed();
  assert.equal(getSidebarCollapsed(), false);
});

test("購読者は変化時のみ通知され、解除できる", () => {
  setSidebarCollapsed(false);
  let calls = 0;
  const unsubscribe = subscribeSidebarCollapsed(() => {
    calls += 1;
  });

  setSidebarCollapsed(true); // 変化あり → 通知
  assert.equal(calls, 1);

  setSidebarCollapsed(true); // 同値 → 通知なし
  assert.equal(calls, 1);

  unsubscribe();
  setSidebarCollapsed(false); // 解除後は通知されない
  assert.equal(calls, 1);
});
