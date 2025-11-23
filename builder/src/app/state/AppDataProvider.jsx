import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { dataStore } from "./dataStore.js";

const AppDataContext = createContext(null);

export function AppDataProvider({ children }) {
  const [forms, setForms] = useState([]);
  const [loadingForms, setLoadingForms] = useState(true);
  const [error, setError] = useState(null);
  const [loadFailures, setLoadFailures] = useState([]);

  const refreshForms = useCallback(async (source = "unknown") => {
    setLoadingForms(true);
    setError(null);
    const startedAt = new Date().toISOString();
    console.log("[AppDataProvider] refreshForms start", { source, startedAt });
    try {
      const result = await dataStore.listForms({ includeArchived: true });
      setForms(result.forms || []);
      setLoadFailures(result.loadFailures || []);
      const finishedAt = new Date().toISOString();
      console.log("[AppDataProvider] refreshForms success", {
        source,
        startedAt,
        finishedAt,
        formCount: (result.forms || []).length,
        loadFailures: (result.loadFailures || []).length,
      });
    } catch (err) {
      console.error("[AppDataProvider] フォーム取得エラー:", err);
      setError(err.message || "フォームの取得に失敗しました");
      // エラー時は既存のフォームリストを保持（空配列に設定しない）
      const finishedAt = new Date().toISOString();
      console.log("[AppDataProvider] refreshForms fail", { source, startedAt, finishedAt, error: err?.message });
    } finally {
      setLoadingForms(false);
    }
  }, []);

  useEffect(() => {
    // 起動時にフォームを読み込む（Drive完全移行モードでは常にDriveから取得）
    refreshForms("startup");
  }, [refreshForms]);

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
      return next;
    });
  }, []);

  const removeFormsState = useCallback((formIds) => {
    if (!Array.isArray(formIds) || formIds.length === 0) return;
    setForms((prev) => prev.filter((form) => !formIds.includes(form.id)));
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

  const deleteForms = useCallback(async (formIds) => {
    await dataStore.deleteForms(formIds);
    removeFormsState(formIds);
  }, [removeFormsState]);

  const deleteForm = useCallback((formId) => deleteForms([formId]), [deleteForms]);

  const importForms = useCallback(async (jsonList) => {
    const created = await dataStore.importForms(jsonList);
    if (Array.isArray(created)) {
      created.forEach((form) => upsertFormsState(form));
    }
    return created;
  }, [upsertFormsState]);

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
      deleteForms,
      deleteForm,
      importForms,
      exportForms,
      getFormById,
    }),
    [forms, loadFailures, loadingForms, error, refreshForms, createForm, updateForm, archiveForm, unarchiveForm, deleteForms, deleteForm, importForms, exportForms, getFormById],
  );

  return <AppDataContext.Provider value={memoValue}>{children}</AppDataContext.Provider>;
}

export function useAppData() {
  const ctx = useContext(AppDataContext);
  if (!ctx) throw new Error("useAppData must be used within AppDataProvider");
  return ctx;
}
