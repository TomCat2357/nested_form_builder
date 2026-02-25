import { useCallback, useEffect, useRef, useState } from "react";
import { useLatestRef } from "../../app/hooks/useLatestRef.js";
import { useOperationCacheTrigger } from "../../app/hooks/useOperationCacheTrigger.js";
import { useAppData } from "../../app/state/AppDataProvider.jsx";
import { dataStore } from "../../app/state/dataStore.js";
import { getFormsFromCache } from "../../app/state/formsCache.js";
import { saveRecordsToCache, getRecordsFromCache } from "../../app/state/recordsCache.js";
import {
  evaluateCache,
  RECORD_CACHE_BACKGROUND_REFRESH_MS,
  RECORD_CACHE_MAX_AGE_MS,
  FORM_CACHE_BACKGROUND_REFRESH_MS,
  FORM_CACHE_MAX_AGE_MS,
} from "../../app/state/cachePolicy.js";
import { perfLogger } from "../../utils/perfLogger.js";

const defaultAlert = { showAlert: (message) => console.warn("[useEntriesWithCache]", message) };

const shouldForceSync = (locationState) => {
  if (!locationState || typeof locationState !== "object") return false;
  return locationState.saved === true || locationState.deleted === true || locationState.created === true;
};

const hasFormsCacheData = (cache) => {
  const formCount = Array.isArray(cache?.forms) ? cache.forms.length : 0;
  const failureCount = Array.isArray(cache?.loadFailures) ? cache.loadFailures.length : 0;
  return formCount > 0 || failureCount > 0 || !!cache?.lastSyncedAt;
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
  const loadingFormsRef = useLatestRef(loadingForms);

  const fetchAndCacheData = useCallback(async ({ background = false, forceFullSync = false, reason = "unknown" } = {}) => {
    if (!formId) return;
    if (background && backgroundLoadingRef.current) return;

    if (!background) {
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
      const fetchedEntries = result.entries || result || [];
      setEntries(fetchedEntries);
      setHeaderMatrix(result.headerMatrix || []);
      const syncedAt = result.lastSyncedAt || Date.now();
      setLastSyncedAt(syncedAt);

      try {
        await saveRecordsToCache(formId, fetchedEntries, result.headerMatrix || [], { schemaHash: form?.schemaHash });
        setCacheDisabled(false);
      } catch (cacheErr) {
        console.warn("[SearchPage] Failed to save records cache:", cacheErr);
        setCacheDisabled(true);
      }
      setUseCache(false);
    } catch (error) {
      console.error("[SearchPage] Failed to fetch and cache data:", error);
      showAlert(`データの取得に失敗しました: ${error.message || error}`);
    } finally {
      const finishedAt = Date.now();
      perfLogger.logVerbose("search", "fetch done", {
        formId,
        background,
        reason,
        forceFullSync,
        durationMs: finishedAt - startedAt,
      });
      if (!background) {
        setLoading(false);
      } else {
        backgroundLoadingRef.current = false;
        setBackgroundLoading(false);
      }
    }
  }, [form?.schemaHash, formId, showAlert]);

  const refreshFormsIfNeeded = useCallback(async (source = "unknown") => {
    let formsCache = { forms: [], loadFailures: [], lastSyncedAt: null };
    try {
      formsCache = await getFormsFromCache();
    } catch (error) {
      console.warn("[SearchPage] Failed to load forms cache:", error);
    }

    const decision = evaluateCache({
      lastSyncedAt: formsCache.lastSyncedAt,
      hasData: hasFormsCacheData(formsCache),
      maxAgeMs: FORM_CACHE_MAX_AGE_MS,
      backgroundAgeMs: FORM_CACHE_BACKGROUND_REFRESH_MS,
    });

    if (decision.isFresh) return;
    if (loadingFormsRef.current) return;

    if (decision.shouldSync) {
      await refreshForms({ reason: `operation:${source}:forms-sync`, background: false });
      return;
    }

    if (decision.shouldBackground) {
      refreshForms({ reason: `operation:${source}:forms-background`, background: true }).catch((error) => {
        console.error("[SearchPage] forms background refresh failed:", error);
      });
    }
  }, [refreshForms]);

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
          showAlert(`データの取得に失敗しました: ${error.message || error}`);
        });
      }
    };

    loadData();
  }, [cacheDisabled, fetchAndCacheData, form?.schemaHash, formId, locationKey, locationState, showAlert]);

  const forceRefreshAll = useCallback(async () => {
    await Promise.all([
      fetchAndCacheData({ background: false, forceFullSync: true, reason: "manual:search-records" }),
      refreshForms({ reason: "manual:search-forms", background: false }),
    ]);
  }, [fetchAndCacheData, refreshForms]);

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
