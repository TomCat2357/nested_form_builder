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

  const [name, setName] = useState(initialMetaRef.current.name);
  const [description, setDescription] = useState(initialMetaRef.current.description);
  const [driveUrl, setDriveUrl] = useState(form?.driveFileUrl || "");
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
          setQuestionControl(control);
        }
      }
    }, 100);
    return () => clearInterval(interval);
  }, [questionControl]);

  useEffect(() => {
    if (!form) return;
    const formTitle = form.settings?.formTitle || "";
    initialMetaRef.current = { name: formTitle, description: form.description || "" };
    setName(formTitle);
    setDescription(form.description || "");
    setDriveUrl(form.driveFileUrl || "");
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
      // Include existing form data for fallback when getForm fails
      ...(isEdit && form ? { id: form.id, createdAt: form.createdAt, driveFileUrl: form.driveFileUrl } : {}),
      description,
      schema: cleanedSchema,
      settings: { ...settings, formTitle: trimmedName },
      archived: form?.archived ?? false,
      schemaVersion: form?.schemaVersion ?? 1,
    };

    // driveUrlが指定されている場合、それを使用
    const targetUrl = driveUrl?.trim() || null;

    try {
      setIsSaving(true);
      if (isEdit) await updateForm(formId, payload, targetUrl);
      else await createForm(payload, targetUrl);
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
        <div style={fieldStyle}>
          <label>Google Drive保存先URL（オプション）</label>
          <input
            value={driveUrl}
            onChange={(event) => setDriveUrl(event.target.value)}
            style={inputStyle}
            placeholder="空白: ルートディレクトリ / フォルダURL: ランダム名で保存 / ファイルURL: そのファイルに保存"
          />
          <p style={{ fontSize: 11, color: "#6B7280", marginTop: 4, marginBottom: 0 }}>
            空白の場合はルートディレクトリに保存されます。フォルダURLを指定するとそのフォルダにランダム名で保存、ファイルURLを指定するとそのファイルに保存されます。
          </p>
          {isEdit && driveUrl && (
            <p style={{ fontSize: 11, color: "#2563EB", marginTop: 4, marginBottom: 0 }}>
              変更すると新しい場所に保存され、元のファイルはそのまま残ります。
            </p>
          )}
        </div>
      </section>

      <FormBuilderWorkspace
        ref={builderRef}
        initialSchema={form?.schema || []}
        initialSettings={form?.settings || {}}
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
