/**
 * 列の主要型 (compiledColumns.type / fallbackTypeMap の値) を扱う共通ユーティリティ。
 *
 * Question (analytics) の型推定は次の 3 経路を統合する:
 *   - detectColumnType (columnValueInference.js): compiledColumns + fallback + FIXED_DATE_KEYS
 *   - inferCompiledColumnsFromSql (sqlColumnInference.js): SELECT 句解析時に fallback を引く
 *   - 各 viz / コンポーネント側の degrade 判定
 *
 * いずれも「未知/異常値は null に潰す」「Map と plain object の両方に対応する」という
 * 同じ前処理を必要としていたため、その 2 点をここに集約する。
 *
 * 既知の列型: "number" | "date" | "string" | "boolean"
 *   ※ "unknown" や undefined 等はすべて null に正規化する。
 */

const KNOWN_COLUMN_TYPES = new Set(["number", "date", "string", "boolean"]);

/**
 * 文字列を既知の列型に絞り込む。未知値・非文字列は null。
 * @param {unknown} raw
 * @returns {"number"|"date"|"string"|"boolean"|null}
 */
export function normalizeColumnType(raw) {
  return typeof raw === "string" && KNOWN_COLUMN_TYPES.has(raw) ? raw : null;
}

/**
 * Map か plain object のいずれであっても同じインタフェースで型を引く。
 * 未知キー / 未知型値 / map が falsy のいずれも null。
 * @param {Map<string,string>|Record<string,string>|null|undefined} map
 * @param {string} key
 * @returns {"number"|"date"|"string"|"boolean"|null}
 */
export function lookupTypeFromMap(map, key) {
  if (!map || !key) return null;
  let raw;
  if (typeof map.get === "function") raw = map.get(key);
  else if (typeof map === "object") raw = map[key];
  return normalizeColumnType(raw);
}
