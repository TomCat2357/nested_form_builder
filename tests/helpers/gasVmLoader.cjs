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

// 共有ランタイム（builder ESM → esbuild 生成の IIFE）。gas/*.gs の多くが
// NfbAlasqlRuntime.* へのデリゲートを含むため、実バンドル（dist/Bundle.gs）と同じく
// 常に最初にロードする。生成物が無い環境では `npm run build:gas-udfs` を促す。
const RUNTIME_FILE = "generated/nfbAlasqlUdfs.gs";
let runtimeCode = null;

function loadRuntimeCode() {
  if (runtimeCode === null) {
    const runtimePath = path.join(GAS_DIR, RUNTIME_FILE);
    if (!fs.existsSync(runtimePath)) {
      throw new Error(`loadGasFiles: ${RUNTIME_FILE} not found — run \`npm run build:gas-udfs\` first`);
    }
    runtimeCode = fs.readFileSync(runtimePath, "utf8");
  }
  return runtimeCode;
}

function loadGasFiles(context, fileNames) {
  if (!context || typeof context !== "object") {
    throw new Error("loadGasFiles: context object is required");
  }
  if (!Array.isArray(fileNames) || fileNames.length === 0) {
    throw new Error("loadGasFiles: fileNames must be a non-empty array");
  }
  vm.createContext(context);
  if (context.NfbAlasqlRuntime === undefined && !fileNames.includes(RUNTIME_FILE)) {
    vm.runInContext(loadRuntimeCode(), context, { filename: path.join(GAS_DIR, RUNTIME_FILE) });
  }
  for (const fileName of fileNames) {
    const filePath = path.join(GAS_DIR, fileName);
    const code = fs.readFileSync(filePath, "utf8");
    vm.runInContext(code, context, { filename: filePath });
  }
  return context;
}

module.exports = { loadGasFiles, GAS_DIR, PROJECT_ROOT };
