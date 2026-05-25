/**
 * ヒートマップ機能の小ユーティリティ群。
 *
 * - parseExcludeList: 列除外（excludeColumns）用。カンマ区切り文字列を Set<string> へ。
 * - compileRowExcludePredicate: 行除外（excludeRows）用。AlaSQL の WHERE 節相当の式を
 *   precompile 前提の同期 predicate に変換する。true で除外（否定形）。
 * - extractRowExcludeExpr: precompileExpressions に渡す式文字列の抽出。
 *
 * 行データに加え `_row`（ソート前 1-based）と `_dispRow`（ソート後 1-based）を式で参照可能。
 * precompile されていない式は false 扱い（＝除外しない）。
 */

import { evalExpressionSync } from "../../expression/alasqlExpressionEvaluator.js";

/**
 * カンマ区切り文字列を Set<string> に分解する（excludeColumns 用）。
 * 各要素は trim され、空文字は捨てる。null / undefined / 非文字列は空 Set。
 * 重複入力は Set として自然に de-dup される。
 */
export function parseExcludeList(str) {
  if (!str || typeof str !== "string") return new Set();
  const out = new Set();
  for (const part of str.split(",")) {
    const token = part.trim();
    if (token) out.add(token);
  }
  return out;
}

/**
 * 行除外式から (rowData, displayIndex) => boolean な predicate を作る。
 * 空文字は () => false（除外なし）。precompile されていない式も false 扱い。
 * 渡される rowData には _dispRow（1-based）をミックスインして式から参照可能にする。
 */
export function compileRowExcludePredicate(exprStr) {
  const expr = String(exprStr || "").trim();
  if (!expr) {
    return { expr: "", predicate: () => false };
  }
  const predicate = (rowData, displayIndex) => {
    const row = { ...(rowData || {}), _dispRow: displayIndex };
    const v = evalExpressionSync(expr, row, { fallback: false });
    return !!v;
  };
  return { expr, predicate };
}

/**
 * heatmap 設定から、precompile 対象の行除外式文字列を抽出する。
 * 無効/空なら null を返す。
 */
export function extractRowExcludeExpr(heatmap) {
  if (!heatmap || !heatmap.enabled) return null;
  const raw = typeof heatmap.excludeRows === "string" ? heatmap.excludeRows.trim() : "";
  return raw || null;
}
