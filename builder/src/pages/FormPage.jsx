import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toErrorMessage } from "../utils/errorMessage.js";
import { useLatestRef } from "../app/hooks/useLatestRef.js";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import AppLayout from "../app/components/AppLayout.jsx";
import PreviewPage from "../features/preview/PreviewPage.jsx";
import FormPageDialogs from "./FormPageDialogs.jsx";
import FormPageSidebar from "./FormPageSidebar.jsx";
import { useAppData } from "../app/state/AppDataProvider.jsx";
import { hasDirtyChanges } from "../utils/responses.js";
import { isPlainObject } from "../utils/objectShape.js";
import { useAlert } from "../app/hooks/useAlert.js";
import { useConfirmDialog } from "../app/hooks/useConfirmDialog.js";
import { useBeforeUnloadGuard } from "../app/hooks/useBeforeUnloadGuard.js";
import { normalizeSchemaIDs } from "../core/schema.js";
import { useOperationCacheTrigger } from "../app/hooks/useOperationCacheTrigger.js";
import { useEditLock } from "../app/hooks/useEditLock.js";
import { useRefreshFormsIfNeeded } from "../app/hooks/useRefreshFormsIfNeeded.js";
import { useAuth } from "../app/state/authContext.jsx";
import { useApplyTheme } from "../app/hooks/useApplyTheme.js";
import SearchToolbar from "../features/search/components/SearchToolbar.jsx";
import { useEntries } from "../features/search/useEntries.js";
import {
  buildFieldPathsMap,
  resolveOmitEmptyRowsOnPrint,
} from "../features/preview/printDocument.js";
import { buildPrimarySaveOptions } from "../utils/settings.js";
import {
  areDriveFolderStatesMapsEqual,
  createEmptyDriveFolderState,
  createEmptyDriveFolderStates,
  hasAnyConfiguredDriveFolder,
  markDriveFolderForDeletion,
  setDriveFolderStateForField,
} from "../utils/driveFolderState.js";
import { fallbackForForm } from "./formPageHelpers.js";
import { performFormPageSave, DriveFolderFinalizeError } from "./formPageSaveHandler.js";
import { performFormPageEntryLoad } from "./formPageEntryLoader.js";
import { performFormPagePrintDocument } from "./formPagePrintHandler.js";
import {
  performFormPageNavigateBack,
  performFormPageOperationCacheCheck,
  performFormPageTriggerSave,
  performFormPageConfirmEntryAction,
  performFormPageFetchCopySource,
  performFormPageConfirmRecordCopy,
} from "./formPageActionHandlers.js";
import {
  runApplyEntryToState,
  runApplyOrDeferSyncedEntry,
  runCancelEditAndRestoreLatest,
  runCommitResponses,
  runDiscardUnsavedUploadedFiles,
  runUpdateDriveFolderStateFromPrint,
} from "./formPageStateMutators.js";

