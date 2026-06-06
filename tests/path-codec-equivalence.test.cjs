/**
 * パスコーデックのフロント / GAS 等価性テスト。
 *
 * 双子実装:
 *   フロント: builder/src/utils/pathCodec.js
 *             （joinFieldPath / splitFieldPath / splitFieldKey）
 *             + builder/src/features/analytics/utils/headerToAlaSqlKey.js（headerKeyToAlaSqlKey）
 *   GAS:      gas/pathCodec.gs
 *             （Nfb_joinFieldPath_ / Nfb_splitFieldPath_ / Nfb_splitFieldKey_ / Nfb_headerKeyToAlaSqlKey_）
 *
 * 物理統合はせず、本テストで同入力に同出力を返すことを担保してドリフトを検知する。
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadGas() {
  const context = { console };
  vm.createContext(context);
  const gasFile = path.join(__dirname, "..", "gas", "pathCodec.gs");
  vm.runInContext(fs.readFileSync(gasFile, "utf8"), context, { filename: gasFile });
  return context;
}

async function loadFront() {
  const codec = await import("../builder/src/utils/pathCodec.js");
  const hdr = await import("../builder/src/features/analytics/utils/headerToAlaSqlKey.js");
  return { ...codec, headerKeyToAlaSqlKey: hdr.headerKeyToAlaSqlKey };
}

// セグメント配列ケース（join / 往復用）
const SEGMENT_CASES = [
  ["親", "子", "孫"],
  ["aaa", "bbb", "cc/c"],
  ["a\\b", "c/d"],
  ["売上|目標", "担当"],
  ["only"],
  ["a/b/c"],
  ["\\", "/"],
  ["前後 ", " 空白"],
];

// 文字列ケース（splitFieldPath / splitFieldKey / headerKeyToAlaSqlKey 用）
const STRING_CASES = [
  "親/子/孫",
  "aaa/bbb/cc\\/c",
  "aaa/bbb/'cc/c'",
  'aaa/bbb/"cc/c"',
  "/親//子/",
  " 親 / 子 ",
  "売上|目標/担当",
  "基本情報|区",      // legacy パイプ
  "基本情報/区",      // 新スラッシュ
  "親/",
  "",
  "No.",
];

test("joinFieldPath: フロント / GAS が一致", async () => {
  const front = await loadFront();
  const gas = loadGas();
  for (const segs of SEGMENT_CASES) {
    assert.equal(
      gas.Nfb_joinFieldPath_(segs),
      front.joinFieldPath(segs),
      `joinFieldPath(${JSON.stringify(segs)})`,
    );
  }
});

test("splitFieldPath（クォート/エスケープ受理）: フロント / GAS が一致", async () => {
  const front = await loadFront();
  const gas = loadGas();
  for (const s of STRING_CASES) {
    assert.deepEqual(
      Array.from(gas.Nfb_splitFieldPath_(s)),
      front.splitFieldPath(s),
      `splitFieldPath(${JSON.stringify(s)})`,
    );
  }
});

test("splitFieldKey（内部キー）: フロント / GAS が一致", async () => {
  const front = await loadFront();
  const gas = loadGas();
  for (const s of STRING_CASES) {
    assert.deepEqual(
      Array.from(gas.Nfb_splitFieldKey_(s)),
      front.splitFieldKey(s),
      `splitFieldKey(${JSON.stringify(s)})`,
    );
  }
});

test("headerKeyToAlaSqlKey（legacy | も受理）: フロント / GAS が一致", async () => {
  const front = await loadFront();
  const gas = loadGas();
  for (const s of STRING_CASES) {
    assert.equal(
      gas.Nfb_headerKeyToAlaSqlKey_(s),
      front.headerKeyToAlaSqlKey(s),
      `headerKeyToAlaSqlKey(${JSON.stringify(s)})`,
    );
  }
});

test("往復: joinFieldPath → splitFieldKey がセグメント配列を復元（両実装）", async () => {
  const front = await loadFront();
  const gas = loadGas();
  for (const segs of SEGMENT_CASES) {
    assert.deepEqual(front.splitFieldKey(front.joinFieldPath(segs)), segs);
    assert.deepEqual(Array.from(gas.Nfb_splitFieldKey_(gas.Nfb_joinFieldPath_(segs))), segs);
  }
});
