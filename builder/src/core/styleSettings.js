// 「設定のデフォルト（指定なし）」を表すセンチネル値。色未指定時に格納する。
export const STYLE_SETTINGS_DEFAULT_COLOR = "settingsDefault";

export const DEFAULT_STYLE_SETTINGS = {
  labelSize: "default",
  textColor: STYLE_SETTINGS_DEFAULT_COLOR,
  bgColor: STYLE_SETTINGS_DEFAULT_COLOR,
};

const HEX_COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

// 任意の HEX 色を受け付ける。妥当でなければ「設定のデフォルト」センチネルへ丸める。
export const normalizeColorValue = (value) => {
  if (typeof value === "string" && HEX_COLOR_RE.test(value)) return value;
  return STYLE_SETTINGS_DEFAULT_COLOR;
};

export const normalizeLabelSize = (value) => {
  if (value === "smallest" || value === "smaller" || value === "default" || value === "larger" || value === "largest") return value;
  return "default";
};

export const normalizeStyleSettings = (input) => {
  const next = { ...(input || {}) };
  if (!next.labelSize && typeof next.fontSize === "string") {
    const numeric = parseInt(next.fontSize, 10);
    if (!Number.isNaN(numeric)) {
      if (numeric <= 12) next.labelSize = "smaller";
      else if (numeric >= 18) next.labelSize = "larger";
      else next.labelSize = "default";
    } else {
      next.labelSize = "default";
    }
  }
  next.labelSize = normalizeLabelSize(next.labelSize);
  next.textColor = normalizeColorValue(next.textColor);
  next.bgColor = normalizeColorValue(next.bgColor);
  delete next.fontSize;
  return next;
};

/**
 * スタイル設定からラベルサイズを解決する（PreviewPage用）
 * normalizeStyleSettings と同等だが textColor の正規化は行わない
 */
export const resolveLabelSize = (styleSettings) => {
  if (styleSettings?.labelSize === "smallest" || styleSettings?.labelSize === "smaller" || styleSettings?.labelSize === "default" || styleSettings?.labelSize === "larger" || styleSettings?.labelSize === "largest") {
    return styleSettings.labelSize;
  }
  if (typeof styleSettings?.fontSize === "string") {
    const numeric = parseInt(styleSettings.fontSize, 10);
    if (!Number.isNaN(numeric)) {
      if (numeric <= 12) return "smaller";
      if (numeric >= 18) return "larger";
    }
  }
  return "default";
};

export const resolveTextColor = (styleSettings) => {
  const color = normalizeColorValue(styleSettings?.textColor);
  return color === STYLE_SETTINGS_DEFAULT_COLOR ? undefined : color;
};

export const resolveBgColor = (styleSettings) => {
  const color = normalizeColorValue(styleSettings?.bgColor);
  return color === STYLE_SETTINGS_DEFAULT_COLOR ? undefined : color;
};

// ラベルサイズ → フォントサイズ(px)。base.css の --label-font-size-base(14px) + 各 offset と一致させる。
const LABEL_SIZE_FONT_PX = {
  smallest: 10,
  smaller: 12,
  default: 14,
  larger: 16,
  largest: 18,
};

/**
 * スタイル設定をインライン style オブジェクトに解決する（ボタン等、CSS 変数を持たない要素用）。
 * 「標準・設定のデフォルト」のときは未指定（undefined）にして既定のスタイルを尊重する。
 */
export const resolveStyleSettingsInlineStyle = (styleSettings) => {
  const labelSize = resolveLabelSize(styleSettings);
  const color = resolveTextColor(styleSettings);
  const bgColor = resolveBgColor(styleSettings);
  const style = {};
  if (labelSize !== "default") {
    const px = LABEL_SIZE_FONT_PX[labelSize];
    if (px) style.fontSize = `${px}px`;
  }
  if (color) style.color = color;
  if (bgColor) {
    style.backgroundColor = bgColor;
    // 塗り背景を指定したときは枠線色も背景に馴染ませる（nf-btn-outline の枠を上書き）。
    style.borderColor = bgColor;
  }
  return style;
};
