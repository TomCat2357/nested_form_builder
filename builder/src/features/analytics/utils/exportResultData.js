/**
 * ダッシュボードカードの結果行を CSV / 画像でダウンロードさせるユーティリティ。
 * 元の Question / Dashboard には影響しない、閲覧者向けの書き出し専用。
 */

import { ensureArray } from "../../../utils/arrays.js";
import { filterDisplayColumns, getColumnDisplayLabel, shouldKeepRowFromSql } from "./metaColumnDisplay.js";
import { triggerBlobDownload, triggerDataUrlDownload, sanitizeFileBaseName } from "../../../utils/fileDownload.js";

export { sanitizeFileBaseName, triggerDataUrlDownload };

// Excel が UTF-8 CSV を正しく開けるよう先頭に付ける BOM。
const UTF8_BOM = "﻿";

function csvCell(value) {
  if (value === null || value === undefined) return "";
  const s = typeof value === "string" ? value : String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * rows を CSV 文字列に変換する。隠しメタ列は除外し、ヘッダは表示ラベルを使う。
 * Excel での文字化け回避に先頭へ BOM を付ける。改行は CRLF（RFC 4180）。
 *
 * opts.sql に元の SQL を渡すと、`\b_row\b` を含むときだけ `_row` 列を CSV に残す
 * （ResultTable の opt-in と同ポリシー）。デフォルトは隠す。
 */
export function rowsToCsv(rows, columns, compiledColumns, { sql } = {}) {
  const cols = filterDisplayColumns(columns, { keepRow: shouldKeepRowFromSql(sql) });
  const header = cols.map((c) => csvCell(getColumnDisplayLabel(c, compiledColumns)));
  const lines = [header.join(",")];
  for (const row of ensureArray(rows)) {
    lines.push(cols.map((c) => csvCell(row ? row[c] : "")).join(","));
  }
  return UTF8_BOM + lines.join("\r\n");
}

/** rows を CSV ファイルとしてダウンロードさせる。 opts は rowsToCsv に素通し。 */
export function triggerCsvDownload(rows, columns, compiledColumns, filename, opts) {
  const csv = rowsToCsv(rows, columns, compiledColumns, opts);
  triggerBlobDownload(new Blob([csv], { type: "text/csv;charset=utf-8" }), filename);
}
