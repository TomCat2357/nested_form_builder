import test from "node:test";
import assert from "node:assert/strict";
import { evaluateCacheForForms, evaluateCacheForAnalytics } from "./cachePolicy.js";

const HOUR = 60 * 60 * 1000;

// forms / dashboards / questions は同一の SWR しきい値（1 時間 fresh / 24 時間で要再取得）を共有する。
for (const [label, evaluate] of [["forms", evaluateCacheForForms], ["analytics", evaluateCacheForAnalytics]]) {
  test(`${label}: キャッシュ無しは shouldSync`, () => {
    const r = evaluate({ lastSyncedAt: null, hasData: false });
    assert.equal(r.shouldSync, true);
    assert.equal(r.shouldBackground, false);
  });

  test(`${label}: 1 時間以内は fresh（取得しない）`, () => {
    const r = evaluate({ lastSyncedAt: Date.now() - 30 * 60 * 1000, hasData: true });
    assert.equal(r.isFresh, true);
    assert.equal(r.shouldSync, false);
    assert.equal(r.shouldBackground, false);
  });

  test(`${label}: 1〜24 時間は background 更新`, () => {
    const r = evaluate({ lastSyncedAt: Date.now() - 3 * HOUR, hasData: true });
    assert.equal(r.shouldBackground, true);
    assert.equal(r.shouldSync, false);
    assert.equal(r.isFresh, false);
  });

  test(`${label}: 24 時間以上は shouldSync（再取得）`, () => {
    const r = evaluate({ lastSyncedAt: Date.now() - 25 * HOUR, hasData: true });
    assert.equal(r.shouldSync, true);
    assert.equal(r.shouldBackground, false);
  });

  test(`${label}: forceSync は鮮度に関係なく shouldSync`, () => {
    const r = evaluate({ lastSyncedAt: Date.now(), hasData: true, forceSync: true });
    assert.equal(r.shouldSync, true);
  });
}
