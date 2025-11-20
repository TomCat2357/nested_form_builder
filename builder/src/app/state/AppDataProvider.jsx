import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { dataStore } from "./dataStore.js";

const AppDataContext = createContext(null);

export function AppDataProvider({ children }) {
  const [forms, setForms] = useState([]);
  const [loadingForms, setLoadingForms] = useState(true);

  const refreshForms = useCallback(async () => {
    setLoadingForms(true);
    const list = await dataStore.listForms({ includeArchived: true });
    setForms(list);
    setLoadingForms(false);
  }, []);

  useEffect(() => {
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
    [forms, loadingForms, refreshForms, createForm, updateForm, archiveForm, unarchiveForm, deleteForm, importForms, exportForms, getFormById],
  );

  return <AppDataContext.Provider value={memoValue}>{children}</AppDataContext.Provider>;
}

export function useAppData() {
  const ctx = useContext(AppDataContext);
  if (!ctx) throw new Error("useAppData must be used within AppDataProvider");
  return ctx;
}
