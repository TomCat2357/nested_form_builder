import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toErrorMessage } from "../../utils/errorMessage.js";
import { useLatestRef } from "../../app/hooks/useLatestRef.js";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import AppLayout from "../../app/components/AppLayout.jsx";
import ConfirmDialog from "../../app/components/ConfirmDialog.jsx";
import FormBuilderWorkspace from "../../features/admin/FormBuilderWorkspace.jsx";
import { SETTINGS_GROUPS, SPREADSHEET_SETTINGS_GROUP } from "../../features/settings/settingsSchema.js";
import { dataStore } from "../../app/state/dataStore.js";
import { useAppData } from "../../app/state/AppDataProvider.jsx";
import { useTempIdRedirect } from "../../app/hooks/useTempIdRedirect.js";
import { useFormCacheSync } from "../../app/hooks/useFormCacheSync.js";
import { useEditLock } from "../../app/hooks/useEditLock.js";
import { useAlert } from "../../app/hooks/useAlert.js";
import { useConfirmDialog } from "../../app/hooks/useConfirmDialog.js";
import { useBeforeUnloadGuard } from "../../app/hooks/useBeforeUnloadGuard.js";
import { normalizeSpreadsheetId } from "../../utils/spreadsheet.js";
import { normalizeFolderPath } from "../../utils/folderTree.js";
import { omitThemeSetting, normalizeExternalActions, applySpreadsheetExclusiveSetting } from "../../utils/settings.js";
import { loadSpreadsheetOptions } from "../../features/editor/useSpreadsheetOptions.js";
import { SettingsGroupFields } from "../../features/settings/SettingsField.jsx";
import ExternalActionsEditor from "../../features/settings/ExternalActionsEditor.jsx";
import { DEFAULT_THEME } from "../../app/theme/theme.js";
import SchemaMapNav from "../../features/nav/SchemaMapNav.jsx";
import { buildFormIndex } from "../../features/analytics/utils/formIdentifierResolver.js";
import {
  schemaTemplateFormRefsToIds,
  schemaTemplateFormRefsToNames,
  settingsTemplateFormRefsToIds,
  settingsTemplateFormRefsToNames,
  refreshFormLinkPaths,
} from "../../features/analytics/utils/rewriteSqlFormRefs.js";

const fallbackPath = (locationState) => (locationState?.from ? locationState.from : "/admin/forms");
const buildFormEditPath = (id) => `/admin/forms/${id}/edit`;

