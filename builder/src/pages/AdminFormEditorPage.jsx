import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLatestRef } from "../app/hooks/useLatestRef.js";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import AppLayout from "../app/components/AppLayout.jsx";
import ConfirmDialog from "../app/components/ConfirmDialog.jsx";
import FormBuilderWorkspace from "../features/admin/FormBuilderWorkspace.jsx";
import { SETTINGS_GROUPS } from "../features/settings/settingsSchema.js";
import { dataStore } from "../app/state/dataStore.js";
import { useAppData } from "../app/state/AppDataProvider.jsx";
import { useOperationCacheTrigger } from "../app/hooks/useOperationCacheTrigger.js";
import { useEditLock } from "../app/hooks/useEditLock.js";
import { useAlert } from "../app/hooks/useAlert.js";
import { useBeforeUnloadGuard } from "../app/hooks/useBeforeUnloadGuard.js";
import { normalizeSpreadsheetId } from "../utils/spreadsheet.js";
import { validateSpreadsheet } from "../services/gasClient.js";
import { omitThemeSetting } from "../utils/settings.js";
import { DEFAULT_THEME, applyThemeWithFallback } from "../app/theme/theme.js";
import { useBuilderSettings } from "../features/settings/settingsStore.js";
import SchemaMapNav from "../features/nav/SchemaMapNav.jsx";
import {
  evaluateCache,
  FORM_CACHE_MAX_AGE_MS,
  FORM_CACHE_BACKGROUND_REFRESH_MS,
} from "../app/state/cachePolicy.js";

const fallbackPath = (locationState) => (locationState?.from ? locationState.from : "/forms");

