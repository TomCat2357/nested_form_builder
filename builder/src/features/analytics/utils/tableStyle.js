/**
 * Analytics の table / pivotTable の見た目をユーザー単位で調整するためのユーティリティ。
 *
 * - viz.tableStyle 未設定 (null/undefined) のときは「現状のハードコード値で描画」を意味する。
 *   これにより既存質問の見た目を完全に維持する後方互換センチネルになる。
 * - 色フィールドの空文字 "" は「CSS 変数フォールバック使用」を意味するセンチネル。
 *   <input type="color"> が空文字を表現できないので UI 側で × ボタンで戻す。
 * - 正規化 (normalizeTableStyle) では数値クランプ・enum 制限・色サニタイズで防御する。
 *   sanitizeColor は最低限の正規表現で javascript: 等を弾く。
 *
 * 罫線スキーマは「横 (horizontal, 行間) / 縦 (vertical, 列間) の独立 2 系統」+ オーバーライド配列。
 * 旧形式 `border: { width, color, style }` は normalizeTableStyle 内で
 * `border.horizontal = {width,color,style}` / `border.vertical = {width:0,...}` に
 * 自動マイグレーションされる（既存見た目を維持）。
 */

export const TABLE_BORDER_STYLES = ["solid", "dashed", "dotted", "none"];
export const ROW_OVERRIDE_EDGES = ["top", "bottom", "both"];
export const COLUMN_OVERRIDE_EDGES = ["left", "right", "both"];

const DEFAULT_BORDER_LINE = { width: 1, color: "", style: "solid" };
const DEFAULT_VERTICAL_BORDER_LINE = { width: 0, color: "", style: "solid" };

export const COLUMN_WIDTH_MIN = 20;
export const COLUMN_WIDTH_MAX = 2000;

export const DEFAULT_TRUNCATE_LENGTH = 50;
export const TRUNCATE_LENGTH_MIN = 0;
export const TRUNCATE_LENGTH_MAX = 5000;

export const DEFAULT_TABLE_STYLE = {
  border: {
    horizontal: { ...DEFAULT_BORDER_LINE },
    vertical: { ...DEFAULT_VERTICAL_BORDER_LINE },
    overrides: [],
  },
  cell: { paddingY: 6, paddingX: 10, rowHeight: 0, truncateLength: DEFAULT_TRUNCATE_LENGTH },
  header: { bg: "", color: "" },
  zebra: { enabled: false, color: "" },
  column: { minWidth: null, maxWidth: null, widths: [] },
};

function clampNumber(value, min, max, fallback) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

// 列幅 minWidth / maxWidth の正規化。null/undefined/非数値 は null（未設定 sentinel）。
// 数値は COLUMN_WIDTH_MIN..COLUMN_WIDTH_MAX にクランプ。
function normalizeOptionalColumnWidth(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  if (n < COLUMN_WIDTH_MIN) return COLUMN_WIDTH_MIN;
  if (n > COLUMN_WIDTH_MAX) return COLUMN_WIDTH_MAX;
  return n;
}

const SAFE_COLOR_RE = /^(#[0-9a-fA-F]{3,8}|rgb\([^)]+\)|rgba\([^)]+\)|hsl\([^)]+\)|hsla\([^)]+\)|[a-zA-Z]+)$/;

function sanitizeColor(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  return SAFE_COLOR_RE.test(trimmed) ? trimmed : "";
}

function sanitizeBorderStyle(value) {
  return TABLE_BORDER_STYLES.includes(value) ? value : "solid";
}

function normalizeBorderLine(input, fallback) {
  const src = input && typeof input === "object" ? input : {};
  return {
    width: clampNumber(src.width, 0, 10, fallback.width),
    color: sanitizeColor(src.color),
    style: sanitizeBorderStyle(src.style),
  };
}

function normalizeRowEdges(input) {
  if (ROW_OVERRIDE_EDGES.includes(input)) return input;
  return "both";
}

function normalizeColumnEdges(input) {
  if (COLUMN_OVERRIDE_EDGES.includes(input)) return input;
  return "both";
}

function normalizeOverrides(input) {
  if (!Array.isArray(input)) return [];
  const out = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const target = raw.target === "row" || raw.target === "column" ? raw.target : null;
    if (!target) continue;
    const rawSelector = typeof raw.selector === "string" ? raw.selector : "";
    if (!rawSelector.trim()) continue;
    const selector = rawSelector.slice(0, 500);
    const edges = target === "row" ? normalizeRowEdges(raw.edges) : normalizeColumnEdges(raw.edges);
    out.push({
      target,
      selector,
      edges,
      width: clampNumber(raw.width, 0, 10, DEFAULT_BORDER_LINE.width),
      color: sanitizeColor(raw.color),
      style: sanitizeBorderStyle(raw.style),
    });
  }
  return out;
}

