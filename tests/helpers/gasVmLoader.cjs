/**
 * GAS テストの共通ヘルパ。
 *
 * Node.js の vm モジュールで gas/*.gs を sandbox 評価するときの定型処理を 1 箇所に集約する。
 * 各テスト固有の context（NFB 定数・スタブ・モック）はテスト側で用意し、本ヘルパは
 * vm.createContext と gas/ 配下のファイル読み込みループだけを担う。
 */

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const PROJECT_ROOT = path.join(__dirname, "..", "..");
const GAS_DIR = path.join(PROJECT_ROOT, "gas");

function loadGasFiles(context, fileNames) {
  if (!context || typeof context !== "object") {
    throw new Error("loadGasFiles: context object is required");
  }
  if (!Array.isArray(fileNames) || fileNames.length === 0) {
    throw new Error("loadGasFiles: fileNames must be a non-empty array");
  }
  vm.createContext(context);
  for (const fileName of fileNames) {
    const filePath = path.join(GAS_DIR, fileName);
    const code = fs.readFileSync(filePath, "utf8");
    vm.runInContext(code, context, { filename: filePath });
  }
  return context;
}

module.exports = { loadGasFiles, GAS_DIR, PROJECT_ROOT };
