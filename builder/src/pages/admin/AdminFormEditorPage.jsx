import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toErrorMessage } from "../../utils/errorMessage.js";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import AppLayout from "../../app/components/AppLayout.jsx";
import ConfirmDialog from "../../app/components/ConfirmDialog.jsx";
import FormBuilderWorkspace from "../../features/admin/FormBuilderWorkspace.jsx";
import { SETTINGS_GROUPS, SPREADSHEET_SETTINGS_GROUP } from "../../features/settings/settingsSchema.js";
import { dataStore } from "../../app/state/dataStore.js";
import { useAppData } from "../../app/state/AppDataProvider.jsx";
import { useTempIdRedirect } from "../../app/hooks/useTempIdRedirect.js";
import { useCancellable } from "../../app/hooks/useCancellable.js";
import { useEditLock } from "../../app/hooks/useEditLock.js";
import { useAlert } from "../../app/hooks/useAlert.js";
import { useConfirmDialog } from "../../app/hooks/useConfirmDialog.js";
import { useBeforeUnloadGuard } from "../../app/hooks/useBeforeUnloadGuard.js";
import { normalizeSpreadsheetId } from "../../utils/spreadsheet.js";
import { normalizeFolderPath } from "../../utils/folderTree.js";
import { omitThemeSetting, normalizeExternalActions, applySpreadsheetExclusiveSetting, migrateStandardPrintTemplateId } from "../../utils/settings.js";
import { loadSpreadsheetOptions, invalidateSpreadsheetOptions } from "../../features/editor/useSpreadsheetOptions.js";
import { isFormSpreadsheetLinked, applyUnlinkSpreadsheetForRecreate } from "./spreadsheetLinkState.js";
import { isLocalId } from "../../core/ids.js";
import { SettingsGroupFields } from "../../features/settings/SettingsField.jsx";
import ExternalActionsEditor from "../../features/settings/ExternalActionsEditor.jsx";
import { DEFAULT_THEME } from "../../app/theme/theme.js";
import SchemaMapNav from "../../features/nav/SchemaMapNav.jsx";
import { buildSchemaMapItems } from "../../features/nav/schemaMapNavTree.js";
import { getFormNavFromCache, saveFormNavToCache } from "../../app/state/formNavCache.js";
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
// 目次の先頭に固定で出す「フォーム基本情報」。即表示用ローディング画面と通常表示で共有する。
const META_LEADING_ITEMS = [{ id: "form-meta-info", label: "フォーム基本情報", indexLabel: "■" }];

