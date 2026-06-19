/**
 * 簡易検索（プレフィックスなし）→ alasql WHERE 式文字列への変換器。
 *
 * 設計方針:
 * - トークナイザ/パーサは searchQueryEngine.js のものを再利用する（tokenizeSearchQuery /
 *   parseTokens）。これにより簡易検索の構文解釈が、フィルタ評価（このファイル → alasql）と
 *   ヒット抜粋ハイライト（searchQueryEngine.js）で完全に一致する。
 * - 生成した WHERE 式は filterRowsByExpr（SELECT * FROM ? WHERE <expr>）で評価する。
 *   評価対象の行は view 形式（entriesToViewTableRows）。複数値セルは "," 連結で統一されている。
 * - カスタム JS 評価器（searchQueryEngine.evaluateLeafOnRow）の意味論を alasql 式として再現する:
 *   - 自由文（裸単語 / 列:値）= 大小無視の正規表現 → REGEXP_LIKE(col, pat, 'i')
 *   - 列無し述語 = 全検索対象列への OR 展開
 *   - 列:true/false = TO_BOOL(col) = TRUE/FALSE
 *   - 列="" / 列<>"" = 空欄 / 非空（IS NULL OR = '' / IS NOT NULL AND <> ''）
 *   - 列 in (...) / not in = MV_IN / NOT MV_IN（複数値セルを集合分解）
 *   - 列=値 / 列<>値 = 複数値・テキスト列は MV_EQ / NOT MV_EQ（集合分解）、数値列は TO_NUMBER 比較
 *   - 列 > >= < <= 値 = 非日付列は TO_NUMBER(col) op N（数値のみ。非数値は不成立）、日付列は生文字列比較
 *
 * 列名の解決は searchQueryEngine と同じ matchColumnName（key/path/aliases/segments）で行う。
 */
import { ensureArray } from "../../utils/arrays.js";
import { headerKeyToAlaSqlKey } from "../analytics/utils/headerToAlaSqlKey.js";
import { quoteString } from "../expression/sqlEmit.js";
import {
  isDateLikeColumn,
  isNumericColumn,
} from "./searchTableValues.js";
import { tokenizeSearchQuery, parseTokens } from "./searchQueryEngine.js";
import {
  canonicalSearchOperator,
  toSafeRegexSource,
  findColumnByName,
  expandColumnlessOr,
} from "./searchQueryShared.js";
import { NON_SEARCHABLE_META_KEYS } from "../../core/constants.js";

// 検索対象外の固定メタ列。キー一覧は core/constants.js に一元化（NON_SEARCHABLE_META_KEYS）。
const EXCLUDED_META_COLUMN_KEYS = new Set(NON_SEARCHABLE_META_KEYS);

const isSearchableColumn = (col) =>
  !!col && col.searchable !== false && !EXCLUDED_META_COLUMN_KEYS.has(col.key);

// 列名（表示は path 優先、メタ列は key）。
const resolveSearchableName = (col) => (col ? col.path || col.key || "" : "");

// 列 → alasql 行のキー（safeKey）。view/data 行ビルダの命名規則に合わせる。
// "No." 列のみ行ビルダが "No_" でキーするため特別扱い（entriesToViewRows / analyticsAlaSql 参照）。
const columnToSafeKey = (col) => {
  if (col && col.key === "No.") return "No_";
  return headerKeyToAlaSqlKey(resolveSearchableName(col));
};

const isNumericLiteral = (value) => /^-?\d+(?:\.\d+)?$/.test(String(value).trim());

// 列値を文字列化してから大小無視の正規表現判定を行う。
// 数値列（年齢 / No_ 等）や null を REGEXP_LIKE に直接渡すと
// 「.search is not a function」で落ちるため `|| ''` で文字列強制する
// （number → "25" / null → ""）。旧エンジンが display 文字列に対して
// regex.test していた挙動と整合する。
const regexLike = (safeKey, pattern) =>
  "REGEXP_LIKE(`" + safeKey + "` || '', " + quoteString(pattern) + ", 'i')";

function buildContext(columns) {
  const cols = Array.isArray(columns) ? columns.filter(isSearchableColumn) : [];
  const safeKeys = cols.map(columnToSafeKey).filter(Boolean);
  return { cols, safeKeys };
}

// 列名 → { safeKey, col }。見つからなければ col=null・safeKey は入力名から導出（行に無い列は
// NULL 扱いになる）。列解決は findColumnByName（key/path/aliases/segments を OR 一致）に委譲。
function resolveColumn(ctx, name) {
  const col = findColumnByName(ctx.cols, name);
  if (col) return { safeKey: columnToSafeKey(col), col };
  return { safeKey: headerKeyToAlaSqlKey(String(name || "")), col: null };
}

