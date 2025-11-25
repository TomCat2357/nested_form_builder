import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { dataStore } from "./dataStore.js";
import { getFormsFromCache, saveFormsToCache } from "./formsCache.js";

const AppDataContext = createContext(null);
const FORMS_CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000; // 12 hours

export function AppDataProvider({ children }) {
  const [forms, setForms] = useState([]);
  const [loadingForms, setLoadingForms] = useState(true);
  const [error, setError] = useState(null);
  const [loadFailures, setLoadFailures] = useState([]);

  // キャッシュ更新用にformsとloadFailuresの最新値を保持
  const formsRef = useRef(forms);
  const loadFailuresRef = useRef(loadFailures);

  useEffect(() => {
    formsRef.current = forms;
  }, [forms]);

  useEffect(() => {
    loadFailuresRef.current = loadFailures;
  }, [loadFailures]);

  const refreshForms = useCallback(async (source = "unknown") => {
    setLoadingForms(true);
    setError(null);
    // キャッシュからの初期表示時以外はリセットしない
    const startedAt = Date.now();
    console.log("[AppDataProvider] refreshForms start", { source, startedAt: new Date(startedAt).toISOString() });

    try {
      const apiCallStart = Date.now();
      const result = await dataStore.listForms({ includeArchived: true });

      const apiCallEnd = Date.now();
      const apiCallDuration = apiCallEnd - apiCallStart;

      const allForms = result.forms || [];
      const failures = result.loadFailures || [];

      const averagePerForm = allForms.length > 0 ? Math.round(apiCallDuration / allForms.length) : 0;

      console.log("[AppDataProvider] === Performance Summary ===");
      console.log("[AppDataProvider] API call duration:", apiCallDuration, "ms");
      console.log("[AppDataProvider] Forms received:", allForms.length);
      console.log("[AppDataProvider] Average per form:", averagePerForm, "ms");

      // 一括更新（順次追加は廃止）
      setForms(allForms);
      setLoadFailures(failures);

      // キャッシュに保存
      try {
        await saveFormsToCache(allForms, failures);
        console.log("[AppDataProvider] Saved to cache");
      } catch (cacheErr) {
        console.warn("[AppDataProvider] Failed to save to cache:", cacheErr);
      }

      const finishedAt = Date.now();
      const totalDuration = finishedAt - startedAt;

      console.log("[AppDataProvider] Total duration:", totalDuration, "ms");
      console.log("[AppDataProvider] API call:", Math.round(apiCallDuration / totalDuration * 100), "%");
      console.log("[AppDataProvider] refreshForms success", {
        source,
        startedAt: new Date(startedAt).toISOString(),
        finishedAt: new Date(finishedAt).toISOString(),
        formCount: allForms.length,
        loadFailures: failures.length,
      });
    } catch (err) {
      console.error("[AppDataProvider] フォーム取得エラー:", err);
      setError(err.message || "フォームの取得に失敗しました");
      const finishedAt = Date.now();
      console.log("[AppDataProvider] refreshForms fail", { source, startedAt: new Date(startedAt).toISOString(), finishedAt: new Date(finishedAt).toISOString(), error: err?.message });
    } finally {
      setLoadingForms(false);
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

      try {
        // 1. キャッシュから即座に表示
        const cacheResult = await getFormsFromCache();
        cachedForms = cacheResult.forms || [];
        cachedFailures = cacheResult.loadFailures || [];
        cacheTimestamp = cacheResult.cacheTimestamp || null;
        const cacheAge = cacheTimestamp ? Date.now() - cacheTimestamp : null;
        const hasCachedData = cachedForms.length > 0 || cachedFailures.length > 0 || !!cacheTimestamp;

        if (hasCachedData) {
          console.log("[AppDataProvider] Loaded from cache:", cachedForms.length, "forms (age:", cacheAge, "ms)");
          setForms(cachedForms);
          setLoadFailures(cachedFailures);
          cacheApplied = true;
        }

        const isCacheFresh = cacheTimestamp && cacheAge !== null && cacheAge < FORMS_CACHE_MAX_AGE_MS && cachedForms.length > 0;

        // 2. 12時間以上経過 or キャッシュなしなら同期取得
        if (!isCacheFresh) {
          console.log("[AppDataProvider] Cache stale or missing; fetching synchronously", { cacheAge, cacheTimestamp, hasCachedData });
          const apiStart = Date.now();
          const result = await dataStore.listForms({ includeArchived: true });
          const apiEnd = Date.now();
          const latestForms = result.forms || [];
          const latestFailures = result.loadFailures || [];

          setForms(latestForms);
          setLoadFailures(latestFailures);

          try {
            await saveFormsToCache(latestForms, latestFailures);
            console.log("[AppDataProvider] Saved to cache (sync refresh)");
          } catch (cacheErr) {
            console.warn("[AppDataProvider] Failed to save to cache (sync refresh):", cacheErr);
          }

          const finishedAt = Date.now();
          console.log("[AppDataProvider] Startup sync fetch complete", {
            duration: finishedAt - startedAt,
            apiDuration: apiEnd - apiStart,
            formCount: latestForms.length,
            loadFailures: latestFailures.length,
          });
          setLoadingForms(false);
          return;
        }

        // 3. キャッシュが新鮮なら即表示しつつバックグラウンドで差分チェック
        setLoadingForms(false);

        console.log("[AppDataProvider] Cache is fresh; fetching latest in background");
        const result = await dataStore.listForms({ includeArchived: true });
        const latestForms = result.forms || [];
        const latestFailures = result.loadFailures || [];

        const hasChanges = JSON.stringify(latestForms) !== JSON.stringify(cachedForms) ||
                          JSON.stringify(latestFailures) !== JSON.stringify(cachedFailures);

        if (hasChanges) {
          console.log("[AppDataProvider] Detected changes; updating state and cache");
          setForms(latestForms);
          setLoadFailures(latestFailures);

          try {
            await saveFormsToCache(latestForms, latestFailures);
            console.log("[AppDataProvider] Saved to cache (background refresh)");
          } catch (cacheErr) {
            console.warn("[AppDataProvider] Failed to save to cache (background refresh):", cacheErr);
          }
        } else {
          console.log("[AppDataProvider] No changes detected after background fetch");
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
    return result;
  }, [upsertFormsState]);

  const updateForm = useCallback(async (formId, updates, targetUrl) => {
    const result = await dataStore.updateForm(formId, updates, targetUrl);
    upsertFormsState(result);
    return result;
  }, [upsertFormsState]);

  const archiveForm = useCallback(async (formId) => {
    const result = await dataStore.archiveForm(formId);
    upsertFormsState(result);
    return result;
  }, [upsertFormsState]);

  const unarchiveForm = useCallback(async (formId) => {
    const result = await dataStore.unarchiveForm(formId);
    upsertFormsState(result);
    return result;
  }, [upsertFormsState]);

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
    return result;
  }, []);

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
    return result;
  }, []);

  const deleteForms = useCallback(async (formIds) => {
    await dataStore.deleteForms(formIds);
    removeFormsState(formIds);
  }, [removeFormsState]);

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
    [forms, loadFailures, loadingForms, error, refreshForms, createForm, updateForm, archiveForm, unarchiveForm, archiveForms, unarchiveForms, deleteForms, deleteForm, importForms, exportForms, getFormById],
  );

  return <AppDataContext.Provider value={memoValue}>{children}</AppDataContext.Provider>;
}

export function useAppData() {
  const ctx = useContext(AppDataContext);
  if (!ctx) throw new Error("useAppData must be used within AppDataProvider");
  return ctx;
}
