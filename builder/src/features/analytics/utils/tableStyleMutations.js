// テーブルスタイルの罫線オーバーライド / 列幅の不変更新ロジック（純関数）。
// TableStyleControls.jsx から切り出してユニットテスト可能にする。
//
// 契約: いずれの関数も「clone 済みの base」を受け取り、破壊的に編集して返す。
// 呼び出し側は `cloneBase()`（useStylePathSetter）で複製したオブジェクトを渡し、
// 戻り値をそのまま onChange へ流す。対象インデックスが存在しない更新系は null を返す
// （呼び出し側は null のとき onChange しない＝従来の早期 return 相当）。

export function applyAddOverride(base, target) {
  if (!Array.isArray(base.border.overrides)) base.border.overrides = [];
  base.border.overrides.push({
    target,
    selector: "",
    edges: "both",
    width: 1,
    color: "",
    style: "solid",
  });
  return base;
}

export function applyUpdateOverride(base, idx, patch) {
  const list = base.border.overrides || [];
  if (!list[idx]) return null;
  list[idx] = { ...list[idx], ...patch };
  return base;
}

export function applyRemoveOverride(base, idx) {
  const list = base.border.overrides || [];
  list.splice(idx, 1);
  return base;
}

// 古い質問データには column プロパティが無いことがあるので、列幅編集前に必ず初期化する。
export function ensureColumn(base) {
  if (!base.column) base.column = { minWidth: null, maxWidth: null, widths: [] };
  if (!Array.isArray(base.column.widths)) base.column.widths = [];
  if (!("minWidth" in base.column)) base.column.minWidth = null;
  if (!("maxWidth" in base.column)) base.column.maxWidth = null;
  return base;
}

// 空文字 → null (未設定 sentinel)、数値 → Number()。範囲外クランプは normalize 側で実施。
export function applySetMinMaxWidth(base, key, value) {
  ensureColumn(base);
  base.column[key] = value === "" || value === null ? null : Number(value);
  return base;
}

export function applyAddColumnWidth(base, defaultWidth) {
  ensureColumn(base);
  base.column.widths.push({ column: "", width: defaultWidth });
  return base;
}

export function applyUpdateColumnWidth(base, idx, patch) {
  ensureColumn(base);
  if (!base.column.widths[idx]) return null;
  base.column.widths[idx] = { ...base.column.widths[idx], ...patch };
  return base;
}

export function applyRemoveColumnWidth(base, idx) {
  ensureColumn(base);
  base.column.widths.splice(idx, 1);
  return base;
}