// 列幅 widths 配列の正規化。border.overrides と同じ防御パターン。
// - 配列以外なら []
// - column キーが空文字なら除外 (500 文字に slice して防御)
// - width は COLUMN_WIDTH_MIN..COLUMN_WIDTH_MAX にクランプ、不正値は最小値
// - 同じ column が複数回現れたら先勝ち (UI 表示順とロジック評価順を一致させる)
function normalizeColumnWidths(input) {
  if (!Array.isArray(input)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const rawCol = typeof raw.column === "string" ? raw.column.trim() : "";
    if (!rawCol) continue;
    const column = rawCol.slice(0, 500);
    if (seen.has(column)) continue;
    seen.add(column);
    out.push({
      column,
      width: clampNumber(raw.width, COLUMN_WIDTH_MIN, COLUMN_WIDTH_MAX, COLUMN_WIDTH_MIN),
    });
  }
  return out;
}

function isLegacyBorderShape(border) {
  if (!border || typeof border !== "object") return false;
  if (border.horizontal || border.vertical || Array.isArray(border.overrides)) return false;
  return ("width" in border) || ("color" in border) || ("style" in border);
}

export function normalizeTableStyle(input) {
  if (input === null || input === undefined) return null;
  if (typeof input !== "object") return null;

  const rawBorder = input.border || {};
  let horizontal;
  let vertical;
  let overrides;

  if (isLegacyBorderShape(rawBorder)) {
    horizontal = normalizeBorderLine(rawBorder, DEFAULT_BORDER_LINE);
    vertical = { ...DEFAULT_VERTICAL_BORDER_LINE };
    overrides = [];
  } else {
    horizontal = normalizeBorderLine(rawBorder.horizontal, DEFAULT_BORDER_LINE);
    vertical = normalizeBorderLine(rawBorder.vertical, DEFAULT_VERTICAL_BORDER_LINE);
    overrides = normalizeOverrides(rawBorder.overrides);
  }

  const c = input.cell || {};
  const h = input.header || {};
  const z = input.zebra || {};
  const col = input.column || {};

  // min > max のときは両方 null に戻して矛盾を排除する（ユーザ混乱を避ける）。
  let minWidth = normalizeOptionalColumnWidth(col.minWidth);
  let maxWidth = normalizeOptionalColumnWidth(col.maxWidth);
  if (minWidth !== null && maxWidth !== null && minWidth > maxWidth) {
    minWidth = null;
    maxWidth = null;
  }

  return {
    border: {
      horizontal,
      vertical,
      overrides,
    },
    cell: {
      paddingY: clampNumber(c.paddingY, 0, 30, DEFAULT_TABLE_STYLE.cell.paddingY),
      paddingX: clampNumber(c.paddingX, 0, 30, DEFAULT_TABLE_STYLE.cell.paddingX),
      rowHeight: clampNumber(c.rowHeight, 0, 80, DEFAULT_TABLE_STYLE.cell.rowHeight),
      truncateLength: clampNumber(c.truncateLength, TRUNCATE_LENGTH_MIN, TRUNCATE_LENGTH_MAX, DEFAULT_TRUNCATE_LENGTH),
    },
    header: {
      bg: sanitizeColor(h.bg),
      color: sanitizeColor(h.color),
    },
    zebra: {
      enabled: !!z.enabled,
      color: sanitizeColor(z.color),
    },
    column: {
      minWidth,
      maxWidth,
      widths: normalizeColumnWidths(col.widths),
    },
  };
}

