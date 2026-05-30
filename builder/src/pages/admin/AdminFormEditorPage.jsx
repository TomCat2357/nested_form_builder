import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLatestRef } from "../../app/hooks/useLatestRef.js";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import AppLayout from "../../app/components/AppLayout.jsx";
import ConfirmDialog from "../../app/components/ConfirmDialog.jsx";
import FormBuilderWorkspace from "../../features/admin/FormBuilderWorkspace.jsx";
import { SETTINGS_GROUPS, SPREADSHEET_SETTINGS_GROUP } from "../../features/settings/settingsSchema.js";
import { dataStore } from "../../app/state/dataStore.js";
import { useAppData } from "../../app/state/AppDataProvider.jsx";
import { useFormCacheSync } from "../../app/hooks/useFormCacheSync.js";
import { useEditLock } from "../../app/hooks/useEditLock.js";
import { useAlert } from "../../app/hooks/useAlert.js";
import { useConfirmDialog } from "../../app/hooks/useConfirmDialog.js";
import { useBeforeUnloadGuard } from "../../app/hooks/useBeforeUnloadGuard.js";
import { normalizeSpreadsheetId } from "../../utils/spreadsheet.js";
import { normalizeFolderPath } from "../../utils/folderTree.js";
import { omitThemeSetting, normalizeExternalActions } from "../../utils/settings.js";
import { SettingsGroupFields } from "../../features/settings/SettingsField.jsx";
import ExternalActionsEditor from "../../features/settings/ExternalActionsEditor.jsx";
import { DEFAULT_THEME } from "../../app/theme/theme.js";
import SchemaMapNav from "../../features/nav/SchemaMapNav.jsx";
import { countSchemaNodes } from "../../core/schema.js";
import LinkTargetUrlField from "../../features/editor/LinkTargetUrlField.jsx";

const fallbackPath = (locationState) => (locationState?.from ? locationState.from : "/admin/forms");

