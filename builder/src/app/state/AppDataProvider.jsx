import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { dataStore } from "./dataStore.js";
import { getFormsFromCache, saveFormsToCache } from "./formsCache.js";
import {
  evaluateCache,
  FORM_CACHE_MAX_AGE_MS,
  FORM_CACHE_BACKGROUND_REFRESH_MS,
} from "./cachePolicy.js";
import { perfLogger } from "../../utils/perfLogger.js";
import { computeSchemaHash } from "../../core/schema.js";
import { collectDisplayFieldSettings } from "../../utils/formPaths.js";
import { omitThemeSetting } from "../../utils/settings.js";
import { genId } from "../../core/ids.js";

const AppDataContext = createContext(null);

const buildOptimisticForm = (source = {}, { fallbackId = genId(), fallbackCreatedAt = Date.now() } = {}) => {
  const schema = Array.isArray(source.schema) ? source.schema : [];
  const displayFieldSettings = collectDisplayFieldSettings(schema);
  const createdAt = Number.isFinite(source.createdAt)
    ? source.createdAt
    : (Number.isFinite(source.createdAtUnixMs) ? source.createdAtUnixMs : fallbackCreatedAt);
  const settings = omitThemeSetting(source.settings || {});
  if (!settings.formTitle) {
    settings.formTitle = source.name || "無題のフォーム";
  }

  return {
    ...source,
    id: source.id || fallbackId,
    description: source.description || "",
    schema,
    settings,
    schemaHash: computeSchemaHash(schema),
    displayFieldSettings,
    importantFields: displayFieldSettings.map((item) => item.path),
    createdAt,
    createdAtUnixMs: createdAt,
    modifiedAt: Date.now(),
    modifiedAtUnixMs: Date.now(),
    archived: !!source.archived,
    schemaVersion: Number.isFinite(source.schemaVersion) ? source.schemaVersion : 1,
  };
};

/**
 * Helper to save forms cache with consistent error handling
 */