// 列無し述語: 全検索対象列への OR 展開。safeKeys が空なら FALSE。
function columnlessOr(ctx, buildPredicate) {
  return expandColumnlessOr(ctx.safeKeys, buildPredicate);
}

function emitCompare(token, ctx) {
  const value = token.value;
  if (value === "") return "FALSE";
  const op = canonicalSearchOperator(token.operator);
  const { safeKey, col } = resolveColumn(ctx, token.column);
  const colExpr = "`" + safeKey + "`";
  const isEquality = op === "=" || op === "<>";

  // 日付/時刻列: 列は丸めず生文字列比較（リテラルもそのまま）。canonical 文字列同士の比較。
  if (col && isDateLikeColumn(col)) {
    return colExpr + " " + op + " " + quoteString(value);
  }

  if (isEquality) {
    // 数値列の等価は数値比較（リテラルが数値のとき）。それ以外は集合分解（MV_EQ）。
    if (col && isNumericColumn(col) && isNumericLiteral(value)) {
      return "TO_NUMBER(" + colExpr + ") " + op + " " + String(Number(value));
    }
    const mvEq = "MV_EQ(" + colExpr + ", " + quoteString(value) + ")";
    return op === "=" ? mvEq : "NOT " + mvEq;
  }

  // 順序比較（> >= < <=）: 数値のみ意味を持つ。非数値リテラルは不成立。
  if (!isNumericLiteral(value)) return "FALSE";
  return "TO_NUMBER(" + colExpr + ") " + op + " " + String(Number(value));
}

function emitLeaf(token, ctx) {
  switch (token.type) {
    case "PARTIAL": {
      if (!token.keyword) return "TRUE";
      const pattern = toSafeRegexSource(token.keyword);
      return columnlessOr(ctx, (k) => regexLike(k, pattern));
    }
    case "COLUMN_PARTIAL": {
      if (!token.keyword) return "FALSE";
      const pattern = toSafeRegexSource(token.keyword);
      const { safeKey } = resolveColumn(ctx, token.column);
      return regexLike(safeKey, pattern);
    }
    case "COLUMN_BOOL": {
      const { safeKey } = resolveColumn(ctx, token.column);
      return "TO_BOOL(`" + safeKey + "`) = " + (token.value ? "TRUE" : "FALSE");
    }
    case "COLUMN_EMPTY": {
      const { safeKey } = resolveColumn(ctx, token.column);
      const colExpr = "`" + safeKey + "`";
      return "(" + colExpr + " IS NULL OR " + colExpr + " = '')";
    }
    case "COLUMN_NOT_EMPTY": {
      const { safeKey } = resolveColumn(ctx, token.column);
      const colExpr = "`" + safeKey + "`";
      return "(" + colExpr + " IS NOT NULL AND " + colExpr + " <> '')";
    }
    case "COLUMN_IN": {
      const targets = ensureArray(token.values);
      const negate = !!token.negate;
      if (targets.length === 0) return negate ? "TRUE" : "FALSE";
      const { safeKey } = resolveColumn(ctx, token.column);
      const args = targets.map((v) => quoteString(v)).join(", ");
      const mvIn = "MV_IN(`" + safeKey + "`, " + args + ")";
      return negate ? "NOT " + mvIn : mvIn;
    }
    case "COMPARE":
      return emitCompare(token, ctx);
    case "ALWAYS_FALSE":
      return "FALSE";
    case "EMPTY":
      return "TRUE";
    default:
      return "TRUE";
  }
}

function emit(node, ctx) {
  if (!node || node.type === "EMPTY") return "TRUE";
  switch (node.type) {
    case "OR":
      return "(" + emit(node.left, ctx) + ") OR (" + emit(node.right, ctx) + ")";
    case "AND":
      return "(" + emit(node.left, ctx) + ") AND (" + emit(node.right, ctx) + ")";
    case "NOT":
      return "NOT (" + emit(node.value, ctx) + ")";
    default:
      return emitLeaf(node, ctx);
  }
}

/**
 * 簡易検索クエリ文字列 → { expr, errors }。
 * 空クエリは expr=null（呼び出し側は全件表示）。
 *
 * @param {string} query
 * @param {Array<object>} columns searchColumns（key/path/sourceType/type/searchable/segments）
 * @returns {{ expr: string|null, errors: string[] }}
 */
export function buildSimpleSearchExpression(query, columns) {
  if (!query || typeof query !== "string" || !query.trim()) {
    return { expr: null, errors: [] };
  }
  const ctx = buildContext(columns);
  const tokens = tokenizeSearchQuery(query);
  const ast = parseTokens(tokens);
  if (!ast || ast.type === "EMPTY") return { expr: null, errors: [] };
  return { expr: emit(ast, ctx), errors: [] };
}