export default function AdminFormEditorPage() {
  const { formId } = useParams();
  const isEdit = Boolean(formId);
  const { forms, getFormById, createForm, updateForm, refreshForms, lastSyncedAt, loadingForms } = useAppData();
  const currentForm = isEdit ? getFormById(formId) : null;
  const [cachedForm, setCachedForm] = useState(currentForm);
  const form = cachedForm;
  const navigate = useNavigate();
  const location = useLocation();
  const { showAlert } = useAlert();
  const fallback = useMemo(() => fallbackPath(location.state), [location.state]);
  const builderRef = useRef(null);
  // 新規作成時は一覧で開いていたフォルダ (location.state.folder) を初期フォルダにする。
  const initialFolder = isEdit ? (form?.folder || "") : normalizeFolderPath(location.state?.folder || "");
  const initialMetaRef = useRef({ name: form?.name || "新規フォーム", description: form?.description || "", folder: initialFolder });
  const initialSchema = useMemo(() => (form?.schema ? form.schema : []), [form]);
  const initialSettings = useMemo(() => omitThemeSetting(form?.settings || {}), [form]);

  const [name, setName] = useState(initialMetaRef.current.name);
  const [description, setDescription] = useState(initialMetaRef.current.description);
  const [folder, setFolder] = useState(initialMetaRef.current.folder);
  const [localSettings, setLocalSettings] = useState(initialSettings);
  // 保存先スプレッドシートの手動指定欄。標準フォルダ構成が既定のため初期は常に非表示（③）。
  const [showSpreadsheetSetting, setShowSpreadsheetSetting] = useState(false);
  // 普段は隠している「リンク先URL（保存先）」。指定時のみ保存の targetUrl として渡す。
  const [linkTargetUrl, setLinkTargetUrl] = useState("");
  const [builderDirty, setBuilderDirty] = useState(false);
  const unsavedDialog = useConfirmDialog();
  const [isSaving, setIsSaving] = useState(false);
  const { isReadLocked, withReadLock } = useEditLock();
  const [nameError, setNameError] = useState("");
  const [questionControl, setQuestionControl] = useState(null);
  const isSavingRef = useLatestRef(isSaving);
  const isReadLockedRef = useLatestRef(isReadLocked);
  const cachedFormRef = useLatestRef(cachedForm);
  const metaDirty = useMemo(() => name !== initialMetaRef.current.name || description !== initialMetaRef.current.description || folder !== initialMetaRef.current.folder, [name, description, folder]);
  const isDirty = builderDirty || metaDirty;
  const isDirtyRef = useLatestRef(isDirty);

  useEffect(() => {
    if (!isEdit) return;
    setCachedForm((prevForm) => {
      if (!prevForm) return prevForm;
      return prevForm.id === formId ? prevForm : null;
    });
  }, [formId, isEdit]);

  useEffect(() => {
    if (!isEdit) {
      setCachedForm(null);
      return;
    }
    if (!currentForm) return;
    if (isSavingRef.current) {
      console.log("[AdminFormEditorPage] defer applying refreshed form during save", {
        formId,
        cachedSchemaNodeCount: countSchemaNodes(cachedFormRef.current?.schema),
        incomingSchemaNodeCount: countSchemaNodes(currentForm?.schema),
        incomingModifiedAt: currentForm?.modifiedAt ?? null,
      });
      return;
    }

    if (isDirtyRef.current) {
      console.log("[AdminFormEditorPage] defer applying refreshed form during dirty edit", {
        formId,
        cachedSchemaNodeCount: countSchemaNodes(cachedFormRef.current?.schema),
        incomingSchemaNodeCount: countSchemaNodes(currentForm?.schema),
        incomingModifiedAt: currentForm?.modifiedAt ?? null,
      });
      return;
    }

    setCachedForm((prevForm) => {
      if (prevForm === currentForm) return prevForm;
      console.log("[AdminFormEditorPage] apply refreshed form", {
        formId,
        previousSchemaNodeCount: countSchemaNodes(prevForm?.schema),
        incomingSchemaNodeCount: countSchemaNodes(currentForm?.schema),
        previousModifiedAt: prevForm?.modifiedAt ?? null,
        incomingModifiedAt: currentForm?.modifiedAt ?? null,
      });
      return currentForm;
    });
  }, [currentForm, formId, isDirty, isDirtyRef, isEdit, cachedFormRef, isSavingRef]);

  useEffect(() => {
    if (!form) return;
    if (isSavingRef.current) {
      console.log("[AdminFormEditorPage] defer applying form meta during save", {
        formId,
        cachedSchemaNodeCount: countSchemaNodes(form?.schema),
        modifiedAt: form?.modifiedAt ?? null,
      });
      return;
    }
    if (isDirtyRef.current) {
      console.log("[AdminFormEditorPage] defer applying form meta during dirty edit", {
        formId,
        cachedSchemaNodeCount: countSchemaNodes(form?.schema),
        modifiedAt: form?.modifiedAt ?? null,
      });
      return;
    }
    const formTitle = form.settings?.formTitle || "";
    initialMetaRef.current = { name: formTitle, description: form.description || "", folder: form.folder || "" };
    setName(formTitle);
    setDescription(form.description || "");
    setFolder(form.folder || "");
    setLocalSettings(omitThemeSetting(form.settings || {}));
    setQuestionControl(null);
    setNameError("");
  }, [form, formId, isDirty, isDirtyRef, isSavingRef]);

  useFormCacheSync({
    enabled: isEdit && !!formId,
    formsCount: forms.length,
    lastSyncedAt,
    loadingForms,
    refreshForms,
    label: "admin-form-editor",
    shouldSkip: () => isSavingRef.current || isReadLockedRef.current || isDirtyRef.current,
    onRefresh: async (source, cacheDecision) => {
      await withReadLock(async () => {
        console.log("[AdminFormEditorPage] run refreshForms from operation trigger", {
          formId,
          source,
          cacheAgeMs: cacheDecision.age,
          shouldSync: cacheDecision.shouldSync,
          shouldBackground: cacheDecision.shouldBackground,
          cachedSchemaNodeCount: countSchemaNodes(cachedFormRef.current?.schema),
        });
        await dataStore.getForm(formId);
        await refreshForms({ reason: `operation:${source}:admin-form-editor`, background: false });
      });
    },
  });

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

    const saveResult = await builderRef.current.save({ markClean: false });
    if (saveResult === false) {
      setIsSaving(false);
      return;
    }

    const schema = builderRef.current.getSchema();
    const trimmedSettings = omitThemeSetting(localSettings);
    const preservedTheme = form?.settings?.theme || DEFAULT_THEME;

    const payload = {
      ...(isEdit && form ? { id: form.id, createdAt: form.createdAt, driveFileUrl: form.driveFileUrl } : {}),
      description,
      folder: normalizeFolderPath(folder),
      schema,
      settings: { ...trimmedSettings, theme: preservedTheme, formTitle: trimmedName },
      archived: form?.archived ?? false,
      readOnly: form?.readOnly ?? false,
      schemaVersion: form?.schemaVersion ?? 1,
    };

    // 保存先は標準フォルダ構成（01_forms）。新規は copy_to_root → 01_forms、編集は既存ファイルを上書き。
    // 「リンク先URL（保存先）」が指定されていれば targetUrl として渡し、別ファイル/フォルダへ付け替える。
    const targetUrl = linkTargetUrl.trim() || null;
    try {
      const savedForm = isEdit
        ? await updateForm(formId, payload, targetUrl, "auto")
        : await createForm(payload, targetUrl, "auto");
      setCachedForm(savedForm);
      builderRef.current?.commitSavedState?.();
      initialMetaRef.current = { name: trimmedName, description: payload.description || "" };
      setBuilderDirty(false);
      // 直前に開いていたフォルダ付き一覧（location.state.from）へ戻る。
      // from 未指定（ルート検索からの直接遷移）なら fallback = "/admin/forms"。
      navigateBack();
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
    unsavedDialog.open();
    return false;
  };

  const handleOpenSpreadsheet = () => {
    const spreadsheetIdOrUrl = localSettings?.spreadsheetId || "";

    if (!spreadsheetIdOrUrl) {
      showAlert("スプレッドシートIDが設定されていません");
      return;
    }

    const spreadsheetId = normalizeSpreadsheetId(spreadsheetIdOrUrl);
    const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const confirmOptions = [
    {
      label: "保存して続行",
      value: "save",
      variant: "primary",
      onSelect: async () => {
        unsavedDialog.close();
        await handleSave();
      },
    },
    {
      label: "保存せずに戻る",
      value: "discard",
      onSelect: () => {
        unsavedDialog.close();
        navigateBack();
      },
    },
    {
      label: "キャンセル",
      value: "cancel",
      onSelect: unsavedDialog.close,
    },
  ];

  return (
    <AppLayout
      title={isEdit ? "フォーム修正" : "フォーム新規作成"}
      badge="管理 > フォーム"
      fallbackPath={fallback}
      onBack={handleBack}
      sidebarActions={
        <>
          <button type="button" className="nf-btn-outline nf-btn-sidebar nf-text-14" disabled={isSaving || isReadLocked} onClick={handleSave}>
            保存
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
          <SchemaMapNav schema={builderRef.current?.getSchema?.() || initialSchema} scope="all" />
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

          <div className="nf-col nf-gap-6 nf-mb-16">
            <label className="nf-block nf-fw-600 nf-mb-6">フォルダ（任意）</label>
            <input
              value={folder}
              onChange={(event) => setFolder(event.target.value)}
              className="nf-input admin-input"
              placeholder="例: 営業/見積  （空欄=フォルダなし）"
              disabled={isReadLocked}
            />
            <p className="nf-text-11 nf-text-muted nf-mt-4 nf-mb-0">
              スラッシュ区切りで階層を指定します。一覧画面でフォルダとして表示され、クリックで中に入れます。
            </p>
          </div>

          {isEdit && (
            <div className="nf-col nf-gap-6 nf-mb-16">
              <label className="nf-block nf-fw-600 nf-mb-6">実体ファイル URL（Drive 上の form.json）</label>
              <input
                type="text"
                value={form?.driveFileUrl || ""}
                readOnly
                className="nf-input admin-input nf-input--readonly"
                style={form?.driveFileUrl ? { background: "var(--surface-subtle)", color: "var(--text-muted)" } : undefined}
                placeholder="保存後に表示されます"
                onFocus={(event) => event.target.select()}
                title={form?.driveFileUrl ? "このフォームの実体（Drive 上の JSON ファイル）の URL。表示専用で編集できません。" : undefined}
              />
              <p className="nf-text-11 nf-text-muted nf-mt-4 nf-mb-0">
                このフォーム定義が保存されている Drive 上の場所です。どれが実体かを確認するための表示専用で、編集はできません。
              </p>
            </div>
          )}
        </div>

        <div className="nf-card nf-mb-16">
          <label className="nf-row nf-gap-8" style={{ alignItems: "center", cursor: isReadLocked ? "default" : "pointer" }}>
            <input
              type="checkbox"
              checked={showSpreadsheetSetting}
              disabled={isReadLocked}
              onChange={(event) => setShowSpreadsheetSetting(event.target.checked)}
            />
            <span className="nf-text-13">保存先スプレッドシートを手動指定する</span>
          </label>
          <p className="nf-text-11 nf-text-muted nf-mt-4 nf-mb-0">
            指定しない場合は標準フォルダ構成の <code>04_spreadsheets</code> に回答保存用スプレッドシートを自動作成します。
          </p>
          {showSpreadsheetSetting && (
            <div className="nf-mt-12">
              <SettingsGroupFields
                fields={SPREADSHEET_SETTINGS_GROUP.fields}
                values={localSettings}
                onChange={handleSettingsChange}
                disabled={isReadLocked}
              />
            </div>
          )}
        </div>

        <div className="nf-card nf-mb-16">
          <LinkTargetUrlField
            value={linkTargetUrl}
            onChange={setLinkTargetUrl}
            disabled={isReadLocked}
            entityLabel="フォーム定義"
          />
        </div>

        {SETTINGS_GROUPS.map((group) => (
          <div key={group.key} className="nf-card nf-mb-16">
            <div className="nf-settings-group-title nf-mb-12">{group.label}</div>
            <SettingsGroupFields
              fields={group.fields}
              values={localSettings}
              onChange={handleSettingsChange}
              disabled={isReadLocked}
            />
          </div>
        ))}

        <div className="nf-card nf-mb-16">
          <div className="nf-settings-group-title nf-mb-12">外部アクション (Webhook)</div>
          <ExternalActionsEditor
            value={normalizeExternalActions(localSettings?.externalActions)}
            onChange={(next) => setLocalSettings((prev) => ({
              ...(prev || {}),
              externalActions: next,
            }))}
            disabled={isReadLocked}
          />
        </div>

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

      <ConfirmDialog open={unsavedDialog.state.open} title="未保存の変更があります" message="保存せずに離れますか？" options={confirmOptions} />
    </AppLayout>
  );
}
