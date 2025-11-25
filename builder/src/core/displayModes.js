export const DISPLAY_MODES = {
  NONE: "none",
  NORMAL: "normal",
  COMPACT: "compact",
};

const VALID_MODES = new Set(Object.values(DISPLAY_MODES));
const COMPACT_SUPPORTED_TYPES = new Set(["radio", "select"]);

export const normalizeDisplayMode = (mode, { importantFlag = false } = {}) => {
  if (typeof mode === "string") {
    const lower = mode.toLowerCase();
    if (VALID_MODES.has(lower)) {
      return lower;
    }
  }
  return importantFlag ? DISPLAY_MODES.NORMAL : DISPLAY_MODES.NONE;
};

export const isCompactDisplaySupported = (type) => COMPACT_SUPPORTED_TYPES.has(type);

export const ensureDisplayModeForType = (mode, type, { explicit = false } = {}) => {
  if (mode === DISPLAY_MODES.NONE) {
    return DISPLAY_MODES.NONE;
  }

  const compactCapable = isCompactDisplaySupported(type);

  if (mode === DISPLAY_MODES.COMPACT) {
    return compactCapable ? DISPLAY_MODES.COMPACT : DISPLAY_MODES.NORMAL;
  }

  if (mode === DISPLAY_MODES.NORMAL) {
    // 未指定の場合のみ従来の簡略表示デフォルトを維持し、明示指定は尊重する
    if (compactCapable && !explicit) {
      return DISPLAY_MODES.COMPACT;
    }
    return DISPLAY_MODES.NORMAL;
  }

  // フォールバック: 選択式は簡略表示を既定、明示指定なら通常表示
  if (compactCapable && !explicit) {
    return DISPLAY_MODES.COMPACT;
  }
  return DISPLAY_MODES.NORMAL;
};

export const toImportantFlag = (mode) => mode !== DISPLAY_MODES.NONE;
