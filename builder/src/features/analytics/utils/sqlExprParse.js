/**
 * SELECT 句の単一カラム式を「カラム参照 / 集計関数 / CAST」のいずれかとして
 * 解析する小さなパーサ群。マスキング等の低レベル処理は sqlMaskScanner.js。
 *
 * すべての関数は判定に失敗したら null を返す。呼び出し側 (inferCompiledColumnsFromSql)
 * は CAST → AGG → カラム参照 → 複合式 の順で試す。
 */

import { maskTokens, isWhollyWrappedByParens } from "./sqlMaskScanner.js";

/**
 * CAST(... AS <type>) の AlaSQL 型名 → compiledColumns 互換の内部型。
 * AlaSQL のネイティブ CAST は実行値を変換するが、SELECT パーサ側でも明示型を拾わないと
 * 棒グラフ Y 軸候補（getValueColumnsFromColumns）や heatmap の非数値除外に反映されない。
 */
const CAST_TYPE_MAP = {
  NUMBER: "number", INT: "number", INTEGER: "number", BIGINT: "number",
  FLOAT: "number", DOUBLE: "number", DECIMAL: "number", NUMERIC: "number", REAL: "number",
  STRING: "string", TEXT: "string", VARCHAR: "string", NVARCHAR: "string", CHAR: "string", NCHAR: "string",
  DATE: "date", DATETIME: "date", TIMESTAMP: "date",
  BOOLEAN: "boolean", BOOL: "boolean",
};

export function stripIdentifierWrap(s) {
  if (!s) return s;
  const t = s.trim();
  if (t.length >= 2 && t.charAt(0) === "[" && t.charAt(t.length - 1) === "]") return t.slice(1, -1);
  if (t.length >= 2 && t.charAt(0) === "`" && t.charAt(t.length - 1) === "`") return t.slice(1, -1);
  return t;
}

function isBareIdentifier(s) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(s);
}

/**
 * 式が単独のカラム参照かを判定し、参照名を返す。違えば null。
 * 受理: `[name]` / `\`name\`` / `name` / `alias.[name]` / `alias.name`
 */
export function tryAsColumnRef(expr) {
  const t = expr.trim();
  // 修飾あり (alias.[col] or alias.col)
  const qm = t.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*\.\s*(\[[^\]]+\]|`[^`]+`|[A-Za-z_][A-Za-z0-9_]*)$/);
  if (qm) return stripIdentifierWrap(qm[2]);
  if (t.startsWith("[") && t.endsWith("]") && t.indexOf("]") === t.length - 1) return t.slice(1, -1);
  if (t.startsWith("`") && t.endsWith("`")) return t.slice(1, -1);
  if (isBareIdentifier(t)) return t;
  return null;
}

/**
 * `AGG( inner )` の構造を切り出す。違えば null。
 * AGG は名前のみ ([A-Za-z_]+)、inner は閉じ括弧までの中身（文字列を保持）。
 * `DISTINCT inner` には対応する。
 */
export function tryAsAggregate(expr) {
  const t = expr.trim();
  const m = t.match(/^([A-Za-z_]+)\s*\(([\s\S]*)\)\s*$/);
  if (!m) return null;
  // 末尾 ) が関数全体の閉じであり、かつ全文がその関数呼び出しで消費されているか
  if (!isWhollyWrappedByParens(maskTokens(t))) return null;
  const fnName = m[1];
  let inner = m[2].trim();
  let distinct = false;
  if (/^DISTINCT\b/i.test(inner)) {
    distinct = true;
    inner = inner.replace(/^DISTINCT\b\s*/i, "").trim();
  }
  return { fn: fnName.toUpperCase(), inner, distinct };
}

/**
 * `CAST(<inner> AS <typeName>)` を検出して、AlaSQL の型名を compiledColumns 互換型に変換する。
 * 末尾 `)` が CAST 全体の閉じであることをマスク済みトークン上で深度カウントして検証する
 * （`CAST(x AS STRING) + 1` のような複合式に取り違えないため）。
 * 型名は case-insensitive。CAST_TYPE_MAP に無い型名 (例: WIDGET) は認識せず null を返し、
 * 呼び出し側で「複合式」分岐に落とす。
 *
 * 戻り値: { type: "number"|"string"|"date"|"boolean" } もしくは null。
 */
export function tryAsCast(expr) {
  const t = expr.trim();
  if (!/^CAST\s*\(/i.test(t)) return null;
  const masked = maskTokens(t);
  if (!isWhollyWrappedByParens(masked)) return null;
  const openIdx = masked.indexOf("(");
  // 中身を取り出して末尾の `AS <typeName>` を切る
  const inner = t.slice(openIdx + 1, masked.length - 1);
  const innerMasked = masked.slice(openIdx + 1, masked.length - 1);
  // トップレベル ( depth 0 ) 上で末尾の AS を探す
  const upperInnerMasked = innerMasked.toUpperCase();
  let asAt = -1;
  let d = 0;
  for (let i = 0; i < upperInnerMasked.length - 2; i++) {
    const ch = upperInnerMasked.charAt(i);
    if (ch === "(") d++;
    else if (ch === ")") d = Math.max(0, d - 1);
    if (d !== 0) continue;
    if (upperInnerMasked.startsWith(" AS ", i) || upperInnerMasked.startsWith("\tAS ", i) || upperInnerMasked.startsWith("\nAS ", i)) {
      asAt = i + 1; // 'A' の位置
    }
  }
  if (asAt < 0) return null;
  const typeRaw = inner.slice(asAt + 2).trim();
  // 型名の末尾に括弧パラメータ（VARCHAR(255) など）が付くケースに対応
  const typeName = typeRaw.replace(/\s*\(.*\)\s*$/, "").trim().toUpperCase();
  if (!typeName) return null;
  const mapped = CAST_TYPE_MAP[typeName];
  if (!mapped) return null;
  return { type: mapped };
}