export default function AdminFormEditorPage() {
  const { formId } = useParams();
  // 一時 ID のままディープリンクで開かれた場合、アップロード完了後に実 ID の URL へ置き換える。
  useTempIdRedirect(formId, buildFormEditPath);
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
  // 表示用: 保存スキーマ/設定は full-query フォーム参照を fileId で保持しているため、
  // エディタ表示時は論理パスへ戻し、formLink の表示パスも childFormId から再計算する（リネーム追従）。
  const formIndex = useMemo(() => buildFormIndex(forms || []), [forms]);
  const initialSchema = useMemo(
    () => (form?.schema ? refreshFormLinkPaths(schemaTemplateFormRefsToNames(form.schema, formIndex), formIndex) : []),
    [form, formIndex],
  );
  const initialSettings = useMemo(
    () => settingsTemplateFormRefsToNames(omitThemeSetting(form?.settings || {}), formIndex),
    [form, formIndex],
  );

  const [name, setName] = useState(initialMetaRef.current.name);
  const [description, setDescription] = useState(initialMetaRef.current.description);
  const [folder, setFolder] = useState(initialMetaRef.current.folder);
  const [localSettings, setLocalSettings] = useState(initialSettings);
  // 保存先スプレッドシートの手動指定欄。標準フォルダ構成が既定のため初期は常に非表示（③）。
  const [showSpreadsheetSetting, setShowSpreadsheetSetting] = useState(false);
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
      return;
    }

    // useLatestRef は 1 コミット遅れるため、同レンダーの isDirty 変数（meta 同期）と
    // ビルダーの同期 isDirty()（builder 同期）を併用し、「編集開始直後でフラグ未伝播」の
    // 窓でも作業コピーを取り込みで潰さない。
    if (isDirty || builderRef.current?.isDirty?.()) {
      return;
    }

    setCachedForm((prevForm) => {
      if (prevForm === currentForm) return prevForm;
      return currentForm;
    });
  }, [currentForm, formId, isDirty, isDirtyRef, isEdit, cachedFormRef, isSavingRef]);

  useEffect(() => {
    if (!form) return;
    if (isSavingRef.current) {
      return;
    }
    if (isDirty || builderRef.current?.isDirty?.()) {
      return;
    }
    const formTitle = form.settings?.formTitle || "";
    initialMetaRef.current = { name: formTitle, description: form.description || "", folder: form.folder || "" };
    setName(formTitle);
    setDescription(form.description || "");
    setFolder(form.folder || "");
    setLocalSettings(settingsTemplateFormRefsToNames(omitThemeSetting(form.settings || {}), formIndex));
    setQuestionControl(null);
    setNameError("");
  }, [form, formId, isDirty, isDirtyRef, isSavingRef, formIndex]);

  useFormCacheSync({
    enabled: isEdit && !!formId,
    formsCount: forms.length,
    lastSyncedAt,
    loadingForms,
    refreshForms,
    label: "admin-form-editor",
    shouldSkip: () => isSavingRef.current || isReadLockedRef.current || isDirtyRef.current || !!builderRef.current?.isDirty?.(),
    onRefresh: async (source) => {
      await withReadLock(async () => {
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
    // 論理パス（spreadsheetPath）と直接 ID/URL（spreadsheetId）は排他（後勝ち）にする。
    setLocalSettings((prev) => applySpreadsheetExclusiveSetting(prev, key, value));
    builderRef.current?.updateSetting?.(key, value);
    // 排他で相手側がクリアされるケースはビルダー側プレビューにも反映する（冪等）。
    if (key === "spreadsheetPath" && value) builderRef.current?.updateSetting?.("spreadsheetId", "");
    if (key === "spreadsheetId" && value) builderRef.current?.updateSetting?.("spreadsheetPath", "");
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
    // 保存用: full-query フォーム参照を論理パス → fileId に変換（リネーム耐性）。formLink は
    // childFormId 保持なので不変、childFormPath は現在パスのまま保存される（追従）。
    const schemaForSave = schemaTemplateFormRefsToIds(schema, formIndex);
    const trimmedSettings = settingsTemplateFormRefsToIds(omitThemeSetting(localSettings), formIndex);
    const preservedTheme = form?.settings?.theme || DEFAULT_THEME;

    const payload = {
      ...(isEdit && form ? { id: form.id, createdAt: form.createdAt, driveFileUrl: form.driveFileUrl } : {}),
      description,
      folder: normalizeFolderPath(folder),
      schema: schemaForSave,
      settings: { ...trimmedSettings, theme: preservedTheme, formTitle: trimmedName },
      archived: form?.archived ?? false,
      readOnly: form?.readOnly ?? false,
      childOnly: form?.childOnly ?? false,
      schemaVersion: form?.schemaVersion ?? 1,
    };

    // 保存先は標準フォルダ構成（01_forms）。新規は copy_to_root → 01_forms、編集は既存ファイルを上書き。
    try {
      const savedForm = isEdit
        ? await updateForm(formId, payload, "auto")
        : await createForm(payload, "auto");
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
      showAlert(`保存に失敗しました: ${toErrorMessage(error)}`);
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

  const handleOpenSpreadsheet = async () => {
    // 直接 ID/URL 指定があればそれを開く（従来動作）。
    const spreadsheetIdOrUrl = localSettings?.spreadsheetId || "";
    if (spreadsheetIdOrUrl) {
      const spreadsheetId = normalizeSpreadsheetId(spreadsheetIdOrUrl);
      window.open(`https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`, "_blank", "noopener,noreferrer");
      return;
    }

    // 論理パス指定の場合は 04_spreadsheets 一覧から URL を引いて開く。
    const path = (localSettings?.spreadsheetPath || "").trim();
    if (!path) {
      showAlert("スプレッドシートが設定されていません");
      return;
    }
    // ユーザー操作の同期コンテキストで空タブを先に開き（ポップアップブロック回避）、
    // 一覧解決後に location を差し替える。失敗時は空タブを閉じる。
    const pendingTab = window.open("", "_blank", "noopener,noreferrer");
    try {
      const files = await loadSpreadsheetOptions();
      const match = (files || []).find((f) => (f.path || f.name) === path);
      if (match?.url) {
        if (pendingTab) pendingTab.location.href = match.url;
        else window.open(match.url, "_blank", "noopener,noreferrer");
      } else {
        if (pendingTab) pendingTab.close();
        showAlert(`論理パス「${path}」のスプレッドシートが見つかりません（保存時にこのパスへ作成されます）`);
      }
    } catch (e) {
      if (pendingTab) pendingTab.close();
      showAlert("スプレッドシート一覧を取得できませんでした");
    }
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
          <button
            type="button"
            className="nf-btn-outline nf-btn-sidebar nf-text-14 admin-move-btn"
            disabled={isReadLocked || !questionControl?.canPromote}
            onClick={() => questionControl?.promote?.()}
          >
            ⇤ 昇格
          </button>
          <button
            type="button"
            className="nf-btn-outline nf-btn-sidebar nf-text-14 admin-move-btn"
            disabled={isReadLocked || !questionControl?.canDemote}
            onClick={() => questionControl?.demote?.()}
          >
            ⇥ 降格
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
          <SchemaMapNav
            schema={builderRef.current?.getSchema?.() || initialSchema}
            scope="all"
            leadingItems={[{ id: "form-meta-info", label: "フォーム基本情報", indexLabel: "■" }]}
          />
        </>
      }
    >
      <div className="nf-card nf-mb-24">
        <div className="nf-card nf-mb-16" id="form-meta-info">
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

        {SETTINGS_GROUPS.map((group) => (
          <div key={group.key} className="nf-card nf-mb-16">
            <div className="nf-settings-group-title nf-mb-12">{group.label}</div>
            {group.note && (
              <p className="nf-text-11 nf-text-muted nf-mt-0 nf-mb-12">{group.note}</p>
            )}
            <SettingsGroupFields
              fields={group.fields}
              values={localSettings}
              onChange={handleSettingsChange}
              disabled={isReadLocked}
            />
          </div>
        ))}

        <div className="nf-card nf-mb-16">
          <div className="nf-settings-group-title nf-mb-12">外部アクション</div>
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
