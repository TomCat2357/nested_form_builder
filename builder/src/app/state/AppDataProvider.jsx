import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { dataStore } from "./dataStore.js";
import { debugGetMapping } from "../../services/gasClient.js";

const AppDataContext = createContext(null);

export function AppDataProvider({ children }) {
  const [forms, setForms] = useState([]);
  const [loadingForms, setLoadingForms] = useState(true);
  const [error, setError] = useState(null);
  const [loadFailures, setLoadFailures] = useState([]);

  const refreshForms = useCallback(async () => {
    setLoadingForms(true);
    setError(null);
    try {
      // Debug: PropertiesServiceのマッピングを取得して出力
      try {
        const debugResult = await debugGetMapping();
        console.log("[DEBUG] PropertiesService Mapping:", debugResult);
        console.log("[DEBUG] Raw JSON:", debugResult.rawJson);
        console.log("[DEBUG] Mapping object:", JSON.stringify(debugResult.mapping, null, 2));
        console.log("[DEBUG] Total forms in mapping:", debugResult.totalForms);
        console.log("[DEBUG] Legacy info:", JSON.stringify(debugResult.legacyInfo, null, 2));
      } catch (debugErr) {
        console.warn("[DEBUG] Failed to get mapping:", debugErr);
      }

      const result = await dataStore.listForms({ includeArchived: true });
      setForms(result.forms || []);
      setLoadFailures(result.loadFailures || []);
    } catch (err) {
      console.error("[AppDataProvider] フォーム取得エラー:", err);
      setError(err.message || "フォームの取得に失敗しました");
      // エラー時は既存のフォームリストを保持（空配列に設定しない）
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

  const deleteForms = useCallback(
    createOperationWithRefresh((formIds) => dataStore.deleteForms(formIds)),
    [createOperationWithRefresh],
  );

  const deleteForm = useCallback(
    (formId) => deleteForms([formId]),
    [deleteForms],
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
