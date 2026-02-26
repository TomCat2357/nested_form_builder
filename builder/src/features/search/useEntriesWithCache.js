import { useCallback, useEffect, useRef, useState } from "react";
import { useLatestRef } from "../../app/hooks/useLatestRef.js";
import { useOperationCacheTrigger } from "../../app/hooks/useOperationCacheTrigger.js";
import { useAppData } from "../../app/state/AppDataProvider.jsx";
import { dataStore } from "../../app/state/dataStore.js";
import { getFormsFromCache } from "../../app/state/formsCache.js";
import { saveRecordsToCache, getRecordsFromCache } from "../../app/state/recordsCache.js";
import { evaluateCache, RECORD_CACHE_BACKGROUND_REFRESH_MS, RECORD_CACHE_MAX_AGE_MS } from "../../app/state/cachePolicy.js";
import { useRefreshFormsIfNeeded } from "../../app/hooks/useRefreshFormsIfNeeded.js";
import { GAS_ERROR_CODE_LOCK_TIMEOUT } from "../../core/constants.js";
import { perfLogger } from "../../utils/perfLogger.js";

const defaultAlert = { showAlert: (message) => console.warn("[useEntriesWithCache]", message) };
const buildFetchErrorMessage = (error) =>
  `スプレッドシートからデータを読み取れませんでした。\n接続設定やスプレッドシートの共有設定を確認してください。\n\n詳細: ${error?.message || error}`;

const shouldForceSync = (locationState) => {
  if (!locationState || typeof locationState !== "object") return false;
  return locationState.saved === true || locationState.deleted === true || locationState.created === true;
};

