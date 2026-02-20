export const DEFAULT_STYLE_SETTINGS = { labelSize: "default", textColor: "#000000" };

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
  if (typeof next.textColor !== "string" || !next.textColor) {
    next.textColor = DEFAULT_STYLE_SETTINGS.textColor;
  }
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