export default function AdminFormEditorPage() {
  const { formId } = useParams();
  const isEdit = Boolean(formId);
  const { forms, getFormById, createForm, updateForm, refreshForms, lastSyncedAt, loadingForms } = useAppData();
  const form = isEdit ? getFormById(formId) : null;
  const navigate = useNavigate();
  const location = useLocation();
  const { showAlert } = useAlert();
  const fallback = useMemo(() => fallbackPath(location.state), [location.state]);
  const builderRef = useRef(null);
  const initialMetaRef = useRef({ name: form?.name || "新規フォーム", description: form?.description || "" });
  const initialSchema = useMemo(() => (form?.schema ? form.schema : []), [form]);
  const initialSettings = useMemo(() => omitThemeSetting(form?.settings || {}), [form]);

  const { settings } = useBuilderSettings();

  
  const [name, setName] = useState(initialMetaRef.current.name);
  const [description, setDescription] = useState(initialMetaRef.current.description);
  const [driveUrl, setDriveUrl] = useState(form?.driveFileUrl || "");
  const [localSettings, setLocalSettings] = useState(initialSettings);
  const [builderDirty, setBuilderDirty] = useState(false);
  const [confirmState, setConfirmState] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const { isReadLocked, withReadLock } = useEditLock();
  const [nameError, setNameError] = useState("");
  const [questionControl, setQuestionControl] = useState(null);
  const isSavingRef = useLatestRef(isSaving);
  const isReadLockedRef = useLatestRef(isReadLocked);
  const loadingFormsRef = useLatestRef(loadingForms);

  useEffect(() => {
    if (!form) return;
    const formTitle = form.settings?.formTitle || "";
    initialMetaRef.current = { name: formTitle, description: form.description || "" };
    setName(formTitle);
    setDescription(form.description || "");
    setDriveUrl(form.driveFileUrl || "");
    setLocalSettings(omitThemeSetting(form.settings || {}));
    setQuestionControl(null);
    setNameError("");
  }, [form]);

  const handleOperationCacheCheck = useCallback(async ({ source }) => {
    if (!isEdit || !formId) return;
    if (isSavingRef.current || isReadLockedRef.current || loadingFormsRef.current) return;

    const cacheDecision = evaluateCache({
      lastSyncedAt,
      hasData: forms.length > 0 || !!lastSyncedAt,
      maxAgeMs: FORM_CACHE_MAX_AGE_MS,
      backgroundAgeMs: FORM_CACHE_BACKGROUND_REFRESH_MS,
    });

    if (cacheDecision.isFresh) return;

    await withReadLock(async () => {
      await dataStore.getForm(formId);
      await refreshForms({ reason: `operation:${source}:admin-form-editor`, background: false });
    });
  }, [formId, forms.length, isEdit, lastSyncedAt, refreshForms, withReadLock]);

  useOperationCacheTrigger({
    enabled: isEdit && !!formId,
    onOperation: handleOperationCacheCheck,
  });

  const metaDirty = useMemo(() => name !== initialMetaRef.current.name || description !== initialMetaRef.current.description, [name, description]);
  const isDirty = builderDirty || metaDirty;

  useBeforeUnloadGuard(isDirty);

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
    if (isSaving || isReadLocked) return;
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
    const preservedTheme = form?.settings?.theme || DEFAULT_THEME;

    const payload = {
      // Include existing form data for fallback when getForm fails
      ...(isEdit && form ? { id: form.id, createdAt: form.createdAt, driveFileUrl: form.driveFileUrl } : {}),
      description,
      schema,
      settings: { ...trimmedSettings, theme: preservedTheme, formTitle: trimmedName },
      archived: form?.archived ?? false,
      schemaVersion: form?.schemaVersion ?? 1,
    };

    const targetUrl = driveUrl?.trim() || null;
    const isFileUrl = targetUrl ? /\/file\/d\/[a-zA-Z0-9_-]+/.test(targetUrl) : false;
    const isFolderUrl = targetUrl ? /\/folders\/[a-zA-Z0-9_-]+/.test(targetUrl) : false;
    let saveMode = "auto";

    if (!targetUrl) {
      saveMode = isEdit ? "auto" : "copy_to_root";
    } else if (isFileUrl) {
      saveMode = "overwrite_existing";
    } else if (isFolderUrl) {
      saveMode = "copy_to_folder";
    }

    // ファイルURLのバリデーション
    if (targetUrl) {
      if (!isEdit && isFileUrl) {
        showAlert("新規作成時はファイルURLは指定できません。フォルダURLまたは空白にしてください。");
        setIsSaving(false);
        return;
      }
      if (isEdit && isFileUrl) {
        const originalFileUrl = form?.driveFileUrl || "";
        if (targetUrl !== originalFileUrl) {
          showAlert("既存フォームの保存先には、元のファイルURL以外のファイルURLは指定できません。フォルダURLまたは空白にしてください。");
          setIsSaving(false);
          return;
        }
      }
    }

    try {
      if (isEdit) await updateForm(formId, payload, targetUrl, saveMode);
      else await createForm(payload, targetUrl, saveMode);
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
          <button type="button" className="nf-btn-outline nf-btn-sidebar nf-text-14" disabled={isSaving || isReadLocked} onClick={handleSave}>
            保存
          </button>
          <button type="button" className="nf-btn-outline nf-btn-sidebar nf-text-14" onClick={handleCancel}>
            キャンセル
          </button>
          <div className="nf-spacer-16" />
          <button
            type="button"
            className="nf-btn-outline nf-btn-sidebar nf-text-14 admin-move-btn"
            disabled={isReadLocked || !questionControl?.canMoveUp}
            onClick={() => questionControl?.moveUp?.()}
          >
            ↑ 上へ
          </button>
          <button
            type="button"
            className="nf-btn-outline nf-btn-sidebar nf-text-14 admin-move-btn"
            disabled={isReadLocked || !questionControl?.canMoveDown}
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
          <SchemaMapNav schema={builderRef.current?.getSchema?.() || initialSchema} />
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
              disabled={isReadLocked}
            />
            {nameError && <p className="nf-text-danger-strong nf-text-12 nf-m-0">{nameError}</p>}
          </div>

          <div className="nf-col nf-gap-6 nf-mb-16">
            <label className="nf-block nf-fw-600 nf-mb-6">フォームの説明</label>
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} className="nf-input admin-input nf-min-h-80" placeholder="説明" disabled={isReadLocked} />
          </div>

          <div className="nf-col nf-gap-6">
            <label className="nf-block nf-fw-600 nf-mb-6">フォーム項目データのGoogle Drive保存先URL</label>
            <input
              value={driveUrl}
              onChange={(event) => setDriveUrl(event.target.value)}
              className="nf-input admin-input"
              placeholder={isEdit
                ? "空白: マイドライブルートに新たにコピー / フォルダURL: 指定フォルダにコピー"
                : "空白: マイドライブルート / フォルダURL: 指定フォルダに保存"}
              disabled={isReadLocked}
            />
            <p className="nf-text-11 nf-text-muted nf-mt-4 nf-mb-0">
              {isEdit
                ? "現在のファイルURLが表示されています。空白にするとマイドライブルートに新たなコピーを作成します。フォルダURLに変更するとそのフォルダにコピーを作成します。ファイルURLは元のURL以外は指定できません。"
                : "空白の場合はマイドライブのルートに保存されます。フォルダURLを指定するとそのフォルダに保存されます。ファイルURLは指定できません。"}
            </p>
          </div>
        </div>

        {SETTINGS_GROUPS.map((group) => (
          <div key={group.key} className="nf-card nf-mb-16">
            <div className="nf-settings-group-title nf-mb-12">{group.label}</div>
            {(() => {
              const checkboxFields = group.fields.filter((f) => f.type === "checkbox");
              const otherFields = group.fields.filter((f) => f.type !== "checkbox");
              return (
                <>
                  {otherFields.map((field) => {
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
                            disabled={isReadLocked}
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
                            disabled={isReadLocked}
                          />
                        )}
                        {field.description && (
                          <p className="nf-text-11 nf-text-muted nf-mt-4 nf-mb-0">{field.description}</p>
                        )}
                      </div>
                    );
                  })}
                  {checkboxFields.length > 0 && (
                    <div className="nf-flex nf-flex-wrap nf-gap-16 nf-mb-12">
                      {checkboxFields.map((field) => (
                        <label key={field.key} className="nf-flex nf-items-center nf-gap-8" style={{ cursor: "pointer" }}>
                          <input
                            type="checkbox"
                            checked={localSettings[field.key] !== undefined ? !!localSettings[field.key] : !!field.defaultValue}
                            onChange={(event) => handleSettingsChange(field.key, event.target.checked)}
                            disabled={isReadLocked}
                          />
                          <span className="nf-fw-600">{field.label}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        ))}

        <div className="admin-editor-workspace-wrap">
          <div className={isReadLocked ? "admin-editor-workspace-lock" : ""}>
            <FormBuilderWorkspace
              ref={builderRef}
              initialSchema={initialSchema}
              initialSettings={initialSettings}
              formTitle={name || "フォーム"}
              onDirtyChange={setBuilderDirty}
              onQuestionControlChange={setQuestionControl}
              showToolbarSave={false}
            />
          </div>
          {isReadLocked && <div className="admin-editor-workspace-overlay" aria-hidden="true" />}
        </div>
      </div>

      <ConfirmDialog open={confirmState} title="未保存の変更があります" message="保存せずに離れますか？" options={confirmOptions} />

</AppLayout>
  );
}
