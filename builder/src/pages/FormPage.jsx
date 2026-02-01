import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import AppLayout from "../app/components/AppLayout.jsx";
import ConfirmDialog from "../app/components/ConfirmDialog.jsx";
import AlertDialog from "../app/components/AlertDialog.jsx";
import PreviewPage from "../features/preview/PreviewPage.jsx";
import { useAppData } from "../app/state/AppDataProvider.jsx";
import { dataStore } from "../app/state/dataStore.js";
import { restoreResponsesFromData, hasDirtyChanges } from "../utils/responses.js";
import { submitResponses, hasScriptRun } from "../services/gasClient.js";
import { normalizeSpreadsheetId } from "../utils/spreadsheet.js";
import { useAlert } from "../app/hooks/useAlert.js";
import { normalizeSchemaIDs } from "../core/schema.js";
import { getCachedEntryWithIndex } from "../app/state/recordsCache.js";
import { evaluateCache, RECORD_CACHE_MAX_AGE_MS } from "../app/state/cachePolicy.js";

const fallbackForForm = (formId, locationState) => {
  if (locationState?.from) return locationState.from;
  if (formId) return `/search?formId=${formId}`;
  return "/";
};

export default function FormPage() {
  const { formId, entryId } = useParams();
  const { getFormById } = useAppData();
  const location = useLocation();
  const navigate = useNavigate();
  const { alertState, showAlert, closeAlert } = useAlert();
  const form = formId ? getFormById(formId) : null;
  const normalizedSchema = useMemo(() => normalizeSchemaIDs(form?.schema || []), [form]);
  const [entry, setEntry] = useState(null);
  const [loading, setLoading] = useState(true);
  const [responses, setResponses] = useState({});
  const [currentRecordId, setCurrentRecordId] = useState(entryId || null);
  const [confirmState, setConfirmState] = useState({ open: false, intent: null });
  const [isSaving, setIsSaving] = useState(false);
  const [mode, setMode] = useState(entryId ? "view" : "edit");
  const [isReloading, setIsReloading] = useState(false);
  const initialResponsesRef = useRef({});
  const previewRef = useRef(null);

  const fallbackPath = useMemo(() => fallbackForForm(formId, location.state), [formId, location.state]);

  useEffect(() => {
    setMode(entryId ? "view" : "edit");
  }, [entryId]);

  const isViewMode = mode === "view";

  useEffect(() => {
    let mounted = true;
    const loadEntry = async () => {
      const tStart = performance.now();
      console.log(`[PERF] FormPage loadEntry START - formId: ${formId}, entryId: ${entryId}`);

      if (!formId || !form) {
        setLoading(false);
        return;
      }
      if (!entryId) {
        initialResponsesRef.current = {};
        setResponses({});
        setLoading(false);
        return;
      }
      setLoading(true);

      const tBeforeGetEntry = performance.now();
      console.log(`[PERF] FormPage before dataStore.getEntry - Time from start: ${(tBeforeGetEntry - tStart).toFixed(2)}ms`);

      // まずキャッシュから取得を試みる
      const { entry: cachedEntry, rowIndex, lastSyncedAt } = await getCachedEntryWithIndex(formId, entryId);

      if (cachedEntry && mounted) {
        // キャッシュがあれば即座に表示
        setEntry(cachedEntry);
        const restored = restoreResponsesFromData(normalizedSchema, cachedEntry?.data || {}, cachedEntry?.dataUnixMs || {});
        initialResponsesRef.current = restored;
        setResponses(restored);
        setCurrentRecordId(cachedEntry?.id || entryId);
        setLoading(false);
        console.log(`[PERF] FormPage cache displayed - Time: ${(performance.now() - tStart).toFixed(2)}ms, rowIndex: ${rowIndex}`);

        // キャッシュ年齢を計算し、5分以上古い場合はバックグラウンド更新
        const cacheAge = lastSyncedAt ? Date.now() - lastSyncedAt : Infinity;
        const shouldBackground = cacheAge >= RECORD_CACHE_MAX_AGE_MS;

        if (shouldBackground) {
          console.log(`[PERF] FormPage starting background refresh (cache age: ${cacheAge}ms, threshold: ${RECORD_CACHE_MAX_AGE_MS}ms, rowIndexHint: ${rowIndex})`);
          setIsReloading(true);
          dataStore.getEntry(formId, entryId, { rowIndexHint: rowIndex }).then((freshData) => {
            if (!mounted) return;
            if (freshData) {
              setEntry(freshData);
              const freshRestored = restoreResponsesFromData(normalizedSchema, freshData?.data || {}, freshData?.dataUnixMs || {});
              initialResponsesRef.current = freshRestored;
              setResponses(freshRestored);
              setCurrentRecordId(freshData?.id || entryId);
              console.log(`[PERF] FormPage background refresh complete - Total time: ${(performance.now() - tStart).toFixed(2)}ms`);
            }
            setIsReloading(false);
          }).catch((error) => {
            console.error("[FormPage] background refresh failed:", error);
            setIsReloading(false);
          });
        } else {
          console.log(`[PERF] FormPage cache is fresh (age: ${cacheAge}ms, threshold: ${RECORD_CACHE_MAX_AGE_MS}ms), no background refresh`);
        }
      } else {
        // キャッシュがない場合は同期読み取り（rowIndexがある場合は渡す）
        const data = await dataStore.getEntry(formId, entryId, rowIndex !== undefined ? { rowIndexHint: rowIndex } : {});

        const tAfterGetEntry = performance.now();
        console.log(`[PERF] FormPage after dataStore.getEntry - Time: ${(tAfterGetEntry - tBeforeGetEntry).toFixed(2)}ms, rowIndexHint: ${rowIndex}`);

        if (!mounted) return;
        setEntry(data);

        const tBeforeRestore = performance.now();
        const restored = restoreResponsesFromData(normalizedSchema, data?.data || {}, data?.dataUnixMs || {});
        const tAfterRestore = performance.now();
        console.log(`[PERF] FormPage restoreResponsesFromData - Time: ${(tAfterRestore - tBeforeRestore).toFixed(2)}ms`);

        initialResponsesRef.current = restored;
        setResponses(restored);
        setCurrentRecordId(data?.id || entryId);
        setLoading(false);

        const tEnd = performance.now();
        console.log(`[PERF] FormPage loadEntry COMPLETE - Total time: ${(tEnd - tStart).toFixed(2)}ms`);
      }
    };
    loadEntry();
    return () => {
      mounted = false;
    };
  }, [formId, entryId, form, normalizedSchema]);

  const isDirty = useMemo(() => hasDirtyChanges(initialResponsesRef.current, responses), [responses]);

  useEffect(() => {
    const handleBeforeUnload = (event) => {
      if (!isDirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

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

    // まずスプレッドシートに保存（主データソース）
    const settings = form.settings || {};
    const spreadsheetId = normalizeSpreadsheetId(settings.spreadsheetId || "");
    const sheetName = settings.sheetName || "Data";

    let resolvedId = payload.id;
    if (spreadsheetId) {
      if (!hasScriptRun()) {
        throw new Error("この機能はGoogle Apps Script環境でのみ利用可能です");
      }
      const res = await submitResponses({
        spreadsheetId,
        sheetName,
        payload,
      });
      if (res && res.id) {
        resolvedId = res.id;
      }
    } else {
      console.warn("[FormPage] No spreadsheetId configured, skipping spreadsheet save");
    }

    // 次にIndexedDBにキャッシュとして保存
    const saved = await dataStore.upsertEntry(form.id, {
      id: resolvedId,
      data: payload.responses,
      order: payload.order,
    });
    setCurrentRecordId(saved.id);
    const restored = restoreResponsesFromData(normalizedSchema, saved.data || {}, saved.dataUnixMs || {});
    initialResponsesRef.current = restored;
    setResponses(restored);
    setEntry(saved);
    return saved;
  };

  const triggerSave = async ({ redirect } = {}) => {
    if (!form) {
      showAlert("フォームが見つかりません");
      return;
    }
    try {
      setIsSaving(true);
      const preview = previewRef.current;
      if (!preview) throw new Error("preview_not_ready");
      await preview.submit({ silent: true });
      if (redirect) navigateBack({ saved: true });
    } catch (error) {
      console.warn(error);
      if (error?.message === "validation_failed" || error?.message?.includes("missing_")) {
        setIsSaving(false);
        return;
      }
      setIsSaving(false);
      showAlert(`保存に失敗しました: ${error?.message || error}`);
      return;
    }
    setIsSaving(false);
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
      setEntry(data);
      const restored = restoreResponsesFromData(normalizedSchema, data?.data || {}, data?.dataUnixMs || {});
      initialResponsesRef.current = restored;
      setResponses(restored);
      setCurrentRecordId(data?.id || entryId);
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

  if (!form) {
    return (
      <AppLayout title="フォーム" fallbackPath="/">
        <p className="nf-text-subtle">フォームが見つかりません。メイン画面からやり直してください。</p>
      </AppLayout>
    );
  }

  const handleConfirmAction = async (action) => {
    setConfirmState({ open: false, intent: null });
    if (action === "discard") {
      navigateBack();
      return;
    }
    if (action === "save") {
      await triggerSave({ redirect: true });
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
    <AppLayout
      title={`${form.settings?.formTitle || "(無題)"} - フォーム入力`}
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
              <button type="button" className="nf-btn-outline nf-btn-sidebar nf-text-14" disabled={isSaving || isReloading} onClick={() => triggerSave({ redirect: true })}>
                保存
              </button>
              <button type="button" className="nf-btn-outline nf-btn-sidebar nf-text-14" onClick={() => attemptLeave("cancel")}>
                キャンセル
              </button>
            </>
          )}
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
          setResponses={setResponses}
          settings={{ ...(form.settings || {}), recordId: currentRecordId, recordNo: entry?.["No."] || "" }}
          onSave={handleSaveToStore}
          showOutputJson={false}
          showSaveButton={false}
          readOnly={isViewMode || isReloading}
        />
      )}

      <ConfirmDialog
        open={confirmState.open}
        title="未保存の変更があります"
        message={confirmMessage}
        options={confirmOptions}
      />

      <AlertDialog open={alertState.open} title={alertState.title} message={alertState.message} onClose={closeAlert} />
    </AppLayout>
  );
}
