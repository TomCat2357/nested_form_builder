/**
 * GAS から届く column.key（パイプ区切り）を AlaSQL 安全な列名に変換する。
 * 例: "基本情報|区" → "基本情報__区"
 * フィールド階層の区切りは "|"（正規）と "/" の両方を受理し、どちらも "__" に揃える。
 * これにより列インデックス（正規パス側）とユーザー入力の参照（`親|子` / `親/子`）が
 * 同一キーへ収束し、SQL・検索・テンプレート・計算項目のいずれでも両区切りが使える。
 * 固定列（id, createdAt 等）はそのまま返す。
 */
export function headerKeyToAlaSqlKey(key) {
  if (!key) return "";
  return key.replace(/[|/]/g, "__");
}
