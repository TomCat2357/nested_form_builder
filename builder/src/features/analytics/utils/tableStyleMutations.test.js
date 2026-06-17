import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyAddOverride,
  applyUpdateOverride,
  applyRemoveOverride,
  ensureColumn,
  applySetMinMaxWidth,
  applyAddColumnWidth,
  applyUpdateColumnWidth,
  applyRemoveColumnWidth,
} from "./tableStyleMutations.js";

function baseWithBorder(overrides) {
  return { border: overrides === undefined ? {} : { overrides } };
}

test("applyAddOverride: overrides 未定義でも初期化して既定行を追加", () => {
  const next = applyAddOverride(baseWithBorder(), "row");
  assert.deepEqual(next.border.overrides, [
    { target: "row", selector: "", edges: "both", width: 1, color: "", style: "solid" },
  ]);
});

test("applyUpdateOverride: 該当 idx をマージ更新", () => {
  const base = baseWithBorder([{ target: "row", selector: "", edges: "both", width: 1, color: "", style: "solid" }]);
  const next = applyUpdateOverride(base, 0, { selector: "x>1", width: 3 });
  assert.equal(next.border.overrides[0].selector, "x>1");
  assert.equal(next.border.overrides[0].width, 3);
  assert.equal(next.border.overrides[0].target, "row");
});

test("applyUpdateOverride: 該当 idx 無しは null（onChange しない契約）", () => {
  assert.equal(applyUpdateOverride(baseWithBorder([]), 5, { width: 2 }), null);
});

test("applyRemoveOverride: 指定 idx を除去", () => {
  const base = baseWithBorder([{ selector: "a" }, { selector: "b" }]);
  const next = applyRemoveOverride(base, 0);
  assert.deepEqual(next.border.overrides, [{ selector: "b" }]);
});

test("ensureColumn: column 欠落の古いデータを初期化", () => {
  const next = ensureColumn({});
  assert.deepEqual(next.column, { minWidth: null, maxWidth: null, widths: [] });
});

test("ensureColumn: widths が配列でない / min,max 欠落も補完", () => {
  const next = ensureColumn({ column: { widths: null } });
  assert.ok(Array.isArray(next.column.widths));
  assert.equal(next.column.minWidth, null);
  assert.equal(next.column.maxWidth, null);
});

test("applySetMinMaxWidth: 空文字は null、数値は Number 化", () => {
  assert.equal(applySetMinMaxWidth({}, "minWidth", "").column.minWidth, null);
  assert.equal(applySetMinMaxWidth({}, "minWidth", null).column.minWidth, null);
  assert.equal(applySetMinMaxWidth({}, "maxWidth", "120").column.maxWidth, 120);
});

test("applyAddColumnWidth: 既定幅で行追加（古いデータでも安全）", () => {
  const next = applyAddColumnWidth({}, 40);
  assert.deepEqual(next.column.widths, [{ column: "", width: 40 }]);
});

test("applyUpdateColumnWidth: 該当 idx をマージ / 無しは null", () => {
  const base = { column: { minWidth: null, maxWidth: null, widths: [{ column: "a", width: 40 }] } };
  assert.equal(applyUpdateColumnWidth(base, 0, { width: 80 }).column.widths[0].width, 80);
  assert.equal(applyUpdateColumnWidth({ column: { widths: [] } }, 3, { width: 80 }), null);
});

test("applyRemoveColumnWidth: 指定 idx を除去", () => {
  const base = { column: { widths: [{ column: "a" }, { column: "b" }] } };
  const next = applyRemoveColumnWidth(base, 1);
  assert.deepEqual(next.column.widths, [{ column: "a" }]);
});
