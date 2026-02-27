import { useCallback, useEffect, useRef, useState } from "react";
import { useLatestRef } from "../../app/hooks/useLatestRef.js";
import { useOperationCacheTrigger } from "../../app/hooks/useOperationCacheTrigger.js";
import { useAppData } from "../../app/state/AppDataProvider.jsx";
import { dataStore } from "../../app/state/dataStore.js";
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

const LOCK_WAIT_RETRY_MS = 1000;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
  const [waitingForLock, setWaitingForLock] = useState(false);
  const [useCache, setUseCache] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const [lastSpreadsheetReadAt, setLastSpreadsheetReadAt] = useState(null);
  const [cacheDisabled, setCacheDisabled] = useState(false);
  const lastSyncedAtRef = useLatestRef(lastSyncedAt);
  const lastSpreadsheetReadAtRef = useLatestRef(lastSpreadsheetReadAt);
  const backgroundLoadingRef = useRef(false);
  const activeForegroundRequestsRef = useRef(0);
  const latestRequestTokenRef = useRef(0);
  const manualRefreshRunningRef = useRef(false);
  const manualRefreshQueuedRef = useRef(false);
  const entriesRef = useLatestRef(entries);

  const logSearchBackground = useCallback((event, payload = {}) => {
    console.info(`[SearchPage][background] ${event}`, {
      formId,
      ...payload,
    });
  }, [formId]);

  const fetchAndCacheData = useCallback(async ({ background = false, forceFullSync = false, reason = "unknown", onError = null } = {}) => {
    if (!formId) return;
    if (background && backgroundLoadingRef.current) {
      logSearchBackground("fetch:skip-already-running", {
        background,
        reason,
        forceFullSync,
      });
      return;
    }

    const requestToken = ++latestRequestTokenRef.current;
    const entriesBefore = Array.isArray(entriesRef.current) ? entriesRef.current.length : 0;
    let entriesAfter = entriesBefore;
    let responseMeta = null;
    if (!background) {
      activeForegroundRequestsRef.current += 1;
      setLoading(true);
    } else {
      backgroundLoadingRef.current = true;
      setBackgroundLoading(true);
    }
    const startedAt = Date.now();
    logSearchBackground("fetch:start", {
      background,
      reason,
      forceFullSync,
      requestToken,
      entriesBefore,
      lastSyncedAt: lastSyncedAtRef.current,
      lastSpreadsheetReadAt: lastSpreadsheetReadAtRef.current,
    });

    try {
      const result = await dataStore.listEntries(formId, {
        lastSyncedAt: forceFullSync ? null : lastSyncedAtRef.current,
        lastSpreadsheetReadAt: forceFullSync ? null : lastSpreadsheetReadAtRef.current,
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
        logSearchBackground("fetch:stale-response-ignored", {
          background,
          reason,
          forceFullSync,
          requestToken,
          latestRequestToken: latestRequestTokenRef.current,
        });
        return;
      }
      const fetchedEntries = result.entries || result || [];
      entriesAfter = fetchedEntries.length;
      responseMeta = {
        isDelta: result?.isDelta === true,
        fetchedCount: Number.isFinite(result?.fetchedCount) ? result.fetchedCount : fetchedEntries.length,
        allIdsCount: Number.isFinite(result?.allIdsCount) ? result.allIdsCount : null,
        sheetLastUpdatedAt: Number.isFinite(result?.sheetLastUpdatedAt) ? result.sheetLastUpdatedAt : 0,
        nextLastSpreadsheetReadAt: result?.lastSpreadsheetReadAt || null,
      };
      logSearchBackground("fetch:response", {
        background,
        reason,
        requestToken,
        entriesBefore,
        entriesAfter,
        ...responseMeta,
      });
      setEntries(fetchedEntries);
      setHeaderMatrix(result.headerMatrix || []);
      const syncedAt = result.lastSyncedAt || Date.now();
      setLastSyncedAt(syncedAt);
      setLastSpreadsheetReadAt(result.lastSpreadsheetReadAt || null);
      setCacheDisabled(false);
      setUseCache(false);
      return true;
    } catch (error) {
      console.error("[SearchPage] Failed to fetch and cache data:", error);
      logSearchBackground("fetch:error", {
        background,
        reason,
        forceFullSync,
        requestToken,
        error: error?.message || String(error),
      });
      if (typeof onError === "function") onError(error);
      else showAlert(buildFetchErrorMessage(error));
      return false;
    } finally {
      const finishedAt = Date.now();
      logSearchBackground("fetch:done", {
        background,
        reason,
        forceFullSync,
        requestToken,
        durationMs: finishedAt - startedAt,
        entriesBefore,
        entriesAfter,
        ...(responseMeta || {}),
      });
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
  }, [entriesRef, form?.schemaHash, formId, logSearchBackground, showAlert]);

  const refreshFormsIfNeeded = useRefreshFormsIfNeeded(refreshForms, loadingForms);

  const handleOperation = useCallback(async ({ source }) => {
    if (!formId) return;

    try {
      const cache = await getRecordsFromCache(formId);
      const schemaMismatch = cache.schemaHash && form?.schemaHash && cache.schemaHash !== form.schemaHash;
      const hasCache = (cache.entries || []).length > 0 && !schemaMismatch;
      const decision = evaluateCache({
        lastSyncedAt: cache.lastSyncedAt,
        lastSpreadsheetReadAt: cache.lastSpreadsheetReadAt,
        hasData: hasCache,
        maxAgeMs: RECORD_CACHE_MAX_AGE_MS,
        backgroundAgeMs: RECORD_CACHE_BACKGROUND_REFRESH_MS,
      });
      logSearchBackground("operation:decision", {
        source,
        hasCache,
        lastSyncedAt: cache.lastSyncedAt,
        lastSpreadsheetReadAt: cache.lastSpreadsheetReadAt,
        shouldSync: decision.shouldSync,
        shouldBackground: decision.shouldBackground,
        isFresh: decision.isFresh,
      });

      if (!decision.isFresh) {
        if (decision.shouldSync) {
          logSearchBackground("operation:sync", { source, reason: `operation:${source}:records-sync` });
          await fetchAndCacheData({ background: false, reason: `operation:${source}:records-sync` });
        } else if (decision.shouldBackground) {
          logSearchBackground("operation:background", { source, reason: `operation:${source}:records-background` });
          await fetchAndCacheData({ background: true, reason: `operation:${source}:records-background` });
        }
      }

      await refreshFormsIfNeeded(source);
    } catch (error) {
      console.error("[SearchPage] operation cache check failed:", error);
      logSearchBackground("operation:error", {
        source,
        error: error?.message || String(error),
      });
    }
  }, [fetchAndCacheData, form?.schemaHash, formId, logSearchBackground, refreshFormsIfNeeded]);

  useOperationCacheTrigger({
    enabled: Boolean(formId),
    onOperation: handleOperation,
  });

  useEffect(() => {
    if (!formId) return;

    const loadData = async () => {
      let cache = { entries: [], headerMatrix: [], lastSyncedAt: null, lastSpreadsheetReadAt: null };
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
        lastSpreadsheetReadAt: cache.lastSpreadsheetReadAt,
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
      logSearchBackground("initial:cache-decision", {
        hasCache,
        schemaMismatch: Boolean(schemaMismatch),
        cacheAgeMs: age,
        forceSync,
        shouldSync,
        shouldBackground,
        cacheDisabled,
        cacheLastSyncedAt: cache.lastSyncedAt,
        cacheLastSpreadsheetReadAt: cache.lastSpreadsheetReadAt,
      });

      if (hasCache) {
        setEntries(cache.entries);
        setHeaderMatrix(cache.headerMatrix || []);
        setLastSyncedAt(cache.lastSyncedAt || cache.cacheTimestamp || null);
        setLastSpreadsheetReadAt(cache.lastSpreadsheetReadAt || null);
        setUseCache(true);
        logSearchBackground("initial:cache-applied", {
          entryCount: (cache.entries || []).length,
          headerRows: (cache.headerMatrix || []).length,
        });
      }

      if ((shouldSync || cacheDisabled) && !hasCache) {
        logSearchBackground("initial:sync-start", {
          reason: "initial-sync",
          shouldSync,
          cacheDisabled,
        });
        await fetchAndCacheData({ background: false, reason: "initial-sync" });
        return;
      }

      if (shouldSync || shouldBackground) {
        logSearchBackground("initial:background-start", {
          reason: "initial-background",
          shouldSync,
          shouldBackground,
        });
        fetchAndCacheData({ background: true, reason: "initial-background" }).catch((error) => {
          console.error("[SearchPage] background refresh failed:", error);
          logSearchBackground("initial:background-error", {
            reason: "initial-background",
            error: error?.message || String(error),
          });
          showAlert(buildFetchErrorMessage(error));
        });
      }
    };

    loadData();
  }, [cacheDisabled, fetchAndCacheData, form?.schemaHash, formId, locationKey, locationState, logSearchBackground, showAlert]);

  const runManualRefreshOnce = useCallback(async () => {
    if (!formId) return;

    // 検索結果画面の手動更新は、遅延書き込み完了後に全件再取得を実行する
    logSearchBackground("manual-refresh:start", {
      reason: "manual:search-records",
    });
    await dataStore.flushPendingOperations();
    let lockTimeoutDetected = false;
    try {
      while (true) {
        let fetchError = null;
        const refreshed = await fetchAndCacheData({
          background: false,
          forceFullSync: true,
          reason: "manual:search-records",
          onError: (error) => {
            fetchError = error;
          },
        });

        if (refreshed) {
          logSearchBackground("manual-refresh:records-synced", {
            reason: "manual:search-records",
          });
          await refreshForms({ reason: "manual:search-forms", background: false });
          logSearchBackground("manual-refresh:done", {
            reason: "manual:search-forms",
          });
          return;
        }

        if (fetchError?.code === GAS_ERROR_CODE_LOCK_TIMEOUT) {
          if (!lockTimeoutDetected) {
            lockTimeoutDetected = true;
            setWaitingForLock(true);
          }
          logSearchBackground("manual-refresh:lock-timeout-retry", {
            retryInMs: LOCK_WAIT_RETRY_MS,
          });
          await wait(LOCK_WAIT_RETRY_MS);
          continue;
        }

        if (fetchError) {
          logSearchBackground("manual-refresh:error", {
            error: fetchError?.message || String(fetchError),
          });
          showAlert(buildFetchErrorMessage(fetchError));
          return;
        }

        await wait(LOCK_WAIT_RETRY_MS);
      }
    } finally {
      if (lockTimeoutDetected) setWaitingForLock(false);
      logSearchBackground("manual-refresh:exit", {
        reason: "manual:search-records",
      });
    }
  }, [fetchAndCacheData, formId, logSearchBackground, refreshForms, showAlert]);

  const forceRefreshAll = useCallback(async () => {
    if (!formId) return;

    if (manualRefreshRunningRef.current) {
      manualRefreshQueuedRef.current = true;
      logSearchBackground("manual-refresh:queued", {
        reason: "manual:search-records",
      });
      return;
    }

    manualRefreshRunningRef.current = true;
    try {
      do {
        manualRefreshQueuedRef.current = false;
        await runManualRefreshOnce();
      } while (manualRefreshQueuedRef.current);
    } finally {
      manualRefreshRunningRef.current = false;
      manualRefreshQueuedRef.current = false;
    }
  }, [formId, logSearchBackground, runManualRefreshOnce]);

  return {
    entries,
    headerMatrix,
    loading,
    backgroundLoading,
    waitingForLock,
    useCache,
    lastSyncedAt,
    cacheDisabled,
    fetchAndCacheData,
    forceRefreshAll,
  };
};
