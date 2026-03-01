import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLatestRef } from "../app/hooks/useLatestRef.js";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import AppLayout from "../app/components/AppLayout.jsx";
import ConfirmDialog from "../app/components/ConfirmDialog.jsx";
import PreviewPage from "../features/preview/PreviewPage.jsx";
import { useAppData } from "../app/state/AppDataProvider.jsx";
import { dataStore } from "../app/state/dataStore.js";
import { restoreResponsesFromData, hasDirtyChanges, collectDefaultNowResponses } from "../utils/responses.js";
import { acquireSaveLock, submitResponses, hasScriptRun } from "../services/gasClient.js";
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

export default function FormPage() {
  const { formId, entryId } = useParams();
  const { getFormById, refreshForms, loadingForms } = useAppData();
  const { userName, userEmail } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { showAlert, showToast } = useAlert();
  const currentForm = formId ? getFormById(formId) : null;
  const [cachedForm, setCachedForm] = useState(currentForm);

  const form = cachedForm;
  const normalizedSchema = useMemo(() => normalizeSchemaIDs(form?.schema || []), [form]);
  const [entry, setEntry] = useState(null);
  const [loading, setLoading] = useState(true);

  const draftKey = `nfb_draft_${formId}_${entryId || 'new'}`;

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
  const [currentRecordId, setCurrentRecordId] = useState(entryId || null);
  const [confirmState, setConfirmState] = useState({ open: false, intent: null });
  const [isSaving, setIsSaving] = useState(false);
  const [mode, setMode] = useState(entryId ? "view" : "edit");
  const [isReloading, setIsReloading] = useState(false);
  const [copySourceId, setCopySourceId] = useState("");
  const [copySourceResponses, setCopySourceResponses] = useState({});
  const [isCopyDialogOpen, setIsCopyDialogOpen] = useState(false);
  const [isCopySourceLoading, setIsCopySourceLoading] = useState(false);
  const { isReadLocked, withReadLock } = useEditLock();
  const initialResponsesRef = useRef({});
  const previewRef = useRef(null);
  const newEntryInitKeyRef = useRef(null);
  const responseMutationSeqRef = useRef(0);
  const formLoadedStateRef = useRef(null);

  const fallbackPath = useMemo(() => fallbackForForm(formId, location.state), [formId, location.state]);

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

  useEffect(() => {
    setMode(entryId ? "view" : "edit");
  }, [entryId]);

  const isViewMode = mode === "view";
  const canCopyFromExistingRecord = !entryId && !isViewMode;
  const isDirty = useMemo(() => hasDirtyChanges(initialResponsesRef.current, responses), [responses]);
  const isDirtyRef = useLatestRef(isDirty);
  const isViewModeRef = useLatestRef(isViewMode);
  const normalizedSchemaRef = useLatestRef(normalizedSchema);
  const userNameRef = useLatestRef(userName);
  const userEmailRef = useLatestRef(userEmail);

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
        console.log("[FormPage] responses mutated", {
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
    const previous = responsesRef.current;
    const diff = diffResponses(previous, restored);
    const hasPotentialOverwrite = diff.removedKeys.length > 0 || diff.changedKeys.length > 6;
    if (hasPotentialOverwrite || source !== "save:new-entry") {
      console.log("[FormPage] applyEntryToState", {
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
    initialResponsesRef.current = restored;
    commitResponses(`applyEntryToState:${source}`, restored, {
      forceLog: true,
      meta: { nextEntryId: nextEntry?.id || fallbackEntryId || null },
    });
    setCurrentRecordId(nextEntry?.id || fallbackEntryId || null);
  }, [commitResponses, entryId, formId, isDirtyRef, isViewModeRef, normalizedSchemaRef, responsesRef]);
  const applyEntryToStateRef = useLatestRef(applyEntryToState);

  const navigateToEntryById = useCallback((targetEntryId) => {
    navigate(`/form/${formId}/entry/${targetEntryId}`, {
      state: { from: location.state?.from, entryIds },
      replace: true,
    });
  }, [navigate, formId, location.state?.from, entryIds]);

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

        const initialResponses = collectDefaultNowResponses(normalizedSchemaRef.current, new Date(), { userName: userNameRef.current, userEmail: userEmailRef.current });
        initialResponsesRef.current = initialResponses;
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
            if (freshData && isViewModeRef.current && !isDirtyRef.current) {
              applyEntryToStateRef.current(freshData, entryId, "loadEntry:background-refresh");
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
        if (data && (!isDirtyRef.current || isViewModeRef.current)) {
          applyEntryToStateRef.current(data, entryId, "loadEntry:sync-read");
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
              if (latest && !isDirtyRef.current && isViewModeRef.current) {
                applyEntryToStateRef.current(latest, entryId, "operation-cache:sync");
              }
            } finally {
              setLoading(false);
            }
          } else if (cacheDecision.shouldBackground) {
            setIsReloading(true);
            dataStore.getEntry(formId, entryId, options)
              .then((latest) => {
                if (latest && !isDirtyRef.current && isViewModeRef.current) {
                  applyEntryToStateRef.current(latest, entryId, "operation-cache:background");
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
  }, [entryId, formId, refreshFormsIfNeeded]);

  useOperationCacheTrigger({
    enabled: Boolean(formId),
    onOperation: handleOperationCacheCheck,
  });

  useBeforeUnloadGuard(isDirty);

  const navigateBack = ({ saved = false } = {}) => {
    const state = saved ? { saved: true } : undefined;
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

  const handleSaveToStore = async ({ payload }) => {
    if (!form) throw new Error("form_not_found");

    try {
      sessionStorage.removeItem(draftKey);
    } catch(e) {}

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

    const saved = await dataStore.upsertEntry(form.id, {
      id: payloadWithFormId.id,
      data: payloadWithFormId.responses,
      order: payloadWithFormId.order,
      createdBy,
      modifiedBy,
      "No.": entry?.["No."],
    });
    applyEntryToState(saved, saved.id, "save:new-entry");

    if (requiresSpreadsheetSave) {
      void acquireSaveLock({ spreadsheetId, sheetName })
        .then(() => submitResponses({
          spreadsheetId,
          sheetName,
          payload: { ...payloadWithFormId, id: saved.id },
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
    return saved;
  };

  const triggerSave = async ({ redirect } = {}) => {
    if (!form) {
      showAlert("フォームが見つかりません");
      return false;
    }
    if (isReadLocked) return false;
    setIsSaving(true);
    try {
      const preview = previewRef.current;
      if (!preview) throw new Error("preview_not_ready");
      await preview.submit({ silent: true });
      if (redirect) navigateBack({ saved: true });
      return true;
    } catch (error) {
      console.warn(error);
      if (error?.message === "validation_failed" || error?.message?.includes("missing_")) {
        return false;
      }
      if (error?.code === GAS_ERROR_CODE_LOCK_TIMEOUT) {
        showAlert(
          "現在、他のユーザーによる更新処理が実行中のため保存できませんでした。しばらく時間をおいて、もう一度お試しください。",
          "保存を完了できませんでした",
        );
        return false;
      }
      showAlert(`保存に失敗しました: ${error?.message || error}`);
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const attemptLeave = (intent) => {
    if (isDirty) {
      setConfirmState({ open: true, intent });
      return;
    }
    if (intent === "back" || intent === "cancel") {
      navigateBack();
      return;
    }
  };

  const handleEditMode = async () => {
    if (!formId || !entryId) return;
    setIsReloading(true);
    setMode("edit");
    try {
      const data = await dataStore.getEntry(formId, entryId, { forceSync: true });
      if (!data) {
        showAlert("レコードが見つかりませんでした。削除された可能性があります。");
        navigateBack();
        return;
      }
      applyEntryToState(data, entryId, "handleEditMode:forceSync");
    } catch (error) {
      console.error("[FormPage] handleEditMode error:", error);
      showAlert(`データの読み込みに失敗しました: ${error?.message || error}`);
    } finally {
      setIsReloading(false);
    }
  };

  const handleBack = () => {
    if (!isDirty) {
      navigateBack();
      return false;
    }
    setConfirmState({ open: true, intent: "back" });
    return false;
  };

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
        const saved = await triggerSave();
        if (saved) navigateToEntryById(targetEntryId);
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

  const confirmMessage = "保存せずに前の画面へ戻りますか？";

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
              <button type="button" className="nf-btn-outline nf-btn-sidebar nf-text-14" onClick={handleEditMode}>
                編集
              </button>
              <button type="button" className="nf-btn-outline nf-btn-sidebar nf-text-14" onClick={() => navigateBack()}>
                戻る
              </button>
            </>
          ) : (
            <>
              <button type="button" className="nf-btn-outline nf-btn-sidebar nf-text-14" disabled={isSaving || isReloading || isReadLocked} onClick={() => triggerSave({ redirect: true })}>
                保存
              </button>
              <button type="button" className="nf-btn-outline nf-btn-sidebar nf-text-14" onClick={() => attemptLeave("cancel")}>
                キャンセル
              </button>
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
                    disabled={isCopySourceLoading || isSaving || isReloading || isReadLocked}
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
          <SchemaMapNav schema={normalizedSchema} />
        </>
      }
    >
      {loading ? (
        <p className="nf-text-subtle">読み込み中...</p>
      ) : (
        <PreviewPage
          ref={previewRef}
          schema={normalizedSchema}
          responses={responses}
          setResponses={handleResponsesChange}
          settings={{ ...(form.settings || {}), recordId: currentRecordId, recordNo: entry?.["No."] || "", userName, userEmail }}
          onSave={handleSaveToStore}
          showOutputJson={false}
          showSaveButton={false}
          readOnly={isViewMode || isReloading || isReadLocked}
        />
      )}

      <ConfirmDialog
        open={confirmState.open}
        title="未保存の変更があります"
        message={confirmMessage}
        options={confirmOptions}
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