/**
 * tableStyle が null/undefined のときは「現状のハードコード値」を返し、
 * 既存テーブルの見た目を寸分違わず維持する。
 *
 * レイアウトは常に content-adaptive（table-layout: auto）。列幅は内容に応じて伸縮し、
 * column.minWidth / maxWidth でクランプ、widths[] は列ごとの「優先幅」ヒント。
 */
export function buildTableStyleTokens(tableStyle) {
  if (!tableStyle) {
    return {
      horizontal: { width: 1, color: "var(--nf-border)", style: "solid" },
      vertical: { width: 0, color: "var(--nf-border)", style: "solid" },
      overrides: [],
      headerBg: "var(--nf-bg-subtle, #f5f5f5)",
      headerColor: undefined,
      paddingY: 6,
      paddingX: 10,
      rowHeight: 0,
      truncateLength: DEFAULT_TRUNCATE_LENGTH,
      zebra: { enabled: false, color: "rgba(0,0,0,0.03)" },
      column: {
        minWidth: null,
        maxWidth: null,
        widthMap: new Map(),
        customized: false,
      },
      customized: false,
    };
  }
  const ts = tableStyle;
  const resolveColor = (c) => (c || "var(--nf-border)");
  const colMinWidth = ts.column && ts.column.minWidth != null ? ts.column.minWidth : null;
  const colMaxWidth = ts.column && ts.column.maxWidth != null ? ts.column.maxWidth : null;
  return {
    horizontal: {
      width: ts.border.horizontal.width,
      color: resolveColor(ts.border.horizontal.color),
      style: ts.border.horizontal.style,
    },
    vertical: {
      width: ts.border.vertical.width,
      color: resolveColor(ts.border.vertical.color),
      style: ts.border.vertical.style,
    },
    overrides: ts.border.overrides.map((o) => ({
      target: o.target,
      selector: o.selector,
      edges: o.edges,
      width: o.width,
      color: resolveColor(o.color),
      style: o.style,
    })),
    headerBg: ts.header.bg || "var(--nf-bg-subtle, #f5f5f5)",
    headerColor: ts.header.color || undefined,
    paddingY: ts.cell.paddingY,
    paddingX: ts.cell.paddingX,
    rowHeight: ts.cell.rowHeight,
    truncateLength: typeof ts.cell.truncateLength === "number" ? ts.cell.truncateLength : DEFAULT_TRUNCATE_LENGTH,
    zebra: {
      enabled: !!ts.zebra.enabled,
      color: ts.zebra.color || "rgba(0,0,0,0.03)",
    },
    column: {
      minWidth: colMinWidth,
      maxWidth: colMaxWidth,
      widthMap: ts.column
        ? new Map(ts.column.widths.map((w) => [w.column, w.width]))
        : new Map(),
      customized: !!ts.column,
    },
    customized: true,
  };
}

/**
 * セル文字列を maxLen 文字で切り詰めて末尾に「…」を付ける。
 * maxLen <= 0 / 未指定は省略しない。戻り値の `full` は `<td title>` 用の全文。
 */
export function truncateForDisplay(value, maxLen) {
  const str = value === null || value === undefined ? "" : String(value);
  if (!maxLen || maxLen <= 0) return { text: str, truncated: false, full: str };
  if (str.length <= maxLen) return { text: str, truncated: false, full: str };
  return { text: str.slice(0, maxLen) + "…", truncated: true, full: str };
}

/**
 * tokens.truncateLength を 50 文字フォールバック付きで取り出す。
 * ResultTable / PivotTable で同一ロジックを書いていたので共通化。
 */
export function resolveTruncateLength(tokens) {
  return typeof tokens?.truncateLength === "number" ? tokens.truncateLength : DEFAULT_TRUNCATE_LENGTH;
}
