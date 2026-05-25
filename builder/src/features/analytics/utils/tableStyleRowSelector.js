/**
 * 罫線オーバーライドの「行 / 列セレクタ」。
 *
 * 行セレクタ:
 *   - AlaSQL の WHERE 節相当の式文字列。true で適用、false / null / 未定義で非適用。
 *   - 例: `` `月` > 4 AND `日` = 30 ``、`_dispRow = 1`、`_row IN (1, 3, 5)`、`` `項目` = '対応件数' ``
 *   - 行データに加え `_row`（ソート前 1-based）と `_dispRow`（ソート後 1-based）を参照可能。
 *   - 評価は alasqlExpressionEvaluator の同期版を使用。precompile されていない式は false 扱い。
 *
 * 列セレクタ（無変更）:
 *   - カンマ区切りの列名 (OR)。`...` でクォートしても良いし、生の名前でも良い。
 *
 * 設計方針:
 *   - 構文検証は AlaSQL のコンパイル時にしか正確に検出できないため、ここでは長さ上限など
 *     軽い検証のみを errors に積む。コンパイル失敗は precompileExpressions の console.warn に流れ、
 *     evalExpressionSync は fallback false で返るため、結果として「罫線無し」になる。
 */

import { evalExpressionSync } from "../../expression/alasqlExpressionEvaluator.js";

const MAX_EXPR_LEN = 500;

export function parseRowSelector(input) {
  const expr = String(input || "").trim();
  const errors = [];
  if (expr.length > MAX_EXPR_LEN) {
    errors.push(`式が長すぎます（${MAX_EXPR_LEN} 文字以内）`);
  }
  return { expr, isEmpty: expr.length === 0, errors };
}

export function compileRowPredicate(parsed) {
  if (!parsed || parsed.isEmpty) return () => false;
  const expr = parsed.expr;
  return (rowData, displayIndex) => {
    const row = { ...(rowData || {}), _dispRow: displayIndex };
    const v = evalExpressionSync(expr, row, { fallback: false });
    return !!v;
  };
}

export function parseColumnSelector(input) {
  const src = String(input || "");
  const result = [];
  let i = 0;
  while (i < src.length) {
    while (i < src.length && (src[i] === " " || src[i] === "\t" || src[i] === ",")) i += 1;
    if (i >= src.length) break;
    if (src[i] === "`") {
      i += 1;
      let name = "";
      while (i < src.length && src[i] !== "`") { name += src[i]; i += 1; }
      if (src[i] === "`") i += 1;
      result.push(name.trim());
    } else {
      let name = "";
      while (i < src.length && src[i] !== ",") { name += src[i]; i += 1; }
      result.push(name.trim());
    }
  }
  return result.filter(Boolean);
}

export function compileColumnPredicate(columnNames) {
  if (!columnNames || columnNames.length === 0) return () => false;
  const set = new Set(columnNames);
  return (colName) => set.has(colName);
}
