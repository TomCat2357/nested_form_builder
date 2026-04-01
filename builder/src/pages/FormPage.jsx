import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLatestRef } from "../app/hooks/useLatestRef.js";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import AppLayout from "../app/components/AppLayout.jsx";
import ConfirmDialog from "../app/components/ConfirmDialog.jsx";
import PreviewPage from "../features/preview/PreviewPage.jsx";
import { useAppData } from "../app/state/AppDataProvider.jsx";
import { dataStore } from "../app/state/dataStore.js";
import { PARENT_RECORD_ID_KEY } from "../core/constants.js";
import { restoreResponsesFromData, hasDirtyChanges, collectDefaultNowResponses } from "../utils/responses.js";
import {
  acquireSaveLock,
  createRecordPrintDocument,
  finalizeRecordDriveFolder,
  submitResponses,
  hasScriptRun,
} from "../services/gasClient.js";
import { normalizeSpreadsheetId } from "../utils/spreadsheet.js";
import { useAlert } from "../app/hooks/useAlert.js";
import { useBeforeUnloadGuard } from "../app/hooks/useBeforeUnloadGuard.js";
import { normalizeSchemaIDs } from "../core/schema.js";
import { traverseSchema } from "../core/schemaUtils.js";
import { GAS_ERROR_CODE_LOCK_TIMEOUT } from "../core/constants.js";
import { useOperationCacheTrigger } from "../app/hooks/useOperationCacheTrigger.js";
import { useEditLock } from "../app/hooks/useEditLock.js";
import { getCachedEntryWithIndex } from "../app/state/recordsCache.js";
import {
  evaluateCache,
  RECORD_CACHE_MAX_AGE_MS,
  RECORD_CACHE_BACKGROUND_REFRESH_MS,
} from "../app/state/cachePolicy.js";
import { useRefreshFormsIfNeeded } from "../app/hooks/useRefreshFormsIfNeeded.js";
import { useAuth } from "../app/state/authContext.jsx";
import { DEFAULT_THEME, applyThemeWithFallback } from "../app/theme/theme.js";
import { perfLogger } from "../utils/perfLogger.js";
import SchemaMapNav from "../features/nav/SchemaMapNav.jsx";
import RecordCopyDialog from "../app/components/RecordCopyDialog.jsx";
import BreadcrumbNav from "../app/components/BreadcrumbNav.jsx";
import SearchToolbar from "../features/search/components/SearchToolbar.jsx";
import { useEntriesWithCache } from "../features/search/useEntriesWithCache.js";
import { buildFieldLabelsMap, resolveOmitEmptyRowsOnPrint } from "../features/preview/printDocument.js";
import { collectChildFormLinks, mergeChildFormLinksByFormId } from "../features/search/childFormIntegration.js";
import PrintChildFormDialog from "../features/search/components/PrintChildFormDialog.jsx";
import { buildPrimarySaveOptions } from "../utils/settings.js";

const fallbackForForm = (formId, locationState) => {
  if (locationState?.from) return locationState.from;
  if (formId) return `/search?form=${formId}`;
  return "/";
};

const toResponseObject = (value) => (value && typeof value === "object" ? value : {});

const diffResponses = (prevValue, nextValue) => {
  const prev = toResponseObject(prevValue);
  const next = toResponseObject(nextValue);
  const prevKeys = Object.keys(prev);
  const nextKeys = Object.keys(next);

  const addedKeys = nextKeys.filter((key) => !Object.prototype.hasOwnProperty.call(prev, key));
  const removedKeys = prevKeys.filter((key) => !Object.prototype.hasOwnProperty.call(next, key));
  const changedKeys = nextKeys.filter((key) => Object.prototype.hasOwnProperty.call(prev, key) && prev[key] !== next[key]);

  return {
    prevCount: prevKeys.length,
    nextCount: nextKeys.length,
    addedKeys,
    removedKeys,
    changedKeys,
  };
};

