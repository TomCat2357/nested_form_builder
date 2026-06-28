/**
 * ULID / ID 生成プリミティブのフロント / GAS 等価性テスト。
 *
 * 双子実装（いずれも手書き・独立実装のためドリフトしうる）:
 *   フロント: builder/src/core/ids.js
 *             （encodeUlidTime / encodeUlidRandom / incrementBase32 + 生成系 genCardId 等）
 *   GAS:      gas/constants.gs
 *             （Nfb_encodeUlidTime_ / Nfb_encodeUlidRandom_ / Nfb_incrementUlidRandom_ / Nfb_generateUlid_）
 *
 * 物理統合はしない（実行環境差: フロントは crypto / GAS は Utilities、可変グローバル状態の保持境界も異なる）。
 * 代わりに本テストで「決定的プリミティブが同入力に同出力を返す」ことを担保し、byte 互換のドリフトを検知する。
 * 生成系（createUlid / Nfb_generateUlid_）は Date.now / 乱数に依存し非決定的なので等価対象にせず、
 * 出力フォーマット（プレフィックス・長さ・アルファベット）だけを構造検査する。
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadGas() {
  const context = { console };
  vm.createContext(context);
  const gasFile = path.join(__dirname, "..", "gas", "constants.gs");
  vm.runInContext(fs.readFileSync(gasFile, "utf8"), context, { filename: gasFile });
  return context;
}

async function loadFront() {
  return import("../builder/src/core/ids.js");
}

// encodeUlidTime のケース（境界含む）
const TIME_CASES = [
  0,
  1,
  31,
  32,
  1700000000000,
  1,
  Date.UTC(2026, 0, 1),
  Date.UTC(1999, 11, 31, 23, 59, 59, 999),
  -1, // 負値は 0 にクランプ
  Number.NaN, // 非有限は 0 にクランプ
  32 ** 10 - 1, // 10桁 base32 の最大付近
];

// encodeUlidRandom のバイト列ケース
const BYTE_CASES = [
  [0],
  [255],
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  [255, 255, 255, 255, 255],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [171, 205, 239, 18, 52, 86, 120, 154, 188, 222],
  [127, 128, 1, 254],
];

// incrementBase32 / Nfb_incrementUlidRandom_ のケース（オーバーフロー・短長含む）
const INCREMENT_CASES = [
  "0000000000000000",
  "000000000000000Z", // 末尾繰り上がり
  "ZZZZZZZZZZZZZZZZ", // 全桁オーバーフロー
  "0000000000000009",
  "000000000000000",  // 16 未満 → 右ゼロ埋め
  "ABCDEFGHJKMNPQRS",
  "",                  // 空 → 全ゼロ起点
];

test("ULID アルファベット・乱数長の定数が一致", async () => {
  const front = await loadFront();
  const gas = loadGas();
  assert.equal(front.ULID_ALPHABET, gas.Nfb_ulidAlphabet_());
  assert.equal(front.ULID_RANDOM_LENGTH, gas.NFB_ULID_RANDOM_LENGTH);
});

test("encodeUlidTime: フロント / GAS が一致", async () => {
  const front = await loadFront();
  const gas = loadGas();
  for (const ms of TIME_CASES) {
    assert.equal(
      front.encodeUlidTime(ms),
      gas.Nfb_encodeUlidTime_(ms),
      `encodeUlidTime(${String(ms)})`,
    );
  }
});

test("encodeUlidRandom: フロント / GAS が一致", async () => {
  const front = await loadFront();
  const gas = loadGas();
  for (const bytes of BYTE_CASES) {
    assert.equal(
      front.encodeUlidRandom(bytes),
      gas.Nfb_encodeUlidRandom_(bytes),
      `encodeUlidRandom(${JSON.stringify(bytes)})`,
    );
  }
});

test("incrementBase32 / Nfb_incrementUlidRandom_: value と overflow が一致", async () => {
  const front = await loadFront();
  const gas = loadGas();
  for (const v of INCREMENT_CASES) {
    const f = front.incrementBase32(v);
    const g = gas.Nfb_incrementUlidRandom_(v);
    assert.equal(f.value, g.value, `increment value (${JSON.stringify(v)})`);
    assert.equal(f.overflow, g.overflow, `increment overflow (${JSON.stringify(v)})`);
  }
});

test("生成系の構造: card_/flt_ プレフィックス + 26桁 ULID（フロント）", async () => {
  const front = await loadFront();
  const alpha = front.ULID_ALPHABET;
  const ulidRe = new RegExp(`^[${alpha}]{26}$`);
  const card = front.genCardId();
  const flt = front.genFilterId();
  assert.match(card, /^card_/);
  assert.match(flt, /^flt_/);
  assert.match(card.slice("card_".length), ulidRe);
  assert.match(flt.slice("flt_".length), ulidRe);
});
