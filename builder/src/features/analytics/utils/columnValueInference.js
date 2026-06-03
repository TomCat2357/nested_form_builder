import { HIDDEN_META_COLUMNS } from "./metaColumnDisplay.js";
import { FIXED_DATE_KEYS, AGG_TYPE_MATRIX } from "./aggregationCompatibility.js";
import { normalizeColumnType, lookupTypeFromMap } from "./columnTypeLookup.js";

/**
 * 列の主要型をスキーマ情報のみから決定する。
 *
 * 優先順位:
 *   1. compiledColumns に登録があれば、その type / role を採用
 *      （compileStages が schema と集計関数 (count/sum/avg → number, min/max → 元列継承) から構築する）
 *   2. fallbackTypeMap (Map<columnName, columnType>) があれば、そこから引く
 *   3. FIXED_DATE_KEYS (createdAt / modifiedAt / deletedAt) は schema に無くても "date"
 *   4. 上記いずれにも当たらなければ null（型不明 → UI 側で degrade）
 *
 * 旧実装にあった rows の値スキャン（isNumericByValues / isDateByValues）は廃止した。
 * 列に値が無い／旧データ混入で誤判定するなど不安定だったため、フォーム schema を
 * 単一情報源とするポリシーに切り替えた。schema にマッピングできない自由形式 SQL の
 * 結果列（例: SELECT [a]+[b] AS total）は null となり、UI ではテキスト入力に degrade。
 *
 * 戻り値: "date" | "number" | "string" | "boolean" | null
 */
export function detectColumnType(compiledColumns, name, fallbackTypeMap) {
  if (!name) return null;
  if (Array.isArray(compiledColumns)) {
    const c = compiledColumns.find((x) => x && x.name === name);
    if (c) {
      const normalized = normalizeColumnType(c.type);
      if (normalized) return normalized;
      // role=metric は集計関数の出力なので type 未指定でも数値とみなす。
      if (c.role === "metric") return "number";
    }
  }
  const fromFallback = lookupTypeFromMap(fallbackTypeMap, name);
  if (fromFallback) return fromFallback;
  if (FIXED_DATE_KEYS.has(name)) return "date";
  return null;
}

// 値を数値とみなせるか。number は有限値のみ。文字列は空でなく Number() が有限のもの。
function isNumberValue(v) {
  if (typeof v === "number") return Number.isFinite(v);
  if (typeof v === "string") {
    const s = v.trim();
    if (s === "") return false;
    return Number.isFinite(Number(s));
  }
  return false;
}

// 日付らしい文字列か。純粋な数値（"2020" 等）を日付と誤判定しないよう、日付区切りを含む
// 形（YYYY-MM-DD / YYYY/MM/DD / ISO / MM-DD-YYYY 等）に限って Date.parse を信用する。
const DATE_LIKE_RE = /^\d{4}[-/]\d{1,2}([-/]\d{1,2})?([ T].*)?$|^\d{1,2}[-/]\d{1,2}[-/]\d{4}/;
function isDateValue(v) {
  if (v instanceof Date) return !Number.isNaN(v.getTime());
  if (typeof v === "string") {
    const s = v.trim();
    return DATE_LIKE_RE.test(s) && !Number.isNaN(Date.parse(s));
  }
  return false;
}

/**
 * 行データの値から列の主要型を推定する（スキーマで型不明だった列の最終フォールバック専用）。
 *
 * 非 null（および非空文字列）の値を最大 sample 件サンプリングし、全件が数値なら "number"、
 * 全件が日付なら "date"、混在・判定不能・非 null が 0 件なら null を返す。
 * 数値文字列を日付と誤判定しないよう number を優先する（DATE_LIKE_RE 参照）。
 *
 * 過去に削除された rows 全走査の不安定さを避けるため、サンプル件数を絞った保守的な実装とし、
 * detectColumnType（schema 単一情報源）では解決できなかった列の UI 候補補完にのみ用いる。
 *
 * @returns {"number"|"date"|null}
 */
export function inferTypeFromValues(rows, name, { sample = 50 } = {}) {
  if (!Array.isArray(rows) || !name) return null;
  let seen = 0;
  let allNumber = true;
  let allDate = true;
  for (const r of rows) {
    if (seen >= sample) break;
    const v = r ? r[name] : undefined;
    if (v === null || v === undefined || v === "") continue;
    seen++;
    if (allNumber && !isNumberValue(v)) allNumber = false;
    if (allDate && !isDateValue(v)) allDate = false;
    if (!allNumber && !allDate) return null;
  }
  if (seen === 0) return null;
  if (allNumber) return "number";
  if (allDate) return "date";
  return null;
}

/**
 * 列名配列から「Y 軸候補となる列（数値・日付）」のみを抽出する。
 * HIDDEN_META_COLUMNS (createdBy 等) は常に除外。型推測は detectColumnType に委譲。
 *
 * rows を渡すと、detectColumnType（schema）で型不明だった列に限り inferTypeFromValues で
 * 値ベースに補完する。schema で型が解決できた列は常に schema を優先する（値スキャンは
 * 最後の手段）。rows を省略した場合は従来どおり schema のみで判定する。
 */
export function getValueColumnsFromColumns(columns, compiledColumns, fallbackTypeMap, rows) {
  if (!Array.isArray(columns)) return [];
  return columns.filter((name) => {
    if (HIDDEN_META_COLUMNS.has(name)) return false;
    const t = detectColumnType(compiledColumns, name, fallbackTypeMap);
    if (t === "number" || t === "date") return true;
    if (t) return false; // schema で string/boolean 等と判明 → 値で昇格させない
    if (!rows) return false;
    const inferred = inferTypeFromValues(rows, name);
    return inferred === "number" || inferred === "date";
  });
}

/**
 * 集計種別 (agg) に互換性のある列のみを抽出する。
 *   - sum / avg → number / date
 *   - count → 全列 (列任意)
 *   - min / max → number / date / string
 * AGG_TYPE_MATRIX が単一情報源。agg 未指定または未知の場合は全列許可。
 * 型不明列 (compiledColumns / fallback いずれにも無い) は UI 側で degrade させるため通す。
 */
export function getValueColumnsForAgg(columns, compiledColumns, fallbackTypeMap, agg) {
  if (!Array.isArray(columns)) return [];
  const spec = agg ? AGG_TYPE_MATRIX[agg] : null;
  const allowed = spec ? spec.allowedTypes : null;
  return columns.filter((name) => {
    if (HIDDEN_META_COLUMNS.has(name)) return false;
    if (!allowed) return true;
    const t = detectColumnType(compiledColumns, name, fallbackTypeMap);
    if (!t) return true; // 型不明は通す (自由形式 SQL の出力列等)
    return allowed.includes(t);
  });
}