const sampleKeys = (keys, max = 8) => keys.slice(0, max);

const toEntryVersion = (candidate) => {
  const value = Number(candidate?.modifiedAtUnixMs ?? candidate?.modifiedAt ?? 0);
  return Number.isFinite(value) ? value : 0;
};

const pickLatestEntry = (current, incoming) => {
  if (!current) return incoming || null;
  if (!incoming) return current;
  const currentVersion = toEntryVersion(current);
  const incomingVersion = toEntryVersion(incoming);
  return incomingVersion > currentVersion ? incoming : current;
};

const createEmptyDriveFolderState = () => ({
  resolvedUrl: "",
  inputUrl: "",
  autoCreated: false,
});

const normalizeDriveFolderState = (value) => {
  const source = value && typeof value === "object" ? value : {};
  const resolvedUrl = typeof source.resolvedUrl === "string"
    ? source.resolvedUrl
    : (typeof source.url === "string" ? source.url : "");
  const inputUrl = typeof source.inputUrl === "string" ? source.inputUrl : resolvedUrl;
  return {
    resolvedUrl,
    inputUrl,
    autoCreated: source.autoCreated === true,
  };
};

const areDriveFolderStatesEqual = (left, right) => {
  const a = normalizeDriveFolderState(left);
  const b = normalizeDriveFolderState(right);
  return a.resolvedUrl === b.resolvedUrl
    && a.inputUrl === b.inputUrl
    && a.autoCreated === b.autoCreated;
};

const collectDriveFileIds = (responses) => {
  const seen = new Set();
  Object.values(toResponseObject(responses)).forEach((value) => {
    if (!Array.isArray(value)) return;
    value.forEach((entry) => {
      const fileId = typeof entry?.driveFileId === "string" ? entry.driveFileId.trim() : "";
      if (fileId) seen.add(fileId);
    });
  });
  return Array.from(seen);
};

