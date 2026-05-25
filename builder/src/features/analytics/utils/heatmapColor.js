/**
 * ヒートマップのセル背景色計算。
 *
 * 色端点 (minColor / maxColor) の解釈:
 *   - ""        : 既定 (最小=白, 最大=HSL 210/80% 由来の青)。両方未設定なら HSL 補間。
 *   - "transparent": その端を完全透明扱いにし、反対側の色で alpha 補間する。
 *   - "#rrggbb" / "#rgb": その色を端の色として使う。
 * 両端が "transparent" のときは色を出さない（undefined）。
 *
 * detectNumericColumns はスキーマ型と行値スキャンの組合せで、ヒートマップ着色対象の
 * 列だけを抽出する純関数。`string` / `boolean` 列は除外（CAST(... AS STRING) の値も含む）、
 * 残りは「行値がすべて数値 or 空欄」で「最低 1 件は数値」の列のみ採用する。
 */

import { toFiniteNumberOrNull as toFiniteNumber } from "./computeShared.js";
import { detectColumnType } from "./columnValueInference.js";

const HEAT_HUE = 210;

const DEFAULT_MIN_COLOR = { r: 255, g: 255, b: 255, a: 1 };
const DEFAULT_MAX_COLOR = { r: 76, g: 126, b: 255, a: 1 };

// "#rrggbb" / "#rgb" を {r,g,b,a:1} に分解する。解釈できなければ null。
export function parseHexColor(color) {
  if (typeof color !== "string") return null;
  const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(color.trim());
  if (!m) return null;
  const hex = m[1];
  if (hex.length === 3) {
    return {
      r: parseInt(hex[0] + hex[0], 16),
      g: parseInt(hex[1] + hex[1], 16),
      b: parseInt(hex[2] + hex[2], 16),
      a: 1,
    };
  }
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
    a: 1,
  };
}

export function heatBackground(value, range, minColor, maxColor) {
  if (!range) return undefined;
  const [min, max] = range;
  if (min === max) return undefined;
  const t = Math.max(0, Math.min(1, (value - min) / (max - min)));

  const noMin = !minColor;
  const noMax = !maxColor;
  if (noMin && noMax) {
    const lightness = 100 - t * 50;
    return `hsl(${HEAT_HUE}, 80%, ${lightness}%)`;
  }

  const minTrans = minColor === "transparent";
  const maxTrans = maxColor === "transparent";
  if (minTrans && maxTrans) return undefined;

  let c1;
  if (minTrans) {
    const base = !noMax && !maxTrans ? (parseHexColor(maxColor) || DEFAULT_MAX_COLOR) : DEFAULT_MAX_COLOR;
    c1 = { ...base, a: 0 };
  } else {
    c1 = noMin ? DEFAULT_MIN_COLOR : (parseHexColor(minColor) || DEFAULT_MIN_COLOR);
  }

  let c2;
  if (maxTrans) {
    const base = !noMin && !minTrans ? (parseHexColor(minColor) || DEFAULT_MIN_COLOR) : DEFAULT_MIN_COLOR;
    c2 = { ...base, a: 0 };
  } else {
    c2 = noMax ? DEFAULT_MAX_COLOR : (parseHexColor(maxColor) || DEFAULT_MAX_COLOR);
  }

  const r = Math.round(c1.r + (c2.r - c1.r) * t);
  const g = Math.round(c1.g + (c2.g - c1.g) * t);
  const b = Math.round(c1.b + (c2.b - c1.b) * t);
  const a = c1.a + (c2.a - c1.a) * t;
  if (a <= 0) return undefined;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/**
 * スキーマ型が "string" / "boolean" の列は明示的に「非数値」なので heatmap から除外する。
 * CAST(... AS STRING) で文字列化した数値表現を heat 着色しないための判定で、それ以外
 * （"number" / "date" / null = 型不明）は行値スキャン（toFiniteNumber）に委ねる。
 * "date" は値が日付正規化文字列で来るため Number() で弾かれて結果的に除外される。
 */
export function detectNumericColumns(rows, columns, compiledColumns, fallbackTypeMap, excludeColumns) {
  const result = new Set();
  const hasExcludes = excludeColumns && excludeColumns.size > 0;
  for (const col of columns) {
    if (hasExcludes && excludeColumns.has(col)) continue;
    const schemaType = detectColumnType(compiledColumns, col, fallbackTypeMap);
    if (schemaType === "string" || schemaType === "boolean") continue;
    let hasNumber = false;
    let allNumericOrEmpty = true;
    for (const r of rows) {
      const v = r[col];
      if (v === null || v === undefined || v === "") continue;
      if (toFiniteNumber(v) === null) { allNumericOrEmpty = false; break; }
      hasNumber = true;
    }
    if (hasNumber && allNumericOrEmpty) result.add(col);
  }
  return result;
}
