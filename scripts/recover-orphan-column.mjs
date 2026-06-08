#!/usr/bin/env node
/**
 * recover-orphan-column.mjs
 *
 * R8_ひぐまとめ の Data シート CSV から、ヘッダーが空白の「孤立列」に取り残された
 * 特勤(`内容/ヒグマ/特勤/はい`)のデータを、正しい特勤列へ移し替えて修正済み CSV を出力する
 * ワンオフ・ユーティリティ。実シート(Google Sheets)には一切アクセスしない。
 *
 * 背景:
 *   ヘッダー行(NFB_HEADER_DEPTH=11)の下にデータがあるが、特勤の値が
 *   - ヘッダー空白の孤立列(過去/手動操作で取り残された列)と
 *   - 正規の `内容/ヒグマ/特勤/はい` 列
 *   の 2 つに分裂し、孤立列側はアプリの読み取りでスキップされ「消えた」ように見えていた。
 *   このスクリプトは孤立列の値を正規列の空セルへ移し、空になった孤立列を削除する。
 *   列の並べ替えはしない。r_2026_* 等ほかの行・列は触らない。
 *
 * 使い方:
 *   node scripts/recover-orphan-column.mjs [input.csv] [output.csv]
 *   既定 input : form_data/NFB Responses - R8_ひぐまとめ - Data.csv
 *   既定 output: 同ディレクトリに " (corrected)" を付けたファイル
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const NFB_HEADER_DEPTH = 11;
// 取り残された特勤の正規の宛先パス(ヘッダー上のラベル列)。
const TARGET_PATH = ["内容", "ヒグマ", "特勤", "はい"];
const PATH_SEP = "/";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const DEFAULT_INPUT = join(REPO_ROOT, "form_data", "NFB Responses - R8_ひぐまとめ - Data.csv");

// ---------------------------------------------------------------------------
// 最小 CSV パーサ / シリアライザ(引用符内のカンマ・改行・"" エスケープに対応)
// ---------------------------------------------------------------------------

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  const pushField = () => { row.push(field); field = ""; };
  const pushRow = () => { rows.push(row); row = []; };

  while (i < n) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i += 1; continue;
      }
      field += ch; i += 1; continue;
    }
    if (ch === '"') { inQuotes = true; i += 1; continue; }
    if (ch === ",") { pushField(); i += 1; continue; }
    if (ch === "\r") {
      // CRLF または CR
      pushField(); pushRow();
      i += (text[i + 1] === "\n") ? 2 : 1;
      continue;
    }
    if (ch === "\n") { pushField(); pushRow(); i += 1; continue; }
    field += ch; i += 1;
  }
  // 末尾フィールド/行(最終行に改行が無い場合)
  if (field.length > 0 || row.length > 0) { pushField(); pushRow(); }
  return rows;
}

function needsQuoting(value) {
  return /[",\r\n]/.test(value);
}

function serializeCsv(rows, eol) {
  return rows
    .map((row) => row.map((cell) => {
      const s = cell == null ? "" : String(cell);
      return needsQuoting(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(","))
    .join(eol) + eol;
}

// ---------------------------------------------------------------------------
// ヘッダー解析
// ---------------------------------------------------------------------------

// 列のパス = ヘッダー行 0 から、最初の空セルまで連続する非空ラベル(GAS の挙動に一致)。
function columnPath(header, col) {
  const path = [];
  for (let r = 0; r < NFB_HEADER_DEPTH; r++) {
    const cell = (header[r] && header[r][col] != null) ? String(header[r][col]).trim() : "";
    if (!cell) break;
    path.push(cell);
  }
  return path;
}

function isBlankHeader(header, col) {
  for (let r = 0; r < NFB_HEADER_DEPTH; r++) {
    const cell = (header[r] && header[r][col] != null) ? String(header[r][col]).trim() : "";
    if (cell) return false;
  }
  return true;
}

function nearestHeadedNeighborKey(header, col, ncol, dir) {
  for (let c = col + dir; c >= 0 && c < ncol; c += dir) {
    if (!isBlankHeader(header, c)) return columnPath(header, c).join(PATH_SEP);
  }
  return dir < 0 ? "(行頭)" : "(行末)";
}

// ---------------------------------------------------------------------------
// メイン
// ---------------------------------------------------------------------------

function main() {
  const inputPath = process.argv[2] || DEFAULT_INPUT;
  const outputPath = process.argv[3] || inputPath.replace(/\.csv$/i, "") + " (corrected).csv";

  const raw = readFileSync(inputPath, "utf8");
  const eol = raw.includes("\r\n") ? "\r\n" : "\n";
  const rows = parseCsv(raw);

  if (rows.length < NFB_HEADER_DEPTH + 1) {
    console.error(`[abort] 行数が少なすぎます (${rows.length} 行)。ヘッダー ${NFB_HEADER_DEPTH} 行 + データが必要です。`);
    process.exit(1);
  }

  const ncol = rows.reduce((m, r) => Math.max(m, r.length), 0);
  // 全行を ncol 幅に正規化(欠けは空文字で埋める)。
  for (const r of rows) { while (r.length < ncol) r.push(""); }

  const header = rows.slice(0, NFB_HEADER_DEPTH);
  const dataStart = NFB_HEADER_DEPTH;
  const ID_COL = 0;
  const NO_COL = 1;

  const dataHasValue = (col) => {
    for (let r = dataStart; r < rows.length; r++) {
      if (String(rows[r][col] ?? "").trim() !== "") return true;
    }
    return false;
  };

  // 孤立列 = ヘッダー空白 かつ データ有り。
  const orphanCols = [];
  for (let c = 0; c < ncol; c++) {
    if (isBlankHeader(header, c) && dataHasValue(c)) orphanCols.push(c);
  }

  // 宛先(特勤)列。
  const targetKey = TARGET_PATH.join(PATH_SEP);
  const targetCols = [];
  for (let c = 0; c < ncol; c++) {
    if (!isBlankHeader(header, c) && columnPath(header, c).join(PATH_SEP) === targetKey) targetCols.push(c);
  }

  console.log(`入力      : ${inputPath}`);
  console.log(`列数      : ${ncol} / データ行数: ${rows.length - dataStart}`);
  console.log(`宛先(特勤): key="${targetKey}" → 列 ${targetCols.length ? targetCols.map((c) => c).join(",") : "(見つからない)"}`);
  console.log(`孤立列    : ${orphanCols.length ? orphanCols.join(",") : "(なし)"}`);

  if (orphanCols.length === 0) {
    console.log("孤立列が無いため、修正は不要です。");
    return;
  }
  if (targetCols.length === 0) {
    console.error(`[abort] 宛先となる特勤列(${targetKey})が見つかりません。スキーマ/ヘッダーを確認してください。`);
    process.exit(1);
  }
  if (targetCols.length > 1) {
    console.error(`[abort] 特勤列が複数(${targetCols.join(",")})あります。重複列の統合は本スクリプトの対象外です。手動確認してください。`);
    process.exit(1);
  }
  const targetCol = targetCols[0];

  // 各孤立列の位置(左右の有ヘッダー隣接列)を表示して、特勤スロットであることを確認できるようにする。
  for (const oc of orphanCols) {
    const left = nearestHeadedNeighborKey(header, oc, ncol, -1);
    const right = nearestHeadedNeighborKey(header, oc, ncol, +1);
    console.log(`  孤立列 ${oc}: 左="${left}"  右="${right}"`);
  }

  // 復旧: 孤立セルの値を、宛先が空の行にだけ移す。両方非空で不一致ならコンフリクト(触らない)。
  const recovered = [];
  const conflicts = [];
  const orphanResidual = new Set(); // 削除を見送る孤立列

  for (const oc of orphanCols) {
    for (let r = dataStart; r < rows.length; r++) {
      const oVal = String(rows[r][oc] ?? "").trim();
      if (oVal === "") continue;
      const tVal = String(rows[r][targetCol] ?? "").trim();
      const id = rows[r][ID_COL];
      const no = rows[r][NO_COL];
      if (tVal === "") {
        rows[r][targetCol] = rows[r][oc];
        rows[r][oc] = "";
        recovered.push({ no, id, value: oVal });
      } else if (tVal === oVal) {
        // 既に同値。孤立側だけ消す(データ損失なし)。
        rows[r][oc] = "";
      } else {
        conflicts.push({ no, id, orphanCol: oc, orphanVal: oVal, targetVal: tVal });
        orphanResidual.add(oc); // 値が残るので列を消さない
      }
    }
  }

  // 完全に空になった孤立列を削除(高インデックスから)。コンフリクトで値が残る列は残す。
  const deletable = orphanCols.filter((c) => !orphanResidual.has(c)).sort((a, b) => b - a);
  for (const c of deletable) {
    for (const r of rows) r.splice(c, 1);
  }

  // 宛先列の最終データ件数(削除でインデックスがずれるため再計算)。
  const newNcol = rows.reduce((m, r) => Math.max(m, r.length), 0);
  let newTargetCol = -1;
  for (let c = 0; c < newNcol; c++) {
    if (!isBlankHeader(rows.slice(0, NFB_HEADER_DEPTH), c)
      && columnPath(rows.slice(0, NFB_HEADER_DEPTH), c).join(PATH_SEP) === targetKey) { newTargetCol = c; break; }
  }
  let targetCount = 0;
  if (newTargetCol >= 0) {
    for (let r = dataStart; r < rows.length; r++) {
      if (String(rows[r][newTargetCol] ?? "").trim() !== "") targetCount++;
    }
  }

  writeFileSync(outputPath, serializeCsv(rows, eol), "utf8");

  console.log("");
  console.log("=== 結果 ===");
  console.log(`復旧した特勤  : ${recovered.length} 件`);
  for (const rec of recovered) console.log(`  No.${rec.no} ${rec.id}  ← "${rec.value}"`);
  console.log(`コンフリクト  : ${conflicts.length} 件${conflicts.length ? "(上書きせず孤立列も残しました)" : ""}`);
  for (const cf of conflicts) console.log(`  No.${cf.no} ${cf.id}  孤立列${cf.orphanCol}="${cf.orphanVal}" / 宛先="${cf.targetVal}"`);
  console.log(`削除した孤立列: ${deletable.length ? deletable.slice().sort((a, b) => a - b).join(",") : "(なし)"}`);
  console.log(`特勤列の最終データ件数: ${targetCount}`);
  console.log(`出力          : ${outputPath}`);
  if (conflicts.length === 0 && deletable.length === orphanCols.length) {
    console.log("→ 孤立列はすべて統合・削除され、特勤データが正規列に集約されました。");
  }
}

main();
