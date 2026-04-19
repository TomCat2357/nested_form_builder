import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLatestRef } from "../app/hooks/useLatestRef.js";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import AppLayout from "../app/components/AppLayout.jsx";
import ConfirmDialog from "../app/components/ConfirmDialog.jsx";
import PreviewPage from "../features/preview/PreviewPage.jsx";
import { useAppData } from "../app/state/AppDataProvider.jsx";
import { dataStore } from "../app/state/dataStore.js";
import { restoreResponsesFromData, hasDirtyChanges, collectDefaultNowResponses, collectFileUploadFolderUrls } from "../utils/responses.js";
import {
  acquireSaveLock,
  createRecordPrintDocument,
  finalizeRecordDriveFolder,
  hasScriptRun,
  submitResponses,
  trashDriveFilesByIds,
} from "../services/gasClient.js";
import { normalizeSpreadsheetId } from "../utils/spreadsheet.js";
import { useAlert } from "../app/hooks/useAlert.js";
import { useConfirmDialog } from "../app/hooks/useConfirmDialog.js";
import { useBeforeUnloadGuard } from "../app/hooks/useBeforeUnloadGuard.js";
import { normalizeSchemaIDs, collectFileUploadFields } from "../core/schema.js";
import { traverseSchema } from "../core/schemaUtils.js";
import { collectResponses as coreCollectResponses } from "../core/collect.js";
import { GAS_ERROR_CODE_LOCK_TIMEOUT } from "../core/constants.js";
import { useOperationCacheTrigger } from "../app/hooks/useOperationCacheTrigger.js";
import { useEditLock } from "../app/hooks/useEditLock.js";
import { getCachedEntryWithIndex } from "../app/state/recordsCache.js";
import {
  evaluateCacheForRecords,
  RECORD_CACHE_MAX_AGE_MS,
} from "../app/state/cachePolicy.js";
import { useRefreshFormsIfNeeded } from "../app/hooks/useRefreshFormsIfNeeded.js";
import { useAuth } from "../app/state/authContext.jsx";
import { useApplyTheme } from "../app/hooks/useApplyTheme.js";
import { perfLogger } from "../utils/perfLogger.js";
import SchemaMapNav from "../features/nav/SchemaMapNav.jsx";
import RecordCopyDialog from "../app/components/RecordCopyDialog.jsx";
import SearchToolbar from "../features/search/components/SearchToolbar.jsx";
import { useEntriesWithCache } from "../features/search/useEntriesWithCache.js";
import {
  buildFieldLabelsMap,
  buildFieldValuesMap,
  collectFileUploadMeta,
  resolveOmitEmptyRowsOnPrint,
} from "../features/preview/printDocument.js";
import { buildPrimarySaveOptions } from "../utils/settings.js";
import { resolveSharedPrintFileNameTemplate } from "../utils/printTemplateAction.js";
import {
  appendDriveFileId,
  areDriveFolderStatesMapsEqual,
  createEmptyDriveFolderState,
  createEmptyDriveFolderStates,
  hasAnyConfiguredDriveFolder,
  markDriveFolderForDeletion,
  normalizeDriveFileIds,
  normalizeDriveFolderState,
  resolveEffectiveDriveFolderUrl,
  setDriveFolderStateForField,
} from "../utils/driveFolderState.js";
import {
  fallbackForForm,
  toResponseObject,
  diffResponses,
  sampleKeys,
  toEntryVersion,
  pickLatestEntry,
  collectDriveFileIds,
  buildFolderUrlsByFieldFromStates,
} from "./formPageHelpers.js";

