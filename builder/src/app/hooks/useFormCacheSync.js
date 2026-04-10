import { useCallback } from "react";
import { useLatestRef } from "./useLatestRef.js";
import { useOperationCacheTrigger } from "./useOperationCacheTrigger.js";
import {
  evaluateCache,
  FORM_CACHE_MAX_AGE_MS,
  FORM_CACHE_BACKGROUND_REFRESH_MS,
} from "../state/cachePolicy.js";

/**
 * フォームキャッシュをユーザー操作に応じて同期するフック
 *
 * @param {object} options
 * @param {boolean}  options.enabled       - 有効フラグ
 * @param {number}   options.formsCount    - forms.length（キャッシュ有無判定用）
 * @param {number}   options.lastSyncedAt  - 最後の同期タイムスタンプ
 * @param {boolean}  options.loadingForms  - 現在読み込み中か
 * @param {Function} options.refreshForms  - 同期実行関数
 * @param {string}   options.label         - ログ用ラベル
 * @param {Function} [options.shouldSkip]  - 追加のスキップ条件（true を返すとスキップ）
 * @param {Function} [options.onRefresh]   - カスタム更新ロジック。指定時はデフォルトの sync/background 分岐を置換する。
 *                                           (source, cacheDecision) => Promise<void>
 */
export function useFormCacheSync({
  enabled = true,
  formsCount,
  lastSyncedAt,
  loadingForms,
  refreshForms,
  label = "form-cache-sync",
  shouldSkip,
  onRefresh,
}) {
  const loadingFormsRef = useLatestRef(loadingForms);
  const shouldSkipRef = useLatestRef(shouldSkip);
  const onRefreshRef = useLatestRef(onRefresh);

  const handleOperationCacheCheck = useCallback(async ({ source }) => {
    if (typeof shouldSkipRef.current === "function" && shouldSkipRef.current()) return;
    if (loadingFormsRef.current) return;

    const cacheDecision = evaluateCache({
      lastSyncedAt,
      hasData: formsCount > 0 || !!lastSyncedAt,
      maxAgeMs: FORM_CACHE_MAX_AGE_MS,
      backgroundAgeMs: FORM_CACHE_BACKGROUND_REFRESH_MS,
    });

    if (cacheDecision.isFresh) return;

    if (typeof onRefreshRef.current === "function") {
      await onRefreshRef.current(source, cacheDecision);
      return;
    }

    if (cacheDecision.shouldSync) {
      await refreshForms({ reason: `operation:${source}:${label}-sync`, background: false });
      return;
    }
    if (cacheDecision.shouldBackground) {
      refreshForms({ reason: `operation:${source}:${label}-background`, background: true }).catch((error) => {
        console.error(`[${label}] Background refresh failed:`, error);
      });
    }
  }, [formsCount, lastSyncedAt, refreshForms, label, shouldSkipRef, loadingFormsRef, onRefreshRef]);

  useOperationCacheTrigger({ enabled, onOperation: handleOperationCacheCheck });
}
