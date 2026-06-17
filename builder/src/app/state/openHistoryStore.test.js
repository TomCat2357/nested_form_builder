import { test } from "node:test";
import assert from "node:assert/strict";
import { rankOpenHistory } from "./openHistoryStore.js";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_000_000_000_000; // 固定の基準時刻（ms）

test("rankOpenHistory: 同時刻なら openCount が多い順", () => {
  const entries = [
    { entityId: "a", openCount: 2, lastOpenedAt: NOW },
    { entityId: "b", openCount: 5, lastOpenedAt: NOW },
    { entityId: "c", openCount: 1, lastOpenedAt: NOW },
  ];
  const ranked = rankOpenHistory(entries, { now: NOW });
  assert.deepEqual(ranked.map((e) => e.entityId), ["b", "a", "c"]);
});

test("rankOpenHistory: 同 openCount なら最近開いた方が上", () => {
  const entries = [
    { entityId: "old", openCount: 3, lastOpenedAt: NOW - 10 * DAY },
    { entityId: "new", openCount: 3, lastOpenedAt: NOW - 1 * DAY },
  ];
  const ranked = rankOpenHistory(entries, { now: NOW });
  assert.deepEqual(ranked.map((e) => e.entityId), ["new", "old"]);
});

test("rankOpenHistory: recency 減衰で、たまにしか開かない最新より頻繁な定番が勝つ", () => {
  // half-life=14日。1日前の openCount=1 → score ≈ 1 * 2^(-1/14) ≈ 0.95。
  // 30日前の openCount=8 → score ≈ 8 * 2^(-30/14) ≈ 8 * 0.226 ≈ 1.81。定番が勝つ。
  const entries = [
    { entityId: "rare-recent", openCount: 1, lastOpenedAt: NOW - 1 * DAY },
    { entityId: "frequent-old", openCount: 8, lastOpenedAt: NOW - 30 * DAY },
  ];
  const ranked = rankOpenHistory(entries, { now: NOW, halfLifeDays: 14 });
  assert.deepEqual(ranked.map((e) => e.entityId), ["frequent-old", "rare-recent"]);
});

test("rankOpenHistory: 古すぎる定番は、半減期を十分超えると最近の方に負ける", () => {
  // 200日前の openCount=8 → score ≈ 8 * 2^(-200/14) ≈ ほぼ 0。1日前の openCount=1 が勝つ。
  const entries = [
    { entityId: "rare-recent", openCount: 1, lastOpenedAt: NOW - 1 * DAY },
    { entityId: "frequent-ancient", openCount: 8, lastOpenedAt: NOW - 200 * DAY },
  ];
  const ranked = rankOpenHistory(entries, { now: NOW, halfLifeDays: 14 });
  assert.deepEqual(ranked.map((e) => e.entityId), ["rare-recent", "frequent-ancient"]);
});

test("rankOpenHistory: limit で上位だけ切り出す", () => {
  const entries = [
    { entityId: "a", openCount: 1, lastOpenedAt: NOW },
    { entityId: "b", openCount: 9, lastOpenedAt: NOW },
    { entityId: "c", openCount: 5, lastOpenedAt: NOW },
    { entityId: "d", openCount: 3, lastOpenedAt: NOW },
  ];
  const ranked = rankOpenHistory(entries, { now: NOW, limit: 2 });
  assert.deepEqual(ranked.map((e) => e.entityId), ["b", "c"]);
});

test("rankOpenHistory: 不正・欠損入力に強い（throw しない）", () => {
  assert.deepEqual(rankOpenHistory(null), []);
  assert.deepEqual(rankOpenHistory(undefined), []);
  const entries = [
    null,
    { entityId: "x" }, // openCount/lastOpenedAt 欠損 → score 0 扱い
    { entityId: "y", openCount: 2, lastOpenedAt: NOW },
  ];
  const ranked = rankOpenHistory(entries, { now: NOW });
  assert.equal(ranked[0].entityId, "y");
  assert.equal(ranked.length, 2);
});
