import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { dataStore } from "./dataStore.js";
import { getFormsFromCache, saveFormsToCache } from "./formsCache.js";
import { useAuth } from "./authContext.jsx";
import {
  evaluateCache,
  FORM_CACHE_MAX_AGE_MS,
  FORM_CACHE_BACKGROUND_REFRESH_MS,
} from "./cachePolicy.js";
import { perfLogger } from "../../utils/perfLogger.js";
import { normalizeFormRecord } from "../../utils/formNormalize.js";

const AppDataContext = createContext(null);

/**
 * Helper to save forms cache with consistent error handling
 */
const saveCacheWithErrorHandling = async (forms, loadFailures, setCacheDisabled, propertyStoreMode, logPrefix = "saveCache") => {
  try {
    await saveFormsToCache(forms, loadFailures, propertyStoreMode);
    console.log(`[${logPrefix}] Cache updated`);
  } catch (err) {
    console.warn(`[${logPrefix}] Failed to update cache:`, err);
    setCacheDisabled(true);
  }
};
export function AppDataProvider({ children }) {
  const { propertyStoreMode } = useAuth();
  const propertyStoreModeRef = useRef(propertyStoreMode);

  const [forms, setForms] = useState([]);
  const [loadingForms, setLoadingForms] = useState(true);
  const [error, setError] = useState(null);
  const [loadFailures, setLoadFailures] = useState([]);
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const [cacheDisabled, setCacheDisabled] = useState(false);

  // キャッシュ更新用にformsとloadFailuresの最新値を保持
  const formsRef = useRef(forms);
  const loadFailuresRef = useRef(loadFailures);

  useEffect(() => {
    formsRef.current = forms;
  }, [forms]);

  useEffect(() => {
    loadFailuresRef.current = loadFailures;
  }, [loadFailures]);

  const refreshForms = useCallback(async ({ reason = "unknown", background = false } = {}) => {
    if (!background) {
      setLoadingForms(true);
    }
    setError(null);
    const startedAt = Date.now();
    perfLogger.logVerbose("forms", "refresh start", { reason, background, startedAt });

    try {
      const apiCallStart = Date.now();
      const result = await dataStore.listForms({ includeArchived: true });

      const apiCallEnd = Date.now();
      const apiCallDuration = apiCallEnd - apiCallStart;

      const allForms = result.forms || [];
      const failures = result.loadFailures || [];

      const averagePerForm = allForms.length > 0 ? Math.round(apiCallDuration / allForms.length) : 0;

      perfLogger.logVerbose("forms", "api call done", {
        apiDurationMs: apiCallDuration,
        count: allForms.length,
        avgPerFormMs: averagePerForm,
      });
      perfLogger.logFormGasRead(apiCallDuration, allForms.length);

      setForms(allForms);
      setLoadFailures(failures);
      const syncedAt = Date.now();
      setLastSyncedAt(syncedAt);

      try {
        const cacheStart = Date.now();
        await saveFormsToCache(allForms, failures, propertyStoreModeRef.current);
        const cacheDuration = Date.now() - cacheStart;
        perfLogger.logFormCacheSave(cacheDuration, allForms.length);
        setCacheDisabled(false);
        perfLogger.logVerbose("forms", "saved to cache", { cacheDurationMs: cacheDuration, count: allForms.length });
      } catch (cacheErr) {
        console.warn("[AppDataProvider] Failed to save to cache:", cacheErr);
        setCacheDisabled(true);
      }

      const finishedAt = Date.now();
      const totalDuration = finishedAt - startedAt;

      perfLogger.logVerbose("forms", "refresh timing", {
        totalDurationMs: totalDuration,
        apiSharePct: Math.round(apiCallDuration / totalDuration * 100),
      });
      perfLogger.logVerbose("forms", "refresh success", {
        reason,
        formCount: allForms.length,
        loadFailures: failures.length,
        finishedAt,
      });
    } catch (err) {
      console.error("[AppDataProvider] フォーム取得エラー:", err);
      setError(err.message || "フォームの取得に失敗しました");
      const finishedAt = Date.now();
      perfLogger.logVerbose("forms", "refresh fail", { reason, startedAt, finishedAt, error: err?.message });
    } finally {
      if (!background) {
        setLoadingForms(false);
      }
    }
  }, []);

  useEffect(() => {
    // 起動時の読み込みロジック
    (async () => {
      const startedAt = Date.now();
      console.log("[AppDataProvider] Startup - checking cache...");
      let cacheApplied = false;
      let cachedForms = [];
      let cachedFailures = [];
      let cacheLastSyncedAt = null;

      try {
        // 1. キャッシュから即座に表示
        const cacheResult = await getFormsFromCache();
        cachedForms = cacheResult.forms || [];
        cachedFailures = cacheResult.loadFailures || [];
        cacheLastSyncedAt = cacheResult.lastSyncedAt || cacheResult.cacheTimestamp || null;
        const cachedPropertyStoreMode = cacheResult.propertyStoreMode || "";
        const cacheAge = cacheLastSyncedAt ? Date.now() - cacheLastSyncedAt : null;
        const hasCachedData = cachedForms.length > 0 || cachedFailures.length > 0 || !!cacheLastSyncedAt;

        // プロパティ保存モードが変わった場合はキャッシュを無効化して強制再同期
        if (hasCachedData && cachedPropertyStoreMode !== propertyStoreModeRef.current) {
          console.log("[AppDataProvider] Property store mode changed; forcing fresh sync", {
            cachedMode: cachedPropertyStoreMode,
            currentMode: propertyStoreModeRef.current,
          });
          await refreshForms({ reason: "mode-changed", background: false });
          setLoadingForms(false);
          return;
        }

        if (hasCachedData) {
          console.log("[AppDataProvider] Loaded from cache:", cachedForms.length, "forms (age:", cacheAge, "ms)");
          perfLogger.logFormCacheHit(cacheAge || 0, cachedForms.length);
          setForms(cachedForms);
          setLoadFailures(cachedFailures);
          setLastSyncedAt(cacheLastSyncedAt);
          cacheApplied = true;
        }

        const { age: cacheAgeMs, shouldSync, shouldBackground } = evaluateCache({
          lastSyncedAt: cacheLastSyncedAt,
          hasData: hasCachedData,
          maxAgeMs: FORM_CACHE_MAX_AGE_MS,
          backgroundAgeMs: FORM_CACHE_BACKGROUND_REFRESH_MS,
        });

        perfLogger.logVerbose("forms", "cache check", {
          cacheAgeMs,
          cacheApplied,
          shouldSync,
          shouldBackground,
        });

        if (shouldSync) {
          console.log("[AppDataProvider] Cache stale or missing; fetching synchronously", { cacheAgeMs, cacheLastSyncedAt, hasCachedData });
          await refreshForms({ reason: "startup-sync", background: false });
          setLoadingForms(false);
          return;
        }

        // cache is fresh enough for sync, stop loading spinner
        setLoadingForms(false);

        if (shouldBackground) {
          console.log("[AppDataProvider] Cache is fresh enough; background refresh scheduled");
          refreshForms({ reason: "startup-background", background: true }).catch((err) => {
            console.error("[AppDataProvider] Background refresh error:", err);
            setError(err.message || "フォームの取得に失敗しました");
          });
        }

        const finishedAt = Date.now();
        console.log("[AppDataProvider] Startup complete in", finishedAt - startedAt, "ms");
      } catch (err) {
        console.error("[AppDataProvider] Startup error:", err);
        setError(err.message || "フォームの取得に失敗しました");
        setCacheDisabled(true);
      } finally {
        if (!cacheApplied) {
          setLoadingForms(false);
        }
      }
    })();
  }, []);

  // Helper to DRY up form state updates and cache saving
  const updateFormsAndCache = useCallback(async (updaterFn, nextFailures, logPrefix) => {
    let updatedForms;
    setForms((prev) => {
      updatedForms = updaterFn([...prev]);
      formsRef.current = updatedForms;
      return updatedForms;
    });
    setLoadFailures(nextFailures);
    loadFailuresRef.current = nextFailures;
    await saveCacheWithErrorHandling(updatedForms, nextFailures, setCacheDisabled, propertyStoreModeRef.current, logPrefix);
  }, []);

  const upsertFormsState = useCallback(async (nextForm) => {
    if (!nextForm || !nextForm.id) return;
    await updateFormsAndCache((next) => {
      const index = next.findIndex((form) => form.id === nextForm.id);
      if (index === -1) next.unshift(nextForm);
      else next[index] = nextForm;
      return next;
    }, loadFailuresRef.current, "upsertFormsState");
  }, [updateFormsAndCache]);

  const removeFormsState = useCallback(async (formIds) => {
    if (!Array.isArray(formIds) || formIds.length === 0) return;
    const targetIdSet = new Set(formIds.filter(Boolean));
    if (!targetIdSet.size) return;

    await updateFormsAndCache(
      (next) => next.filter((form) => !targetIdSet.has(form.id)),
      loadFailuresRef.current.filter((failure) => !targetIdSet.has(failure.id)),
      "removeFormsState"
    );
  }, [updateFormsAndCache]);

  const createForm = useCallback(async (payload, targetUrl, saveMode = "auto") => {
    const optimisticForm = normalizeFormRecord(payload, { preserveUnknownFields: true });
    await upsertFormsState(optimisticForm);

    void dataStore.createForm({ ...payload, id: optimisticForm.id, createdAt: optimisticForm.createdAt }, targetUrl, saveMode)
      .then(upsertFormsState)
      .catch((err) => console.error("[AppDataProvider] createForm failed:", err));

    return optimisticForm;
  }, [upsertFormsState]);

  const updateForm = useCallback(async (formId, updates, targetUrl, saveMode = "auto") => {
    const existing = formsRef.current.find((form) => form.id === formId) || {};
    const optimisticForm = normalizeFormRecord({
      ...existing,
      ...updates,
      id: formId,
      createdAt: existing.createdAt,
      createdAtUnixMs: existing.createdAtUnixMs,
    }, { fallbackId: formId, fallbackCreatedAt: existing.createdAt || existing.createdAtUnixMs, preserveUnknownFields: true });

    await upsertFormsState(optimisticForm);

    void dataStore.updateForm(formId, updates, targetUrl, saveMode)
      .then(upsertFormsState)
      .catch((err) => console.error("[AppDataProvider] updateForm failed:", err));

    return optimisticForm;
  }, [upsertFormsState]);

  const archiveForm = useCallback(async (formId) => {
    const existing = formsRef.current.find((form) => form.id === formId);
    if (existing) await upsertFormsState({ ...existing, archived: true });
    void dataStore.archiveForm(formId).then((res) => { if (res) upsertFormsState(res); });
    return existing ? { ...existing, archived: true } : null;
  }, [upsertFormsState]);

  const unarchiveForm = useCallback(async (formId) => {
    const existing = formsRef.current.find((form) => form.id === formId);
    if (existing) await upsertFormsState({ ...existing, archived: false });
    void dataStore.unarchiveForm(formId).then((res) => { if (res) upsertFormsState(res); });
    return existing ? { ...existing, archived: false } : null;
  }, [upsertFormsState]);

  const batchUpdateFormsState = useCallback(async (dataStoreFn, formIds, archived, logPrefix) => {
    const targetIds = Array.isArray(formIds) ? formIds.filter(Boolean) : [formIds].filter(Boolean);
    if (!targetIds.length) return { forms: [], updated: 0, errors: [] };

    const targetIdSet = new Set(targetIds);
    const optimisticForms = formsRef.current.filter((form) => targetIdSet.has(form.id)).map((form) => ({ ...form, archived }));

    if (optimisticForms.length > 0) {
      await updateFormsAndCache((next) => {
        optimisticForms.forEach((form) => {
          const index = next.findIndex((f) => f.id === form.id);
          if (index !== -1) next[index] = form;
        });
        return next;
      }, loadFailuresRef.current, `${logPrefix}:optimistic`);
    }

    void dataStoreFn(targetIds)
      .then(async (result) => {
        if (!result?.forms || !Array.isArray(result.forms) || result.forms.length === 0) return;
        await updateFormsAndCache((next) => {
          result.forms.forEach((form) => {
            const index = next.findIndex((f) => f.id === form.id);
            if (index !== -1) next[index] = form;
          });
          return next;
        }, loadFailuresRef.current, `${logPrefix}:background`);
      });

    return { forms: optimisticForms, updated: optimisticForms.length, errors: [] };
  }, [updateFormsAndCache]);

  const archiveForms = useCallback(
    (formIds) => batchUpdateFormsState(dataStore.archiveForms.bind(dataStore), formIds, true, "archiveForms"),
    [batchUpdateFormsState],
  );

  const unarchiveForms = useCallback(
    (formIds) => batchUpdateFormsState(dataStore.unarchiveForms.bind(dataStore), formIds, false, "unarchiveForms"),
    [batchUpdateFormsState],
  );

  const deleteForms = useCallback(async (formIds) => {
    await removeFormsState(formIds);

    void dataStore.deleteForms(formIds).catch((err) => {
      console.error("[AppDataProvider] Background deleteForms failed:", err);
    });
  }, [removeFormsState]);

  const deleteForm = useCallback((formId) => deleteForms([formId]), [deleteForms]);

  const importForms = useCallback(async (jsonList) => {
    const created = await dataStore.importForms(jsonList);
    if (Array.isArray(created)) {
      // 複数フォームを一括追加してキャッシュも1回だけ更新
      setForms((prev) => {
        const next = [...created, ...prev];

        // キャッシュ更新
        saveCacheWithErrorHandling(next, loadFailuresRef.current, setCacheDisabled, propertyStoreModeRef.current, "importForms");

        return next;
      });
    }
    return created;
  }, []);

  const exportForms = useCallback(async (formIds) => dataStore.exportForms(formIds), []);
  const getFormById = useCallback((formId) => forms.find((form) => form.id === formId) || null, [forms]);

  const registerImportedForm = useCallback(async (payload) => {
    const result = await dataStore.registerImportedForm(payload);
    if (result) {
      await upsertFormsState(result);
    }
    return result;
  }, [upsertFormsState]);

  const memoValue = useMemo(
    () => ({
      forms,
      loadFailures,
      loadingForms,
      error,
      lastSyncedAt,
      cacheDisabled,
      refreshForms,
      createForm,
      updateForm,
      archiveForm,
      unarchiveForm,
      archiveForms,
      unarchiveForms,
      deleteForms,
      deleteForm,
      importForms,
      exportForms,
      getFormById,
      registerImportedForm,
    }),
    [forms, loadFailures, loadingForms, error, lastSyncedAt, cacheDisabled, refreshForms, createForm, updateForm, archiveForm, unarchiveForm, archiveForms, unarchiveForms, deleteForms, deleteForm, importForms, exportForms, getFormById, registerImportedForm],
  );

  return <AppDataContext.Provider value={memoValue}>{children}</AppDataContext.Provider>;
}

export function useAppData() {
  const ctx = useContext(AppDataContext);
  if (!ctx) throw new Error("useAppData must be used within AppDataProvider");
  return ctx;
}
