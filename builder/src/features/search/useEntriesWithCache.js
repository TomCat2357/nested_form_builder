import { useCallback, useEffect, useState } from "react";
import { dataStore } from "../../app/state/dataStore.js";
import { saveRecordsToCache, getRecordsFromCache } from "../../app/state/recordsCache.js";
import {
  evaluateCache,
  RECORD_CACHE_BACKGROUND_REFRESH_MS,
  RECORD_CACHE_MAX_AGE_MS,
} from "../../app/state/cachePolicy.js";
import { perfLogger } from "../../utils/perfLogger.js";

const defaultAlert = { showAlert: (message) => console.warn("[useEntriesWithCache]", message) };

const shouldForceSync = (locationState) => {
  if (!locationState || typeof locationState !== "object") return false;
  return locationState.saved === true || locationState.deleted === true || locationState.created === true;
};

export const useEntriesWithCache = ({ formId, form, locationKey, locationState, showAlert = defaultAlert.showAlert }) => {
  const [entries, setEntries] = useState([]);
  const [headerMatrix, setHeaderMatrix] = useState([]);
  const [loading, setLoading] = useState(false);
  const [backgroundLoading, setBackgroundLoading] = useState(false);
  const [useCache, setUseCache] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const [cacheDisabled, setCacheDisabled] = useState(false);

  const fetchAndCacheData = useCallback(async ({ background = false, forceFullSync = false } = {}) => {
    if (!formId) return;
    if (!background) setLoading(true);
    else setBackgroundLoading(true);
    const startedAt = Date.now();

    try {
      const result = await dataStore.listEntries(formId, { 
        lastSyncedAt: forceFullSync ? null : lastSyncedAt, 
        forceFullSync 
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
      perfLogger.logVerbose("search", "fetch done", { formId, background, durationMs: finishedAt - startedAt });
      if (!background) setLoading(false);
      else setBackgroundLoading(false);
    }
  }, [formId, form, showAlert]);

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
        await fetchAndCacheData({ background: false });
        return;
      }

      if (shouldSync || shouldBackground) {
        fetchAndCacheData({ background: true }).catch((error) => {
          console.error("[SearchPage] background refresh failed:", error);
          showAlert(`データの取得に失敗しました: ${error.message || error}`);
        });
      }
    };

    loadData();
  }, [formId, locationKey, fetchAndCacheData, locationState, form, showAlert, cacheDisabled]);

  return {
    entries,
    headerMatrix,
    loading,
    backgroundLoading,
    useCache,
    lastSyncedAt,
    cacheDisabled,
    fetchAndCacheData,
  };
};