export default function FormPage() {
  const { formId, entryId } = useParams();
  const [searchParams] = useSearchParams();
  const { getFormById, refreshForms, loadingForms, forms } = useAppData();
  const { userName, userEmail, userAffiliation, userTitle, userPhone, isAdmin } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { showAlert, showToast } = useAlert();
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
  const [driveFolderState, setDriveFolderState] = useState(() => {
    if (entryId) return createEmptyDriveFolderState();
    try {
      const saved = sessionStorage.getItem(driveFolderDraftKey);
      if (saved) return normalizeDriveFolderState(JSON.parse(saved));
    } catch (e) {}
    return createEmptyDriveFolderState();
  });

  useEffect(() => {
    if (entryId) return;
    try {
      const saved = sessionStorage.getItem(driveFolderDraftKey);
      setDriveFolderState(saved ? normalizeDriveFolderState(JSON.parse(saved)) : createEmptyDriveFolderState());
    } catch (e) {
      setDriveFolderState(createEmptyDriveFolderState());
    }
  }, [driveFolderDraftKey, entryId]);

  useEffect(() => {
    if (!entryId) {
      try {
        sessionStorage.setItem(driveFolderDraftKey, JSON.stringify(driveFolderState));
      } catch (e) {}
    }
  }, [driveFolderDraftKey, driveFolderState, entryId]);
  const [currentRecordId, setCurrentRecordId] = useState(entryId || null);

  // 親子フォーム階層コンテキスト
  const parentRecordId = searchParams.get("parentRecordId") || location.state?.parentRecordId || "";
  const breadcrumbTrail = location.state?.breadcrumbTrail || [];

  const [confirmState, setConfirmState] = useState({ open: false, intent: null });
  const [isSaving, setIsSaving] = useState(false);
  const [isCreatingPrintDocument, setIsCreatingPrintDocument] = useState(false);
  const [showPrintChildFormDialog, setShowPrintChildFormDialog] = useState(false);
  const [mode, setMode] = useState(entryId ? "view" : "edit");
  const [isReloading, setIsReloading] = useState(false);
  const [entryActionConfirm, setEntryActionConfirm] = useState({ open: false, action: null });
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
  const initialDriveFolderStateRef = useRef(createEmptyDriveFolderState());
  const previewRef = useRef(null);
  const newEntryInitKeyRef = useRef(null);
  const responseMutationSeqRef = useRef(0);
  const formLoadedStateRef = useRef(null);
  const pendingSyncedEntryRef = useRef(null);
  const pendingNavStateRef = useRef(null);

  const fallbackPath = useMemo(() => fallbackForForm(formId, location.state), [formId, location.state]);
  const omitEmptyRowsOnPrint = resolveOmitEmptyRowsOnPrint(form?.settings);
  const fieldLabels = useMemo(() => buildFieldLabelsMap(normalizedSchema), [normalizedSchema]);
  const primarySaveOptions = useMemo(() => buildPrimarySaveOptions(form?.settings), [form?.settings?.saveAfterAction]);
  const childFormLinks = useMemo(() => collectChildFormLinks(normalizedSchema), [normalizedSchema]);
  const childForms = useMemo(
    () => mergeChildFormLinksByFormId(childFormLinks, getFormById),
    [childFormLinks, getFormById],
  );
  const canIncludeChildrenInPrint = Boolean(entryId && childForms.length > 0);

  useEffect(() => {
    if (!form) return;
    const theme = form?.settings?.theme || DEFAULT_THEME;
    void applyThemeWithFallback(theme, { persist: false });
  }, [form?.id, form?.settings?.theme]);

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
  const driveFolderStateRef = useLatestRef(driveFolderState);

  useEffect(() => {
    setMode(entryId ? "view" : "edit");
  }, [entryId]);

  const isViewMode = mode === "view";
  const canCopyFromExistingRecord = !entryId && !isViewMode;
  const isDriveFolderDirty = useMemo(
    () => !areDriveFolderStatesEqual(initialDriveFolderStateRef.current, driveFolderState),
    [driveFolderState],
  );
  const isDirty = useMemo(
    () => hasDirtyChanges(initialResponsesRef.current, responses) || isDriveFolderDirty,
    [isDriveFolderDirty, responses],
  );
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
    if (isDirty && !isViewMode) {
      console.log("[FormPage] defer applying refreshed form during dirty edit", {
        formId,
        entryId: entryId || "new",
      });
      return;
    }
    setCachedForm(currentForm);
  }, [currentForm, entryId, formId, isDirty, isViewMode]);

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
    const restored = restoreResponsesFromData(normalizedSchemaRef.current, nextEntry?.data || {}, nextEntry?.dataUnixMs || {});
    const nextDriveFolderState = normalizeDriveFolderState({
      resolvedUrl: nextEntry?.driveFolderUrl || "",
      inputUrl: nextEntry?.driveFolderUrl || "",
      autoCreated: false,
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
    initialDriveFolderStateRef.current = nextDriveFolderState;
    setDriveFolderState(nextDriveFolderState);
    commitResponses(`applyEntryToState:${source}`, restored, {
      forceLog: true,
      meta: { nextEntryId: nextEntry?.id || fallbackEntryId || null },
    });
    setCurrentRecordId(nextEntry?.id || fallbackEntryId || null);
  }, [commitResponses, entryId, formId, isDirtyRef, isViewModeRef, normalizedSchemaRef, responsesRef]);
  const applyEntryToStateRef = useLatestRef(applyEntryToState);

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
      setDriveFolderState(initialDriveFolderStateRef.current);
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

  const navigateToEntryById = useCallback((targetEntryId) => {
    clearNewEntryDraft();
    navigate(`/form/${formId}/entry/${targetEntryId}`, {
      state: {
        from: location.state?.from,
        entryIds,
        ...(parentRecordId ? { parentRecordId } : {}),
        ...(breadcrumbTrail.length > 0 ? { breadcrumbTrail } : {}),
      },
      replace: true,
    });
  }, [breadcrumbTrail, clearNewEntryDraft, navigate, formId, location.state?.from, entryIds, parentRecordId]);

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
        const emptyDriveFolderState = createEmptyDriveFolderState();
        initialResponsesRef.current = initialResponses;
        initialDriveFolderStateRef.current = emptyDriveFolderState;
        setDriveFolderState(emptyDriveFolderState);
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
        const cacheDecision = evaluateCache({
          lastSyncedAt,
          hasData: !!cachedEntry,
          maxAgeMs: RECORD_CACHE_MAX_AGE_MS,
          backgroundAgeMs: RECORD_CACHE_BACKGROUND_REFRESH_MS,
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
    const hierarchyState = {
      ...(parentRecordId ? { parentRecordId } : {}),
      ...(breadcrumbTrail.length > 0 ? { breadcrumbTrail } : {}),
    };
    const state = (saved || deleted || Object.keys(hierarchyState).length > 0)
      ? { ...(saved || deleted ? { saved, deleted } : {}), ...hierarchyState }
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

  const handleSaveToStore = async ({ payload, responses: rawResponses }) => {
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
    const currentDriveFolder = normalizeDriveFolderState(driveFolderStateRef.current);
    const currentDriveFolderUrl = currentDriveFolder.resolvedUrl.trim();
    const inputDriveFolderUrl = currentDriveFolder.inputUrl.trim();
    const driveFileIds = collectDriveFileIds(rawResponses);
    const shouldFinalizeDriveFolder = Boolean(currentDriveFolderUrl || inputDriveFolderUrl || driveFileIds.length > 0);
    let finalizedDriveFolderUrl = currentDriveFolderUrl;

    if (shouldFinalizeDriveFolder) {
      if (!hasScriptRun()) {
        throw new Error("この機能はGoogle Apps Script環境でのみ利用可能です");
      }
      const finalizeResult = await finalizeRecordDriveFolder({
        currentDriveFolderUrl,
        inputDriveFolderUrl,
        rootFolderUrl: settings.driveRootFolderUrl || "",
        folderNameTemplate: settings.driveFolderNameTemplate || "",
        responses: rawResponses || {},
        fieldLabels,
        fileIds: driveFileIds,
        recordId: payloadWithFormId.id,
      });
      finalizedDriveFolderUrl = typeof finalizeResult?.folderUrl === "string"
        ? finalizeResult.folderUrl.trim()
        : currentDriveFolderUrl;
    }

    const saved = await dataStore.upsertEntry(form.id, {
      id: payloadWithFormId.id,
      data: saveData,
      order: saveOrder,
      driveFolderUrl: finalizedDriveFolderUrl,
      ...(isNewEntry && parentRecordId ? { parentRecordId } : {}),
      createdBy,
      modifiedBy,
      "No.": normalizedRecordNo === "" ? entry?.["No."] : normalizedRecordNo,
    });
    applyEntryToState(saved, saved.id, "save:new-entry");
    pendingSyncedEntryRef.current = null;
    reloadListFromCache();

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

  const triggerSave = async ({ redirect, stayAsView, skipStayAsViewNavigation = false } = {}) => {
    if (!form) {
      showAlert("フォームが見つかりません");
      return { ok: false, recordId: "" };
    }
    if (isReadLocked) return { ok: false, recordId: "" };
    setIsSaving(true);
    try {
      const preview = previewRef.current;
      if (!preview) throw new Error("preview_not_ready");
      const result = await preview.submit({ silent: true });
      const savedId = String(preview.getRecordId?.() || result?.id || currentRecordId || entryId || "").trim();
      if (stayAsView) {
        if (!skipStayAsViewNavigation) {
          if (!entryId && savedId) {
            navigate(`/form/${formId}/entry/${savedId}`, {
              replace: true,
              state: {
                ...location.state,
                ...(parentRecordId ? { parentRecordId } : {}),
                ...(breadcrumbTrail.length > 0 ? { breadcrumbTrail } : {}),
              },
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
      if (error?.message === "validation_failed" || error?.message?.includes("missing_")) {
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
      setConfirmState({ open: true, intent });
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
    if (!isDirty) {
      navigateBack();
      return false;
    }
    setConfirmState({ open: true, intent: "back" });
    return false;
  };

  const handleDeleteEntry = () => {
    setEntryActionConfirm({ open: true, action: "delete" });
  };

  const handleUndeleteEntry = () => {
    setEntryActionConfirm({ open: true, action: "undelete" });
  };

  const confirmEntryAction = useCallback(async () => {
    const action = entryActionConfirm.action;
    setEntryActionConfirm({ open: false, action: null });
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
  }, [entryActionConfirm.action, formId, entryId, userEmail, applyEntryToState, reloadListFromCache]);

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

  const navigateToChildForm = useCallback((childFormId, targetRecordId) => {
    const resolvedRecordId = String(targetRecordId || "").trim();
    if (!childFormId || !resolvedRecordId) return false;
    const representativeFieldId = form?.settings?.representativeFieldId;
    const representativeValue = representativeFieldId
      ? (responses?.[representativeFieldId] || "")
      : resolvedRecordId;
    const nextBreadcrumb = [...breadcrumbTrail, { formId, recordId: resolvedRecordId, representativeValue }];
    navigate(`/search?form=${childFormId}&parentRecordId=${resolvedRecordId}`, {
      state: { breadcrumbTrail: nextBreadcrumb },
    });
    return true;
  }, [breadcrumbTrail, form?.settings?.representativeFieldId, formId, navigate, responses]);

  const handleChildFormJump = useCallback(async (childFormId) => {
    const persistedRecordId = String(entryId || currentRecordId || "").trim();
    if (!persistedRecordId) {
      const saveResult = await triggerSave({ stayAsView: true, skipStayAsViewNavigation: true });
      if (saveResult.ok) {
        navigateToChildForm(childFormId, saveResult.recordId);
      }
      return;
    }
    if (mode === "edit" && isDirty) {
      setConfirmState({ open: true, intent: `childJump:${childFormId}` });
      return;
    }
    navigateToChildForm(childFormId, persistedRecordId);
  }, [currentRecordId, entryId, isDirty, mode, navigateToChildForm, triggerSave]);

  const buildChildSectionsForPrint = useCallback(async (targetChildForms) => {
    const isDeleted = (e) => Boolean(e?.deletedAtUnixMs || e?.deletedAt);
    const sections = await Promise.all(
      (targetChildForms || []).map(async (childForm) => {
        const childFormId = String(childForm?.childFormId || "");
        if (!childFormId) return null;
        const childFormRecord = childForm?.form || getFormById(childFormId);
        const childSchema = normalizeSchemaIDs(childFormRecord?.schema || []);
        const result = await dataStore.listEntries(childFormId);
        const allEntries = Array.isArray(result?.entries) ? result.entries : [];
        const entries = allEntries
          .filter((ce) => ce?.parentRecordId === entryId)
          .filter((ce) => !isDeleted(ce))
          .map((ce, idx) => ({
            recordNo: ce?.["No."] === undefined || ce?.["No."] === null || ce?.["No."] === ""
              ? String(idx + 1)
              : String(ce["No."]),
            schema: childSchema,
            responses: restoreResponsesFromData(childSchema, ce?.data || {}, ce?.dataUnixMs || {}),
          }));
        return {
          title: childForm?.formTitle || childFormRecord?.settings?.formTitle || childFormId,
          entries,
        };
      }),
    );
    return sections.filter(Boolean).filter((s) => s.entries.length > 0);
  }, [entryId, getFormById]);

  const executePrintWithChildren = useCallback(async (selectedChildFormIds) => {
    const preview = previewRef.current;
    if (!preview || typeof preview.getPrintDocumentPayload !== "function") return;
    setIsCreatingPrintDocument(true);
    try {
      const targetChildForms = childForms.filter((cf) => selectedChildFormIds.includes(cf.childFormId));
      const childSections = await buildChildSectionsForPrint(targetChildForms);
      const payload = preview.getPrintDocumentPayload({ omitEmptyRows: omitEmptyRowsOnPrint, childSections });
      const result = await createRecordPrintDocument(payload);
      showAlert(
        <div className="nf-col nf-gap-8">
          <div>マイドライブに Google ドキュメントを保存しました。</div>
          <a href={result.fileUrl} target="_blank" rel="noopener noreferrer" className="nf-link nf-fw-600">
            ファイルを開く
          </a>
        </div>,
        "出力完了",
      );
    } catch (error) {
      console.error("[FormPage] failed to create print document:", error);
      showAlert(`印刷様式の出力に失敗しました: ${error?.message || error}`);
    } finally {
      setIsCreatingPrintDocument(false);
    }
  }, [buildChildSectionsForPrint, childForms, omitEmptyRowsOnPrint, showAlert]);

  const handleCreatePrintDocument = useCallback(async () => {
    const preview = previewRef.current;
    if (!preview || typeof preview.getPrintDocumentPayload !== "function") {
      showAlert("印刷様式の出力準備がまだできていません。少し待ってからもう一度お試しください。");
      return;
    }

    if (canIncludeChildrenInPrint) {
      setShowPrintChildFormDialog(true);
      return;
    }

    await executePrintWithChildren([]);
  }, [canIncludeChildrenInPrint, executePrintWithChildren, showAlert]);

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
    const intent = confirmState.intent;
    setConfirmState({ open: false, intent: null });
    if (action === "discard") {
      if (intent === "cancel-edit") {
        if (!entryId) {
          navigateBack();
          return;
        }
        await cancelEditAndRestoreLatest();
        return;
      }
      if (intent === "breadcrumb-nav") {
        const nav = pendingNavStateRef.current;
        pendingNavStateRef.current = null;
        if (nav) navigate(nav.path, { state: nav.state });
        return;
      }
      if (intent && intent.startsWith("breadcrumb:")) {
        const idx = parseInt(intent.slice("breadcrumb:".length), 10);
        const crumb = breadcrumbTrail[idx];
        if (crumb) {
          navigate(`/form/${crumb.formId}/entry/${crumb.recordId}`, {
            state: { breadcrumbTrail: breadcrumbTrail.slice(0, idx) },
          });
        }
        return;
      }
      if (intent && intent.startsWith("childJump:")) {
        const childFormId = intent.slice("childJump:".length);
        navigateToChildForm(childFormId, currentRecordId || entryId);
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
      if (intent === "breadcrumb-nav") {
        const nav = pendingNavStateRef.current;
        pendingNavStateRef.current = null;
        const saveResult = await triggerSave();
        if (saveResult.ok && nav) navigate(nav.path, { state: nav.state });
        return;
      }
      if (intent && intent.startsWith("childJump:")) {
        const childFormId = intent.slice("childJump:".length);
        const saveResult = await triggerSave({ stayAsView: true, skipStayAsViewNavigation: true });
        if (saveResult.ok) {
          navigateToChildForm(childFormId, saveResult.recordId || currentRecordId || entryId);
        }
        return;
      }
      if (intent && intent.startsWith("breadcrumb:")) {
        const idx = parseInt(intent.slice("breadcrumb:".length), 10);
        const crumb = breadcrumbTrail[idx];
        const saveResult = await triggerSave();
        if (saveResult.ok && crumb) {
          navigate(`/form/${crumb.formId}/entry/${crumb.recordId}`, {
            state: { breadcrumbTrail: breadcrumbTrail.slice(0, idx) },
          });
        }
        return;
      }
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
      onSelect: () => setConfirmState({ open: false, intent: null }),
    },
  ];

  const confirmMessage = confirmState.intent === "cancel-edit"
    ? "保存せずに編集内容を破棄しますか？"
    : "保存せずに前の画面へ戻りますか？";
  const editDisabled = loading || isReadLocked;

  return (
    <AppLayout themeOverride={form?.settings?.theme}       title={`${form.settings?.formTitle || "(無題)"} - フォーム入力`}
      fallbackPath={fallbackPath}
      onBack={handleBack}
      backHidden={true}
      badge={{
        label: (loading || isReloading) ? "読み取り中..." : (isViewMode ? "閲覧モード" : "編集モード"),
        variant: (loading || isReloading) ? "loading" : (isViewMode ? "view" : "edit")
      }}
      sidebarActions={
        <>
          {isViewMode ? (
            <>
              <button type="button" className="nf-btn-outline nf-btn-sidebar nf-text-14" onClick={handleEditMode} disabled={editDisabled}>
                編集
              </button>
              <button type="button" className="nf-btn-outline nf-btn-sidebar nf-text-14" onClick={() => navigateBack()}>
                ← 戻る
              </button>
            </>
          ) : (
            <>
              <button type="button" className="nf-btn-outline nf-btn-sidebar nf-text-14" disabled={isSaving || isReadLocked} onClick={() => triggerSave(primarySaveOptions)}>
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
                <button type="button" className="nf-btn-outline nf-btn-sidebar nf-btn-danger nf-text-14" onClick={handleDeleteEntry}>
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
      <BreadcrumbNav
        trail={breadcrumbTrail}
        currentFormId={formId}
        currentFormTitle={form?.settings?.formTitle || "(無題)"}
        currentRecordLabel={entryId ? (responses?.[form?.settings?.representativeFieldId] || entryId) : ""}
        parentRecordId={parentRecordId}
        getFormById={getFormById}
        onNavigate={(path, state) => {
          if (isDirty) {
            pendingNavStateRef.current = { path, state };
            setConfirmState({ open: true, intent: "breadcrumb-nav" });
          } else {
            navigate(path, { state });
          }
        }}
      />
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
          readOnly={isViewMode || isReadLocked}
          entryId={currentRecordId}
          onChildFormJump={handleChildFormJump}
          driveFolderState={driveFolderState}
          onDriveFolderStateChange={setDriveFolderState}
        />
      )}

      <ConfirmDialog
        open={confirmState.open}
        title="未保存の変更があります"
        message={confirmMessage}
        options={confirmOptions}
      />
      <ConfirmDialog
        open={entryActionConfirm.open}
        title={entryActionConfirm.action === "undelete" ? "削除取消し" : "レコードを削除"}
        message={entryActionConfirm.action === "undelete"
          ? "このレコードの削除を取り消し、復活させます。よろしいですか？"
          : "このレコードを削除します。よろしいですか？"}
        options={[
          { label: "キャンセル", value: "cancel", onSelect: () => setEntryActionConfirm({ open: false, action: null }) },
          entryActionConfirm.action === "undelete"
            ? { label: "削除取消し", value: "undelete", variant: "primary", onSelect: confirmEntryAction }
            : { label: "削除", value: "delete", variant: "danger", onSelect: confirmEntryAction },
        ]}
      />

      <RecordCopyDialog
        open={isCopyDialogOpen}
        schema={normalizedSchema}
        sourceResponses={copySourceResponses}
        onConfirm={handleConfirmRecordCopy}
        onCancel={() => setIsCopyDialogOpen(false)}
      />

      <PrintChildFormDialog
        open={showPrintChildFormDialog}
        childForms={childForms}
        onCancel={() => setShowPrintChildFormDialog(false)}
        onSubmit={async (selectedChildFormIds) => {
          setShowPrintChildFormDialog(false);
          await executePrintWithChildren(selectedChildFormIds);
        }}
      />

    </AppLayout>
  );
}
