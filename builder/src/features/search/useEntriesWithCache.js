import { useCallback, useEffect, useRef, useState } from "react";
import { useLatestRef } from "../../app/hooks/useLatestRef.js";
import { useOperationCacheTrigger } from "../../app/hooks/useOperationCacheTrigger.js";
import { useAppData } from "../../app/state/AppDataProvider.jsx";
import { dataStore } from "../../app/state/dataStore.js";
import { saveRecordsToCache, getRecordsFromCache } from "../../app/state/recordsCache.js";
import { evaluateCacheForRecords } from "../../app/state/cachePolicy.js";
import { useRefreshFormsIfNeeded } from "../../app/hooks/useRefreshFormsIfNeeded.js";
import { GAS_ERROR_CODE_LOCK_TIMEOUT } from "../../core/constants.js";
import { perfLogger } from "../../utils/perfLogger.js";
import {
  syncStateListeners,
  defaultAlert,
  getGlobalSyncSnapshot,
  setGlobalSyncState,
  updateGlobalMeta,
  buildFetchErrorMessage,
  shouldForceSync,
  shouldRetryListReadError,
  canRetryOperationSync,
  getUnsyncedState,
  LOCK_WAIT_RETRY_MS,
  READ_RETRY_INTERVAL_MS,
  READ_RETRY_MAX_ATTEMPTS,
  SYNC_INTERVAL_MS,
  wait,
} from "./globalSyncState.js";

const WRITE_RETRY_INTERVAL_MS = 1000;
const WRITE_RETRY_MAX_ATTEMPTS = 3;

