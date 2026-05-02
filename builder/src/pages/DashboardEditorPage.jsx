import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import AppLayout from "../app/components/AppLayout.jsx";
import ConfirmDialog from "../app/components/ConfirmDialog.jsx";
import { useAppData } from "../app/state/AppDataProvider.jsx";
import { useAlert } from "../app/hooks/useAlert.js";
import { useConfirmDialog } from "../app/hooks/useConfirmDialog.js";
import { useBeforeUnloadGuard } from "../app/hooks/useBeforeUnloadGuard.js";
import { createEmptyDashboard, normalizeDashboard } from "../features/dashboards/dashboardSchema.js";

const stringifyJsonField = (value) => {
  if (value === null || value === undefined) return "[]";
  try {
    return JSON.stringify(value, null, 2);
  } catch (_err) {
    return "[]";
  }
};

const parseJsonField = (raw, fieldName) => {
  const trimmed = (raw || "").trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) {
      throw new Error(`${fieldName} は JSON 配列で記述してください`);
    }
    return parsed;
  } catch (err) {
    throw new Error(`${fieldName} のJSONが不正です: ${err.message}`);
  }
};

export default function DashboardEditorPage() {
  const { id: dashboardId } = useParams();
  const isEdit = Boolean(dashboardId);
  const { dashboards, getDashboardById, createDashboard, updateDashboard, refreshDashboards } = useAppData();
  const navigate = useNavigate();
  const { showAlert } = useAlert();
  const unsavedDialog = useConfirmDialog();

  const currentDashboard = useMemo(() => {
    if (!isEdit) return null;
    return getDashboardById(dashboardId) || null;
  }, [isEdit, dashboardId, getDashboardById, dashboards]);

  const initialDashboard = useMemo(() => currentDashboard || createEmptyDashboard(), [currentDashboard]);

  const [title, setTitle] = useState(initialDashboard.settings?.title || "");
  const [description, setDescription] = useState(initialDashboard.description || "");
  const [driveUrl, setDriveUrl] = useState(initialDashboard.driveFileUrl || "");
  const [templateUrl, setTemplateUrl] = useState(initialDashboard.templateUrl || "");
  const [dataSourcesJson, setDataSourcesJson] = useState(stringifyJsonField(initialDashboard.dataSources));
  const [queriesJson, setQueriesJson] = useState(stringifyJsonField(initialDashboard.queries));
  const [widgetsJson, setWidgetsJson] = useState(stringifyJsonField(initialDashboard.widgets));
  const [layoutJson, setLayoutJson] = useState(stringifyJsonField(initialDashboard.layout));
  const [titleError, setTitleError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    if (!isEdit) return;
    if (!currentDashboard) {
      // 一覧が未取得ならフェッチ
      refreshDashboards({ reason: "editor-mount", background: true }).catch(console.error);
      return;
    }
    setTitle(currentDashboard.settings?.title || "");
    setDescription(currentDashboard.description || "");
    setDriveUrl(currentDashboard.driveFileUrl || "");
    setTemplateUrl(currentDashboard.templateUrl || "");
    setDataSourcesJson(stringifyJsonField(currentDashboard.dataSources));
    setQueriesJson(stringifyJsonField(currentDashboard.queries));
    setWidgetsJson(stringifyJsonField(currentDashboard.widgets));
    setLayoutJson(stringifyJsonField(currentDashboard.layout));
    setIsDirty(false);
  }, [currentDashboard, isEdit, refreshDashboards]);

  useBeforeUnloadGuard(isDirty);

  const markDirty = () => {
    if (!isDirty) setIsDirty(true);
  };

  const navigateBack = () => {
    navigate("/dashboards", { replace: true });
  };

  const handleSave = async () => {
    if (isSaving) return;
    const trimmedTitle = (title || "").trim();
    if (!trimmedTitle) {
      setTitleError("ダッシュボード名を入力してください");
      return;
    }
    setTitleError("");

    let dataSources;
    let queries;
    let widgets;
    let layout;
    try {
      dataSources = parseJsonField(dataSourcesJson, "データソース");
      queries = parseJsonField(queriesJson, "クエリ");
      widgets = parseJsonField(widgetsJson, "ウィジェット");
      layout = parseJsonField(layoutJson, "レイアウト");
    } catch (err) {
      showAlert(err.message);
      return;
    }

    setIsSaving(true);
    const payload = {
      ...(isEdit && currentDashboard
        ? { id: currentDashboard.id, createdAtUnixMs: currentDashboard.createdAtUnixMs, driveFileUrl: currentDashboard.driveFileUrl }
        : {}),
      settings: { ...(currentDashboard?.settings || {}), title: trimmedTitle },
      description,
      templateUrl: templateUrl.trim(),
      dataSources,
      queries,
      widgets,
      layout,
      archived: currentDashboard?.archived ?? false,
      readOnly: currentDashboard?.readOnly ?? false,
    };

    const trimmedTargetUrl = driveUrl?.trim() || null;
    const isFileUrl = trimmedTargetUrl ? /\/file\/d\/[a-zA-Z0-9_-]+/.test(trimmedTargetUrl) : false;
    const isFolderUrl = trimmedTargetUrl ? /\/folders\/[a-zA-Z0-9_-]+/.test(trimmedTargetUrl) : false;
    let saveMode = "auto";
    if (!trimmedTargetUrl) {
      saveMode = isEdit ? "auto" : "copy_to_root";
    } else if (isFileUrl) {
      saveMode = "overwrite_existing";
    } else if (isFolderUrl) {
      saveMode = "copy_to_folder";
    }

    if (trimmedTargetUrl) {
      if (!isEdit && isFileUrl) {
        showAlert("新規作成時はファイルURLは指定できません。フォルダURLまたは空白にしてください。");
        setIsSaving(false);
        return;
      }
      if (isEdit && isFileUrl) {
        const originalFileUrl = currentDashboard?.driveFileUrl || "";
        if (trimmedTargetUrl !== originalFileUrl) {
          showAlert("既存ダッシュボードの保存先には、元のファイルURL以外のファイルURLは指定できません。");
          setIsSaving(false);
          return;
        }
      }
    }

    try {
      if (isEdit) {
        await updateDashboard(dashboardId, payload, trimmedTargetUrl, saveMode);
      } else {
        await createDashboard(payload, trimmedTargetUrl, saveMode);
      }
      setIsDirty(false);
      navigate("/dashboards", { replace: true });
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

  const handleCancel = () => {
    if (!isDirty) navigateBack();
    else unsavedDialog.open();
  };

  const previewDashboard = useMemo(() => {
    try {
      return normalizeDashboard({
        ...(currentDashboard || createEmptyDashboard()),
        settings: { ...(currentDashboard?.settings || {}), title: title || "" },
        description,
        templateUrl,
      });
    } catch (_err) {
      return null;
    }
  }, [currentDashboard, title, description, templateUrl]);

  const confirmOptions = [
    { label: "保存して続行", value: "save", variant: "primary", onSelect: async () => { unsavedDialog.close(); await handleSave(); } },
    { label: "保存せずに戻る", value: "discard", onSelect: () => { unsavedDialog.close(); navigateBack(); } },
    { label: "キャンセル", value: "cancel", onSelect: unsavedDialog.close },
  ];

  return (
    <AppLayout
      title={isEdit ? "ダッシュボード修正" : "ダッシュボード新規作成"}
      badge="ダッシュボード管理"
      fallbackPath="/dashboards"
      onBack={handleBack}
      backHidden={true}
      sidebarActions={
        <>
          <button type="button" className="nf-btn-outline nf-btn-sidebar nf-text-14" disabled={isSaving} onClick={handleSave}>
            {isSaving ? "保存中..." : "保存"}
          </button>
          <button type="button" className="nf-btn-outline nf-btn-sidebar nf-text-14" onClick={handleCancel}>
            キャンセル
          </button>
        </>
      }
    >
      <div className="nf-card nf-mb-24">
        <div className="nf-card nf-mb-16">
          <h3 className="nf-settings-group-title nf-mb-16">ダッシュボードの基本情報</h3>

          {isEdit && (
            <div className="nf-col nf-gap-6 nf-mb-16">
              <label className="nf-block nf-fw-600 nf-mb-6">ダッシュボードID</label>
              <input type="text" value={dashboardId || ""} readOnly className="nf-input nf-input--readonly admin-input" />
            </div>
          )}

          <div className="nf-col nf-gap-6 nf-mb-16">
            <label className="nf-block nf-fw-600 nf-mb-6">ダッシュボード名</label>
            <input
              value={title}
              onChange={(event) => { setTitle(event.target.value); if (titleError) setTitleError(""); markDirty(); }}
              className="nf-input admin-input"
              placeholder="ダッシュボード名"
            />
            {titleError && <p className="nf-text-danger-strong nf-text-12 nf-m-0">{titleError}</p>}
          </div>

          <div className="nf-col nf-gap-6 nf-mb-16">
            <label className="nf-block nf-fw-600 nf-mb-6">説明</label>
            <textarea value={description} onChange={(event) => { setDescription(event.target.value); markDirty(); }} className="nf-input admin-input nf-min-h-80" placeholder="説明" />
          </div>

          <div className="nf-col nf-gap-6 nf-mb-16">
            <label className="nf-block nf-fw-600 nf-mb-6">ダッシュボード定義のGoogle Drive保存先URL</label>
            <input
              value={driveUrl}
              onChange={(event) => { setDriveUrl(event.target.value); markDirty(); }}
              className="nf-input admin-input"
              placeholder={isEdit
                ? "空白: マイドライブルートに新たにコピー / フォルダURL: 指定フォルダにコピー"
                : "空白: マイドライブルート / フォルダURL: 指定フォルダに保存"}
            />
            <p className="nf-text-11 nf-text-muted nf-mt-4 nf-mb-0">
              {isEdit
                ? "現在のファイルURLが表示されています。空白にすると新たなコピーを作成します。フォルダURLに変更するとそのフォルダにコピーを作成します。ファイルURLは元のURL以外指定できません。"
                : "空白の場合はマイドライブのルートに保存されます。フォルダURLを指定するとそのフォルダに保存されます。"}
            </p>
          </div>

          <div className="nf-col nf-gap-6">
            <label className="nf-block nf-fw-600 nf-mb-6">グラフ・表のHTMLテンプレートファイルURL</label>
            <input
              value={templateUrl}
              onChange={(event) => { setTemplateUrl(event.target.value); markDirty(); }}
              className="nf-input admin-input"
              placeholder="https://drive.google.com/file/d/.../view"
            />
            <p className="nf-text-11 nf-text-muted nf-mt-4 nf-mb-0">
              Google Drive上のHTMLファイルのURL。<code>{"{{widget:..}}"}</code> 等のトークンを差し込んで描画します。空白の場合はテンプレートを使わず、ウィジェット定義に従ってデフォルトレイアウトで表示します。
            </p>
          </div>
        </div>

        <div className="nf-card nf-mb-16">
          <h3 className="nf-settings-group-title nf-mb-16">データソース・クエリ・ウィジェット</h3>
          <p className="nf-text-12 nf-text-muted nf-mb-12">
            このセクションは現状 JSON での編集です。ビジュアルエディタは後続フェーズで提供されます。
          </p>

          <div className="nf-col nf-gap-6 nf-mb-16">
            <label className="nf-block nf-fw-600 nf-mb-6">データソース (JSON 配列)</label>
            <textarea
              value={dataSourcesJson}
              onChange={(event) => { setDataSourcesJson(event.target.value); markDirty(); }}
              className="nf-input admin-input nf-min-h-80 nf-font-mono"
              placeholder='[{"alias":"sales","formId":"f_xxx","fields":["day","amount"]}]'
            />
          </div>

          <div className="nf-col nf-gap-6 nf-mb-16">
            <label className="nf-block nf-fw-600 nf-mb-6">クエリ (JSON 配列)</label>
            <textarea
              value={queriesJson}
              onChange={(event) => { setQueriesJson(event.target.value); markDirty(); }}
              className="nf-input admin-input nf-min-h-80 nf-font-mono"
              placeholder='[{"id":"q_daily","sql":"SELECT day, SUM(amount) AS total FROM sales GROUP BY day","params":[]}]'
            />
          </div>

          <div className="nf-col nf-gap-6 nf-mb-16">
            <label className="nf-block nf-fw-600 nf-mb-6">ウィジェット (JSON 配列)</label>
            <textarea
              value={widgetsJson}
              onChange={(event) => { setWidgetsJson(event.target.value); markDirty(); }}
              className="nf-input admin-input nf-min-h-80 nf-font-mono"
              placeholder='[{"id":"w_chart1","type":"echarts","queryId":"q_daily","chart":"line","encode":{"x":"day","y":["total"]}}]'
            />
          </div>

          <div className="nf-col nf-gap-6">
            <label className="nf-block nf-fw-600 nf-mb-6">レイアウト (JSON 配列)</label>
            <textarea
              value={layoutJson}
              onChange={(event) => { setLayoutJson(event.target.value); markDirty(); }}
              className="nf-input admin-input nf-min-h-80 nf-font-mono"
              placeholder='[{"widgetId":"w_chart1","row":0,"col":0,"w":12,"h":6}]'
            />
          </div>
        </div>

        {previewDashboard && (
          <div className="nf-card">
            <h3 className="nf-settings-group-title nf-mb-12">プレビュー (現在の入力)</h3>
            <pre className="nf-text-12 nf-pre-wrap">{JSON.stringify(previewDashboard, null, 2)}</pre>
          </div>
        )}
      </div>

      <ConfirmDialog open={unsavedDialog.state.open} title="未保存の変更があります" message="保存せずに離れますか？" options={confirmOptions} />
    </AppLayout>
  );
}
