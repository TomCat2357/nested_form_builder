import { useEffect } from "react";
import { DEFAULT_THEME, applyThemeWithFallback } from "../theme/theme.js";

/**
 * テーマを画面に適用するフック
 * @param {string} themeValue - テーマ名
 * @param {object} options
 * @param {boolean} options.enabled - 有効フラグ（falseの場合は適用しない）
 * @param {boolean} options.persist - 永続化するか
 */
export function useApplyTheme(themeValue, { enabled = true, persist = false } = {}) {
  useEffect(() => {
    if (!enabled) return;
    void applyThemeWithFallback(themeValue || DEFAULT_THEME, { persist });
  }, [enabled, themeValue, persist]);
}
