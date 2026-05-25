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

/**
 * 列名配列から「Y 軸候補となる列（数値・日付）」のみを抽出する。
 * HIDDEN_META_COLUMNS (createdBy 等) は常に除外。型推測は detectColumnType に委譲。
 */
export function getValueColumnsFromColumns(columns, compiledColumns, fallbackTypeMap) {
  if (!Array.isArray(columns)) return [];
  return columns.filter((name) => {
    if (HIDDEN_META_COLUMNS.has(name)) return false;
    const t = detectColumnType(compiledColumns, name, fallbackTypeMap);
    return t === "number" || t === "date";
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
