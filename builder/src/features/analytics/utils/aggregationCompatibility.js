/**
 * 集計関数 × 列型の対応マトリクス。
 * UI（候補絞り込み）とコンパイラ（バリデーション）の両方が参照する単一情報源。
 *
 * 列型: "number" | "date" | "string" | "boolean" | "unknown"
 * 集計種別: "count" | "countNotNull" | "sum" | "avg" | "min" | "max"
 */

export const COLUMN_TYPES = ["number", "date", "string", "boolean", "unknown"];

/**
 * メタデータが必ず日付として扱われる固定列キー。
 * id 等は型を問わない（unknown 扱い）。
 */
export const FIXED_DATE_KEYS = new Set(["createdAt", "modifiedAt", "deletedAt"]);

/**
 * フォームスキーマの field.type を analytics 列型に正規化する。
 * フォームビルダーで扱われる主要型のみマップし、それ以外は "unknown"。
 */
const FIELD_TYPE_TO_COLUMN_TYPE = {
  number: "number",
  date: "date",
  datetime: "date",
  time: "date",
  checkboxes: "boolean",
  text: "string",
  textarea: "string",
  email: "string",
  tel: "string",
  url: "string",
  select: "string",
  radio: "string",
};

export function normalizeFieldType(fieldType) {
  if (!fieldType) return "unknown";
  return FIELD_TYPE_TO_COLUMN_TYPE[fieldType] || "unknown";
}

/**
 * 列キー（パイプ区切り）と field.type マップから、その列の analytics 型を解決する。
 * 固定日付キー（createdAt 等）は schema に無くても "date" を返す。
 */
export function resolveColumnType(typeMapOrFn, key) {
  if (key && FIXED_DATE_KEYS.has(key)) return "date";
  let raw;
  if (typeof typeMapOrFn === "function") raw = typeMapOrFn(key);
  else if (typeMapOrFn && typeof typeMapOrFn.get === "function") raw = typeMapOrFn.get(key);
  else if (typeMapOrFn && typeof typeMapOrFn === "object") raw = typeMapOrFn[key];
  return normalizeFieldType(raw);
}

export const AGG_TYPE_MATRIX = {
  // count(*): 列指定不要。どの列でも実行可（列を指定したら COUNT([col]) 相当でも可）。
  count: { columnRequired: false, allowedTypes: ["number", "date", "string", "boolean", "unknown"] },
  // countNotNull: 列必須。型は問わない。
  countNotNull: { columnRequired: true, allowedTypes: ["number", "date", "string", "boolean", "unknown"] },
  sum: { columnRequired: true, allowedTypes: ["number", "unknown"] },
  avg: { columnRequired: true, allowedTypes: ["number", "unknown"] },
  // min/max: 数値・日付・文字列いずれもサポート。boolean は意味が薄いので除外。
  min: { columnRequired: true, allowedTypes: ["number", "date", "string", "unknown"] },
  max: { columnRequired: true, allowedTypes: ["number", "date", "string", "unknown"] },
};

export const AGG_TYPES = Object.keys(AGG_TYPE_MATRIX);

/**
 * 集計種別と列型の組み合わせが許容されるか。
 * 列型が "unknown" のときは判別不能として常に true。
 */
export function isAggCompatible(aggType, columnType) {
  const spec = AGG_TYPE_MATRIX[aggType];
  if (!spec) return false;
  if (!columnType) return true;
  return spec.allowedTypes.includes(columnType);
}

/**
 * 集計設定 (`{ type, column }`) を列メタの集合 ColumnMeta[] に対して検証する。
 * 列が見つからない場合や列必須なのに未指定の場合もエラー。
 * @returns {string|null} エラーメッセージ。問題なければ null。
 */
export function assertAggColumnType(agg, columns) {
  const spec = AGG_TYPE_MATRIX[agg && agg.type];
  if (!spec) return "未対応の集計種別: " + (agg && agg.type);
  if (spec.columnRequired && !agg.column) {
    return "集計対象の列が指定されていません: " + agg.type;
  }
  if (!agg.column) return null;
  const meta = (columns || []).find((c) => c && (c.name === agg.column || c.key === agg.column));
  // 列が候補に無い場合は型不明として通す（呼び出し側の解決に任せる）。
  if (!meta) return null;
  if (!isAggCompatible(agg.type, meta.type)) {
    return agg.type + " は " + meta.type + " 型の列に適用できません: " + agg.column;
  }
  return null;
}

/**
 * 列型に対して使える集計種別の一覧。UI のドロップダウン絞り込み用。
 */
export function compatibleAggTypesForColumnType(columnType) {
  return AGG_TYPES.filter((t) => isAggCompatible(t, columnType));
}
