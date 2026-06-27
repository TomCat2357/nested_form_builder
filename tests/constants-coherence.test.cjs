/**
 * フロント / GAS で二重定義されている定数の整合性テスト（D5）。
 *
 * ネスト最大深さは両層で別々に定義されている:
 *   フロント: builder/src/core/constants.js  … MAX_DEPTH（スキーマ検証の最大階層）
 *   GAS:      gas/constants.gs               … NFB_HEADER_DEPTH（シートのメタ見出し行数）
 *
 * 用途は異なるが「同じ値であること」が要件（見出し行数とネスト深さが一致して初めて
 * 11 階層のフォームがシートに正しくマップされる）。物理統合はできない（実行環境・import 経路が別）
 * ため、本テストで値の一致を CI 上で担保し、片側だけ変更したときのドリフトを検知する。
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadGasConstants() {
  const ctx = { console };
  vm.createContext(ctx);
  const gasFile = path.join(__dirname, "..", "gas", "constants.gs");
  vm.runInContext(fs.readFileSync(gasFile, "utf8"), ctx, { filename: gasFile });
  return ctx;
}

async function loadFrontConstants() {
  return import("../builder/src/core/constants.js");
}

test("ネスト最大深さ: フロント MAX_DEPTH === GAS NFB_HEADER_DEPTH", async () => {
  const front = await loadFrontConstants();
  const gas = loadGasConstants();
  assert.equal(
    front.MAX_DEPTH,
    gas.NFB_HEADER_DEPTH,
    `MAX_DEPTH(${front.MAX_DEPTH}) と NFB_HEADER_DEPTH(${gas.NFB_HEADER_DEPTH}) が不一致。` +
      "片側だけ変更した場合は両方を揃えること。",
  );
});

test("GAS: データ開始行はメタ見出し行数の直後（NFB_DATA_START_ROW === NFB_HEADER_DEPTH + 1）", () => {
  const gas = loadGasConstants();
  assert.equal(gas.NFB_DATA_START_ROW, gas.NFB_HEADER_DEPTH + gas.NFB_HEADER_START_ROW);
});
