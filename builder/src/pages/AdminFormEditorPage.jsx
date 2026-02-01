import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import AppLayout from "../app/components/AppLayout.jsx";
import ConfirmDialog from "../app/components/ConfirmDialog.jsx";
import AlertDialog from "../app/components/AlertDialog.jsx";
import FormBuilderWorkspace from "../features/admin/FormBuilderWorkspace.jsx";
import { SETTINGS_GROUPS } from "../features/settings/settingsSchema.js";
import { useAppData } from "../app/state/AppDataProvider.jsx";
import { useAlert } from "../app/hooks/useAlert.js";
import { normalizeSpreadsheetId } from "../utils/spreadsheet.js";
import { validateSpreadsheet } from "../services/gasClient.js";
import { cleanupTempData } from "../core/schema.js";

const fallbackPath = (locationState) => (locationState?.from ? locationState.from : "/forms");

const omitThemeSetting = (settings) => {
  if (!settings || typeof settings !== "object") return {};
  const { theme, ...rest } = settings;
  return rest;
};

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
  const initialSchema = useMemo(() => (form?.schema ? form.schema : []), [form]);
  const initialSettings = useMemo(() => omitThemeSetting(form?.settings || {}), [form]);

  const [name, setName] = useState(initialMetaRef.current.name);
  const [description, setDescription] = useState(initialMetaRef.current.description);
  const [driveUrl, setDriveUrl] = useState(form?.driveFileUrl || "");
  const [localSettings, setLocalSettings] = useState(initialSettings);
  const [builderDirty, setBuilderDirty] = useState(false);
  const [confirmState, setConfirmState] = useState(false);
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
    setLocalSettings(omitThemeSetting(form.settings || {}));
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

  const handleSettingsChange = useCallback((key, value) => {
    setLocalSettings((prev) => ({ ...prev, [key]: value }));
    builderRef.current?.updateSetting?.(key, value);
  }, []);

  const checkSpreadsheet = useCallback(async (spreadsheetIdOrUrl) => {
    const trimmed = (spreadsheetIdOrUrl || "").trim();
    if (!trimmed) {
      // 未設定の場合はマイドライブに新規作成されるのでOK
      return true;
    }
    try {
      const result = await validateSpreadsheet(trimmed);
      if (!result?.canView) {
        showAlert("閲覧権限がありません。アクセス権を確認してください");
        return false;
      }
      if (!result.canEdit) {
        showAlert("閲覧権限のみで続行します。保存に失敗する場合は編集権限を付与してください。");
      }
      return true;
    } catch (error) {
      console.error("[AdminFormEditorPage] validateSpreadsheet failed", error);
      showAlert(error?.message || "スプレッドシートを確認できません");
      return false;
    }
  }, [showAlert]);

  const handleSave = async () => {
    if (!builderRef.current) return;
    if (isSaving) return;
    setIsSaving(true);

    const trimmedName = (name || "").trim();
    if (!trimmedName) {
      setNameError("フォーム名を入力してください");
      setIsSaving(false);
      return;
    }
    setNameError("");

    const settingsForCheck = builderRef.current.getSettings?.() || {};
    const spreadsheetOk = await checkSpreadsheet(settingsForCheck.spreadsheetId || "");
    if (!spreadsheetOk) {
      setIsSaving(false);
      return;
    }

    // バリデーション実行（失敗時はfalseを返す）
    const saveResult = builderRef.current.save();
    if (saveResult === false) {
      setIsSaving(false);
      return;
    }

    const schema = builderRef.current.getSchema();
    const settings = builderRef.current.getSettings();
    const trimmedSettings = omitThemeSetting(settings);
    // 一時保存データをクリーンアップ
    const cleanedSchema = cleanupTempData(schema);

    const collectStyleStats = (schemaArr) => {
      let totalQuestions = 0;
      let showStyleSettingsTrue = 0;
      let styleSettingsPresent = 0;
      const walk = (arr) => {
        (arr || []).forEach((field) => {
          totalQuestions += 1;
          if (field?.showStyleSettings === true) showStyleSettingsTrue += 1;
          if (field?.styleSettings) styleSettingsPresent += 1;
          if (field?.childrenByValue && typeof field.childrenByValue === "object") {
            Object.values(field.childrenByValue).forEach((children) => walk(children));
          }
        });
      };
      walk(schemaArr);
      return { totalQuestions, showStyleSettingsTrue, styleSettingsPresent };
    };

    console.log("[AdminFormEditorPage] style settings stats", {
      formId,
      beforeCleanup: collectStyleStats(schema),
      afterCleanup: collectStyleStats(cleanedSchema),
    });

    const payload = {
      // Include existing form data for fallback when getForm fails
      ...(isEdit && form ? { id: form.id, createdAt: form.createdAt, driveFileUrl: form.driveFileUrl } : {}),
      description,
      schema: cleanedSchema,
      settings: { ...trimmedSettings, formTitle: trimmedName },
      archived: form?.archived ?? false,
      schemaVersion: form?.schemaVersion ?? 1,
    };

    // driveUrlが指定されている場合、それを使用
    const targetUrl = driveUrl?.trim() || null;

    try {
      if (isEdit) await updateForm(formId, payload, targetUrl);
      else await createForm(payload, targetUrl);
      initialMetaRef.current = { name: trimmedName, description: payload.description || "" };
      setBuilderDirty(false);
      setIsSaving(false);
      navigate("/forms", { replace: true });
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

  return (
    <AppLayout
      title={isEdit ? "フォーム修正" : "フォーム新規作成"}
      badge="フォーム管理"
      fallbackPath={fallback}
      onBack={handleBack}
      backHidden={true}
      sidebarActions={
        <>
          <button type="button" className="nf-btn-outline nf-btn-sidebar nf-text-14" disabled={isSaving} onClick={handleSave}>
            保存
          </button>
          <button type="button" className="nf-btn-outline nf-btn-sidebar nf-text-14" onClick={handleCancel}>
            キャンセル
          </button>
          <div className="nf-spacer-16" />
          <button
            type="button"
            className="nf-btn-outline nf-btn-sidebar nf-text-14 admin-move-btn"
            disabled={!questionControl?.canMoveUp}
            onClick={() => questionControl?.moveUp?.()}
          >
            ↑ 上へ
          </button>
          <button
            type="button"
            className="nf-btn-outline nf-btn-sidebar nf-text-14 admin-move-btn"
            disabled={!questionControl?.canMoveDown}
            onClick={() => questionControl?.moveDown?.()}
          >
            ↓ 下へ
          </button>
          {questionControl?.selectedIndex !== null && (
            <div className="nf-text-11 nf-text-muted nf-pad-4-8 nf-text-center nf-word-break">
              {questionControl?.isOption
                ? `${questionControl?.questionLabel || `質問 ${(questionControl?.selectedIndex ?? 0) + 1}`} > ${questionControl?.optionLabel || `選択肢 ${(questionControl?.optionIndex ?? 0) + 1}`}`
                : questionControl?.questionLabel || `質問 ${(questionControl?.selectedIndex ?? 0) + 1}`
              }
            </div>
          )}
          <div className="nf-flex-1" />
          <button
            type="button"
            className="nf-btn-outline nf-btn-sidebar nf-text-14 admin-info-btn"
            onClick={handleOpenSpreadsheet}
          >
            📊 スプレッドシートを開く
          </button>
        </>
      }
    >
      <div className="nf-card nf-mb-24">
        <div className="nf-card nf-mb-16">
          <h3 className="nf-settings-group-title nf-mb-16">フォームの基本情報</h3>

          <div className="nf-col nf-gap-6 nf-mb-16">
            <label className="nf-block nf-fw-600 nf-mb-6">フォーム名</label>
            <input
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                if (nameError) setNameError("");
              }}
              className="nf-input admin-input"
              placeholder="フォーム名"
            />
            {nameError && <p className="nf-text-danger-strong nf-text-12 nf-m-0">{nameError}</p>}
          </div>

          <div className="nf-col nf-gap-6 nf-mb-16">
            <label className="nf-block nf-fw-600 nf-mb-6">フォームの説明</label>
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} className="nf-input admin-input nf-min-h-80" placeholder="説明" />
          </div>

          <div className="nf-col nf-gap-6">
            <label className="nf-block nf-fw-600 nf-mb-6">フォーム項目データのGoogle Drive保存先URL</label>
            <input
              value={driveUrl}
              onChange={(event) => setDriveUrl(event.target.value)}
              className="nf-input admin-input"
              placeholder="空白: ルートディレクトリ / フォルダURL: ランダム名で保存 / ファイルURL: そのファイルに保存"
            />
            <p className="nf-text-11 nf-text-muted nf-mt-4 nf-mb-0">
              空白の場合はルートディレクトリに保存されます。フォルダURLを指定するとそのフォルダにランダム名で保存、ファイルURLを指定するとそのファイルに保存されます。
            </p>
            {isEdit && driveUrl && (
              <p className="nf-text-11 nf-text-primary-strong nf-mt-4 nf-mb-0">
                変更すると新しい場所に保存され、元のファイルはそのまま残ります。
              </p>
            )}
          </div>
        </div>

        {SETTINGS_GROUPS.map((group) => (
          <div key={group.key} className="nf-card nf-mb-16">
            <div className="nf-settings-group-title nf-mb-12">{group.label}</div>
            {group.fields.map((field) => {
              const isSelect = field.type === "select" || Array.isArray(field.options);
              return (
                <div key={field.key} className="nf-mb-12">
                  <label className="nf-block nf-fw-600 nf-mb-6">
                    {field.label}
                    {field.required && <span className="nf-text-danger nf-ml-4">*</span>}
                  </label>
                  {isSelect ? (
                    <select
                      className="nf-input"
                      value={localSettings[field.key] ?? ""}
                      onChange={(event) => handleSettingsChange(field.key, event.target.value)}
                    >
                      {(field.options || []).map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className="nf-input"
                      type={field.type || "text"}
                      value={localSettings[field.key] ?? ""}
                      placeholder={field.placeholder}
                      onChange={(event) => handleSettingsChange(field.key, event.target.value)}
                    />
                  )}
                  {field.description && (
                    <p className="nf-text-11 nf-text-muted nf-mt-4 nf-mb-0">{field.description}</p>
                  )}
                </div>
              );
            })}
          </div>
        ))}

        <FormBuilderWorkspace
          ref={builderRef}
          initialSchema={initialSchema}
          initialSettings={initialSettings}
          formTitle={name || "フォーム"}
          onDirtyChange={setBuilderDirty}
          showToolbarSave={false}
        />
      </div>

      <ConfirmDialog open={confirmState} title="未保存の変更があります" message="保存せずに離れますか？" options={confirmOptions} />

      <AlertDialog open={alertState.open} title={alertState.title} message={alertState.message} onClose={closeAlert} />
    </AppLayout>
  );
}
