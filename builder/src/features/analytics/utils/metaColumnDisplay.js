export const HIDDEN_META_COLUMNS = new Set([
  "createdAt",
  "createdBy",
  "modifiedBy",
  "deletedAt",
  "deletedBy",
  "_row",
]);

const COLUMN_DISPLAY_LABELS = {
  modifiedAt: "最終更新日時",
};

// compiledColumns があれば displayLabel を優先する。無ければ固定マップ → 列名そのまま。
export function getColumnDisplayLabel(col, compiledColumns) {
  if (Array.isArray(compiledColumns)) {
    const meta = compiledColumns.find((c) => c && c.name === col);
    if (meta && typeof meta.displayLabel === "string" && meta.displayLabel) return meta.displayLabel;
  }
  return COLUMN_DISPLAY_LABELS[col] || col;
}

// "a_1,a_2" のような内部 alias / 実列名の CSV 文字列を UI 表示用の displayLabel
// CSV ("件数,合計") に変換する。compiledColumns の name に一致しないトークンは
// 周囲の空白含めそのまま（入力途中の値・末尾カンマを壊さない）。
export function rawYFieldsToDisplay(text, compiledColumns) {
  if (text === null || text === undefined) return text;
  if (!Array.isArray(compiledColumns) || compiledColumns.length === 0) return text;
  const byName = new Map(compiledColumns.filter((c) => c && c.name).map((c) => [c.name, c]));
  return String(text)
    .split(",")
    .map((s) => {
      const trimmed = s.trim();
      if (!trimmed) return s;
      const meta = byName.get(trimmed);
      if (meta && typeof meta.displayLabel === "string" && meta.displayLabel) {
        return s.replace(trimmed, () => meta.displayLabel);
      }
      return s;
    })
    .join(",");
}

// rawYFieldsToDisplay の逆。displayLabel CSV を内部 alias / 実列名の CSV に戻す。
// 各トークンを resolveColumnKey で解決し、変化しないトークンは触らない。
export function displayYFieldsToRaw(text, columns, compiledColumns) {
  if (text === null || text === undefined) return text;
  return String(text)
    .split(",")
    .map((s) => {
      const trimmed = s.trim();
      if (!trimmed) return s;
      const resolved = resolveColumnKey(trimmed, columns, compiledColumns);
      return resolved === trimmed ? s : s.replace(trimmed, () => resolved);
    })
    .join(",");
}

// keepRow=true なら HIDDEN_META_COLUMNS から `_row` だけ動的に除外して通す。
// ユーザーが SQL で `_row` を明示的に参照したケースだけ表示する opt-in 用。
export function filterDisplayColumns(columns, { keepRow = false } = {}) {
  if (!Array.isArray(columns)) return [];
  if (keepRow) {
    return columns.filter((c) => c === "_row" || !HIDDEN_META_COLUMNS.has(c));
  }
  return columns.filter((c) => !HIDDEN_META_COLUMNS.has(c));
}

// SQL 文字列に `_row` 単語が含まれていれば true。null/undefined/非文字列は false。
// コメント中・文字列リテラル中の `_row` も誤検出するが、その場合は「列が表示される」だけで
// 実害なし。ユーザーが `_row` を意図して書いた場面では確実に拾えるシンプル検出。
export function shouldKeepRowFromSql(sql) {
  return typeof sql === "string" && /\b_row\b/i.test(sql);
}

// ユーザーが手入力 / 旧設定で持っている列名を、実際の rows のキー (可読別名等) に解決する。
// マッチ優先順:
//   1. columns に完全一致 (現行の挙動)
//   2. compiledColumns.displayLabel に完全一致
//   3. 上記いずれも空白除去後の比較で一致
//   4. compiledColumns.srcAggId に完全一致（旧 a_1 等の集計 id → 現在の可読別名）
// 解決できなければ入力値をそのまま返す。
export function resolveColumnKey(input, columns, compiledColumns) {
  if (!input) return input;
  const key = String(input);
  if (Array.isArray(columns) && columns.includes(key)) return key;
  if (Array.isArray(compiledColumns)) {
    const exact = compiledColumns.find((c) => c && c.displayLabel === key);
    if (exact) return exact.name;
    const norm = key.replace(/\s+/g, "");
    const fuzzy = compiledColumns.find((c) => c && typeof c.displayLabel === "string"
      && c.displayLabel.replace(/\s+/g, "") === norm);
    if (fuzzy) return fuzzy.name;
    const byAggId = compiledColumns.find((c) => c && c.srcAggId === key);
    if (byAggId) return byAggId.name;
  }
  return key;
}
