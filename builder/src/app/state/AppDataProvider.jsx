import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { dataStore, syncFromDrive } from "./dataStore.js";

const AppDataContext = createContext(null);

export function AppDataProvider({ children }) {
  const [forms, setForms] = useState([]);
  const [loadingForms, setLoadingForms] = useState(true);
  const [error, setError] = useState(null);

  const refreshForms = useCallback(async () => {
    setLoadingForms(true);
    setError(null);
    try {
      const list = await dataStore.listForms({ includeArchived: true });
      setForms(list);
    } catch (err) {
      console.error("[AppDataProvider] フォーム取得エラー:", err);
      setError(err.message || "フォームの取得に失敗しました");
      setForms([]); // エラー時は空配列
    } finally {
      setLoadingForms(false);
    }
  }, []);

  useEffect(() => {
    // 起動時にフォームを読み込む（Drive完全移行モードでは常にDriveから取得）
    refreshForms();
  }, [refreshForms]);

  const createOperationWithRefresh = useCallback(
    (operation) => async (...args) => {
      const result = await operation(...args);
      await refreshForms();
      return result;
    },
    [refreshForms],
  );

  const createForm = useCallback(
    createOperationWithRefresh((payload, targetUrl) => dataStore.createForm(payload, targetUrl)),
    [createOperationWithRefresh],
  );

  const updateForm = useCallback(
    createOperationWithRefresh((formId, updates, targetUrl) => dataStore.updateForm(formId, updates, targetUrl)),
    [createOperationWithRefresh],
  );

  const archiveForm = useCallback(
    createOperationWithRefresh((formId) => dataStore.archiveForm(formId)),
    [createOperationWithRefresh],
  );

  const unarchiveForm = useCallback(
    createOperationWithRefresh((formId) => dataStore.unarchiveForm(formId)),
    [createOperationWithRefresh],
  );

  const deleteForm = useCallback(
    createOperationWithRefresh((formId) => dataStore.deleteForm(formId)),
    [createOperationWithRefresh],
  );

  const importForms = useCallback(
    createOperationWithRefresh((jsonList) => dataStore.importForms(jsonList)),
    [createOperationWithRefresh],
  );

  const exportForms = useCallback(async (formIds) => dataStore.exportForms(formIds), []);
  const getFormById = useCallback((formId) => forms.find((form) => form.id === formId) || null, [forms]);

  const memoValue = useMemo(
    () => ({
      forms,
      loadingForms,
      error,
      refreshForms,
      createForm,
      updateForm,
      archiveForm,
      unarchiveForm,
      deleteForm,
      importForms,
      exportForms,
      getFormById,
    }),
    [forms, loadingForms, error, refreshForms, createForm, updateForm, archiveForm, unarchiveForm, deleteForm, importForms, exportForms, getFormById],
  );

  return <AppDataContext.Provider value={memoValue}>{children}</AppDataContext.Provider>;
}

export function useAppData() {
  const ctx = useContext(AppDataContext);
  if (!ctx) throw new Error("useAppData must be used within AppDataProvider");
  return ctx;
}