class DriveFolderFinalizeError extends Error {
  constructor(originalError) {
    super("drive_folder_finalize_failed");
    this.originalError = originalError;
  }
}

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
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
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
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
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
  const [copySourceId, setCopySourceId] = useState("");
  const [copySourceResponses, setCopySourceResponses] = useState({});
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
  } = useEntriesWithCache({
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

  const fallbackPath = useMemo(() => fallbackForForm(formId, location.state), [formId, location.state]);
  const omitEmptyRowsOnPrint = resolveOmitEmptyRowsOnPrint(form?.settings);
  const fieldLabels = useMemo(() => buildFieldLabelsMap(normalizedSchema), [normalizedSchema]);
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

  const commitResponses = useCallback((source, updater, { forceLog = false, meta = null } = {}) => {
    setResponses((prevState) => {
      const prev = toResponseObject(prevState);
      const rawNextState = typeof updater === "function" ? updater(prevState) : updater;
      const nextState = rawNextState === undefined || rawNextState === null ? {} : rawNextState;
      const next = toResponseObject(nextState);
      if (nextState === prevState) return prevState;

      const diff = diffResponses(prev, next);
      const shouldLog = forceLog || diff.removedKeys.length > 0 || diff.changedKeys.length > 6 || diff.addedKeys.length > 6;
      if (shouldLog) {
        responseMutationSeqRef.current += 1;
        if (process.env.NODE_ENV !== "production") console.log("[FormPage] responses mutated", {
          seq: responseMutationSeqRef.current,
          source,
          formId,
          entryId: entryId || "new",
          isDirty: isDirtyRef.current,
          isViewMode: isViewModeRef.current,
          prevCount: diff.prevCount,
          nextCount: diff.nextCount,
          addedCount: diff.addedKeys.length,
          removedCount: diff.removedKeys.length,
          changedCount: diff.changedKeys.length,
          addedKeys: sampleKeys(diff.addedKeys),
          removedKeys: sampleKeys(diff.removedKeys),
          changedKeys: sampleKeys(diff.changedKeys),
          ...(meta || {}),
        });
      }
      return nextState;
    });
  }, [entryId, formId, isDirtyRef, isViewModeRef]);

  const applyEntryToState = useCallback((nextEntry, fallbackEntryId = null, source = "unknown") => {
    const schema = normalizedSchemaRef.current;
    const restored = restoreResponsesFromData(schema, nextEntry?.data || {}, nextEntry?.dataUnixMs || {});
    const folderUrlsByField = collectFileUploadFolderUrls(schema, nextEntry?.data || {});
    const uploadFields = collectFileUploadFields(schema);
    const primaryFieldId = uploadFields[0]?.id || "";
    const primaryFolderUrl = nextEntry?.driveFolderUrl || "";
    const nextDriveFolderStates = {};
    uploadFields.forEach((field) => {
      const fid = field?.id;
      if (!fid) return;
      const folderUrl = folderUrlsByField[fid]
        || (fid === primaryFieldId ? primaryFolderUrl : "")
        || "";
      nextDriveFolderStates[fid] = normalizeDriveFolderState({
        resolvedUrl: folderUrl,
        inputUrl: folderUrl,
        autoCreated: false,
      });
    });
    const previous = responsesRef.current;
    const diff = diffResponses(previous, restored);
    const hasPotentialOverwrite = diff.removedKeys.length > 0 || diff.changedKeys.length > 6;
    if (hasPotentialOverwrite || source !== "save:new-entry") {
      if (process.env.NODE_ENV !== "production") console.log("[FormPage] applyEntryToState", {
        source,
        formId,
        entryId: entryId || "new",
        nextEntryId: nextEntry?.id || fallbackEntryId || null,
        isDirty: isDirtyRef.current,
        isViewMode: isViewModeRef.current,
        prevCount: diff.prevCount,
        nextCount: diff.nextCount,
        removedCount: diff.removedKeys.length,
        changedCount: diff.changedKeys.length,
      });
    }
    setEntry(nextEntry);
    setRecordNoInput(nextEntry?.["No."] === undefined || nextEntry?.["No."] === null ? "" : String(nextEntry["No."]));
    initialResponsesRef.current = restored;
    initialDriveFolderStatesRef.current = nextDriveFolderStates;
    setDriveFolderStates(nextDriveFolderStates);
    commitResponses(`applyEntryToState:${source}`, restored, {
      forceLog: true,
      meta: { nextEntryId: nextEntry?.id || fallbackEntryId || null },
    });
    setCurrentRecordId(nextEntry?.id || fallbackEntryId || null);
  }, [commitResponses, entryId, formId, isDirtyRef, isViewModeRef, normalizedSchemaRef, responsesRef]);
  const applyEntryToStateRef = useLatestRef(applyEntryToState);

  const updateDriveFolderStateFromPrintResult = useCallback((result) => {
    const schema = normalizedSchemaRef.current;
    const primaryFieldId = collectFileUploadFields(schema)[0]?.id || "";
    if (!primaryFieldId) return;
    updateFieldDriveFolderState(primaryFieldId, (prev) => {
      const currentEffectiveFolderUrl = resolveEffectiveDriveFolderUrl(prev);
      const nextResolvedUrl = typeof result?.folderUrl === "string" && result.folderUrl.trim()
        ? result.folderUrl.trim()
        : (currentEffectiveFolderUrl || prev.resolvedUrl);
      const keepAutoCreated = prev.autoCreated && prev.resolvedUrl.trim() && prev.resolvedUrl.trim() === nextResolvedUrl;
      return {
        ...prev,
        resolvedUrl: nextResolvedUrl,
        inputUrl: prev.inputUrl.trim() ? prev.inputUrl : nextResolvedUrl,
        autoCreated: keepAutoCreated || result?.autoCreated === true,
        pendingPrintFileIds: appendDriveFileId(prev.pendingPrintFileIds, result?.fileId),
      };
    });
  }, [normalizedSchemaRef, updateFieldDriveFolderState]);

  const applyOrDeferSyncedEntry = useCallback((nextEntry, source = "unknown") => {
    if (!nextEntry) return false;
    const currentVersion = toEntryVersion(entryRef.current);
    const incomingVersion = toEntryVersion(nextEntry);
    if (incomingVersion > 0 && currentVersion > 0 && incomingVersion < currentVersion) {
      console.log("[FormPage] ignore stale synced entry", {
        source,
        formId,
        entryId: entryId || "new",
        currentVersion,
        incomingVersion,
      });
      return false;
    }
    if (!isViewModeRef.current) {
      pendingSyncedEntryRef.current = pickLatestEntry(pendingSyncedEntryRef.current, nextEntry);
      console.log("[FormPage] defer synced entry during edit", {
        source,
        formId,
        entryId: entryId || "new",
        pendingVersion: toEntryVersion(pendingSyncedEntryRef.current),
      });
      return false;
    }
    pendingSyncedEntryRef.current = null;
    applyEntryToStateRef.current(nextEntry, entryId, source);
    return true;
  }, [entryId, formId, entryRef, isViewModeRef]);

  const cancelEditAndRestoreLatest = useCallback(async () => {
    if (!entryId || !formId) return;
    let restoreTarget = pickLatestEntry(entryRef.current, pendingSyncedEntryRef.current);
    try {
      const { entry: cachedEntry } = await getCachedEntryWithIndex(formId, entryId);
      restoreTarget = pickLatestEntry(restoreTarget, cachedEntry);
    } catch (error) {
      console.error("[FormPage] failed to load latest cache on cancel:", error);
    }
    if (restoreTarget) {
      applyEntryToState(restoreTarget, entryId, "cancel:restore-latest");
    } else {
      commitResponses("cancel:restore-initial", initialResponsesRef.current, { forceLog: true });
      setDriveFolderStates(initialDriveFolderStatesRef.current);
    }
    pendingSyncedEntryRef.current = null;
    setMode("view");
  }, [applyEntryToState, commitResponses, entryId, entryRef, formId]);

  const clearNewEntryDraft = useCallback(() => {
    if (entryId) return;
    newEntryInitKeyRef.current = null;
    try {
      sessionStorage.removeItem(draftKey);
    } catch (e) {}
    try {
      sessionStorage.removeItem(driveFolderDraftKey);
    } catch (e) {}
  }, [draftKey, driveFolderDraftKey, entryId]);

  const discardUnsavedUploadedFiles = useCallback(async () => {
    const currentStates = driveFolderStatesRef.current || {};
    const fileIds = normalizeDriveFileIds(
      Object.values(currentStates).flatMap((state) => normalizeDriveFolderState(state).sessionUploadFileIds),
    );
    if (fileIds.length === 0) return;
    if (!hasScriptRun()) {
      throw new Error("この機能はGoogle Apps Script環境でのみ利用可能です");
    }
    await trashDriveFilesByIds(fileIds);
  }, [driveFolderStatesRef]);

  const navigateToEntryById = useCallback((targetEntryId) => {
    clearNewEntryDraft();
    navigate(`/form/${formId}/entry/${targetEntryId}`, {
      state: { from: location.state?.from, entryIds },
      replace: true,
    });
  }, [clearNewEntryDraft, navigate, formId, location.state?.from, entryIds]);

  useEffect(() => {
    let mounted = true;
    const loadEntry = async () => {
      const tStart = performance.now();
      perfLogger.logVerbose("form-page", "loadEntry start", { formId, entryId });

      if (!formId || !isFormLoaded) {
        setLoading(false);
        return;
      }
      if (!entryId) {
        const newEntryKey = `${formId}:new`;
        const currentResponses = toResponseObject(responsesRef.current);
        const responseCount = Object.keys(currentResponses).length;

        if (newEntryInitKeyRef.current === newEntryKey) {
          if (responseCount > 0) {
            console.log("[FormPage] skip new-entry reinitialize", {
              formId,
              responseCount,
              isDirty: isDirtyRef.current,
            });
          }
          setLoading(false);
          return;
        }

        let hasDraft = false;
        try {
          const savedStr = sessionStorage.getItem(draftKey);
          if (savedStr) {
            hasDraft = Object.keys(JSON.parse(savedStr)).length > 0;
          }
        } catch(e) {}

        if (responseCount > 0 || hasDraft) {
          console.log("[FormPage] keep existing responses or draft in new-entry mode", {
            formId,
            responseCount,
            hasDraft,
            isDirty: isDirtyRef.current,
          });
          newEntryInitKeyRef.current = newEntryKey;
          setLoading(false);
          return;
        }

        const initialResponses = collectDefaultNowResponses(normalizedSchemaRef.current, new Date(), {
          userName: userNameRef.current,
          userEmail: userEmailRef.current,
          userAffiliation: userAffiliationRef.current,
          userTitle: userTitleRef.current,
          userPhone: userPhoneRef.current,
        });
        const emptyStates = createEmptyDriveFolderStates();
        initialResponsesRef.current = initialResponses;
        initialDriveFolderStatesRef.current = emptyStates;
        setDriveFolderStates(emptyStates);
        commitResponses("loadEntry:new-entry-initialize", initialResponses, {
          forceLog: true,
          meta: {
            defaultKeyCount: Object.keys(initialResponses).length,
          },
        });
        newEntryInitKeyRef.current = newEntryKey;
        setLoading(false);
        return;
      }
      newEntryInitKeyRef.current = null;
      const currentResponses = toResponseObject(responsesRef.current);
      if (isDirtyRef.current && Object.keys(currentResponses).length > 0) {
        setLoading(false);
        return;
      }
      setLoading(true);

      const tBeforeGetEntry = performance.now();
      perfLogger.logVerbose("form-page", "before dataStore.getEntry", {
        elapsedFromStartMs: Number((tBeforeGetEntry - tStart).toFixed(2)),
        formId,
        entryId,
      });

      // まずキャッシュから取得を試みる
      const { entry: cachedEntry, rowIndex, lastSyncedAt } = await getCachedEntryWithIndex(formId, entryId);

      if (cachedEntry && mounted) {
        // キャッシュがあれば即座に表示
        applyEntryToStateRef.current(cachedEntry, entryId, "loadEntry:cache");
        setLoading(false);
        perfLogger.logVerbose("form-page", "cache displayed", {
          elapsedFromStartMs: Number((performance.now() - tStart).toFixed(2)),
          rowIndex,
        });

        // キャッシュ年齢を計算し、5分以上古い場合はバックグラウンド更新
        const cacheAge = lastSyncedAt ? Date.now() - lastSyncedAt : Infinity;
        const shouldBackground = cacheAge >= RECORD_CACHE_MAX_AGE_MS;

        if (shouldBackground) {
          perfLogger.logVerbose("form-page", "start background refresh", {
            cacheAgeMs: cacheAge,
            thresholdMs: RECORD_CACHE_MAX_AGE_MS,
            rowIndexHint: rowIndex,
          });
          setIsReloading(true);
          dataStore.getEntry(formId, entryId, { rowIndexHint: rowIndex }).then((freshData) => {
            if (!mounted) return;
            if (freshData && !isDirtyRef.current) {
              applyOrDeferSyncedEntry(freshData, "loadEntry:background-refresh");
              perfLogger.logVerbose("form-page", "background refresh complete", {
                elapsedFromStartMs: Number((performance.now() - tStart).toFixed(2)),
              });
            }
            setIsReloading(false);
          }).catch((error) => {
            console.error("[FormPage] background refresh failed:", error);
            setIsReloading(false);
          });
        } else {
          perfLogger.logVerbose("form-page", "cache is fresh; skip background refresh", {
            cacheAgeMs: cacheAge,
            thresholdMs: RECORD_CACHE_MAX_AGE_MS,
          });
        }
      } else {
        // キャッシュがない場合は同期読み取り（rowIndexがある場合は渡す）
        const data = await dataStore.getEntry(formId, entryId, rowIndex !== undefined ? { rowIndexHint: rowIndex } : {});

        const tAfterGetEntry = performance.now();
        perfLogger.logVerbose("form-page", "after dataStore.getEntry", {
          durationMs: Number((tAfterGetEntry - tBeforeGetEntry).toFixed(2)),
          rowIndexHint: rowIndex,
        });

        if (!mounted) return;
        const tBeforeApply = performance.now();
        if (data && !isDirtyRef.current) {
          applyOrDeferSyncedEntry(data, "loadEntry:sync-read");
        }
        const tAfterApply = performance.now();
        perfLogger.logVerbose("form-page", "applyEntryToState", {
          durationMs: Number((tAfterApply - tBeforeApply).toFixed(2)),
        });
        setLoading(false);

        const tEnd = performance.now();
        perfLogger.logVerbose("form-page", "loadEntry complete", {
          totalDurationMs: Number((tEnd - tStart).toFixed(2)),
          formId,
          entryId,
        });
      }
    };
    if (isFormLoaded) {
      loadEntry();
    }
    return () => {
      mounted = false;
    };
  }, [formId, entryId, isFormLoaded]);

  const refreshFormsIfNeeded = useRefreshFormsIfNeeded(refreshForms, loadingForms);

  const handleOperationCacheCheck = useCallback(async ({ source }) => {
    if (!formId) return;

    if (entryId && !loadingRef.current && !reloadingRef.current && !savingRef.current && !readLockRef.current) {
      try {
        const { entry: cachedEntry, rowIndex, lastSyncedAt } = await getCachedEntryWithIndex(formId, entryId);
        const cacheDecision = evaluateCacheForRecords({
          lastSyncedAt,
          hasData: !!cachedEntry,
        });

        if (!cacheDecision.isFresh) {
          const options = { forceSync: true };
          if (rowIndex !== undefined && rowIndex !== null) options.rowIndexHint = rowIndex;

          if (!isViewModeRef.current) {
            // 編集モード中は操作によるバックグラウンド更新でデータを上書きしない
          } else if (cacheDecision.shouldSync) {
            setLoading(true);
            try {
              const latest = await dataStore.getEntry(formId, entryId, options);
              if (latest && !isDirtyRef.current) {
                applyOrDeferSyncedEntry(latest, "operation-cache:sync");
              }
            } finally {
              setLoading(false);
            }
          } else if (cacheDecision.shouldBackground) {
            setIsReloading(true);
            dataStore.getEntry(formId, entryId, options)
              .then((latest) => {
                if (latest && !isDirtyRef.current) {
                  applyOrDeferSyncedEntry(latest, "operation-cache:background");
                }
              })
              .catch((error) => {
                console.error("[FormPage] background getEntry failed:", error);
              })
              .finally(() => {
                setIsReloading(false);
              });
          }
        }
      } catch (error) {
        console.error("[FormPage] operation cache check failed:", error);
      }
    } else if (!entryId && isDirtyRef.current) {
      console.log("[FormPage] operation cache check during unsaved new-entry edit", {
        formId,
        source,
        responseCount: Object.keys(toResponseObject(responsesRef.current)).length,
      });
    }

    if (isDirtyRef.current && !isViewModeRef.current) {
      console.log("[FormPage] defer refreshForms during dirty edit", {
        formId,
        entryId: entryId || "new",
        source,
      });
      return;
    }

    await refreshFormsIfNeeded(source);
  }, [applyOrDeferSyncedEntry, entryId, formId, refreshFormsIfNeeded]);

  useOperationCacheTrigger({
    enabled: Boolean(formId),
    onOperation: handleOperationCacheCheck,
  });

  useEffect(() => {
    reloadListFromCache();
  }, [formId]);

  useBeforeUnloadGuard(isDirty);

  const navigateBack = ({ saved = false, deleted = false } = {}) => {
    clearNewEntryDraft();
    if (isDirectRecordMode && !deleted) {
      navigate(`/form/${formId}/entry/${entryId}`, { replace: true, state: location.state });
      return;
    }
    const state = (saved || deleted)
      ? { ...(saved || deleted ? { saved, deleted } : {}) }
      : undefined;
    if (location.state?.from) {
      navigate(location.state.from, { replace: true, state });
      return;
    }
    if (fallbackPath) {
      navigate(fallbackPath, { replace: true, state });
    } else {
      navigate("/", { replace: true, state });
    }
  };

  const handleSaveToStore = async ({ payload, responses: rawResponses, options = {} }) => {
    if (!form) throw new Error("form_not_found");

    const isNewEntry = !entry?.id;
    const createdBy = isNewEntry ? (userEmail || "") : (entry?.createdBy || "");
    const modifiedBy = userEmail || entry?.modifiedBy || "";
    const settings = form.settings || {};
    const spreadsheetId = normalizeSpreadsheetId(settings.spreadsheetId || "");
    const sheetName = settings.sheetName || "Data";
    const requiresSpreadsheetSave = Boolean(spreadsheetId && hasScriptRun());
    const payloadWithFormId = { ...payload, formId: form.id };

    if (!requiresSpreadsheetSave) {
      if (spreadsheetId) {
        console.warn("[FormPage] google.script.run unavailable; skipped background spreadsheet save");
      } else {
        console.warn("[FormPage] No spreadsheetId configured, skipping spreadsheet save");
      }
    }

    const normalizedRecordNo = String(recordNoInput || "").trim();

    const saveData = { ...payloadWithFormId.responses };
    const saveOrder = [...payloadWithFormId.order];
    const uploadFields = collectFileUploadFields(normalizedSchema);
    const currentStates = driveFolderStatesRef.current || {};
    const initialStates = initialDriveFolderStatesRef.current || {};
    const currentResponseFileIds = collectDriveFileIds(rawResponses);
    const initialResponseFileIds = collectDriveFileIds(initialResponsesRef.current);
    const currentResponseFileIdSet = new Set(currentResponseFileIds);
    const extraTrashFileIds = normalizeDriveFileIds(initialResponseFileIds).filter(
      (fileId) => !currentResponseFileIdSet.has(fileId),
    );
    const extraTrashFileIdSet = new Set(extraTrashFileIds);

    const finalizedFolderUrlByField = {};

    const needsAnyFinalize = uploadFields.some((field) => {
      const st = normalizeDriveFolderState(currentStates[field.id]);
      return Boolean(
        st.resolvedUrl.trim()
        || st.inputUrl.trim()
        || st.pendingDeleteUrl.trim()
        || st.sessionUploadFileIds.length
        || st.pendingPrintFileIds.length,
      );
    }) || extraTrashFileIds.length > 0;

    if (needsAnyFinalize) {
      if (options.unlinkDriveFolder === true) {
        // all folder URLs become empty
      } else {
        if (!hasScriptRun()) {
          throw new Error("この機能はGoogle Apps Script環境でのみ利用可能です");
        }
        // First pass: per-field finalize
        const fieldValuesMap = buildFieldValuesMap(normalizedSchema, rawResponses || {});
        const metaMap = collectFileUploadMeta(normalizedSchema, {
          responses: rawResponses || {},
          folderUrlsByField: buildFolderUrlsByFieldFromStates(currentStates),
        });
        try {
          let remainingExtraTrash = Array.from(extraTrashFileIdSet);
          for (let i = 0; i < uploadFields.length; i += 1) {
            const field = uploadFields[i];
            const fid = field?.id;
            if (!fid) continue;
            const st = normalizeDriveFolderState(currentStates[fid]);
            const fieldValue = (rawResponses || {})[fid];
            const perFieldFileIds = normalizeDriveFileIds([
              ...(Array.isArray(fieldValue)
                ? fieldValue.map((entry) => (entry && typeof entry.driveFileId === "string" ? entry.driveFileId : ""))
                : []),
              ...st.pendingPrintFileIds,
            ]);
            // Trash candidates: session uploads no longer present in current value
            const perFieldTrash = normalizeDriveFileIds(st.sessionUploadFileIds).filter(
              (fileId) => !currentResponseFileIdSet.has(fileId),
            );
            // Also reclaim initial-response file ids that belong to this field's sessions
            const trashFileIds = normalizeDriveFileIds(perFieldTrash);
            // Attach leftover extraTrash (from value-removal) to the first field to not lose them
            if (i === 0 && remainingExtraTrash.length > 0) {
              trashFileIds.push(...remainingExtraTrash);
              remainingExtraTrash = [];
            }
            const hasSomething = Boolean(
              st.resolvedUrl.trim()
              || st.inputUrl.trim()
              || st.pendingDeleteUrl.trim()
              || perFieldFileIds.length
              || trashFileIds.length,
            );
            if (!hasSomething) {
              finalizedFolderUrlByField[fid] = "";
              continue;
            }
            const finalizeResult = await finalizeRecordDriveFolder({
              currentDriveFolderUrl: st.resolvedUrl.trim(),
              inputDriveFolderUrl: st.inputUrl.trim(),
              rootFolderUrl: field?.driveRootFolderUrl || "",
              folderNameTemplate: field?.driveFolderNameTemplate || "",
              responses: rawResponses || {},
              fieldLabels,
              fieldValues: fieldValuesMap,
              fileUploadMeta: metaMap,
              fileIds: normalizeDriveFileIds(perFieldFileIds),
              trashFileIds: normalizeDriveFileIds(trashFileIds),
              folderUrlToTrash: st.pendingDeleteUrl.trim(),
              recordId: payloadWithFormId.id,
            });
            finalizedFolderUrlByField[fid] = typeof finalizeResult?.folderUrl === "string"
              ? finalizeResult.folderUrl.trim()
              : st.resolvedUrl.trim();
          }
        } catch (folderError) {
          throw new DriveFolderFinalizeError(folderError);
        }
      }
    }

    // Embed per-field folderUrl into sheet cell JSON by rebuilding fileUpload paths
    {
      const rebuilt = coreCollectResponses(
        normalizedSchema,
        rawResponses || {},
        { fileUploadFolderUrls: finalizedFolderUrlByField },
      );
      const fileUploadBaseKeys = new Set();
      traverseSchema(normalizedSchema, (field, context) => {
        if (field?.type === "fileUpload") {
          fileUploadBaseKeys.add(context.pathSegments.join("|"));
        }
      });
      fileUploadBaseKeys.forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(rebuilt, key)) {
          saveData[key] = rebuilt[key];
        } else if (Object.prototype.hasOwnProperty.call(saveData, key)) {
          delete saveData[key];
        }
      });
    }

    // Primary folder URL = first fileUpload field's finalized folderUrl (for backwards compat)
    const primaryFieldId = uploadFields[0]?.id || "";
    const finalizedDriveFolderUrl = options.unlinkDriveFolder === true
      ? ""
      : (primaryFieldId && finalizedFolderUrlByField[primaryFieldId])
        || "";

    const saved = await dataStore.upsertEntry(form.id, {
      id: payloadWithFormId.id,
      data: saveData,
      order: saveOrder,
      driveFolderUrl: finalizedDriveFolderUrl,
      createdBy,
      modifiedBy,
      "No.": normalizedRecordNo === "" ? entry?.["No."] : normalizedRecordNo,
    });
    applyEntryToState(saved, saved.id, "save:new-entry");
    pendingSyncedEntryRef.current = null;
    reloadListFromCache();
    if (options.unlinkDriveFolder === true) {
      const emptyStates = createEmptyDriveFolderStates();
      setDriveFolderStates(emptyStates);
      initialDriveFolderStatesRef.current = emptyStates;
    }

    if (requiresSpreadsheetSave) {
      void acquireSaveLock({ spreadsheetId, sheetName })
        .then(() => submitResponses({
          spreadsheetId,
          sheetName,
          payload: {
            ...payloadWithFormId,
            responses: saveData,
            order: saveOrder,
            id: saved.id,
            driveFolderUrl: finalizedDriveFolderUrl,
            createdAt: saved.createdAt,
            createdAtUnixMs: saved.createdAtUnixMs,
            createdBy: saved.createdBy,
            "No.": saved["No."],
          },
        }))
        .then(async (gasResult) => {
          if (gasResult?.recordNo === undefined || gasResult?.recordNo === null || gasResult?.recordNo === "") return;
          if (String(gasResult.recordNo) === String(saved["No."])) return;

          const { entry: currentCached } = await getCachedEntryWithIndex(form.id, saved.id);
          const baseRecord = currentCached || saved;
          const synced = await dataStore.upsertEntry(form.id, {
            ...baseRecord,
            "No.": gasResult.recordNo,
          });
          setEntry((prev) => (prev?.id === synced.id ? synced : prev));
        })
        .catch((error) => {
          console.error("[FormPage] Background spreadsheet save failed:", error);
          if (error?.code === GAS_ERROR_CODE_LOCK_TIMEOUT) {
            showAlert(
              "現在、他のユーザーによる更新処理が実行中のためスプレッドシートへの保存を完了できませんでした。少し時間をおいて再度お試しください。",
              "スプレッドシート保存を完了できませんでした",
            );
            return;
          }
          showAlert(`スプレッドシート保存に失敗しました: ${error?.message || error}`);
        });
    }
    try {
      sessionStorage.removeItem(draftKey);
    } catch (e) {}
    try {
      sessionStorage.removeItem(driveFolderDraftKey);
    } catch (e) {}
    return saved;
  };

  const triggerSave = async ({ redirect, stayAsView, skipStayAsViewNavigation = false, unlinkDriveFolder = false } = {}) => {
    if (!form) {
      showAlert("フォームが見つかりません");
      return { ok: false, recordId: "" };
    }
    if (isReadLocked) return { ok: false, recordId: "" };
    setIsSaving(true);
    try {
      const preview = previewRef.current;
      if (!preview) throw new Error("preview_not_ready");
      const result = await preview.submit({ silent: true, unlinkDriveFolder });
      const savedId = String(preview.getRecordId?.() || result?.id || currentRecordId || entryId || "").trim();

      if (stayAsView) {
        if (!skipStayAsViewNavigation) {
          if (!entryId && savedId) {
            navigate(`/form/${formId}/entry/${savedId}`, {
              replace: true,
              state: location.state,
            });
          } else {
            setMode("view");
          }
        }
        showToast("保存しました");
      } else if (redirect) {
        navigateBack({ saved: true });
      }
      return { ok: true, recordId: savedId };
    } catch (error) {
      console.warn(error);
      if (error instanceof DriveFolderFinalizeError && isAdmin) {
        pendingUnlinkSaveRef.current = { redirect, stayAsView, skipStayAsViewNavigation };
        unlinkFolderDialog.open({ errorMessage: error.originalError?.message || "不明なエラー" });
        return { ok: false, recordId: "" };
      }
      if (error?.message === "validation_failed" || error?.message?.includes("missing_")) {
        return { ok: false, recordId: "" };
      }
      if (error instanceof DriveFolderFinalizeError) {
        showAlert(`Driveフォルダの処理に失敗しました: ${error.originalError?.message || error.message}`);
        return { ok: false, recordId: "" };
      }
      if (error?.code === GAS_ERROR_CODE_LOCK_TIMEOUT) {
        showAlert(
          "現在、他のユーザーによる更新処理が実行中のため保存できませんでした。しばらく時間をおいて、もう一度お試しください。",
          "保存を完了できませんでした",
        );
        return { ok: false, recordId: "" };
      }
      showAlert(`保存に失敗しました: ${error?.message || error}`);
      return { ok: false, recordId: "" };
    } finally {
      setIsSaving(false);
    }
  };

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

  const confirmEntryAction = useCallback(async () => {
    const action = entryActionDialog.state.action;
    entryActionDialog.reset();
    if (action === "delete") {
      await dataStore.deleteEntry(formId, entryId, { deletedBy: userEmail || "" });
      navigateBack({ deleted: true });
    } else if (action === "undelete") {
      await dataStore.undeleteEntry(formId, entryId, { modifiedBy: userEmail || "" });
      const { entry: updated } = await getCachedEntryWithIndex(formId, entryId);
      if (updated) {
        applyEntryToState(updated, entryId, "undelete");
      }
      reloadListFromCache();
    }
  }, [entryActionDialog.state.action, formId, entryId, userEmail, applyEntryToState, reloadListFromCache]);

  const handleFetchCopySource = useCallback(async () => {
    if (!formId) return;
    const sourceId = String(copySourceId || "").trim();
    if (!sourceId) {
      showAlert("コピー元レコードIDを入力してください");
      return;
    }

    try {
      setIsCopySourceLoading(true);
      const { entry: sourceData } = await getCachedEntryWithIndex(formId, sourceId);
      if (!sourceData) {
        showAlert("指定したレコードが見つかりませんでした");
        return;
      }
      const restored = restoreResponsesFromData(normalizedSchema, sourceData.data || {}, sourceData.dataUnixMs || {});
      setCopySourceResponses(restored);
      setIsCopyDialogOpen(true);
    } catch (error) {
      console.error("[FormPage] failed to fetch source record for copy:", error);
      showAlert(`コピー元レコードの取得に失敗しました: ${error?.message || error}`);
    } finally {
      setIsCopySourceLoading(false);
    }
  }, [copySourceId, formId, normalizedSchema, showAlert]);

  const handleConfirmRecordCopy = useCallback((selectedFieldIds) => {
    const selectedIds = Array.isArray(selectedFieldIds) ? selectedFieldIds : [];
    if (!selectedIds.length) {
      showAlert("コピーする項目を選択してください");
      return;
    }

    const copyTargetFieldIds = {};
    selectedIds.forEach((fieldId) => {
      const rootField = topLevelFieldMap[fieldId];
      if (!rootField) return;
      traverseSchema([rootField], (field) => {
        const id = typeof field?.id === "string" ? field.id.trim() : "";
        if (id) copyTargetFieldIds[id] = true;
      }, { responses: copySourceResponses });
    });

    const filteredResponses = {};
    Object.keys(copyTargetFieldIds).forEach((fieldId) => {
      if (Object.prototype.hasOwnProperty.call(copySourceResponses, fieldId)) {
        filteredResponses[fieldId] = copySourceResponses[fieldId];
      }
    });

    commitResponses("record-copy:merge", (prev) => ({
      ...(prev || {}),
      ...filteredResponses,
    }), {
      forceLog: true,
      meta: {
        copiedCount: Object.keys(filteredResponses).length,
      },
    });
    setIsCopyDialogOpen(false);

    const copiedCount = Object.keys(filteredResponses).length;
    if (copiedCount > 0) {
      showToast(`${copiedCount} 項目をコピーしました`);
    } else {
      showAlert("コピー対象の回答が見つかりませんでした");
    }
  }, [copySourceResponses, showAlert, showToast, topLevelFieldMap]);

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

  const handleCreatePrintDocument = useCallback(async () => {
    const preview = previewRef.current;
    if (!preview || typeof preview.getPrintDocumentPayload !== "function") {
      showAlert("印刷様式の出力準備がまだできていません。少し待ってからもう一度お試しください。");
      return;
    }

    setIsCreatingPrintDocument(true);
    try {
      const payload = preview.getPrintDocumentPayload({
        omitEmptyRows: omitEmptyRowsOnPrint,
        driveFolderState: createEmptyDriveFolderState(),
      });
      // 印刷様式出力は常にマイドライブ直下に配置
      if (payload.driveSettings) {
        payload.driveSettings.rootFolderUrl = "";
        payload.driveSettings.folderUrl = "";
        payload.driveSettings.folderNameTemplate = "";
        payload.driveSettings.useTemporaryFolder = false;
      }
      const fileNameTemplate = resolveSharedPrintFileNameTemplate(form?.settings || {});
      if (fileNameTemplate) {
        const currentResponses = responsesRef.current || {};
        payload.fileNameTemplate = fileNameTemplate;
        if (payload.driveSettings) {
          payload.driveSettings.fileNameTemplate = fileNameTemplate;
        }
        payload.templateContext = {
          responses: currentResponses,
          fieldLabels,
          fieldValues: buildFieldValuesMap(normalizedSchema, currentResponses),
          fileUploadMeta: collectFileUploadMeta(normalizedSchema, {
            responses: currentResponses,
            folderUrlsByField: buildFolderUrlsByFieldFromStates(driveFolderStatesRef.current || {}),
          }),
          recordId: payload.recordId || "",
          formId: form?.id || "",
          recordNo: entry?.["No."] || "",
          formTitle: form?.settings?.formTitle || "",
        };
      }
      const result = await createRecordPrintDocument(payload);
      showOutputAlert({ message: "マイドライブに Google ドキュメントを保存しました。", url: result.fileUrl, linkLabel: "ファイルを開く" });
    } catch (error) {
      console.error("[FormPage] failed to create print document:", error);
      showAlert(`印刷様式の出力に失敗しました: ${error?.message || error}`);
    } finally {
      setIsCreatingPrintDocument(false);
    }
  }, [entry, fieldLabels, form?.id, form?.settings, normalizedSchema, omitEmptyRowsOnPrint, showAlert, showOutputAlert]);

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
        showAlert(`未保存アップロードファイルの削除に失敗しました: ${error?.message || error}`);
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
        <>
          {isViewMode ? (
            <>
              <button type="button" className="nf-btn-outline nf-btn-sidebar nf-text-14" onClick={handleEditMode} disabled={editDisabled}>
                編集
              </button>
              {!isDirectRecordMode && (
                <button type="button" className="nf-btn-outline nf-btn-sidebar nf-text-14" onClick={() => navigateBack()}>
                  ← 戻る
                </button>
              )}
            </>
          ) : (
            <>
              <button type="button" className="nf-btn-outline nf-btn-sidebar nf-text-14" disabled={isSaving || isReadLocked || isFormReadOnly} onClick={() => triggerSave(primarySaveOptions)}>
                保存
              </button>
              <button type="button" className="nf-btn-outline nf-btn-sidebar nf-text-14" onClick={() => attemptLeave("cancel-edit")}>
                キャンセル
              </button>
            </>
          )}
          <button
            type="button"
            className="nf-btn-outline nf-btn-sidebar nf-text-14"
            disabled={loading || isCreatingPrintDocument}
            onClick={() => {
              void handleCreatePrintDocument();
            }}
          >
            {isCreatingPrintDocument ? "出力中..." : "印刷様式を出力"}
          </button>
          {entryId && (
            <>
              <hr className="nf-sidebar-divider" />
              {isAdmin && entry?.deletedAt ? (
                <button type="button" className="nf-btn-outline nf-btn-sidebar nf-text-14" onClick={handleUndeleteEntry}>
                  削除取消し
                </button>
              ) : (
                <button type="button" className="nf-btn-outline nf-btn-sidebar nf-btn-danger nf-text-14" onClick={handleDeleteEntry} disabled={isFormReadOnly}>
                  削除
                </button>
              )}
            </>
          )}
          {canCopyFromExistingRecord && (
            <>
              <hr className="nf-sidebar-divider" />
              <div className="record-copy-sidebar">
                <div className="record-copy-sidebar__title">既存レコードからコピー</div>
                <div className="record-copy-sidebar__controls">
                  <input
                    type="text"
                    className="nf-input nf-text-13 record-copy-sidebar__input"
                    value={copySourceId}
                    onChange={(event) => setCopySourceId(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void handleFetchCopySource();
                      }
                    }}
                    placeholder="レコードID"
                  />
                  <button
                    type="button"
                    className="nf-btn-outline nf-text-13 record-copy-sidebar__fetch"
                    disabled={isCopySourceLoading || isSaving || isReadLocked}
                    onClick={() => {
                      void handleFetchCopySource();
                    }}
                  >
                    {isCopySourceLoading ? "取得中..." : "取得"}
                  </button>
                </div>
              </div>
            </>
          )}
          {entryIds.length > 0 && (
            <>
              <hr className="nf-sidebar-divider" />
              <div className="nf-flex nf-gap-8 nf-items-center">
                <button type="button" className="nf-btn-outline nf-btn-sidebar nf-text-14" disabled={!hasPrev} onClick={() => navigateToEntry(entryIds[currentIndex - 1])}>
                  ← 前へ
                </button>
                <button type="button" className="nf-btn-outline nf-btn-sidebar nf-text-14" disabled={!hasNext} onClick={() => navigateToEntry(entryIds[currentIndex + 1])}>
                  次へ →
                </button>
              </div>
              <span className="nf-text-11 nf-text-muted">{currentIndex + 1} / {entryIds.length}</span>
            </>
          )}
          <SchemaMapNav schema={normalizedSchema} responses={responses} scope="visible" />
        </>
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
          settings={{
            ...(form.settings || {}),
            formId: form.id,
            recordId: currentRecordId,
            recordNo: recordNoInput,
            modifiedAt: entry?.modifiedAt,
            modifiedAtUnixMs: entry?.modifiedAtUnixMs,
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

      <ConfirmDialog
        open={unsavedDialog.state.open}
        title="未保存の変更があります"
        message={confirmMessage}
        options={confirmOptions}
      />
      <ConfirmDialog
        open={entryActionDialog.state.open}
        title={entryActionDialog.state.action === "undelete" ? "削除取消し" : "レコードを削除"}
        message={entryActionDialog.state.action === "undelete"
          ? "このレコードの削除を取り消し、復活させます。よろしいですか？"
          : "このレコードを削除します。よろしいですか？"}
        options={[
          { label: "キャンセル", value: "cancel", onSelect: entryActionDialog.reset },
          entryActionDialog.state.action === "undelete"
            ? { label: "削除取消し", value: "undelete", variant: "primary", onSelect: confirmEntryAction }
            : { label: "削除", value: "delete", variant: "danger", onSelect: confirmEntryAction },
        ]}
      />
      <ConfirmDialog
        open={driveFolderDialog.state.open}
        title="フォルダ削除"
        message="現在の保存先フォルダのリンクを解除し、存在するフォルダは保存時にごみ箱へ移動します。よろしいですか？"
        options={[
          { label: "キャンセル", value: "cancel", onSelect: driveFolderDialog.close },
          { label: "フォルダ削除", value: "delete-folder", variant: "danger", onSelect: handleDeleteDriveFolder },
        ]}
      />
      <ConfirmDialog
        open={unlinkFolderDialog.state.open}
        title="フォルダ操作に失敗しました"
        message={`保存先フォルダの処理中にエラーが発生しました（${unlinkFolderDialog.state.errorMessage}）。フォルダのリンクを解除して保存を続行しますか？（Driveフォルダの操作はスキップされます）`}
        options={[
          { label: "キャンセル", value: "cancel", onSelect: handleCancelUnlinkFolder },
          { label: "リンクを解除して保存", value: "unlink", variant: "danger", onSelect: handleConfirmUnlinkFolder },
        ]}
      />

      <RecordCopyDialog
        open={isCopyDialogOpen}
        schema={normalizedSchema}
        sourceResponses={copySourceResponses}
        onConfirm={handleConfirmRecordCopy}
        onCancel={() => setIsCopyDialogOpen(false)}
      />

    </AppLayout>
  );
}