export default function FormPage() {
  const { formId, entryId } = useParams();
  const { getFormById, refreshForms, loadingForms, forms } = useAppData();
  const {
    userName,
    userEmail,
    userAffiliation,
    userTitle,
    userPhone,
    isAdmin,
    formId: sharedFormId,
    recordId: sharedRecordId,
  } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { showAlert, showToast, showOutputAlert } = useAlert();
  const currentForm = formId ? getFormById(formId) : null;
  const [cachedForm, setCachedForm] = useState(currentForm);

  const form = cachedForm;
  const normalizedSchema = useMemo(() => normalizeSchemaIDs(form?.schema || []), [form]);
  const [entry, setEntry] = useState(null);
  const [recordNoInput, setRecordNoInput] = useState("");
  const [loading, setLoading] = useState(true);

  const draftKey = `nfb_draft_${formId}_${entryId || "new"}`;
  const driveFolderDraftKey = `nfb_draft_folder_${formId}_${entryId || "new"}`;

  const [responses, setResponses] = useState(() => {
    try {
      if (!entryId) {
        const saved = sessionStorage.getItem(draftKey);
        if (saved) return JSON.parse(saved);
      }
    } catch(e) {}
    return {};
  });

  useEffect(() => {
    if (!entryId) {
      try {
        sessionStorage.setItem(draftKey, JSON.stringify(responses));
      } catch(e) {}
    }
  }, [responses, draftKey, entryId]);
  const [driveFolderStates, setDriveFolderStates] = useState(() => {
    if (entryId) return createEmptyDriveFolderStates();
    try {
      const saved = sessionStorage.getItem(driveFolderDraftKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (isPlainObject(parsed)) {
          const next = {};
          for (const [fid, v] of Object.entries(parsed)) {
            next[fid] = normalizeDriveFolderState(v);
          }
          return next;
        }
      }
    } catch (e) {}
    return createEmptyDriveFolderStates();
  });

  useEffect(() => {
    if (entryId) return;
    try {
      const saved = sessionStorage.getItem(driveFolderDraftKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (isPlainObject(parsed)) {
          const next = {};
          for (const [fid, v] of Object.entries(parsed)) {
            next[fid] = normalizeDriveFolderState(v);
          }
          setDriveFolderStates(next);
          return;
        }
      }
      setDriveFolderStates(createEmptyDriveFolderStates());
    } catch (e) {
      setDriveFolderStates(createEmptyDriveFolderStates());
    }
  }, [driveFolderDraftKey, entryId]);

  useEffect(() => {
    if (!entryId) {
      try {
        sessionStorage.setItem(driveFolderDraftKey, JSON.stringify(driveFolderStates));
      } catch (e) {}
    }
  }, [driveFolderDraftKey, driveFolderStates, entryId]);
  const [currentRecordId, setCurrentRecordId] = useState(entryId || null);

  const unsavedDialog = useConfirmDialog({ intent: null });
  const [isSaving, setIsSaving] = useState(false);
  const [isCreatingPrintDocument, setIsCreatingPrintDocument] = useState(false);
  const [mode, setMode] = useState(entryId ? "view" : "edit");
  const [isReloading, setIsReloading] = useState(false);
  const entryActionDialog = useConfirmDialog({ action: null });
  const driveFolderDialog = useConfirmDialog({ fieldId: "" });
  const unlinkFolderDialog = useConfirmDialog({ errorMessage: "" });
  const pendingUnlinkSaveRef = useRef(null);
  // formLink でコピー予約された子レコード複製タスク（保存後に実行）。{ sourceRecordId, links }。
  const pendingChildRecordCopyRef = useRef(null);
  const [copySourceId, setCopySourceId] = useState("");
  const [copySourceResponses, setCopySourceResponses] = useState({});
  const [copySourceRecordId, setCopySourceRecordId] = useState("");
  const [isCopyDialogOpen, setIsCopyDialogOpen] = useState(false);
  const [isCopySourceLoading, setIsCopySourceLoading] = useState(false);
  const { isReadLocked, withReadLock } = useEditLock();
  const {
    hasUnsynced,
    unsyncedCount,
    loading: listLoading,
    backgroundLoading: listBackgroundLoading,
    waitingForLock,
    useCache,
    lastSyncedAt,
    cacheDisabled,
    reloadFromCache: reloadListFromCache,
  } = useEntries({
    formId,
    form,
    locationKey: location.key,
    locationState: location.state,
    showAlert,
  });

  const initialResponsesRef = useRef({});
  const initialDriveFolderStatesRef = useRef(createEmptyDriveFolderStates());
  const previewRef = useRef(null);
  const newEntryInitKeyRef = useRef(null);
  const responseMutationSeqRef = useRef(0);
  const formLoadedStateRef = useRef(null);
  const pendingSyncedEntryRef = useRef(null);
  const isDirectRecordMode = sharedFormId === formId && sharedRecordId !== "" && sharedRecordId === entryId;
  // URL で formid を固定して開いた（スコープ）状態。管理者如何に関わらず、戻る先はそのフォームの
  // 絞り込み一覧（/search?form=X）に限定し、メイン画面へは決して戻さない。
  const isFormScoped = sharedFormId !== "" && sharedFormId === formId;

  const fallbackPath = useMemo(() => fallbackForForm(formId, location.state), [formId, location.state]);
  const omitEmptyRowsOnPrint = resolveOmitEmptyRowsOnPrint(form?.settings);
  const fieldPaths = useMemo(() => buildFieldPathsMap(normalizedSchema), [normalizedSchema]);
  const primarySaveOptions = useMemo(
    () => (isDirectRecordMode ? { stayAsView: true } : buildPrimarySaveOptions(form?.settings)),
    [form?.settings?.saveAfterAction, isDirectRecordMode],
  );

  useApplyTheme(form?.settings?.theme, { enabled: !!form });

  const entryIds = location.state?.entryIds || [];
  const currentIndex = entryId ? entryIds.indexOf(entryId) : -1;
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex >= 0 && currentIndex < entryIds.length - 1;
  const loadingRef = useLatestRef(loading);
  const reloadingRef = useLatestRef(isReloading);
  const savingRef = useLatestRef(isSaving);
  const readLockRef = useLatestRef(isReadLocked);
  const loadingFormsRef = useLatestRef(loadingForms);
  const responsesRef = useLatestRef(responses);
  const entryRef = useLatestRef(entry);
  const driveFolderStatesRef = useLatestRef(driveFolderStates);

  useEffect(() => {
    if (form?.readOnly) {
      setMode("view");
      return;
    }
    setMode(entryId ? "view" : "edit");
  }, [entryId, form?.readOnly]);

  const isViewMode = mode === "view";
  const isFormReadOnly = !!form?.readOnly;
  const canCopyFromExistingRecord = !entryId && !isViewMode && !isFormReadOnly;
  const isDriveFolderDirty = useMemo(
    () => !areDriveFolderStatesMapsEqual(initialDriveFolderStatesRef.current, driveFolderStates),
    [driveFolderStates],
  );
  const isDirty = useMemo(
    () => hasDirtyChanges(initialResponsesRef.current, responses) || isDriveFolderDirty,
    [isDriveFolderDirty, responses],
  );
  const canDeleteDriveFolder = useMemo(
    () => hasAnyConfiguredDriveFolder(driveFolderStates),
    [driveFolderStates],
  );
  const updateFieldDriveFolderState = useCallback((fieldId, updater) => {
    if (!fieldId) return;
    setDriveFolderStates((prev) => setDriveFolderStateForField(prev, fieldId, updater));
  }, []);
  const isDirtyRef = useLatestRef(isDirty);
  const isViewModeRef = useLatestRef(isViewMode);
  const normalizedSchemaRef = useLatestRef(normalizedSchema);
  const userNameRef = useLatestRef(userName);
  const userEmailRef = useLatestRef(userEmail);
  const userAffiliationRef = useLatestRef(userAffiliation);
  const userTitleRef = useLatestRef(userTitle);
  const userPhoneRef = useLatestRef(userPhone);

  useEffect(() => {
    if (!currentForm) return;
    if (cachedForm && isDirty && !isViewMode) {
      console.log("[FormPage] defer applying refreshed form during dirty edit", {
        formId,
        entryId: entryId || "new",
      });
      return;
    }
    setCachedForm(currentForm);
  }, [cachedForm, currentForm, entryId, formId, isDirty, isViewMode]);

  useEffect(() => {
    if (entryId) {
      newEntryInitKeyRef.current = null;
    }
  }, [entryId, formId]);

  const isFormLoaded = !!form;
  useEffect(() => {
    if (formLoadedStateRef.current === null) {
      formLoadedStateRef.current = isFormLoaded;
      return;
    }
    if (formLoadedStateRef.current !== isFormLoaded) {
      console.log("[FormPage] isFormLoaded changed", {
        formId,
        entryId: entryId || "new",
        from: formLoadedStateRef.current,
        to: isFormLoaded,
        loadingForms: loadingFormsRef.current,
      });
      formLoadedStateRef.current = isFormLoaded;
    }
  }, [isFormLoaded, formId, entryId, loadingFormsRef]);

  const topLevelFieldMap = useMemo(() => {
    var map = {};
    (normalizedSchema || []).forEach((field) => {
      const id = typeof field?.id === "string" ? field.id.trim() : "";
      if (!id) return;
      map[id] = field;
    });
    return map;
  }, [normalizedSchema]);

  const commitResponses = useCallback((source, updater, { forceLog = false, meta = null } = {}) => (
    runCommitResponses(setResponses, { source, updater, forceLog, meta }, {
      responseMutationSeqRef, formId, entryId, isDirtyRef, isViewModeRef,
    })
  ), [entryId, formId, isDirtyRef, isViewModeRef]);

  const applyEntryToState = useCallback((nextEntry, fallbackEntryId = null, source = "unknown") => (
    runApplyEntryToState(nextEntry, fallbackEntryId, source, {
      normalizedSchemaRef, responsesRef, formId, entryId, isDirtyRef, isViewModeRef,
      initialResponsesRef, initialDriveFolderStatesRef,
      setEntry, setRecordNoInput, setDriveFolderStates, setCurrentRecordId,
      commitResponses,
    })
  ), [commitResponses, entryId, formId, isDirtyRef, isViewModeRef, normalizedSchemaRef, responsesRef]);
  const applyEntryToStateRef = useLatestRef(applyEntryToState);

  const updateDriveFolderStateFromPrintResult = useCallback((result) => (
    runUpdateDriveFolderStateFromPrint(result, { normalizedSchemaRef, updateFieldDriveFolderState })
  ), [normalizedSchemaRef, updateFieldDriveFolderState]);

  const applyOrDeferSyncedEntry = useCallback((nextEntry, source = "unknown") => (
    runApplyOrDeferSyncedEntry(nextEntry, source, {
      entryRef, formId, entryId, isViewModeRef, pendingSyncedEntryRef, applyEntryToStateRef,
    })
  ), [entryId, formId, entryRef, isViewModeRef]);

  const cancelEditAndRestoreLatest = useCallback(() => (
    runCancelEditAndRestoreLatest({
      formId, entryId, entryRef, pendingSyncedEntryRef,
      initialResponsesRef, initialDriveFolderStatesRef,
      applyEntryToState, commitResponses, setDriveFolderStates, setMode,
    })
  ), [applyEntryToState, commitResponses, entryId, entryRef, formId]);

  const clearNewEntryDraft = useCallback(() => {
    if (entryId) return;
    newEntryInitKeyRef.current = null;
    try { sessionStorage.removeItem(draftKey); } catch (_e) { /* ignore */ }
    try { sessionStorage.removeItem(driveFolderDraftKey); } catch (_e) { /* ignore */ }
  }, [draftKey, driveFolderDraftKey, entryId]);

  const discardUnsavedUploadedFiles = useCallback(() => (
    runDiscardUnsavedUploadedFiles({ driveFolderStatesRef })
  ), [driveFolderStatesRef]);

  const navigateToEntryById = useCallback((targetEntryId) => {
    clearNewEntryDraft();
    navigate(`/form/${formId}/entry/${targetEntryId}`, {
      state: { from: location.state?.from, entryIds },
      replace: true,
    });
  }, [clearNewEntryDraft, navigate, formId, location.state?.from, entryIds]);

  useEffect(() => {
    let mounted = true;
    const runtime = { getMounted: () => mounted };
    if (isFormLoaded) {
      void performFormPageEntryLoad(runtime, {
        formId,
        entryId,
        isFormLoaded,
        draftKey,
        responsesRef,
        isDirtyRef,
        normalizedSchemaRef,
        userNameRef,
        userEmailRef,
        userAffiliationRef,
        userTitleRef,
        userPhoneRef,
        newEntryInitKeyRef,
        initialResponsesRef,
        initialDriveFolderStatesRef,
        applyEntryToStateRef,
        applyOrDeferSyncedEntry,
        commitResponses,
        setDriveFolderStates,
        setLoading,
        setIsReloading,
      });
    }
    return () => {
      mounted = false;
    };
  }, [formId, entryId, isFormLoaded]);

  const refreshFormsIfNeeded = useRefreshFormsIfNeeded(refreshForms, loadingForms);

  const handleOperationCacheCheck = useCallback(({ source }) => (
    performFormPageOperationCacheCheck({ source }, {
      formId,
      entryId,
      loadingRef,
      reloadingRef,
      savingRef,
      readLockRef,
      isViewModeRef,
      isDirtyRef,
      responsesRef,
      applyOrDeferSyncedEntry,
      refreshFormsIfNeeded,
      setLoading,
      setIsReloading,
    })
  ), [applyOrDeferSyncedEntry, entryId, formId, refreshFormsIfNeeded]);

  useOperationCacheTrigger({
    enabled: Boolean(formId),
    onOperation: handleOperationCacheCheck,
  });

  useEffect(() => {
    reloadListFromCache();
  }, [formId]);

  useBeforeUnloadGuard(isDirty);

  const navigateBack = (args = {}) => performFormPageNavigateBack(args, {
    formId, entryId, isDirectRecordMode, isFormScoped, fallbackPath, location, navigate, clearNewEntryDraft,
  });

  const handleSaveToStore = ({ payload, responses: rawResponses, options = {} }) => (
    performFormPageSave(
      { payload, rawResponses, options },
      {
        form,
        entry,
        recordNoInput,
        normalizedSchema,
        fieldPaths,
        userEmail,
        draftKey,
        driveFolderDraftKey,
        driveFolderStatesRef,
        initialDriveFolderStatesRef,
        initialResponsesRef,
        pendingSyncedEntryRef,
        applyEntryToState,
        reloadListFromCache,
        setDriveFolderStates,
        setEntry,
        showAlert,
      },
    )
  );

  const triggerSave = (args = {}) => performFormPageTriggerSave(args, {
    form,
    formId,
    entryId,
    isReadLocked,
    isAdmin,
    currentRecordId,
    location,
    previewRef,
    pendingUnlinkSaveRef,
    pendingChildRecordCopyRef,
    unlinkFolderDialog,
    setIsSaving,
    setMode,
    navigate,
    navigateBack,
    showAlert,
    showToast,
  });

  const attemptLeave = (intent) => {
    if (isDirty) {
      unsavedDialog.open({ intent });
      return;
    }
    if (intent === "cancel-edit") {
      if (!entryId) {
        navigateBack();
        return;
      }
      void cancelEditAndRestoreLatest();
      return;
    }
    if (intent === "back" || intent === "cancel") {
      navigateBack();
      return;
    }
  };

  const handleEditMode = async () => {
    if (!formId || !entryId) return;
    if (loading || isReadLocked) {
      showAlert("データ読み取り中のため、読み取り完了までお待ちください。");
      return;
    }
    setMode("edit");
  };

  const handleBack = () => {
    if (isDirectRecordMode) return false;
    if (!isDirty) {
      navigateBack();
      return false;
    }
    unsavedDialog.open({ intent: "back" });
    return false;
  };

  const handleDeleteEntry = () => {
    entryActionDialog.open({ action: "delete" });
  };

  const handleUndeleteEntry = () => {
    entryActionDialog.open({ action: "undelete" });
  };

  const confirmEntryAction = useCallback(() => (
    performFormPageConfirmEntryAction({
      entryActionDialog,
      formId,
      entryId,
      userEmail,
      applyEntryToState,
      reloadListFromCache,
      navigateBack,
    })
  ), [entryActionDialog.state.action, formId, entryId, userEmail, applyEntryToState, reloadListFromCache]);

  const handleFetchCopySource = useCallback(() => (
    performFormPageFetchCopySource({
      formId,
      copySourceId,
      isAdmin,
      normalizedSchema,
      showAlert,
      setIsCopySourceLoading,
      setCopySourceResponses,
      setCopySourceRecordId,
      setIsCopyDialogOpen,
    })
  ), [copySourceId, formId, isAdmin, normalizedSchema, showAlert]);

  const handleConfirmRecordCopy = useCallback((selectedFieldIds) => (
    performFormPageConfirmRecordCopy(selectedFieldIds, {
      topLevelFieldMap,
      copySourceResponses,
      copySourceRecordId,
      pendingChildRecordCopyRef,
      commitResponses,
      setIsCopyDialogOpen,
      showAlert,
      showToast,
    })
  ), [copySourceResponses, copySourceRecordId, showAlert, showToast, topLevelFieldMap]);

  const handleResponsesChange = useCallback((updater) => {
    commitResponses("preview:change", updater);
  }, [commitResponses]);

  const handleDeleteDriveFolder = useCallback(() => {
    const fieldId = driveFolderDialog.state.fieldId;
    if (fieldId) {
      updateFieldDriveFolderState(fieldId, (prev) => markDriveFolderForDeletion(prev));
    }
    driveFolderDialog.close();
  }, [driveFolderDialog, updateFieldDriveFolderState]);

  const handleConfirmUnlinkFolder = useCallback(async () => {
    unlinkFolderDialog.close();
    const savedOptions = pendingUnlinkSaveRef.current;
    pendingUnlinkSaveRef.current = null;
    if (savedOptions) {
      await triggerSave({ ...savedOptions, unlinkDriveFolder: true });
    }
  }, [triggerSave]);

  const handleCancelUnlinkFolder = useCallback(() => {
    unlinkFolderDialog.close();
    pendingUnlinkSaveRef.current = null;
  }, []);

  const handleCreatePrintDocument = useCallback(() => (
    performFormPagePrintDocument({
      previewRef,
      form,
      entry,
      normalizedSchema,
      fieldPaths,
      omitEmptyRowsOnPrint,
      responsesRef,
      driveFolderStatesRef,
      setIsCreatingPrintDocument,
      showAlert,
      showOutputAlert,
    })
  ), [entry, fieldPaths, form?.id, form?.settings, normalizedSchema, omitEmptyRowsOnPrint, showAlert, showOutputAlert]);

  if (!form) {
    return (
      <AppLayout themeOverride={form?.settings?.theme} title="フォーム" fallbackPath="/">
        <p className="nf-text-subtle">フォームが見つかりません。メイン画面からやり直してください。</p>
      </AppLayout>
    );
  }

  const navigateToEntry = (targetEntryId) => {
    if (isDirty) {
      setConfirmState({ open: true, intent: `navigate:${targetEntryId}` });
      return;
    }
    navigateToEntryById(targetEntryId);
  };

  const handleConfirmAction = async (action) => {
    const intent = unsavedDialog.state.intent;
    unsavedDialog.reset();
    if (action === "discard") {
      try {
        await discardUnsavedUploadedFiles();
      } catch (error) {
        showAlert(`未保存アップロードファイルの削除に失敗しました: ${toErrorMessage(error)}`);
        return;
      }
      if (intent === "cancel-edit") {
        if (!entryId) {
          navigateBack();
          return;
        }
        await cancelEditAndRestoreLatest();
        return;
      }
      if (intent && intent.startsWith("navigate:")) {
        const targetEntryId = intent.slice("navigate:".length);
        navigateToEntryById(targetEntryId);
      } else {
        navigateBack();
      }
      return;
    }
    if (action === "save") {
      if (intent && intent.startsWith("navigate:")) {
        const targetEntryId = intent.slice("navigate:".length);
        const saveResult = await triggerSave();
        if (saveResult.ok) navigateToEntryById(targetEntryId);
      } else {
        await triggerSave({ redirect: true });
      }
    }
  };

  const confirmOptions = [
    {
      label: "保存して続行",
      value: "save",
      variant: "primary",
      onSelect: () => handleConfirmAction("save"),
    },
    {
      label: "保存せずに戻る",
      value: "discard",
      onSelect: () => handleConfirmAction("discard"),
    },
    {
      label: "キャンセル",
      value: "cancel",
      onSelect: unsavedDialog.reset,
    },
  ];

  const confirmMessage = unsavedDialog.state.intent === "cancel-edit"
    ? "保存せずに編集内容を破棄しますか？"
    : (unsavedDialog.state.intent && unsavedDialog.state.intent.startsWith("navigate:")
      ? "保存せずに移動しますか？"
      : "保存せずに前の画面へ戻りますか？");
  const editDisabled = loading || isReadLocked || isFormReadOnly;

  return (
      <AppLayout themeOverride={form?.settings?.theme}       title={`${form.settings?.formTitle || "(無題)"} - フォーム入力`}
      fallbackPath={fallbackPath}
      onBack={handleBack}
      backHidden={true}
      badge={{
        label: (loading || isReloading) ? "読み取り中..." : (isFormReadOnly ? "参照のみ" : (isViewMode ? "閲覧モード" : "編集モード")),
        variant: (loading || isReloading) ? "loading" : (isFormReadOnly ? "view" : (isViewMode ? "view" : "edit"))
      }}
      sidebarActions={
        <FormPageSidebar
          isViewMode={isViewMode}
          isDirectRecordMode={isDirectRecordMode}
          isFormReadOnly={isFormReadOnly}
          isReadLocked={isReadLocked}
          isSaving={isSaving}
          isAdmin={isAdmin}
          isCreatingPrintDocument={isCreatingPrintDocument}
          isCopySourceLoading={isCopySourceLoading}
          loading={loading}
          editDisabled={editDisabled}
          entry={entry}
          entryId={entryId}
          entryIds={entryIds}
          currentIndex={currentIndex}
          hasPrev={hasPrev}
          hasNext={hasNext}
          canCopyFromExistingRecord={canCopyFromExistingRecord}
          copySourceId={copySourceId}
          primarySaveOptions={primarySaveOptions}
          normalizedSchema={normalizedSchema}
          responses={responses}
          handleEditMode={handleEditMode}
          navigateBack={navigateBack}
          triggerSave={triggerSave}
          attemptLeave={attemptLeave}
          handleCreatePrintDocument={handleCreatePrintDocument}
          handleUndeleteEntry={handleUndeleteEntry}
          handleDeleteEntry={handleDeleteEntry}
          handleFetchCopySource={handleFetchCopySource}
          navigateToEntry={navigateToEntry}
          setCopySourceId={setCopySourceId}
        />
      }
    >
      <SearchToolbar
        showSearch={false}
        lastSyncedAt={lastSyncedAt}
        useCache={useCache}
        cacheDisabled={cacheDisabled}
        backgroundLoading={listBackgroundLoading}
        lockWaiting={waitingForLock}
        hasUnsynced={hasUnsynced}
        unsyncedCount={unsyncedCount}
        syncInProgress={listLoading || listBackgroundLoading || waitingForLock}
      />
      {loading ? (
        <p className="nf-text-subtle">読み込み中...</p>
      ) : (
        <PreviewPage
          ref={previewRef}
          schema={normalizedSchema}
          responses={responses}
          setResponses={handleResponsesChange}
          isAdmin={isAdmin}
          settings={{
            ...(form.settings || {}),
            formId: form.id,
            recordId: currentRecordId,
            recordNo: recordNoInput,
            modifiedAt: entry?.modifiedAt,
            modifiedAtUnixMs: entry?.modifiedAtUnixMs,
            driveFileUrl: form?.driveFileUrl || "",
            userName,
            userEmail,
            userAffiliation,
            userTitle,
            userPhone,
          }}
          onRecordNoChange={setRecordNoInput}
          onSave={handleSaveToStore}
          showOutputJson={false}
          showSaveButton={false}
          readOnly={isViewMode || isReadLocked || isFormReadOnly}
          entryId={currentRecordId}
          driveFolderStates={driveFolderStates}
          onFieldDriveFolderStateChange={updateFieldDriveFolderState}
          canDeleteDriveFolder={!isViewMode && canDeleteDriveFolder}
          onDeleteDriveFolder={(fieldId) => driveFolderDialog.open({ fieldId: fieldId || "" })}
        />
      )}

      <FormPageDialogs
        unsavedDialog={unsavedDialog}
        confirmMessage={confirmMessage}
        confirmOptions={confirmOptions}
        entryActionDialog={entryActionDialog}
        confirmEntryAction={confirmEntryAction}
        driveFolderDialog={driveFolderDialog}
        handleDeleteDriveFolder={handleDeleteDriveFolder}
        unlinkFolderDialog={unlinkFolderDialog}
        handleConfirmUnlinkFolder={handleConfirmUnlinkFolder}
        handleCancelUnlinkFolder={handleCancelUnlinkFolder}
        isCopyDialogOpen={isCopyDialogOpen}
        normalizedSchema={normalizedSchema}
        copySourceResponses={copySourceResponses}
        handleConfirmRecordCopy={handleConfirmRecordCopy}
        setIsCopyDialogOpen={setIsCopyDialogOpen}
      />
    </AppLayout>
  );
}