export const useEntriesWithCache = ({
  formId,
  form,
  locationKey,
  locationState,
  showAlert = defaultAlert.showAlert,
}) => {
  const { refreshForms, loadingForms } = useAppData();
  const initialSyncSnapshot = getGlobalSyncSnapshot(formId);
  const [entries, setEntries] = useState([]);
  const [hasUnsynced, setHasUnsynced] = useState(initialSyncSnapshot.hasUnsynced);
  const [unsyncedCount, setUnsyncedCount] = useState(initialSyncSnapshot.unsyncedCount);
  const [headerMatrix, setHeaderMatrix] = useState([]);
  const [loading, setLoading] = useState(initialSyncSnapshot.loading);
  const [backgroundLoading, setBackgroundLoading] = useState(initialSyncSnapshot.backgroundLoading);
  const [waitingForLock, setWaitingForLock] = useState(initialSyncSnapshot.waitingForLock);
  const [useCache, setUseCache] = useState(initialSyncSnapshot.useCache);
  const [lastSyncedAt, setLastSyncedAt] = useState(initialSyncSnapshot.lastSyncedAt);
  const [lastSpreadsheetReadAt, setLastSpreadsheetReadAt] = useState(initialSyncSnapshot.lastSpreadsheetReadAt);
  const [cacheDisabled, setCacheDisabled] = useState(initialSyncSnapshot.cacheDisabled);
  const lastSyncedAtRef = useLatestRef(lastSyncedAt);
  const lastSpreadsheetReadAtRef = useLatestRef(lastSpreadsheetReadAt);
  const backgroundLoadingRef = useRef(false);
  const activeForegroundRequestsRef = useRef(0);
  const latestRequestTokenRef = useRef(0);
  const manualRefreshRunningRef = useRef(false);
  const manualRefreshQueuedRef = useRef(false);
  const entriesRef = useLatestRef(entries);
  const operationSyncTokenRef = useRef(0);
  const syncStartSequenceRef = useRef(0);
  const initialFormsSyncDoneRef = useRef(false);

  const applyGlobalSyncSnapshot = useCallback((snapshot) => {
    setLoading(snapshot.loading);
    setBackgroundLoading(snapshot.backgroundLoading);
    backgroundLoadingRef.current = snapshot.backgroundLoading;
    setWaitingForLock(snapshot.waitingForLock);
    setHasUnsynced(snapshot.hasUnsynced);
    setUnsyncedCount(snapshot.unsyncedCount);
    setUseCache(snapshot.useCache);
    setLastSyncedAt(snapshot.lastSyncedAt);
    setLastSpreadsheetReadAt(snapshot.lastSpreadsheetReadAt);
    setCacheDisabled(snapshot.cacheDisabled);
  }, []);

  useEffect(() => {
    const applySnapshot = () => {
      applyGlobalSyncSnapshot(getGlobalSyncSnapshot(formId));
    };
    applySnapshot();
    const listener = () => {
      applySnapshot();
    };
    syncStateListeners.add(listener);
    return () => {
      syncStateListeners.delete(listener);
    };
  }, [applyGlobalSyncSnapshot, formId]);

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
    const syncSequence = ++syncStartSequenceRef.current;
    const entriesBefore = Array.isArray(entriesRef.current) ? entriesRef.current.length : 0;
    let entriesAfter = entriesBefore;
    let responseMeta = null;
    setGlobalSyncState(formId, true, background);
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
      let result;
      let retryAttempt = 0;
      while (true) {
        try {
          result = await dataStore.listEntries(formId, {
            lastSyncedAt: forceFullSync ? null : lastSyncedAtRef.current,
            lastSpreadsheetReadAt: forceFullSync ? null : lastSpreadsheetReadAtRef.current,
            forceFullSync,
          });
          break;
        } catch (error) {
          const canRetry = shouldRetryListReadError(error) && retryAttempt < READ_RETRY_MAX_ATTEMPTS;
          if (!canRetry) throw error;
          retryAttempt += 1;
          logSearchBackground("fetch:retry", {
            background,
            reason,
            forceFullSync,
            requestToken,
            attempt: retryAttempt,
            retryInMs: READ_RETRY_INTERVAL_MS,
            error: error?.message || String(error),
          });
          await wait(READ_RETRY_INTERVAL_MS);
        }
      }
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
      const shouldKeepExistingEntries = result?.unchanged === true;
      entriesAfter = shouldKeepExistingEntries ? entriesBefore : fetchedEntries.length;
      const resultUnsyncedCount = Number(result.unsyncedCount) || 0;
      const syncedAt = result.lastSyncedAt || Date.now();
      const nextLastSpreadsheetReadAt = result.lastSpreadsheetReadAt || null;
      setHasUnsynced(!!result.hasUnsynced);
      setUnsyncedCount(resultUnsyncedCount);
      setWaitingForLock(false);
      responseMeta = {
        isDelta: result?.isDelta === true,
        unchanged: shouldKeepExistingEntries,
        fetchedCount: Number.isFinite(result?.fetchedCount) ? result.fetchedCount : fetchedEntries.length,
        allIdsCount: Number.isFinite(result?.allIdsCount) ? result.allIdsCount : null,
        sheetLastUpdatedAt: Number.isFinite(result?.sheetLastUpdatedAt) ? result.sheetLastUpdatedAt : 0,
        nextLastSpreadsheetReadAt,
      };
      logSearchBackground("fetch:response", {
        background,
        reason,
        requestToken,
        entriesBefore,
        syncSequence,
        entriesAfter,
        ...responseMeta,
      });
      if (!shouldKeepExistingEntries) {
        setEntries(fetchedEntries);
      }
      if (!shouldKeepExistingEntries && Array.isArray(result.headerMatrix)) {
        setHeaderMatrix(result.headerMatrix);
      }
      setLastSyncedAt(syncedAt);
      setLastSpreadsheetReadAt(nextLastSpreadsheetReadAt);
      setCacheDisabled(false);
      setUseCache(false);
      updateGlobalMeta(formId, {
        hasUnsynced: !!result.hasUnsynced,
        unsyncedCount: resultUnsyncedCount,
        waitingForLock: false,
        lastSyncedAt: syncedAt,
        lastSpreadsheetReadAt: nextLastSpreadsheetReadAt,
        useCache: false,
        cacheDisabled: false,
      });
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
        syncSequence,
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
      setGlobalSyncState(formId, false, background);
    }
  }, [entriesRef, form?.schemaHash, formId, logSearchBackground, showAlert]);

  const refreshFormsIfNeeded = useRefreshFormsIfNeeded(refreshForms, loadingForms);

  const handleOperation = useCallback(async ({ source }) => {
    if (!formId) return;
    const operationSyncToken = ++operationSyncTokenRef.current;

    try {
      let cache = await getRecordsFromCache(formId);
      const unsyncedState = getUnsyncedState(cache);
      const schemaMismatch = cache.schemaHash && form?.schemaHash && cache.schemaHash !== form.schemaHash;
      const hasCache = (cache.entries || []).length > 0 && !schemaMismatch;
      const decision = evaluateCacheForRecords({
        lastSyncedAt: cache.lastSyncedAt,
        hasData: hasCache,
      });
      const nowMs = Date.now();
      const reachedSyncInterval = nowMs > (unsyncedState.cacheLastServerReadAt + SYNC_INTERVAL_MS);
      const cachedServerModifiedAt = Number(cache.serverModifiedAt) || 0;
      const shouldSyncByServerModifiedAt = cachedServerModifiedAt <= 0 || cachedServerModifiedAt > unsyncedState.cacheLastServerReadAt;
      logSearchBackground("operation:decision", {
        source,
        hasCache,
        lastSyncedAt: cache.lastSyncedAt,
        lastSpreadsheetReadAt: cache.lastSpreadsheetReadAt,
        shouldSync: decision.shouldSync,
        shouldBackground: decision.shouldBackground,
        isFresh: decision.isFresh,
        hasUnsynced: unsyncedState.hasUnsynced,
        unsyncedCount: unsyncedState.unsyncedCount,
        unsyncedMaxModifiedAt: unsyncedState.unsyncedMaxModifiedAt,
        reachedSyncInterval,
        shouldSyncByServerModifiedAt,
      });


      if (unsyncedState.hasUnsynced) {
        let attempt = 0;
        while (true) {
          if (operationSyncToken !== operationSyncTokenRef.current) {
            logSearchBackground("operation:sync-cancelled-by-new-operation", {
              source,
              attempt,
            });
            break;
          }

          const currentUnsyncedState = getUnsyncedState(cache);
          if (!currentUnsyncedState.hasUnsynced) {
            logSearchBackground("operation:sync-skip-no-unsynced", {
              source,
              attempt,
            });
            break;
          }

          let syncError = null;
          logSearchBackground("operation:sync-unsynced", {
            source,
            attempt,
            unsyncedCount: currentUnsyncedState.unsyncedCount,
          });
          const synced = await fetchAndCacheData({
            background: false,
            reason: `operation:${source}:unsynced-sync`,
            onError: (error) => {
              syncError = error;
            },
          });
          if (synced) break;

          const canRetry = canRetryOperationSync(syncError) && attempt < WRITE_RETRY_MAX_ATTEMPTS;
          if (!canRetry) {
            logSearchBackground("operation:sync-unsynced-error", {
              source,
              attempt,
              error: syncError?.message || String(syncError),
            });
            break;
          }

          attempt += 1;
          logSearchBackground("operation:sync-unsynced-retry", {
            source,
            attempt,
            retryInMs: WRITE_RETRY_INTERVAL_MS,
            error: syncError?.message || String(syncError),
          });
          const retryWaitBaselineSequence = syncStartSequenceRef.current;
          await wait(WRITE_RETRY_INTERVAL_MS);
          if (syncStartSequenceRef.current !== retryWaitBaselineSequence) {
            logSearchBackground("operation:sync-cancelled-by-other-sync", {
              source,
              attempt,
            });
            break;
          }
          cache = await getRecordsFromCache(formId);
          const retriedUnsyncedState = getUnsyncedState(cache);
          if (retriedUnsyncedState.unsyncedMaxModifiedAt > unsyncedState.unsyncedMaxModifiedAt) {
            logSearchBackground("operation:sync-cancelled-by-new-mutation", {
              source,
              previousUnsyncedMaxModifiedAt: unsyncedState.unsyncedMaxModifiedAt,
              nextUnsyncedMaxModifiedAt: retriedUnsyncedState.unsyncedMaxModifiedAt,
            });
            break;
          }
        }
      } else if (!decision.isFresh) {
        if (decision.shouldSync && reachedSyncInterval && shouldSyncByServerModifiedAt) {
          logSearchBackground("operation:sync", { source, reason: `operation:${source}:records-sync` });
          await fetchAndCacheData({ background: false, reason: `operation:${source}:records-sync` });
        } else if (decision.shouldBackground) {
          logSearchBackground("operation:background", { source, reason: `operation:${source}:records-background` });
          await fetchAndCacheData({ background: true, reason: `operation:${source}:records-background` });
        }
      }

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
    if (!formId) {
      initialFormsSyncDoneRef.current = false;
      setEntries([]);
      setHeaderMatrix([]);
      setLastSyncedAt(null);
      setLastSpreadsheetReadAt(null);
      setHasUnsynced(false);
      setUnsyncedCount(0);
      setUseCache(false);
      return;
    }

    const loadData = async () => {
      if (!initialFormsSyncDoneRef.current) {
        initialFormsSyncDoneRef.current = true;
        await refreshFormsIfNeeded("search-initial", "search-page:");
      }

      let cache = { entries: [], headerMatrix: [], lastSyncedAt: null, lastSpreadsheetReadAt: null };
      try {
        cache = await getRecordsFromCache(formId);
      } catch (error) {
        console.warn("[SearchPage] Failed to load cache:", error);
        setCacheDisabled(true);
        updateGlobalMeta(formId, { cacheDisabled: true });
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
      const { age, shouldSync, shouldBackground } = evaluateCacheForRecords({
        lastSyncedAt: cache.lastSyncedAt,
        hasData: hasCache,
        forceSync,
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
        const syncedAt = cache.lastSyncedAt || cache.cacheTimestamp || null;
        const sheetReadAt = cache.lastSpreadsheetReadAt || null;
        setEntries(cache.entries || []);
        setHeaderMatrix(cache.headerMatrix || []);
        setLastSyncedAt(syncedAt);
        setLastSpreadsheetReadAt(sheetReadAt);
        const { hasUnsynced: cachedHasUnsynced, unsyncedCount: nextUnsyncedCount } = getUnsyncedState(cache);
        setHasUnsynced(cachedHasUnsynced);
        setUnsyncedCount(nextUnsyncedCount);
        setUseCache(true);
        setCacheDisabled(false);
        updateGlobalMeta(formId, {
          hasUnsynced: cachedHasUnsynced,
          unsyncedCount: nextUnsyncedCount,
          waitingForLock: false,
          lastSyncedAt: syncedAt,
          lastSpreadsheetReadAt: sheetReadAt,
          useCache: true,
          cacheDisabled: false,
        });
        logSearchBackground("initial:cache-applied", {
          entryCount: (cache.entries || []).length,
          headerRows: (cache.headerMatrix || []).length,
          hasUnsynced: cachedHasUnsynced,
        });
      } else {
        setHasUnsynced(false);
        setUnsyncedCount(0);
        setUseCache(false);
        updateGlobalMeta(formId, {
          hasUnsynced: false,
          unsyncedCount: 0,
          useCache: false,
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
  }, [cacheDisabled, fetchAndCacheData, form?.schemaHash, formId, locationKey, locationState, logSearchBackground, refreshFormsIfNeeded, showAlert]);

  const runManualRefreshOnce = useCallback(async () => {
    if (!formId) return;

    // 検索結果画面の手動更新:
    // 1) ローカル保留操作の書き込み完了待ち
    // 2) forceFullSync で全件同期（シート正規化は行わない）
    // 3) 返却されたシート全件でキャッシュを完全置換
    logSearchBackground("manual-refresh:start", {
      reason: "manual:search-records",
      flow: "full-upload-sheet-cache-replace",
    });
    updateGlobalMeta(formId, { waitingForLock: false });
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
            flow: "full-upload-sheet-cache-replace",
          });
          await refreshForms({ reason: "manual:search-forms", background: false });
          logSearchBackground("manual-refresh:done", {
            reason: "manual:search-forms",
            flow: "full-upload-sheet-cache-replace",
          });
          return;
        }

        if (fetchError?.code === GAS_ERROR_CODE_LOCK_TIMEOUT) {
          if (!lockTimeoutDetected) {
            lockTimeoutDetected = true;
            setWaitingForLock(true);
            updateGlobalMeta(formId, { waitingForLock: true });
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
      if (lockTimeoutDetected) {
        setWaitingForLock(false);
        updateGlobalMeta(formId, { waitingForLock: false });
      }
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

  const reloadFromCache = useCallback(async () => {
    if (!formId) {
      setEntries([]);
      setHeaderMatrix([]);
      setLastSyncedAt(null);
      setLastSpreadsheetReadAt(null);
      setHasUnsynced(false);
      setUnsyncedCount(0);
      setUseCache(false);
      return;
    }

    try {
      const cache = await getRecordsFromCache(formId);
      const syncedAt = cache.lastSyncedAt || cache.cacheTimestamp || null;
      const sheetReadAt = cache.lastSpreadsheetReadAt || null;
      setEntries(cache.entries || []);
      setHeaderMatrix(cache.headerMatrix || []);
      setLastSyncedAt(syncedAt);
      setLastSpreadsheetReadAt(sheetReadAt);
      const { hasUnsynced: cachedHasUnsynced, unsyncedCount: nextUnsyncedCount } = getUnsyncedState(cache);
      setHasUnsynced(cachedHasUnsynced);
      setUnsyncedCount(nextUnsyncedCount);
      setUseCache(true);
      setCacheDisabled(false);
      updateGlobalMeta(formId, {
        hasUnsynced: cachedHasUnsynced,
        unsyncedCount: nextUnsyncedCount,
        lastSyncedAt: syncedAt,
        lastSpreadsheetReadAt: sheetReadAt,
        useCache: true,
        cacheDisabled: false,
      });
    } catch (error) {
      console.warn("[SearchPage] Failed to reload cache:", error);
      setCacheDisabled(true);
      updateGlobalMeta(formId, { cacheDisabled: true });
    }
  }, [formId]);

  return {
    entries,
    hasUnsynced,
    unsyncedCount,
    headerMatrix,
    loading,
    backgroundLoading,
    waitingForLock,
    useCache,
    lastSyncedAt,
    cacheDisabled,
    fetchAndCacheData,
    forceRefreshAll,
    reloadFromCache,
  };
};
