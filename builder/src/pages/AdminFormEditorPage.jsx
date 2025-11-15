import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import AppLayout from "../app/components/AppLayout.jsx";
import ConfirmDialog from "../app/components/ConfirmDialog.jsx";
import AlertDialog from "../app/components/AlertDialog.jsx";
import FormBuilderWorkspace from "../features/admin/FormBuilderWorkspace.jsx";
import { useAppData } from "../app/state/AppDataProvider.jsx";
import { useAlert } from "../app/hooks/useAlert.js";
import { normalizeSpreadsheetId } from "../utils/spreadsheet.js";
import { cleanupTempData } from "../core/schema.js";

const headerButtonStyle = {
  padding: "8px 14px",
  borderRadius: 8,
  border: "1px solid #CBD5E1",
  background: "#fff",
  cursor: "pointer",
  fontSize: 14,
};

const fieldStyle = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  marginBottom: 16,
};

const inputStyle = {
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid #CBD5E1",
  fontSize: 14,
};

const fallbackPath = (locationState) => (locationState?.from ? locationState.from : "/admin");

export default function AdminFormEditorPage() {
  const { formId } = useParams();
  const isEdit = Boolean(formId);
  const { forms, getFormById, createForm, updateForm } = useAppData();
  const form = isEdit ? getFormById(formId) : null;
  const navigate = useNavigate();
  const location = useLocation();
  const { alertState, showAlert, closeAlert } = useAlert();
  const fallback = useMemo(() => fallbackPath(location.state), [location.state]);
  const builderRef = useRef(null);
  const initialMetaRef = useRef({ name: form?.name || "新規フォーム", description: form?.description || "" });
  const initialSettingsRef = useRef(form?.settings || { formTitle: initialMetaRef.current.name });

  const [name, setName] = useState(initialMetaRef.current.name);
  const [description, setDescription] = useState(initialMetaRef.current.description);
  const [builderDirty, setBuilderDirty] = useState(false);
  const [confirmState, setConfirmState] = useState(false);
  const [confirmSave, setConfirmSave] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [nameError, setNameError] = useState("");
  const [questionControl, setQuestionControl] = useState(null);

  // QuestionControlの更新を監視
  useEffect(() => {
    const interval = setInterval(() => {
      if (builderRef.current) {
        const control = builderRef.current.getQuestionControl?.();
        if (control !== questionControl) {
          console.log('[AdminFormEditorPage] questionControl updated:', control);
          setQuestionControl(control);
        }
      }
    }, 100);
    return () => clearInterval(interval);
  }, [questionControl]);

  useEffect(() => {
    if (!form) return;
    initialMetaRef.current = { name: form.name || "", description: form.description || "" };
    initialSettingsRef.current = form.settings || { formTitle: form.name || "" };
    setName(form.name || "");
    setDescription(form.description || "");
    setNameError("");
  }, [form]);

  const metaDirty = useMemo(() => name !== initialMetaRef.current.name || description !== initialMetaRef.current.description, [name, description]);
  const isDirty = builderDirty || metaDirty;

  useEffect(() => {
    const handleBeforeUnload = (event) => {
      if (!isDirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  const navigateBack = () => {
    if (location.state?.from) {
      navigate(location.state.from, { replace: true });
      return;
    }
    navigate(fallback, { replace: true });
  };

  const handleSaveClick = () => {
    // バリデーションのみ実行
    if (!builderRef.current) return;
    const trimmedName = (name || "").trim();
    if (!trimmedName) {
      setNameError("フォーム名を入力してください");
      return;
    }
    const duplicate = forms.some((existing) => existing.name === trimmedName && existing.id !== (form?.id || null));
    if (duplicate) {
      setNameError(`「${trimmedName}」は既に存在します。別の名称を入力してください。`);
      return;
    }
    setNameError("");

    // 確認ダイアログを表示
    setConfirmSave(true);
  };

  const handleSave = async () => {
    if (!builderRef.current) return;

    builderRef.current.save();
    const schema = builderRef.current.getSchema();
    const settings = builderRef.current.getSettings();
    const trimmedName = (name || "").trim();

    // 一時保存データをクリーンアップ
    const cleanedSchema = cleanupTempData(schema);

    const payload = {
      name: trimmedName,
      description,
      schema: cleanedSchema,
      settings: { ...settings, formTitle: settings?.formTitle || trimmedName },
    };
    try {
      setIsSaving(true);
      if (isEdit) await updateForm(formId, payload);
      else await createForm(payload);
      initialMetaRef.current = { name: payload.name, description: payload.description || "" };
      setBuilderDirty(false);
      setIsSaving(false);
      navigate("/admin", { replace: true });
    } catch (error) {
      console.error(error);
      setIsSaving(false);
      showAlert(`保存に失敗しました: ${error?.message || error}`);
    }
  };

  const handleBack = () => {
    if (!isDirty) {
      navigateBack();
      return false;
    }
    setConfirmState(true);
    return false;
  };

  const handleCancel = () => {
    if (!isDirty) {
      navigateBack();
    } else {
      setConfirmState(true);
    }
  };

  const handleOpenSpreadsheet = () => {
    if (!builderRef.current) return;
    const settings = builderRef.current.getSettings();
    const spreadsheetIdOrUrl = settings?.spreadsheetId || "";

    if (!spreadsheetIdOrUrl) {
      showAlert("スプレッドシートIDが設定されていません");
      return;
    }

    // URLまたはIDからスプレッドシートIDを抽出
    const spreadsheetId = normalizeSpreadsheetId(spreadsheetIdOrUrl);

    // スプレッドシートを新しいタブで開く
    const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const confirmOptions = [
    {
      label: "保存して続行",
      value: "save",
      variant: "primary",
      onSelect: async () => {
        setConfirmState(false);
        await handleSave();
      },
    },
    {
      label: "保存せずに戻る",
      value: "discard",
      onSelect: () => {
        setConfirmState(false);
        navigateBack();
      },
    },
    {
      label: "キャンセル",
      value: "cancel",
      onSelect: () => setConfirmState(false),
    },
  ];

  const sidebarButtonStyle = {
    ...headerButtonStyle,
    width: "100%",
    textAlign: "left",
  };

  return (
    <AppLayout
      title={isEdit ? "フォーム修正" : "フォーム新規作成"}
      badge="管理"
      fallbackPath={fallback}
      onBack={handleBack}
      backHidden={true}
      sidebarActions={
        <>
          <button type="button" style={sidebarButtonStyle} disabled={isSaving} onClick={handleSaveClick}>
            保存
          </button>
          <button type="button" style={sidebarButtonStyle} onClick={handleCancel}>
            キャンセル
          </button>
          <div style={{ height: 16 }} />
          <button
            type="button"
            style={{
              ...sidebarButtonStyle,
              background: questionControl?.canMoveUp ? "#fff" : "#F3F4F6",
              color: questionControl?.canMoveUp ? "#000" : "#9CA3AF",
              cursor: questionControl?.canMoveUp ? "pointer" : "not-allowed",
            }}
            disabled={!questionControl?.canMoveUp}
            onClick={() => questionControl?.moveUp?.()}
          >
            ↑ 上へ
          </button>
          <button
            type="button"
            style={{
              ...sidebarButtonStyle,
              background: questionControl?.canMoveDown ? "#fff" : "#F3F4F6",
              color: questionControl?.canMoveDown ? "#000" : "#9CA3AF",
              cursor: questionControl?.canMoveDown ? "pointer" : "not-allowed",
            }}
            disabled={!questionControl?.canMoveDown}
            onClick={() => questionControl?.moveDown?.()}
          >
            ↓ 下へ
          </button>
          {questionControl?.selectedIndex !== null && (
            <div style={{ fontSize: 11, color: "#64748B", padding: "4px 8px", textAlign: "center", wordBreak: "break-word" }}>
              {questionControl?.isOption
                ? `${questionControl?.questionLabel || `質問 ${(questionControl?.selectedIndex ?? 0) + 1}`} > ${questionControl?.optionLabel || `選択肢 ${(questionControl?.optionIndex ?? 0) + 1}`}`
                : questionControl?.questionLabel || `質問 ${(questionControl?.selectedIndex ?? 0) + 1}`
              }
            </div>
          )}
          <div style={{ flex: 1 }} />
          <button
            type="button"
            style={{
              ...sidebarButtonStyle,
              marginTop: "auto",
              background: "#E0F2FE",
              borderColor: "#38BDF8",
            }}
            onClick={handleOpenSpreadsheet}
          >
            📊 スプレッドシートを開く
          </button>
        </>
      }
    >
      <section style={{ marginBottom: 24 }}>
        <div style={fieldStyle}>
          <label>フォーム名</label>
          <input
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              if (nameError) setNameError("");
            }}
            style={inputStyle}
            placeholder="フォーム名"
          />
          {nameError && <p style={{ color: "#DC2626", fontSize: 12, margin: 0 }}>{nameError}</p>}
        </div>
        <div style={fieldStyle}>
          <label>説明</label>
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} style={{ ...inputStyle, minHeight: 80 }} placeholder="説明" />
        </div>
      </section>

      <FormBuilderWorkspace
        ref={builderRef}
        initialSchema={form?.schema || []}
        initialSettings={initialSettingsRef.current}
        formTitle={name || "フォーム"}
        onDirtyChange={setBuilderDirty}
        showToolbarSave={false}
      />

      <ConfirmDialog open={confirmState} title="未保存の変更があります" message="保存せずに離れますか？" options={confirmOptions} />

      <ConfirmDialog
        open={confirmSave}
        title="フォームを保存"
        message={isEdit ? "フォームを更新してよろしいですか？" : "フォームを作成してよろしいですか？"}
        options={[
          {
            label: "キャンセル",
            value: "cancel",
            onSelect: () => setConfirmSave(false),
          },
          {
            label: "保存",
            value: "save",
            variant: "primary",
            onSelect: async () => {
              setConfirmSave(false);
              await handleSave();
            },
          },
        ]}
      />

      <AlertDialog open={alertState.open} title={alertState.title} message={alertState.message} onClose={closeAlert} />
    </AppLayout>
  );
}
