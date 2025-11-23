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

const buttonStyle = {
  padding: "8px 14px",
  borderRadius: 8,
  border: "1px solid #CBD5E1",
  background: "#fff",
  cursor: "pointer",
  fontSize: 14,
};

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
  const initialResponsesRef = useRef({});
  const previewRef = useRef(null);

  const fallbackPath = useMemo(() => fallbackForForm(formId, location.state), [formId, location.state]);

  useEffect(() => {
    let mounted = true;
    const loadEntry = async () => {
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
      const data = await dataStore.getEntry(formId, entryId);
      if (!mounted) return;
      setEntry(data);
      const restored = restoreResponsesFromData(normalizedSchema, data?.data || {}, data?.dataUnixMs || {});
      initialResponsesRef.current = restored;
      setResponses(restored);
      setCurrentRecordId(data?.id || entryId);
      setLoading(false);
    };
    loadEntry();
    return () => {
      mounted = false;
    };
  }, [formId, entryId, form]);

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
    const sheetName = settings.sheetName || "Responses";

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
    } else if (intent === "back" || intent === "cancel") {
      navigateBack();
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
        <p style={{ color: "#6B7280" }}>フォームが見つかりません。メイン画面からやり直してください。</p>
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

  const sidebarButtonStyle = {
    ...buttonStyle,
    width: "100%",
    textAlign: "left",
  };

  return (
    <AppLayout
      title={`${form.settings?.formTitle || "(無題)"} - フォーム入力`}
      fallbackPath={fallbackPath}
      onBack={handleBack}
      backHidden={true}
      sidebarActions={
        <>
          <button type="button" style={sidebarButtonStyle} disabled={isSaving} onClick={() => triggerSave({ redirect: true })}>
            保存
          </button>
          <button type="button" style={sidebarButtonStyle} onClick={() => attemptLeave("cancel")}>
            キャンセル
          </button>
        </>
      }
    >
      {loading ? (
        <p style={{ color: "#6B7280" }}>読み込み中...</p>
      ) : (
        <PreviewPage
          ref={previewRef}
          schema={normalizedSchema}
          responses={responses}
          setResponses={setResponses}
          settings={{ ...(form.settings || {}), recordId: currentRecordId }}
          onSave={handleSaveToStore}
          showOutputJson={false}
          showSaveButton={false}
        />
      )}

      <ConfirmDialog
        open={confirmState.open}
        title="未保存の変更があります"
        message="保存せずに前の画面へ戻りますか？"
        options={confirmOptions}
      />

      <AlertDialog open={alertState.open} title={alertState.title} message={alertState.message} onClose={closeAlert} />
    </AppLayout>
  );
}