export default function AdminFormEditorPage() {
  const { formId } = useParams();
  // 一時 ID のままディープリンクで開かれた場合、アップロード完了後に実 ID の URL へ置き換える。
  useTempIdRedirect(formId, buildFormEditPath);
  const isEdit = Boolean(formId);
  const { forms, createForm, updateForm, loadingForms } = useAppData();
  const navigate = useNavigate();
  const location = useLocation();
  const { showAlert } = useAlert();
  const fallback = useMemo(() => fallbackPath(location.state), [location.state]);
  const builderRef = useRef(null);

  // 巻き戻り対策: 開いたとき 1 回だけサーバ最新(.json)を取り込み、その後は一切再取得・
  // 再反映しない（フリーズ）。背景再取得で provider の forms が差し替わっても作業コピーを
  // 上書きしないよう、ライブ forms への反応的結合をやめる。Question/Dashboard 編集画面と同方針。
  const [cachedForm, setCachedForm] = useState(null);
  const form = cachedForm;
  // 新規作成時は一覧で開いていたフォルダ (location.state.folder) を初期フォルダにする。
  const newFormInitialFolder = useMemo(
    () => (isEdit ? "" : normalizeFolderPath(location.state?.folder || "")),
    [isEdit, location.state],
  );
  const initialMetaRef = useRef({ name: isEdit ? "" : "新規フォーム", description: "", folder: isEdit ? "" : newFormInitialFolder });
  // ビルダー初期 props は読み込み時に 1 回だけ確定させ、以後ライブ forms 変化で揺らさない
  // （= FormBuilderWorkspace の再シードを 1 回に抑え、第 2 の巻き戻り経路を封じる）。
  const [initialSchema, setInitialSchema] = useState([]);
  const [initialSettings, setInitialSettings] = useState({});
  // 保存時の name→fileId 変換用。リネーム追従のため保存時点のライブ forms から算出する。
  const formIndex = useMemo(() => buildFormIndex(forms || []), [forms]);

  const [name, setName] = useState(isEdit ? "" : "新規フォーム");
  const [description, setDescription] = useState("");
  const [folder, setFolder] = useState(isEdit ? "" : newFormInitialFolder);
  const [localSettings, setLocalSettings] = useState({});
  // 保存先スプレッドシートの手動指定欄。標準フォルダ構成が既定のため初期は常に非表示（③）。
  const [showSpreadsheetSetting, setShowSpreadsheetSetting] = useState(false);
  const [builderDirty, setBuilderDirty] = useState(false);
  const unsavedDialog = useConfirmDialog();
  // 連結済みフォームで「未選択（自動作成）」を選んだときの連結解除確認。
  const unlinkDialog = useConfirmDialog();
  const [isSaving, setIsSaving] = useState(false);
  const [loading, setLoading] = useState(isEdit);
  const { isReadLocked } = useEditLock();
  const [nameError, setNameError] = useState("");
  const [questionControl, setQuestionControl] = useState(null);
  // forms 確定後に formId ごと 1 回だけロードするためのガード（新規は "__new__"）。
  const loadedFormIdRef = useRef(null);
  // 開いた瞬間に表示する IndexedDB キャッシュの目次ツリー（フォーム本体ロードを待たない）。
  // 本体ロード完了後はライブ schema 由来の目次へ自然に差し替わる。
  const [cachedNavItems, setCachedNavItems] = useState(null);

  // フォーム本体のロードとは独立に、目次キャッシュを即読み出してサイドバーへ出す。
  useEffect(() => {
    if (!isEdit || !formId) {
      setCachedNavItems(null);
      return;
    }
    let cancelled = false;
    setCachedNavItems(null);
    getFormNavFromCache(formId)
      .then((cached) => {
        if (!cancelled && cached?.items) setCachedNavItems(cached.items);
      })
      .catch(() => { /* キャッシュ無し/失敗は目次なしで読み込み中表示にフォールバック */ });
    return () => { cancelled = true; };
  }, [formId, isEdit]);
  const metaDirty = useMemo(() => name !== initialMetaRef.current.name || description !== initialMetaRef.current.description || folder !== initialMetaRef.current.folder, [name, description, folder]);
  const isDirty = builderDirty || metaDirty;

  // 開いたとき 1 回だけ初期化する（その後フリーズ）。Question 編集画面の確立パターンを踏襲。
  useCancellable(async (isCancelled) => {
    if (!isEdit) {
      // 新規: マウント時 1 回だけ空シード（サーバ取得なし）。
      if (loadedFormIdRef.current === "__new__") return;
      loadedFormIdRef.current = "__new__";
      // 修正画面を開いた初回に 1 回だけ候補を取り直す（保存後に増えた新規シートを反映）。
      invalidateSpreadsheetOptions();
      setCachedForm(null);
      setInitialSchema([]);
      setInitialSettings({});
      initialMetaRef.current = { name: "新規フォーム", description: "", folder: newFormInitialFolder };
      setName("新規フォーム");
      setDescription("");
      setFolder(newFormInitialFolder);
      setLocalSettings({});
      // 新規は未連結。スプレッドシート欄は畳んだ既定（保存時に自動作成）。
      setShowSpreadsheetSetting(false);
      setNameError("");
      return;
    }
    // forms 確定まで待つ（fileId→フォーム名 解決の formIndex に forms が要る）。
    if (loadingForms) return;
    // formId ごとに 1 回だけロードする（背景リフレッシュで再ロードして編集を潰さないため）。
    if (loadedFormIdRef.current === formId) return;
    loadedFormIdRef.current = formId;
    // 修正画面を開いた初回に 1 回だけ候補を取り直す（保存後に増えた新規シートを反映）。
    invalidateSpreadsheetOptions();
    setLoading(true);
    try {
      // 通常は開くたびにサーバ最新(.json)から取得する（キャッシュは使わない）。ただし
      // 未アップロード（pendingUpload）／local_ 仮 ID のフォームは、サーバにまだ無い・もしくは
      // 古い版しか無いため forceRefresh を避けてキャッシュ（＝最新のローカル編集）を使う。
      // forceRefresh すると nfbGetForm が "Form not found" を返してアップロード中の自分の
      // 編集が開けない／無駄な往復になる。送信完了で pendingUpload が false に戻れば次回から
      // 従来どおりサーバ最新を取得する。オフライン等の失敗時は getForm がキャッシュへフォールバック。
      const liveForm = (forms || []).find((f) => f && f.id === formId) || null;
      const pendingUpload = isLocalId(formId) || !!liveForm?.pendingUpload;
      const fresh = await dataStore.getForm(formId, { forceRefresh: !pendingUpload });
      if (isCancelled()) return;
      if (!fresh) {
        setLoading(false);
        return;
      }
      // 表示用: 保存スキーマ/設定は full-query フォーム参照を fileId で保持しているため、
      // 論理パスへ戻し、formLink の表示パスも childFormId から再計算する（リネーム追従）。
      const idx = buildFormIndex(forms || []);
      const displaySchema = fresh.schema
        ? refreshFormLinkPaths(schemaTemplateFormRefsToNames(fresh.schema, idx), idx)
        : [];
      const displaySettings = settingsTemplateFormRefsToNames(
        migrateStandardPrintTemplateId(omitThemeSetting(fresh.settings || {})),
        idx,
      );
      const formTitle = fresh.settings?.formTitle || "";
      // 次回開いた瞬間の即表示用に、最新スキーマの目次ツリーをキャッシュへ書き戻す
      // （ラベル/構造は名前解決に依存しないため生スキーマから直接ビルドできる）。fire-and-forget。
      const navItems = buildSchemaMapItems({ schema: fresh.schema || [], scope: "all" });
      setCachedNavItems(navItems);
      saveFormNavToCache(formId, navItems).catch(() => { /* キャッシュ書込失敗は無視 */ });
      setCachedForm(fresh);
      setInitialSchema(displaySchema);
      setInitialSettings(displaySettings);
      initialMetaRef.current = { name: formTitle, description: fresh.description || "", folder: fresh.folder || "" };
      setName(formTitle);
      setDescription(fresh.description || "");
      setFolder(fresh.folder || "");
      setLocalSettings(displaySettings);
      // 連結済みなら開いた時点でスプレッドシート欄を表示する（formId ごとに 1 回だけ初期化。
      // この後ユーザーが未選択にして両フィールドが空になっても畳まれない）。
      setShowSpreadsheetSetting(isFormSpreadsheetLinked(displaySettings));
      setNameError("");
      setLoading(false);
    } catch (error) {
      if (isCancelled()) return;
      setLoading(false);
      showAlert(`フォームの取得に失敗しました: ${toErrorMessage(error)}`);
    }
  }, [formId, isEdit, loadingForms]);

  useBeforeUnloadGuard(isDirty);

  const navigateBack = () => {
    if (location.state?.from) {
      navigate(location.state.from, { replace: true });
      return;
    }
    navigate(fallback, { replace: true });
  };

  // 「未選択（自動作成）」: 物理 ID と論理パスを両方空にし、保存時にバックエンドの
  // 「両方空 → 04_spreadsheets へ新規作成」経路を発火させる。プレビューにも反映する。
  const applyUnlinkSpreadsheet = useCallback(() => {
    setLocalSettings((prev) => applyUnlinkSpreadsheetForRecreate(prev));
    builderRef.current?.updateSetting?.("spreadsheetPath", "");
    builderRef.current?.updateSetting?.("spreadsheetId", "");
  }, []);

  const handleSettingsChange = useCallback((key, value) => {
    // 保存先スプレッドシート欄で「未選択（自動作成）」を選んだ場合。連結済みなら確認してから
    // 解除し、未連結ならそのまま適用する（解除＝両フィールド空 → 保存時に新規作成・連結し直し）。
    if (key === "spreadsheetPath" && !value) {
      if (isFormSpreadsheetLinked(localSettings)) unlinkDialog.open();
      else applyUnlinkSpreadsheet();
      return;
    }
    // 論理パス（spreadsheetPath）と直接 ID/URL（spreadsheetId）は排他（後勝ち）にする。
    setLocalSettings((prev) => applySpreadsheetExclusiveSetting(prev, key, value));
    builderRef.current?.updateSetting?.(key, value);
    // 排他で相手側がクリアされるケースはビルダー側プレビューにも反映する（冪等）。
    if (key === "spreadsheetPath" && value) builderRef.current?.updateSetting?.("spreadsheetId", "");
    if (key === "spreadsheetId" && value) builderRef.current?.updateSetting?.("spreadsheetPath", "");
  }, [localSettings, unlinkDialog, applyUnlinkSpreadsheet]);

  const unlinkConfirmOptions = [
    {
      label: "新規作成に切り替える",
      value: "unlink",
      variant: "primary",
      onSelect: () => {
        unlinkDialog.close();
        applyUnlinkSpreadsheet();
      },
    },
    {
      label: "キャンセル",
      value: "cancel",
      onSelect: unlinkDialog.close,
    },
  ];

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
      // 次回開いた瞬間の即表示用に、保存したスキーマの目次ツリーをキャッシュへ書き戻す。
      if (savedForm?.id) {
        saveFormNavToCache(savedForm.id, buildSchemaMapItems({ schema, scope: "all" }))
          .catch(() => { /* キャッシュ書込失敗は無視 */ });
      }
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

  // 開くたびにサーバ最新を取得してから本体を表示する（取得完了まで読み込み中表示）。
  // ただし目次は IndexedDB キャッシュから即サイドバーへ出し、開いた瞬間の体感を改善する
  // （キャッシュ未保存の初回フォームは従来どおり目次なしで読み込み中）。
  if (isEdit && loading) {
    return (
      <AppLayout
        title="フォーム修正"
        badge="管理 > フォーム"
        fallbackPath={fallback}
        onBack={handleBack}
        sidebarActions={
          cachedNavItems ? (
            <SchemaMapNav items={cachedNavItems} leadingItems={META_LEADING_ITEMS} />
          ) : null
        }
      >
        <div className="nf-card nf-mb-24">読み込み中…</div>
      </AppLayout>
    );
  }

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
            leadingItems={META_LEADING_ITEMS}
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
          {isFormSpreadsheetLinked(localSettings) ? (
            <p className="nf-text-11 nf-text-muted nf-mt-4 nf-mb-0">
              このフォームはスプレッドシートと連結済みです。下で連結先を確認・変更できます。保存先を「未選択（自動作成）」にして保存すると、新しいスプレッドシートを作成して連結し直します（既存シートのデータは <code>Drive</code> に残りますが、このフォームからは参照されなくなります）。
            </p>
          ) : (
            <p className="nf-text-11 nf-text-muted nf-mt-4 nf-mb-0">
              指定しない場合は標準フォルダ構成の <code>04_spreadsheets</code> に回答保存用スプレッドシートを自動作成します。
            </p>
          )}
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
      <ConfirmDialog
        open={unlinkDialog.state.open}
        title="連結を解除して新規作成しますか？"
        message="現在の連結を外し、保存時に新しいスプレッドシートを作成して連結し直します。既存のシートとデータは Drive に残りますが、このフォームからは参照されなくなります。"
        options={unlinkConfirmOptions}
      />
    </AppLayout>
  );
}
