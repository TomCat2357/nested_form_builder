import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_LAYOUT,
  DEFAULT_CARD_SIZE,
  createEmptyV2,
  isV2,
  createMessageCardDefaults,
  getCardType,
  CARD_TYPE_QUESTION,
  CARD_TYPE_MESSAGE,
  assertV2,
  defaultSimpleFilterValue,
  MAX_SIMPLE_FILTERS,
} from "./dashboardSchema.js";

// ChartRenderer のグラフ領域は高さ 300px 固定。カードヘッダ込みでこれより低いと
// ダッシュボード表示時に X 軸ラベルがクリップされる。rowHeight 60px なので
// 既定カード高 h は 6 以上（= 360px 以上）を維持する。
test("DEFAULT_CARD_SIZE はグラフ領域 300px を収められる高さを持つ", () => {
  assert.ok(DEFAULT_CARD_SIZE.h * DEFAULT_LAYOUT.rowHeight >= 300,
    `カード既定高 ${DEFAULT_CARD_SIZE.h} 行 × ${DEFAULT_LAYOUT.rowHeight}px はグラフ 300px 未満`);
  assert.ok(DEFAULT_CARD_SIZE.minH >= 3, "minH は 3 行以上であるべき");
});

test("createEmptyV2 は schemaVersion 2 の空ダッシュボードを返す", () => {
  const d = createEmptyV2({ name: "x" });
  assert.equal(isV2(d), true);
  assert.equal(d.name, "x");
  assert.deepEqual(d.cards, []);
});

test("getCardType: type 未指定の旧カードは question 扱い", () => {
  assert.equal(getCardType({ id: "c1", questionId: "q1", x: 0, y: 0, w: 6, h: 6 }), CARD_TYPE_QUESTION);
  assert.equal(getCardType({ id: "c1", type: null, questionId: "q1" }), CARD_TYPE_QUESTION);
  assert.equal(getCardType(null), CARD_TYPE_QUESTION);
});

test("getCardType: type === 'message' のカードは message を返す", () => {
  assert.equal(getCardType({ id: "c1", type: "message", text: "hello" }), CARD_TYPE_MESSAGE);
});

test("createMessageCardDefaults: 既定値を返す", () => {
  const d = createMessageCardDefaults();
  assert.equal(d.type, CARD_TYPE_MESSAGE);
  assert.equal(d.text, "");
  assert.equal(typeof d.fontSize, "number");
  assert.equal(typeof d.color, "string");
  assert.equal(typeof d.background, "string");
  assert.equal(typeof d.align, "string");
});

test("assertV2: メッセージカードを含むダッシュボードを許容する (questionId 不要)", () => {
  const d = createEmptyV2({ name: "x" });
  d.cards = [
    { id: "c1", type: "message", text: "hello", x: 0, y: 0, w: 6, h: 3 },
    { id: "c2", questionId: "q1", x: 0, y: 3, w: 6, h: 6 }, // 旧形式
  ];
  assert.doesNotThrow(() => assertV2(d));
});

test("createEmptyV2 は simpleFilters を空配列で持つ", () => {
  const d = createEmptyV2({ name: "x" });
  assert.deepEqual(d.simpleFilters, []);
});

test("defaultSimpleFilterValue は { min: null, max: null } を返す", () => {
  assert.deepEqual(defaultSimpleFilterValue(), { min: null, max: null });
});

test("assertV2: 正常な simpleFilters を許容する", () => {
  const d = createEmptyV2({ name: "x" });
  d.simpleFilters = [
    { id: "sf1", column: "uketsukebi", label: "受付日", valueType: "date" },
    { id: "sf2", column: "kingaku", label: "金額", valueType: "number" },
  ];
  assert.doesNotThrow(() => assertV2(d));
});

test("assertV2: simpleFilters 未定義（旧データ）も許容する", () => {
  const d = createEmptyV2({ name: "x" });
  delete d.simpleFilters;
  assert.doesNotThrow(() => assertV2(d));
});

test("assertV2: simpleFilters が上限件数を超えると throw する", () => {
  const d = createEmptyV2({ name: "x" });
  d.simpleFilters = [];
  for (let i = 0; i <= MAX_SIMPLE_FILTERS; i += 1) {
    d.simpleFilters.push({ id: "sf" + i, column: "c" + i, valueType: "text" });
  }
  assert.throws(() => assertV2(d), /簡易フィルタは最大/);
});

test("assertV2: simpleFilter に column が無いと throw する", () => {
  const d = createEmptyV2({ name: "x" });
  d.simpleFilters = [{ id: "sf1", valueType: "date" }];
  assert.throws(() => assertV2(d), /simpleFilter.column/);
});
