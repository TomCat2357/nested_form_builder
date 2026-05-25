/**
 * ダッシュボードのメッセージボックスカード用プリセット。
 *
 * UI 側はキー (key) を保存し、表示時に hex / px に解決する。これによりテーマ
 * 変更や調整があってもカード本体を書き換えずに済む。
 */

// フォントサイズ (px) のドロップダウン候補。値は数値 (px) として card.fontSize に保存する。
export const FONT_SIZE_PX_OPTIONS = [
  10, 11, 12, 13, 14, 16, 18, 20, 22, 24, 28, 32, 36, 40, 48, 56, 64, 72, 96,
];

// 旧スキーマ ("S"/"M"/"L"/"XL") との後方互換用マッピング。
const LEGACY_FONT_SIZE_KEY_TO_PX = {
  S: 12,
  M: 16,
  L: 22,
  XL: 32,
};

export const COLOR_PRESETS = [
  { key: "default", label: "既定", hex: "var(--nf-text, #1f2937)" },
  { key: "gray", label: "グレー", hex: "#6b7280" },
  { key: "red", label: "赤", hex: "#dc2626" },
  { key: "orange", label: "橙", hex: "#ea580c" },
  { key: "green", label: "緑", hex: "#16a34a" },
  { key: "blue", label: "青", hex: "#2563eb" },
  { key: "purple", label: "紫", hex: "#9333ea" },
];

export const BACKGROUND_PRESETS = [
  { key: "transparent", label: "透明", hex: "transparent" },
  { key: "paper", label: "紙", hex: "#ffffff" },
  { key: "gray", label: "グレー", hex: "#f3f4f6" },
  { key: "yellow", label: "黄", hex: "#fef3c7" },
  { key: "green", label: "緑", hex: "#dcfce7" },
  { key: "blue", label: "青", hex: "#dbeafe" },
  { key: "red", label: "赤", hex: "#fee2e2" },
];

export const ALIGN_PRESETS = [
  { key: "left", label: "左" },
  { key: "center", label: "中央" },
  { key: "right", label: "右" },
];

export const DEFAULT_FONT_SIZE_PX = 16;
export const DEFAULT_COLOR_KEY = "default";
export const DEFAULT_BACKGROUND_KEY = "transparent";
export const DEFAULT_ALIGN_KEY = "left";

function findPreset(presets, key, fallbackKey) {
  return (
    presets.find((p) => p.key === key) ||
    presets.find((p) => p.key === fallbackKey) ||
    presets[0]
  );
}

// card.fontSize は数値 (px) を想定。旧データの "S"/"M"/"L"/"XL" は LEGACY マップで解決し、
// 数値風の文字列 ("16") も許容する。それ以外や未指定は DEFAULT_FONT_SIZE_PX。
export function resolveFontSizePx(value) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string") {
    if (LEGACY_FONT_SIZE_KEY_TO_PX[value]) return LEGACY_FONT_SIZE_KEY_TO_PX[value];
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return DEFAULT_FONT_SIZE_PX;
}

export function resolveColorHex(key) {
  return findPreset(COLOR_PRESETS, key, DEFAULT_COLOR_KEY).hex;
}

export function resolveBackgroundHex(key) {
  return findPreset(BACKGROUND_PRESETS, key, DEFAULT_BACKGROUND_KEY).hex;
}

export function resolveAlign(key) {
  return findPreset(ALIGN_PRESETS, key, DEFAULT_ALIGN_KEY).key;
}
