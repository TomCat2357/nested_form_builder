// shared/chojuDomain.json を単一ソースとして、各 external-action モジュールの Combined.gs 内
// マーカー区間
//   // >>> shared:chojuDomain ...
//   // <<< shared:chojuDomain
// を、モジュールの接頭辞付き var 宣言で再生成する。各 Combined.gs は clasp で独立プロジェクトへ
// push される自己完結ファイルのまま（実行時の共有ライブラリ依存は持たない）。
//
// 使い方: node gas_for_external_action/scripts/sync-shared-constants.mjs [--check]
//   --check: 書き換えず、再生成結果が現状と一致するか検査（差分があれば exit 1）。CI 向け。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

var __dirname = path.dirname(fileURLToPath(import.meta.url));
var EXT_ROOT = path.resolve(__dirname, "..");
var SPEC_PATH = path.join(EXT_ROOT, "shared", "chojuDomain.json");
var START_RE = /^[^\n]*\/\/ >>> shared:chojuDomain[^\n]*$/m;
var END_RE = /^[^\n]*\/\/ <<< shared:chojuDomain[^\n]*$/m;

// JS リテラルとして整形（配列=", " 区切り 1 行 / オブジェクト="{ k: v, ... }" 1 行）。
function renderValue_(value) {
  if (Array.isArray(value)) {
    return "[" + value.map(function (v) { return JSON.stringify(v); }).join(", ") + "]";
  }
  if (value && typeof value === "object") {
    var body = Object.keys(value).map(function (k) {
      return JSON.stringify(k) + ": " + JSON.stringify(value[k]);
    }).join(", ");
    return "{ " + body + " }";
  }
  return JSON.stringify(value);
}

function renderBlock_(constants, prefix) {
  var lines = [
    "// 鳥獣保護管理法の法令由来ドメイン語彙（SPECIES_ORDER_/TOOL_ORDER_/TOOL_KIND_/GUN_LIC_）。",
    "// choju_kyokasho(出力) と choju_yoshiki(取込) の共有。直接編集せず shared/chojuDomain.json を更新して再生成する。"
  ];
  Object.keys(constants).forEach(function (name) {
    lines.push("var " + prefix + name + " = " + renderValue_(constants[name]) + ";");
  });
  return lines.join("\n");
}

function applyToFile_(filePath, block) {
  var src = fs.readFileSync(filePath, "utf8");
  var startM = src.match(START_RE);
  var endM = src.match(END_RE);
  if (!startM || !endM) {
    throw new Error("マーカー (// >>> shared:chojuDomain / // <<< shared:chojuDomain) が見つかりません: " + filePath);
  }
  var startEnd = startM.index + startM[0].length;
  var endStart = endM.index;
  if (endStart < startEnd) throw new Error("マーカーの順序が不正です: " + filePath);
  var next = src.slice(0, startEnd) + "\n" + block + "\n" + src.slice(endStart);
  return { src: src, next: next, changed: src !== next };
}

function main() {
  var check = process.argv.indexOf("--check") !== -1;
  var spec = JSON.parse(fs.readFileSync(SPEC_PATH, "utf8"));
  var drift = [];
  spec.targets.forEach(function (t) {
    var filePath = path.join(EXT_ROOT, t.file);
    var block = renderBlock_(spec.constants, t.prefix);
    var r = applyToFile_(filePath, block);
    if (check) {
      if (r.changed) drift.push(t.file);
      console.log((r.changed ? "DRIFT  " : "ok     ") + t.file);
    } else {
      if (r.changed) fs.writeFileSync(filePath, r.next);
      console.log((r.changed ? "updated" : "ok     ") + " " + t.file);
    }
  });
  if (check && drift.length) {
    console.error("\n再生成が必要です（node gas_for_external_action/scripts/sync-shared-constants.mjs を実行）:\n  " + drift.join("\n  "));
    process.exit(1);
  }
}

main();
