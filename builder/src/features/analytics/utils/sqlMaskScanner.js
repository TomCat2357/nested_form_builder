/**
 * SQL 文字列を「マスク」してトップレベルのカンマ / 括弧 / AS を見つけやすくする
 * 低レベルスキャナ群。AlaSQL の AST が build/test 環境で利用できないため、
 * inferCompiledColumnsFromSql は文字列処理だけで SELECT 句を解析する。
 *
 * モジュール内の関数は副作用を持たず、戻り値はすべて入力文字列のオフセットや
 * スライスで表現する。実際の式パース (CAST / AGG / カラム参照) は sqlExprParse.js。
 */

import { maskWithSpaces } from "./sqlLiteralMask.js";

/**
 * 文字列リテラル ('...') / 角括弧識別子 ([...]) / バッククォート識別子 (`...`) を
 * 等長プレースホルダで覆い、トップレベルのカンマ・括弧・ AS 等を見つけやすくする。
 * `''` / `\\'` / `]]` のエスケープも処理する。
 *
 * 共通スキャナ (sqlLiteralMask.maskWithSpaces) のオプションを固定したラッパー。
 */
export function maskTokens(sql) {
  return maskWithSpaces(sql, {
    singleQuoteAllowsBackslash: true,
    includeBracket: true,
    includeBacktick: true,
  });
}

/**
 * SELECT と FROM のトップレベル位置をマスク後 SQL から探す。
 * サブクエリ (...SELECT...FROM...) は () 深度で除外。見つからなければ null。
 */
export function findSelectFromRange(maskedSql) {
  const upper = maskedSql.toUpperCase();
  const n = upper.length;
  const wordStart = (i) => i === 0 || !/[A-Z0-9_]/.test(upper.charAt(i - 1));
  const wordEnd = (i, len) => i + len >= n || !/[A-Z0-9_]/.test(upper.charAt(i + len));

  let depth = 0;
  let selectEnd = -1;
  for (let i = 0; i < n; i++) {
    const c = upper.charAt(i);
    if (c === "(") depth++;
    else if (c === ")") depth = Math.max(0, depth - 1);
    else if (depth === 0 && c === "S" && upper.startsWith("SELECT", i) && wordStart(i) && wordEnd(i, 6)) {
      selectEnd = i + 6;
      break;
    }
  }
  if (selectEnd < 0) return null;

  depth = 0;
  for (let i = selectEnd; i < n; i++) {
    const c = upper.charAt(i);
    if (c === "(") depth++;
    else if (c === ")") depth = Math.max(0, depth - 1);
    else if (depth === 0 && c === "F" && upper.startsWith("FROM", i) && wordStart(i) && wordEnd(i, 4)) {
      return { start: selectEnd, end: i };
    }
  }
  return { start: selectEnd, end: n };
}

/**
 * SELECT と FROM の間のカンマ列を分割する（マスク済み文字列を使用）。
 * オリジナル SQL の対応スライスを返す。
 */
export function splitSelectColumns(sql, maskedSql, range) {
  const parts = [];
  let depth = 0;
  let startOrig = range.start;
  for (let i = range.start; i < range.end; i++) {
    const mc = maskedSql.charAt(i);
    if (mc === "(") depth++;
    else if (mc === ")") depth = Math.max(0, depth - 1);
    if (mc === "," && depth === 0) {
      parts.push(sql.slice(startOrig, i));
      startOrig = i + 1;
    }
  }
  parts.push(sql.slice(startOrig, range.end));
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

/**
 * カラム式の末尾 AS 句を見つけ、{ exprPart, aliasPart } に分割する。
 * AS が無いケースでは aliasPart = null。
 * 大文字小文字非依存。マスク済み文字列で探索することで、文字列・括弧内の AS を誤マッチしない。
 *
 * トップレベル（括弧深度 0）で出現する最後の ` AS ` を切り出す。
 * `CAST(x AS NUMBER) AS [y]` のように式内部に AS を含む場合でも、外側の `AS [y]` を
 * 正しく拾うために単純な regex ではなく深度カウントの線形スキャンで実装する。
 */
export function splitExprAndAlias(part) {
  const masked = maskTokens(part);
  const upper = masked.toUpperCase();
  const n = upper.length;
  const isWs = (c) => c === " " || c === "\t" || c === "\n" || c === "\r";
  let depth = 0;
  let lastAsAt = -1;
  for (let i = 0; i < n - 3; i++) {
    const c = upper.charAt(i);
    if (c === "(") { depth++; continue; }
    if (c === ")") { depth = Math.max(0, depth - 1); continue; }
    if (depth !== 0) continue;
    if (isWs(c) && upper.charAt(i + 1) === "A" && upper.charAt(i + 2) === "S" && isWs(upper.charAt(i + 3))) {
      lastAsAt = i;
    }
  }
  if (lastAsAt < 0) {
    // AS が無い場合、末尾が単独識別子なら暗黙のエイリアス扱いはしない（AlaSQL の出力名と一致するため）。
    return { exprPart: part.trim(), aliasPart: null };
  }
  const aliasPart = part.slice(lastAsAt + 3).trim();
  if (!aliasPart) return { exprPart: part.trim(), aliasPart: null };
  return { exprPart: part.slice(0, lastAsAt).trim(), aliasPart };
}

/**
 * マスク済みトークン列で「最初の `(` から対応する `)` までで文字列全体を消費する」
 * （= `FN(...)` 形式で末尾までが 1 つの関数呼び出し）かを判定するヘルパー。
 * tryAsAggregate / tryAsCast から共有される。
 */
export function isWhollyWrappedByParens(masked) {
  if (!masked || masked.charAt(masked.length - 1) !== ")") return false;
  const openIdx = masked.indexOf("(");
  if (openIdx < 0) return false;
  let depth = 0;
  for (let i = openIdx; i < masked.length; i++) {
    if (masked.charAt(i) === "(") depth++;
    else if (masked.charAt(i) === ")") {
      depth--;
      if (depth === 0) {
        return i === masked.length - 1;
      }
    }
  }
  return false;
}