export const useEntriesWithCache = ({
  formId,
  form,
  locationKey,
  locationState,
  showAlert = defaultAlert.showAlert,
}) => {
  const { refreshForms, loadingForms } = useAppData();
  const [entries, setEntries] = useState([]);
  const [headerMatrix, setHeaderMatrix] = useState([]);
  const [loading, setLoading] = useState(false);
  const [backgroundLoading, setBackgroundLoading] = useState(false);
  const [useCache, setUseCache] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const [cacheDisabled, setCacheDisabled] = useState(false);
  const lastSyncedAtRef = useLatestRef(lastSyncedAt);
  const backgroundLoadingRef = useRef(false);
  const activeForegroundRequestsRef = useRef(0);
  const latestRequestTokenRef = useRef(0);
  const loadingFormsRef = useLatestRef(loadingForms);

  const fetchAndCacheData = useCallback(async ({ background = false, forceFullSync = false, reason = "unknown", onError = null } = {}) => {
    if (!formId) return;
    if (background && backgroundLoadingRef.current) return;

    const requestToken = ++latestRequestTokenRef.current;
    if (!background) {
      activeForegroundRequestsRef.current += 1;
      setLoading(true);
    } else {
      backgroundLoadingRef.current = true;
      setBackgroundLoading(true);
    }
    const startedAt = Date.now();

    try {
      const result = await dataStore.listEntries(formId, {
        lastSyncedAt: forceFullSync ? null : lastSyncedAtRef.current,
        forceFullSync,
      });
      if (requestToken !== latestRequestTokenRef.current) {
        perfLogger.logVerbose("search", "fetch ignored by stale response guard", {
          formId,
          background,
          reason,
          forceFullSync,
          requestToken,
          latestRequestToken: latestRequestTokenRef.current,
        });
        return;
      }
      const fetchedEntries = result.entries || result || [];
      setEntries(fetchedEntries);
      setHeaderMatrix(result.headerMatrix || []);
      const syncedAt = result.lastSyncedAt || Date.now();
      setLastSyncedAt(syncedAt);
      setCacheDisabled(false);
      setUseCache(false);
      return true;
    } catch (error) {
      console.error("[SearchPage] Failed to fetch and cache data:", error);
      if (typeof onError === "function") onError(error);
      else showAlert(buildFetchErrorMessage(error));
      return false;
    } finally {
      const finishedAt = Date.now();
      perfLogger.logVerbose("search", "fetch done", {
        formId,
        background,
        reason,
        forceFullSync,
        requestToken,
        durationMs: finishedAt - startedAt,
      });
      if (!background) {
        activeForegroundRequestsRef.current = Math.max(0, activeForegroundRequestsRef.current - 1);
        setLoading(activeForegroundRequestsRef.current > 0);
      } else {
        backgroundLoadingRef.current = false;
        setBackgroundLoading(false);
      }
    }
  }, [form?.schemaHash, formId, showAlert]);

  const refreshFormsIfNeeded = useRefreshFormsIfNeeded(refreshForms, loadingForms);

  const handleOperation = useCallback(async ({ source }) => {
    if (!formId) return;

    try {
      const cache = await getRecordsFromCache(formId);
      const schemaMismatch = cache.schemaHash && form?.schemaHash && cache.schemaHash !== form.schemaHash;
      const hasCache = (cache.entries || []).length > 0 && !schemaMismatch;
      const decision = evaluateCache({
        lastSyncedAt: cache.lastSyncedAt,
        hasData: hasCache,
        maxAgeMs: RECORD_CACHE_MAX_AGE_MS,
        backgroundAgeMs: RECORD_CACHE_BACKGROUND_REFRESH_MS,
      });

      if (!decision.isFresh) {
        if (decision.shouldSync) {
          await fetchAndCacheData({ background: false, reason: `operation:${source}:records-sync` });
        } else if (decision.shouldBackground) {
          await fetchAndCacheData({ background: true, reason: `operation:${source}:records-background` });
        }
      }

      await refreshFormsIfNeeded(source);
    } catch (error) {
      console.error("[SearchPage] operation cache check failed:", error);
    }
  }, [fetchAndCacheData, form?.schemaHash, formId, refreshFormsIfNeeded]);

  useOperationCacheTrigger({
    enabled: Boolean(formId),
    onOperation: handleOperation,
  });

  useEffect(() => {
    if (!formId) return;

    const loadData = async () => {
      let cache = { entries: [], headerMatrix: [], lastSyncedAt: null };
      try {
        cache = await getRecordsFromCache(formId);
      } catch (error) {
        console.warn("[SearchPage] Failed to load cache:", error);
        setCacheDisabled(true);
      }

      const schemaMismatch = cache.schemaHash && form?.schemaHash && cache.schemaHash !== form.schemaHash;
      const hasCache = (cache.entries || []).length > 0 && !schemaMismatch;
      if (schemaMismatch) {
        perfLogger.logVerbose("search", "cache schema mismatch detected; forcing sync", {
          cacheSchema: cache.schemaHash,
          formSchema: form?.schemaHash,
        });
        try {
          await saveRecordsToCache(formId, [], [], { schemaHash: form?.schemaHash });
        } catch (clearErr) {
          console.warn("[SearchPage] Failed to clear stale cache:", clearErr);
        }
      }

      const forceSync = shouldForceSync(locationState);
      const { age, shouldSync, shouldBackground } = evaluateCache({
        lastSyncedAt: cache.lastSyncedAt,
        hasData: hasCache,
        forceSync,
        maxAgeMs: RECORD_CACHE_MAX_AGE_MS,
        backgroundAgeMs: RECORD_CACHE_BACKGROUND_REFRESH_MS,
      });

      perfLogger.logVerbose("search", "cache decision", {
        formId,
        cacheAge: age,
        hasCache,
        shouldSync,
        shouldBackground,
        cacheDisabled,
      });

      if (hasCache) {
        setEntries(cache.entries);
        setHeaderMatrix(cache.headerMatrix || []);
        setLastSyncedAt(cache.lastSyncedAt || cache.cacheTimestamp || null);
        setUseCache(true);
      }

      if ((shouldSync || cacheDisabled) && !hasCache) {
        await fetchAndCacheData({ background: false, reason: "initial-sync" });
        return;
      }

      if (shouldSync || shouldBackground) {
        fetchAndCacheData({ background: true, reason: "initial-background" }).catch((error) => {
          console.error("[SearchPage] background refresh failed:", error);
          showAlert(buildFetchErrorMessage(error));
        });
      }
    };

    loadData();
  }, [cacheDisabled, fetchAndCacheData, form?.schemaHash, formId, locationKey, locationState, showAlert]);

  const forceRefreshAll = useCallback(async () => {
    if (!formId) return;

    // 検索結果画面の手動更新は、遅延書き込み完了後に全件再取得を実行する
    await dataStore.flushPendingOperations();
    const refreshed = await fetchAndCacheData({
      background: false,
      forceFullSync: true,
      reason: "manual:search-records",
      onError: (error) => {
        if (error?.code === GAS_ERROR_CODE_LOCK_TIMEOUT) {
          showAlert(
            "現在、他のユーザーによる更新処理が実行中のため更新できませんでした。少し時間をおいて再度「更新」を実行してください。",
            "更新を完了できませんでした",
          );
          return;
        }
        showAlert(buildFetchErrorMessage(error));
      },
    });
    if (!refreshed) return;
    await refreshForms({ reason: "manual:search-forms", background: false });
  }, [fetchAndCacheData, formId, refreshForms, showAlert]);

  return {
    entries,
    headerMatrix,
    loading,
    backgroundLoading,
    useCache,
    lastSyncedAt,
    cacheDisabled,
    fetchAndCacheData,
    forceRefreshAll,
  };
};
