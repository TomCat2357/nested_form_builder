/**
 * 式文字列中のバッククォート / 角括弧識別子（`基本情報|区`, [基本情報|区] 等）を
 * AlaSQL 安全名に変換する。
 *
 * - `` `基本情報|区` `` → `` `基本情報__区` ``
 * - `[基本情報|区]` → `[基本情報__区]`
 * - 文字列リテラル `'...'` / `"..."` 内の `|` は保護（マスク方式）
 * - 識別子は元の囲み（` または [ ]）のまま残す（AlaSQL はどちらも識別子に使える）
 *
 * 文字列リテラルのマスクは sqlLiteralMask の共通実装を利用する
 * （sqlPreprocessor / sqlMaskScanner と同じスキャナを共有）。
 */
import { headerKeyToAlaSqlKey } from "../analytics/utils/headerToAlaSqlKey.js";
import { maskWithPlaceholders } from "../analytics/utils/sqlLiteralMask.js";
import { bracketIdent } from "./sqlEmit.js";

// alasql のパーサ予約語と衝突する関数名 → 衝突しない UDF 名へのマップ。
// LEFT / RIGHT は `LEFT JOIN` 等、DEFAULT は `INSERT ... DEFAULT` 等で予約語扱いされ、
// 関数呼び出し `LEFT(...)` として書けないため、対応する UDF（registerNfbUdfs.js の
// STR_LEFT / STR_RIGHT / STR_DEFAULT）にリネームしてから alasql に渡す。
const RESERVED_FN_REWRITES = [
  [/\bLEFT\s*\(/gi, "STR_LEFT("],
  [/\bRIGHT\s*\(/gi, "STR_RIGHT("],
  [/\bDEFAULT\s*\(/gi, "STR_DEFAULT("],
];

/**
 * 式文字列を alasql 互換に整える:
 *  - バッククォート / 角括弧識別子内の `|` を `__` に置換（文字列リテラル内は保護）
 *  - alasql 予約語と衝突する関数名（LEFT/RIGHT/DEFAULT）を UDF 名にリネーム
 */
export function preprocessAlaSqlExpression(expr) {
  if (!expr || typeof expr !== "string") return expr || "";
  const { masked, unmask } = maskWithPlaceholders(expr, { includeDoubleQuote: true });
  let rewritten = masked.replace(/`([^`]+)`/g, (_m, name) => {
    return "`" + headerKeyToAlaSqlKey(name) + "`";
  });
  rewritten = rewritten.replace(/\[([^\]]+)\]/g, (_m, name) => {
    return bracketIdent(headerKeyToAlaSqlKey(name));
  });
  for (const [re, repl] of RESERVED_FN_REWRITES) {
    rewritten = rewritten.replace(re, repl);
  }
  return unmask(rewritten);
}
