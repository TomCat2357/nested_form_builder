import assert from "node:assert/strict";
import test from "node:test";
import {
  applyDateFilter,
  applyTimeFilter,
  datePresets,
  timePresets,
  inferRangeKind,
  toYmd,
} from "./dateRangePresets.js";

test("toYmd はローカル日付を YYYY-MM-DD で返す", () => {
  assert.equal(toYmd(new Date(2026, 4, 3, 23, 59)), "2026-05-03");
  assert.equal(toYmd(new Date(2026, 11, 31, 0, 0)), "2026-12-31");
});

test("datePresets: last7 / last30 / last90 / thisMonth の範囲", () => {
  const now = new Date(2026, 4, 10, 12, 0).getTime(); // 2026-05-10 (火)
  const byKey = Object.fromEntries(datePresets().map((p) => [p.key, p.range(now)]));
  assert.deepEqual(byKey.last7, { from: "2026-05-04", to: "2026-05-10" });
  assert.deepEqual(byKey.last30, { from: "2026-04-11", to: "2026-05-10" });
  assert.deepEqual(byKey.last90, { from: "2026-02-10", to: "2026-05-10" });
  assert.deepEqual(byKey.thisMonth, { from: "2026-05-01", to: "2026-05-10" });
});

test("applyDateFilter: filter が無効なら rows をそのまま返す", () => {
  const rows = [{ d: "2026-01-01" }, { d: "2026-02-01" }];
  assert.equal(applyDateFilter(rows, null), rows);
  assert.equal(applyDateFilter(rows, { column: "d", from: null, to: null }), rows);
  assert.equal(applyDateFilter(rows, { column: "", from: "2026-01-01", to: null }), rows);
});

test("applyDateFilter: from/to で絞り込む（to はその日を含む）", () => {
  const rows = [
    { d: "2026-01-01" },
    { d: "2026-01-15" },
    { d: "2026-01-31T23:00:00Z" },
    { d: "2026-02-01" },
  ];
  const out = applyDateFilter(rows, { column: "d", from: "2026-01-10", to: "2026-01-31" });
  assert.deepEqual(out.map((r) => r.d), ["2026-01-15", "2026-01-31T23:00:00Z"]);
});

test("applyDateFilter: from のみ / to のみ", () => {
  const rows = [{ d: "2026-01-01" }, { d: "2026-06-01" }, { d: "2026-12-01" }];
  assert.deepEqual(applyDateFilter(rows, { column: "d", from: "2026-06-01", to: null }).map((r) => r.d), ["2026-06-01", "2026-12-01"]);
  assert.deepEqual(applyDateFilter(rows, { column: "d", from: null, to: "2026-06-01" }).map((r) => r.d), ["2026-01-01", "2026-06-01"]);
});

test("applyDateFilter: epoch ms / Date / 無効値の扱い", () => {
  const rows = [
    { d: new Date(2026, 0, 15).getTime() },
    { d: new Date(2026, 5, 15) },
    { d: "" },
    { d: null },
    { d: "not-a-date" },
  ];
  const out = applyDateFilter(rows, { column: "d", from: "2026-01-01", to: "2026-12-31" });
  assert.equal(out.length, 2);
});

test("timePresets: 各レンジ", () => {
  const byKey = Object.fromEntries(timePresets().map((p) => [p.key, p.range()]));
  assert.deepEqual(byKey.morning, { from: "00:00", to: "11:59" });
  assert.deepEqual(byKey.afternoon, { from: "12:00", to: "23:59" });
  assert.deepEqual(byKey.businessHours, { from: "09:00", to: "18:00" });
});

test("applyTimeFilter: filter が無効なら rows をそのまま返す", () => {
  const rows = [{ t: "09:00:00" }, { t: "13:00:00" }];
  assert.equal(applyTimeFilter(rows, null), rows);
  assert.equal(applyTimeFilter(rows, { column: "t", from: null, to: null }), rows);
  assert.equal(applyTimeFilter(rows, { column: "", from: "09:00", to: null }), rows);
});

test("applyTimeFilter: from/to で絞り込む（to はその分を含む）", () => {
  const rows = [
    { t: "08:59:59" },
    { t: "09:00:00" },
    { t: "12:00:00" },
    { t: "12:00:30" },
    { t: "12:01:00" },
    { t: "17:30" },
  ];
  const out = applyTimeFilter(rows, { column: "t", from: "09:00", to: "12:00" });
  assert.deepEqual(out.map((r) => r.t), ["09:00:00", "12:00:00", "12:00:30"]);
});

test("applyTimeFilter: from のみ / to のみ / 無効値の除外", () => {
  const rows = [{ t: "00:30:00" }, { t: "10:00:00" }, { t: "23:00:00" }, { t: "" }, { t: null }, { t: "2026-01-01" }, { t: "nope" }];
  assert.deepEqual(applyTimeFilter(rows, { column: "t", from: "10:00", to: null }).map((r) => r.t), ["10:00:00", "23:00:00"]);
  assert.deepEqual(applyTimeFilter(rows, { column: "t", from: null, to: "10:00" }).map((r) => r.t), ["00:30:00", "10:00:00"]);
});

test("inferRangeKind: 時刻のみ文字列は time、それ以外（値なし含む）は date", () => {
  assert.equal(inferRangeKind([{ c: "14:30" }], "c"), "time");
  assert.equal(inferRangeKind([{ c: "14:30:00" }], "c"), "time");
  assert.equal(inferRangeKind([{ c: null }, { c: "" }, { c: "09:05:00" }], "c"), "time");
  assert.equal(inferRangeKind([{ c: "2026-01-01" }], "c"), "date");
  assert.equal(inferRangeKind([{ c: "2026-01-01_09:00:00" }], "c"), "date");
  assert.equal(inferRangeKind([{ c: 1234567890 }], "c"), "date");
  assert.equal(inferRangeKind([{ c: null }, { c: "" }], "c"), "date");
  assert.equal(inferRangeKind([], "c"), "date");
  assert.equal(inferRangeKind(null, "c"), "date");
  assert.equal(inferRangeKind([{ c: "14:30" }], ""), "date");
});
