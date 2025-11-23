export const DISPLAY_MODES = {
  NONE: "none",
  NORMAL: "normal",
  COMPACT: "compact",
};

const VALID_MODES = new Set(Object.values(DISPLAY_MODES));
const COMPACT_SUPPORTED_TYPES = new Set(["radio", "select"]);

export const DISPLAY_MODE_LABELS = {
  [DISPLAY_MODES.NONE]: "表示なし",
  [DISPLAY_MODES.NORMAL]: "表示",
  [DISPLAY_MODES.COMPACT]: "表示",
};

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

export const ensureDisplayModeForType = (mode, type) => {
  if (mode === DISPLAY_MODES.NONE) {
    return DISPLAY_MODES.NONE;
  }

  // ラジオ/ドロップダウンは表示する場合は常に簡略表示に統一
  if (isCompactDisplaySupported(type)) {
    return DISPLAY_MODES.COMPACT;
  }

  if (mode === DISPLAY_MODES.COMPACT && !isCompactDisplaySupported(type)) {
    return DISPLAY_MODES.NORMAL;
  }

  return DISPLAY_MODES.NORMAL;
};

export const toImportantFlag = (mode) => mode !== DISPLAY_MODES.NONE;
