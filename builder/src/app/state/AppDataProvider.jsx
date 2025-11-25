import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { dataStore } from "./dataStore.js";
import { getFormsFromCache, saveFormsToCache } from "./formsCache.js";

const AppDataContext = createContext(null);
const FORMS_CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000; // 12 hours
const FORMS_BACKGROUND_REFRESH_MS = 5 * 60 * 1000; // 5 minutes

export function AppDataProvider({ children }) {
  const [forms, setForms] = useState([]);
  const [loadingForms, setLoadingForms] = useState(true);
  const [error, setError] = useState(null);
  const [loadFailures, setLoadFailures] = useState([]);
  const [lastReloadedAt, setLastReloadedAt] = useState(null);

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

      setForms(allForms);
      setLoadFailures(failures);
      setLastReloadedAt(Date.now());

      try {
        await saveFormsToCache(allForms, failures);
        console.log("[perf][forms] saved to cache");
      } catch (cacheErr) {
        console.warn("[AppDataProvider] Failed to save to cache:", cacheErr);
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
      let cacheTimestamp = null;
      let cacheLastReloaded = null;

      try {
        // 1. キャッシュから即座に表示
        const cacheResult = await getFormsFromCache();
        cachedForms = cacheResult.forms || [];
        cachedFailures = cacheResult.loadFailures || [];
        cacheTimestamp = cacheResult.cacheTimestamp || null;
        cacheLastReloaded = cacheResult.lastReloadedAt || cacheTimestamp || null;
        const cacheAge = cacheTimestamp ? Date.now() - cacheTimestamp : null;
        const hasCachedData = cachedForms.length > 0 || cachedFailures.length > 0 || !!cacheTimestamp;

        if (hasCachedData) {
          console.log("[AppDataProvider] Loaded from cache:", cachedForms.length, "forms (age:", cacheAge, "ms)");
          setForms(cachedForms);
          setLoadFailures(cachedFailures);
          setLastReloadedAt(cacheLastReloaded);
          cacheApplied = true;
        }

        const cacheAgeMs = cacheLastReloaded ? Date.now() - cacheLastReloaded : Infinity;
        const shouldSync = !cacheApplied || cacheAgeMs >= FORMS_CACHE_MAX_AGE_MS;
        const shouldBackground = cacheApplied && cacheAgeMs >= FORMS_BACKGROUND_REFRESH_MS;

        console.log("[perf][forms] cache check", { cacheAgeMs, cacheApplied, shouldSync, shouldBackground });

        if (shouldSync) {
          console.log("[AppDataProvider] Cache stale or missing; fetching synchronously", { cacheAgeMs, cacheTimestamp, hasCachedData });
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
      } finally {
        if (!cacheApplied) {
          setLoadingForms(false);
        }
      }
    })();
  }, []);

  const upsertFormsState = useCallback((nextForm) => {
    if (!nextForm || !nextForm.id) return;
    setForms((prev) => {
      const next = prev.slice();
      const index = next.findIndex((form) => form.id === nextForm.id);
      if (index === -1) {
        next.unshift(nextForm);
      } else {
        next[index] = nextForm;
      }

      // キャッシュ更新（非同期だがawaitしない）
      saveFormsToCache(next, loadFailuresRef.current)
        .then(() => console.log("[upsertFormsState] Cache updated"))
        .catch((err) => console.warn("[upsertFormsState] Failed to update cache:", err));

      return next;
    });
  }, []);

  const removeFormsState = useCallback((formIds) => {
    if (!Array.isArray(formIds) || formIds.length === 0) return;
    setForms((prev) => {
      const next = prev.filter((form) => !formIds.includes(form.id));

      // キャッシュ更新（非同期だがawaitしない）
      saveFormsToCache(next, loadFailuresRef.current)
        .then(() => console.log("[removeFormsState] Cache updated"))
        .catch((err) => console.warn("[removeFormsState] Failed to update cache:", err));

      return next;
    });
  }, []);

  const createForm = useCallback(async (payload, targetUrl) => {
    const result = await dataStore.createForm(payload, targetUrl);
    upsertFormsState(result);
    await refreshForms({ reason: "create-form", background: false });
    return result;
  }, [upsertFormsState, refreshForms]);

  const updateForm = useCallback(async (formId, updates, targetUrl) => {
    const result = await dataStore.updateForm(formId, updates, targetUrl);
    upsertFormsState(result);
    await refreshForms({ reason: "update-form", background: false });
    return result;
  }, [upsertFormsState, refreshForms]);

  const archiveForm = useCallback(async (formId) => {
    const result = await dataStore.archiveForm(formId);
    upsertFormsState(result);
    await refreshForms({ reason: "archive-form", background: false });
    return result;
  }, [upsertFormsState, refreshForms]);

  const unarchiveForm = useCallback(async (formId) => {
    const result = await dataStore.unarchiveForm(formId);
    upsertFormsState(result);
    await refreshForms({ reason: "unarchive-form", background: false });
    return result;
  }, [upsertFormsState, refreshForms]);

  const archiveForms = useCallback(async (formIds) => {
    const result = await dataStore.archiveForms(formIds);
    if (result.forms && Array.isArray(result.forms)) {
      // 複数フォームを一括更新してキャッシュも1回だけ更新
      setForms((prev) => {
        const next = prev.slice();
        result.forms.forEach((form) => {
          const index = next.findIndex((f) => f.id === form.id);
          if (index !== -1) {
            next[index] = form;
          }
        });

        // キャッシュ更新
        saveFormsToCache(next, loadFailuresRef.current)
          .then(() => console.log("[archiveForms] Cache updated"))
          .catch((err) => console.warn("[archiveForms] Failed to update cache:", err));

        return next;
      });
    }
    await refreshForms({ reason: "archive-forms", background: false });
    return result;
  }, [refreshForms]);

  const unarchiveForms = useCallback(async (formIds) => {
    const result = await dataStore.unarchiveForms(formIds);
    if (result.forms && Array.isArray(result.forms)) {
      // 複数フォームを一括更新してキャッシュも1回だけ更新
      setForms((prev) => {
        const next = prev.slice();
        result.forms.forEach((form) => {
          const index = next.findIndex((f) => f.id === form.id);
          if (index !== -1) {
            next[index] = form;
          }
        });

        // キャッシュ更新
        saveFormsToCache(next, loadFailuresRef.current)
          .then(() => console.log("[unarchiveForms] Cache updated"))
          .catch((err) => console.warn("[unarchiveForms] Failed to update cache:", err));

        return next;
      });
    }
    await refreshForms({ reason: "unarchive-forms", background: false });
    return result;
  }, [refreshForms]);

  const deleteForms = useCallback(async (formIds) => {
    await dataStore.deleteForms(formIds);
    removeFormsState(formIds);
    await refreshForms({ reason: "delete-forms", background: false });
  }, [removeFormsState, refreshForms]);

  const deleteForm = useCallback((formId) => deleteForms([formId]), [deleteForms]);

  const importForms = useCallback(async (jsonList) => {
    const created = await dataStore.importForms(jsonList);
    if (Array.isArray(created)) {
      // 複数フォームを一括追加してキャッシュも1回だけ更新
      setForms((prev) => {
        const next = [...created, ...prev];

        // キャッシュ更新
        saveFormsToCache(next, loadFailuresRef.current)
          .then(() => console.log("[importForms] Cache updated"))
          .catch((err) => console.warn("[importForms] Failed to update cache:", err));

        return next;
      });
    }
    await refreshForms({ reason: "import-forms", background: false });
    return created;
  }, [refreshForms]);

  const exportForms = useCallback(async (formIds) => dataStore.exportForms(formIds), []);
  const getFormById = useCallback((formId) => forms.find((form) => form.id === formId) || null, [forms]);

  const memoValue = useMemo(
    () => ({
      forms,
      loadFailures,
      loadingForms,
      error,
      lastReloadedAt,
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
    [forms, loadFailures, loadingForms, error, lastReloadedAt, refreshForms, createForm, updateForm, archiveForm, unarchiveForm, archiveForms, unarchiveForms, deleteForms, deleteForm, importForms, exportForms, getFormById],
  );

  return <AppDataContext.Provider value={memoValue}>{children}</AppDataContext.Provider>;
}

export function useAppData() {
  const ctx = useContext(AppDataContext);
  if (!ctx) throw new Error("useAppData must be used within AppDataProvider");
  return ctx;
}
