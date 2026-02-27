import { useCallback } from "react";
import { useLatestRef } from "./useLatestRef.js";
import { getFormsFromCache } from "../state/formsCache.js";
import { evaluateCache, FORM_CACHE_MAX_AGE_MS, FORM_CACHE_BACKGROUND_REFRESH_MS } from "../state/cachePolicy.js";

const hasFormsCacheData = (cache) => {
  const formCount = Array.isArray(cache?.forms) ? cache.forms.length : 0;
  const failureCount = Array.isArray(cache?.loadFailures) ? cache.loadFailures.length : 0;
  return formCount > 0 || failureCount > 0 || !!cache?.lastSyncedAt;
};

export const useRefreshFormsIfNeeded = (refreshForms, loadingForms) => {
  const loadingFormsRef = useLatestRef(loadingForms);

  return useCallback(async (source = "unknown", extraReason = "") => {
    let formsCache = { forms: [], loadFailures: [], lastSyncedAt: null };
    try {
      formsCache = await getFormsFromCache();
    } catch (error) {
      console.warn("[useRefreshFormsIfNeeded] Failed to load forms cache:", error);
    }

    const decision = evaluateCache({
      lastSyncedAt: formsCache.lastSyncedAt,
      hasData: hasFormsCacheData(formsCache),
      maxAgeMs: FORM_CACHE_MAX_AGE_MS,
      backgroundAgeMs: FORM_CACHE_BACKGROUND_REFRESH_MS,
    });
    console.info("[useRefreshFormsIfNeeded] decision", {
      source,
      extraReason,
      lastSyncedAt: formsCache.lastSyncedAt,
      shouldSync: decision.shouldSync,
      shouldBackground: decision.shouldBackground,
      isFresh: decision.isFresh,
      loadingForms: loadingFormsRef.current,
    });

    if (decision.isFresh || loadingFormsRef.current) {
      console.info("[useRefreshFormsIfNeeded] skip", {
        source,
        reason: decision.isFresh ? "cache-fresh" : "already-loading",
      });
      return;
    }

    if (decision.shouldSync) {
      console.info("[useRefreshFormsIfNeeded] sync-refresh", {
        source,
        reason: `operation:${source}:${extraReason}sync`,
      });
      await refreshForms({ reason: `operation:${source}:${extraReason}sync`, background: false });
      return;
    }

    if (decision.shouldBackground) {
      console.info("[useRefreshFormsIfNeeded] background-refresh", {
        source,
        reason: `operation:${source}:${extraReason}background`,
      });
      refreshForms({ reason: `operation:${source}:${extraReason}background`, background: true }).catch((error) => {
        console.error(`[useRefreshFormsIfNeeded] background refresh failed:`, error);
      });
    }
  }, [refreshForms, loadingFormsRef]);
};