const saveCacheWithErrorHandling = async (forms, loadFailures, setCacheDisabled, logPrefix = "saveCache") => {
  try {
    await saveFormsToCache(forms, loadFailures);
    console.log(`[${logPrefix}] Cache updated`);
  } catch (err) {
    console.warn(`[${logPrefix}] Failed to update cache:`, err);
    setCacheDisabled(true);
  }
};
export function AppDataProvider({ children }) {
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
    console.log("[perf][forms] refresh start", { reason, background, startedAt });

    try {
      const apiCallStart = Date.now();
      const result = await dataStore.listForms({ includeArchived: true });

      const apiCallEnd = Date.now();
      const apiCallDuration = apiCallEnd - apiCallStart;

      const allForms = result.forms || [];
      const failures = result.loadFailures || [];

      const averagePerForm = allForms.length > 0 ? Math.round(apiCallDuration / allForms.length) : 0;

      console.log("[perf][forms] api duration ms:", apiCallDuration, "count:", allForms.length, "avg_per_form:", averagePerForm);
      perfLogger.logFormGasRead(apiCallDuration, allForms.length);

      setForms(allForms);
      setLoadFailures(failures);
      const syncedAt = Date.now();
      setLastSyncedAt(syncedAt);

      try {
        const cacheStart = Date.now();
        await saveFormsToCache(allForms, failures);
        const cacheDuration = Date.now() - cacheStart;
        perfLogger.logFormCacheSave(cacheDuration, allForms.length);
        setCacheDisabled(false);
        console.log("[perf][forms] saved to cache");
      } catch (cacheErr) {
        console.warn("[AppDataProvider] Failed to save to cache:", cacheErr);
        setCacheDisabled(true);
      }

      const finishedAt = Date.now();
      const totalDuration = finishedAt - startedAt;

      console.log("[perf][forms] total ms:", totalDuration, "api_share_pct:", Math.round(apiCallDuration / totalDuration * 100));
      console.log("[perf][forms] refresh success", { reason, formCount: allForms.length, loadFailures: failures.length, finishedAt });
    } catch (err) {
      console.error("[AppDataProvider] フォーム取得エラー:", err);
      setError(err.message || "フォームの取得に失敗しました");
      const finishedAt = Date.now();
      console.log("[perf][forms] refresh fail", { reason, startedAt, finishedAt, error: err?.message });
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
        const cacheAge = cacheLastSyncedAt ? Date.now() - cacheLastSyncedAt : null;
        const hasCachedData = cachedForms.length > 0 || cachedFailures.length > 0 || !!cacheLastSyncedAt;

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

        console.log("[perf][forms] cache check", { cacheAgeMs, cacheApplied, shouldSync, shouldBackground });

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

  const upsertFormsState = useCallback(async (nextForm) => {
    if (!nextForm || !nextForm.id) return;
    let updatedForms;
    setForms((prev) => {
      const next = prev.slice();
      const index = next.findIndex((form) => form.id === nextForm.id);
      if (index === -1) {
        next.unshift(nextForm);
      } else {
        next[index] = nextForm;
      }
      updatedForms = next;
      return next;
    });

    // キャッシュ更新の完了を待つ
    await saveCacheWithErrorHandling(updatedForms, loadFailuresRef.current, setCacheDisabled, "upsertFormsState");
  }, []);

  const removeFormsState = useCallback(async (formIds) => {
    if (!Array.isArray(formIds) || formIds.length === 0) return;
    const targetIdSet = new Set(formIds.filter(Boolean));
    if (!targetIdSet.size) return;

    const nextForms = formsRef.current.filter((form) => !targetIdSet.has(form.id));
    const nextLoadFailures = loadFailuresRef.current.filter((failure) => !targetIdSet.has(failure.id));

    setForms(nextForms);
    setLoadFailures(nextLoadFailures);

    formsRef.current = nextForms;
    loadFailuresRef.current = nextLoadFailures;

    // キャッシュ更新の完了を待つ
    await saveCacheWithErrorHandling(nextForms, nextLoadFailures, setCacheDisabled, "removeFormsState");
  }, []);

  const createForm = useCallback(async (payload, targetUrl) => {
    const optimisticForm = buildOptimisticForm(payload);
    await upsertFormsState(optimisticForm);

    void dataStore.createForm({ ...payload, id: optimisticForm.id, createdAt: optimisticForm.createdAt }, targetUrl)
      .then((savedForm) => upsertFormsState(savedForm))
      .catch((err) => {
        console.error("[AppDataProvider] Background createForm failed:", err);
      });

    return optimisticForm;
  }, [upsertFormsState]);

  const updateForm = useCallback(async (formId, updates, targetUrl) => {
    const existing = formsRef.current.find((form) => form.id === formId) || {};
    const optimisticForm = buildOptimisticForm({
      ...existing,
      ...updates,
      id: formId,
      createdAt: existing.createdAt,
      createdAtUnixMs: existing.createdAtUnixMs,
    }, {
      fallbackId: formId,
      fallbackCreatedAt: existing.createdAt || Date.now(),
    });

    await upsertFormsState(optimisticForm);

    void dataStore.updateForm(formId, updates, targetUrl)
      .then((savedForm) => upsertFormsState(savedForm))
      .catch((err) => {
        console.error("[AppDataProvider] Background updateForm failed:", err);
      });

    return optimisticForm;
  }, [upsertFormsState]);

  const archiveForm = useCallback(async (formId) => {
    const result = await dataStore.archiveForm(formId);
    await upsertFormsState(result);
    return result;
  }, [upsertFormsState]);

  const unarchiveForm = useCallback(async (formId) => {
    const result = await dataStore.unarchiveForm(formId);
    await upsertFormsState(result);
    return result;
  }, [upsertFormsState]);

  const batchUpdateFormsState = useCallback(async (dataStoreFn, formIds, logPrefix) => {
    const result = await dataStoreFn(formIds);
    if (result.forms && Array.isArray(result.forms)) {
      // 複数フォームを一括更新してキャッシュも1回だけ更新
      let updatedForms;
      setForms((prev) => {
        const next = prev.slice();
        result.forms.forEach((form) => {
          const index = next.findIndex((f) => f.id === form.id);
          if (index !== -1) {
            next[index] = form;
          }
        });
        updatedForms = next;
        return next;
      });

      // キャッシュ更新の完了を待つ
      await saveCacheWithErrorHandling(updatedForms, loadFailuresRef.current, setCacheDisabled, logPrefix);
    }
    return result;
  }, []);

  const archiveForms = useCallback(
    (formIds) => batchUpdateFormsState(dataStore.archiveForms.bind(dataStore), formIds, "archiveForms"),
    [batchUpdateFormsState],
  );

  const unarchiveForms = useCallback(
    (formIds) => batchUpdateFormsState(dataStore.unarchiveForms.bind(dataStore), formIds, "unarchiveForms"),
    [batchUpdateFormsState],
  );

  const deleteForms = useCallback(async (formIds) => {
    await dataStore.deleteForms(formIds);
    await removeFormsState(formIds);
  }, [removeFormsState]);

  const deleteForm = useCallback((formId) => deleteForms([formId]), [deleteForms]);

  const importForms = useCallback(async (jsonList) => {
    const created = await dataStore.importForms(jsonList);
    if (Array.isArray(created)) {
      // 複数フォームを一括追加してキャッシュも1回だけ更新
      setForms((prev) => {
        const next = [...created, ...prev];

        // キャッシュ更新
        saveCacheWithErrorHandling(next, loadFailuresRef.current, setCacheDisabled, "importForms");

        return next;
      });
    }
    return created;
  }, []);

  const exportForms = useCallback(async (formIds) => dataStore.exportForms(formIds), []);
  const getFormById = useCallback((formId) => forms.find((form) => form.id === formId) || null, [forms]);

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
    }),
    [forms, loadFailures, loadingForms, error, lastSyncedAt, cacheDisabled, refreshForms, createForm, updateForm, archiveForm, unarchiveForm, archiveForms, unarchiveForms, deleteForms, deleteForm, importForms, exportForms, getFormById],
  );

  return <AppDataContext.Provider value={memoValue}>{children}</AppDataContext.Provider>;
}

export function useAppData() {
  const ctx = useContext(AppDataContext);
  if (!ctx) throw new Error("useAppData must be used within AppDataProvider");
  return ctx;
}
