import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import AppLayout from "../app/components/AppLayout.jsx";
import ConfirmDialog from "../app/components/ConfirmDialog.jsx";
import AlertDialog from "../app/components/AlertDialog.jsx";
import { useAppData } from "../app/state/AppDataProvider.jsx";
import { dataStore } from "../app/state/dataStore.js";
import { useAlert } from "../app/hooks/useAlert.js";
import { DISPLAY_MODES } from "../core/displayModes.js";
import { importFormsFromDrive, hasScriptRun } from "../services/gasClient.js";
import { formatUnixMsDateTime, toUnixMs } from "../utils/dateTime.js";

const formatDisplayFieldsSummary = (form) => {
  if (!form) return "";
  const settings = Array.isArray(form.displayFieldSettings) && form.displayFieldSettings.length
    ? form.displayFieldSettings
    : (Array.isArray(form.importantFields) ? form.importantFields.map((path) => ({ path, mode: DISPLAY_MODES.NORMAL })) : []);
  if (!settings.length) return "";
  return settings
    .filter((item) => item?.path)
    .map((item) => item.path)
    .join(", ");
};

const formatDate = (value) => {
  const ms = Number.isFinite(value) ? value : toUnixMs(value);
  if (!Number.isFinite(ms)) return "---";
  return formatUnixMsDateTime(ms);
};

const buildImportDetail = (skipped = 0, parseFailed = 0, { useRegisteredLabel = false } = {}) => {
  const parts = [];
  if (skipped > 0) {
    const label = useRegisteredLabel ? "登録済みスキップ" : "スキップ";
    parts.push(`${label} ${skipped} 件`);
  }
  if (parseFailed > 0) parts.push(`読込失敗 ${parseFailed} 件`);
  return parts.length > 0 ? `（${parts.join("、")}）` : "";
};

export default function AdminDashboardPage() {
  const { forms, loadFailures, loadingForms, archiveForm, unarchiveForm, archiveForms, unarchiveForms, deleteForms, refreshForms, exportForms, createForm } = useAppData();
  const navigate = useNavigate();
  const { alertState, showAlert, closeAlert } = useAlert();
  const [selected, setSelected] = useState(() => new Set());
  const [confirmArchive, setConfirmArchive] = useState({ open: false, formId: null, targetIds: [], multiple: false, allArchived: false, hasPublished: false });
  const [confirmDelete, setConfirmDelete] = useState({ open: false, formId: null, targetIds: [], multiple: false });
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importUrl, setImportUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [copiedId, setCopiedId] = useState(null);

  const sortedForms = useMemo(() => {
    const list = forms.slice();
    list.sort(
      (a, b) => (Number.isFinite(b.modifiedAtUnixMs) ? b.modifiedAtUnixMs : toUnixMs(b.modifiedAt)) -
        (Number.isFinite(a.modifiedAtUnixMs) ? a.modifiedAtUnixMs : toUnixMs(a.modifiedAt))
    );
    return list;
  }, [forms]);

  const loadFailureRows = useMemo(() => {
    const rows = (loadFailures || []).map((item) => ({
      id: item.id,
      archived: true,
      settings: {},
      description: "",
      modifiedAt: item.lastTriedAt,
      loadError: item,
    }));
    rows.sort(
      (a, b) => (Number.isFinite(b.modifiedAtUnixMs) ? b.modifiedAtUnixMs : toUnixMs(b.modifiedAt || 0)) -
        (Number.isFinite(a.modifiedAtUnixMs) ? a.modifiedAtUnixMs : toUnixMs(a.modifiedAt || 0))
    );
    return rows;
  }, [loadFailures]);

  const adminForms = useMemo(() => [...sortedForms, ...loadFailureRows], [sortedForms, loadFailureRows]);

  const toggleSelect = (formId) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(formId)) next.delete(formId);
      else next.add(formId);
      return next;
    });
  };

  const selectAll = (checked) => {
    if (checked) setSelected(new Set(adminForms.map((form) => form.id)));
    else setSelected(new Set());
  };

  const clearSelectionByIds = useCallback((ids = []) => {
    if (!Array.isArray(ids) || ids.length === 0) return;
    setSelected((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });
  }, []);

  const handleArchiveSelected = () => {
    const selectedForms = sortedForms.filter((form) => selected.has(form.id));
    if (!selectedForms.length) {
      showAlert("アーカイブ可能なフォームを選択してください。（読み込みエラーの項目は削除のみ可能です）");
      return;
    }

    const allArchived = selectedForms.every((form) => form.archived);
    const hasPublished = selectedForms.some((form) => !form.archived);

    const targetIds = selectedForms.map((form) => form.id);
    const firstId = targetIds[0];
    setConfirmArchive({
      open: true,
      formId: firstId,
      targetIds,
      multiple: targetIds.length > 1,
      allArchived,
      hasPublished,
    });
  };

  const handleDeleteSelected = () => {
    if (!selected.size) {
      showAlert("削除するフォームを選択してください。");
      return;
    }
    const targetIds = Array.from(selected);
    const firstId = targetIds[0];
    setConfirmDelete({ open: true, formId: firstId, multiple: targetIds.length > 1, targetIds });
  };

  const handleExport = async () => {
    if (!selected.size) {
      showAlert("スキーマをエクスポートするフォームを選択してください。");
      return;
    }
    const targets = await exportForms(Array.from(selected));
    if (!targets.length) {
      showAlert("エクスポート可能なデータがありません");
      return;
    }

    if (targets.length === 1) {
      // 1個の場合は.jsonファイルとして保存
      const form = targets[0];
      const filename = `${form.settings?.formTitle || form.id}.json`;
      const { id, ...formWithoutId } = form;
      const blob = new Blob([JSON.stringify(formWithoutId, null, 2)], { type: "application/json" });
      saveAs(blob, filename);
    } else {
      // 複数の場合はZIPファイルとして保存
      const zip = new JSZip();
      targets.forEach((form) => {
        const filename = `${form.settings?.formTitle || form.id}.json`;
        const { id, ...formWithoutId } = form;
        zip.file(filename, JSON.stringify(formWithoutId, null, 2));
      });
      const blob = await zip.generateAsync({ type: "blob" });
      saveAs(blob, `forms_${new Date().toISOString().replace(/[:.-]/g, "")}.zip`);
    }
  };

  const handleImport = () => {
    if (importing) return;
    if (!hasScriptRun()) {
      showAlert("インポート機能はGoogle Apps Script環境でのみ利用可能です");
      return;
    }
    setImportUrl("");
    setImportDialogOpen(true);
  };
  const sanitizeImportedForm = (raw) => {
    if (!raw || typeof raw !== "object") return null;
    const schema = Array.isArray(raw.schema) ? raw.schema : [];
    const settings = raw && typeof raw.settings === "object" && !Array.isArray(raw.settings) ? raw.settings : {};

    // 旧形式のnameフィールドがある場合、settings.formTitleに移行
    if (!settings.formTitle && typeof raw.name === "string") {
      settings.formTitle = raw.name;
    }

    return {
      id: raw.id, // IDを保持（重要）
      description: typeof raw.description === "string" ? raw.description : "",
      schema,
      settings,
      archived: !!raw.archived,
      schemaVersion: Number.isFinite(raw.schemaVersion) ? raw.schemaVersion : 1,
      createdAt: raw.createdAt, // 作成日時を保持
      modifiedAt: raw.modifiedAt, // 更新日時を保持
      createdAtUnixMs: Number.isFinite(raw.createdAtUnixMs) ? raw.createdAtUnixMs : toUnixMs(raw.createdAt),
      modifiedAtUnixMs: Number.isFinite(raw.modifiedAtUnixMs) ? raw.modifiedAtUnixMs : toUnixMs(raw.modifiedAt),
    };
  };

  const flattenImportedContents = (contents) => {
    const list = [];
    contents.forEach((item) => {
      if (Array.isArray(item)) {
        item.forEach((child) => {
          const sanitized = sanitizeImportedForm(child);
          if (sanitized) list.push(sanitized);
        });
      } else {
        const sanitized = sanitizeImportedForm(item);
        if (sanitized) list.push(sanitized);
      }
    });
    return list;
  };

  const startImportWorkflow = useCallback(
    async (parsedContents, { skipped = 0, parseFailed = 0 } = {}) => {
      const queue = flattenImportedContents(parsedContents);
      const detail = buildImportDetail(skipped, parseFailed, { useRegisteredLabel: true });
      if (!queue.length) {
        showAlert(`取り込めるフォームはありませんでした${detail}。`);
        return;
      }

      setImporting(true);
      let imported = 0;

      try {
        for (const item of queue) {
          const payload = {
            id: item.id, // IDを保持（重要）
            description: item.description,
            schema: item.schema,
            settings: item.settings,
            archived: item.archived,
            schemaVersion: item.schemaVersion,
            createdAt: item.createdAt, // 作成日時を保持
            modifiedAt: item.modifiedAt, // 更新日時を保持
          };

          await createForm(payload);
          imported += 1;
        }

        setSelected(new Set());

        // 結果メッセージ
        if (imported > 0) {
          showAlert(`${imported} 件のフォームを取り込みました${detail}。`);
        } else {
          showAlert(`取り込めるフォームはありませんでした${detail}。`);
        }
        console.log(
          `[DriveImport] success=${imported}, alreadyRegistered=${skipped}, parseFailed=${parseFailed}`,
        );
      } catch (error) {
        console.error("[DriveImport] import workflow failed", error);
        showAlert(error?.message || "スキーマの取り込み中にエラーが発生しました");
      } finally {
        setImporting(false);
      }
    },
    [createForm, showAlert],
  );

  const handleImportFromDrive = async () => {
    const url = importUrl?.trim();
    if (!url) {
      showAlert("Google Drive URLを入力してください");
      return;
    }

    setImportDialogOpen(false);
    setImporting(true);

    try {
      // Google DriveからフォームデータをAPI経由で取得
      const result = await importFormsFromDrive(url);
      const { forms: importedForms, skipped = 0, parseFailed = 0 } = result;
      const detail = buildImportDetail(skipped, parseFailed);

      if (!importedForms || importedForms.length === 0) {
        showAlert(`有効なフォームがありませんでした${detail}。`);
        setImporting(false);
        return;
      }

      // インポートワークフローを実行
      await startImportWorkflow(importedForms, { skipped, parseFailed });
    } catch (error) {
      console.error("[DriveImport] import from Drive failed", error);
      showAlert(error?.message || "Google Driveからのインポートに失敗しました");
      setImporting(false);
    }
  };

  const confirmArchiveAction = () => {
    const targetIds = (confirmArchive.targetIds && confirmArchive.targetIds.length
      ? confirmArchive.targetIds
      : confirmArchive.formId
        ? [confirmArchive.formId]
        : []);
    if (!targetIds.length) return;

    // アーカイブ状態を保持
    const shouldUnarchive = confirmArchive.allArchived;

    // ダイアログを即座に閉じて選択をクリア
    clearSelectionByIds(targetIds);
    setConfirmArchive({ open: false, formId: null, targetIds: [], multiple: false, allArchived: false, hasPublished: false });

    // バックグラウンドで一括処理を実行
    (async () => {
      try {
        if (shouldUnarchive) {
          await unarchiveForms(targetIds);
        } else {
          await archiveForms(targetIds);
        }
      } catch (error) {
        console.error("[AdminDashboard] Archive action failed:", error);
        showAlert(`アーカイブ処理中にエラーが発生しました: ${error.message}`);
      }
    })();
  };

  const confirmDeleteAction = async () => {
    const targetIds = (confirmDelete.targetIds && confirmDelete.targetIds.length
      ? confirmDelete.targetIds
      : confirmDelete.formId
        ? [confirmDelete.formId]
        : []);
    if (!targetIds.length) return;

    try {
      await deleteForms(targetIds);
      clearSelectionByIds(targetIds);
      setConfirmDelete({ open: false, formId: null, targetIds: [], multiple: false });
    } catch (error) {
      console.error("[AdminDashboard] Delete action failed:", error);
      showAlert(error?.message || "フォームの削除中にエラーが発生しました");
    }
  };

  const goToEditor = (formId) => {
    navigate(`/forms/${formId}/edit`);
  };

  const handleCopyId = useCallback((formId, event) => {
    event.stopPropagation();
    const baseUrl = window.__GAS_WEBAPP_URL__ || window.location.origin;
    const fullUrl = `${baseUrl}?form=${formId}`;
    navigator.clipboard.writeText(fullUrl).then(() => {
      setCopiedId(formId);
      setTimeout(() => setCopiedId(null), 2000);
    }).catch((error) => {
      console.error("Failed to copy:", error);
      showAlert("URLのコピーに失敗しました");
    });
  }, [showAlert]);

  const handleCreateNew = () => {
    navigate("/forms/new");
  };

  return (
    <AppLayout
      title="フォーム管理"
      badge="フォーム一覧"
      fallbackPath="/"
      actions={null}
      sidebarActions={
        <>
          <button type="button" className="nf-btn-outline nf-btn-sidebar nf-text-13" onClick={handleCreateNew}>
            新規作成
          </button>
          <button type="button" className="nf-btn-outline nf-btn-sidebar nf-text-13" onClick={handleImport}>
            {importing ? "インポート中..." : "インポート"}
          </button>
          <button type="button" className="nf-btn-outline nf-btn-sidebar nf-text-13" onClick={handleExport} disabled={selected.size === 0}>
            エクスポート
          </button>
          <button
            type="button"
            className="nf-btn-outline nf-btn-sidebar nf-text-13"
            onClick={handleArchiveSelected}
            disabled={selected.size === 0}
          >
            アーカイブ
          </button>
          <button
            type="button"
            className="nf-btn-outline nf-btn-sidebar nf-text-13 admin-danger-btn"
            onClick={handleDeleteSelected}
            disabled={selected.size === 0}
          >
            削除
          </button>
          <button
            type="button"
            className={`nf-btn-outline nf-btn-sidebar nf-text-13${!loadingForms ? " admin-refresh-btn" : ""}`}
            onClick={() => refreshForms("manual:admin-dashboard")}
            disabled={loadingForms}
          >
            {loadingForms ? "🔄 更新中..." : "🔄 更新"}
          </button>
        </>
      }
    >
      {loadingForms ? (
        <p className="nf-text-subtle">読み込み中...</p>
      ) : (
        <div className="search-table-wrap">
          <table className="search-table">
            <thead>
              <tr>
                <th className="search-th">
                  <input type="checkbox" checked={adminForms.length > 0 && selected.size === adminForms.length} onChange={(event) => selectAll(event.target.checked)} />
                </th>
                <th className="search-th">名称</th>
                <th className="search-th">フォームID</th>
                <th className="search-th">更新日時</th>
                <th className="search-th">表示項目</th>
                <th className="search-th">状態</th>
              </tr>
            </thead>
            <tbody>
              {adminForms.map((form) => {
                const isLoadError = !!form.loadError;
                const summary = isLoadError ? "" : formatDisplayFieldsSummary(form);
                const loadError = form.loadError || null;
                const lastUpdated = isLoadError ? formatDate(loadError?.lastTriedAt) : formatDate(form.modifiedAt);
                return (
                  <tr
                    key={form.id}
                    className="admin-row"
                    data-clickable={isLoadError ? "false" : "true"}
                    data-error={isLoadError ? "true" : "false"}
                    onClick={() => {
                      if (!isLoadError) {
                        goToEditor(form.id);
                      }
                    }}
                  >
                    <td className="search-td" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={selected.has(form.id)} onChange={() => toggleSelect(form.id)} />
                      {isLoadError && <div className="nf-text-danger-ink nf-text-11 nf-mt-4">削除のみ可能</div>}
                    </td>
                    <td className="search-td">
                      {isLoadError ? (
                        <>
                          <div className="nf-fw-600 nf-text-danger-ink">{loadError?.fileName || "(名称不明)"}</div>
                          <div className="nf-text-danger-ink-strong nf-text-12">フォームID: {form.id}</div>
                          {loadError?.fileId && <div className="nf-text-danger-ink-strong nf-text-12">ファイルID: {loadError.fileId}</div>}
                          {loadError?.driveFileUrl && (
                            <div className="nf-mt-6">
                              <a
                                href={loadError.driveFileUrl}
                                target="_blank"
                                rel="noreferrer"
                                onClick={(event) => event.stopPropagation()}
                                className="admin-link"
                              >
                                Driveで確認
                              </a>
                            </div>
                          )}
                        </>
                      ) : (
                        <>
                          <div className="nf-fw-600">{form.settings?.formTitle || "(無題)"}</div>
                          {form.description && <div className="nf-text-muted nf-text-12">{form.description}</div>}
                        </>
                      )}
                    </td>
                    <td className="search-td" onClick={(e) => e.stopPropagation()}>
                      <div className="nf-row nf-gap-6">
                        <span className="admin-form-id">{form.id}</span>
                        <button
                          type="button"
                          className="admin-copy-btn"
                          onClick={(e) => handleCopyId(form.id, e)}
                          title="URLをコピー"
                        >
                          {copiedId === form.id ? "✓" : "📋"}
                        </button>
                      </div>
                    </td>
                    <td className="search-td">{lastUpdated}</td>
                    <td className="search-td">
                      {isLoadError ? (
                        <>
                          <div className="nf-text-danger-ink nf-fw-600">読み込みエラー</div>
                          <div className="nf-text-danger-ink-strong nf-text-12">{loadError?.errorMessage || "読み込みに失敗しました"}</div>
                          {loadError?.errorStage && <div className="nf-text-danger-ink-strong nf-text-11 nf-mt-4">ステージ: {loadError.errorStage}</div>}
                        </>
                      ) : summary ? (
                        summary
                      ) : (
                        <span className="nf-text-subtle nf-text-12">設定なし</span>
                      )}
                    </td>
                    <td className="search-td">
                      {isLoadError ? (
                        <span className="nf-text-danger-strong nf-fw-600">読み込みエラー</span>
                      ) : form.archived ? (
                        <span className="nf-text-danger-strong">アーカイブ済み</span>
                      ) : (
                        <span className="nf-text-success">公開中</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {adminForms.length === 0 && (
                <tr>
                  <td className="search-td nf-text-center" colSpan={6}>
                    フォームが登録されていません。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={confirmArchive.open}
        title={confirmArchive.allArchived ? "アーカイブを解除" : "フォームをアーカイブ"}
        message={
          confirmArchive.allArchived
            ? "このフォームのアーカイブを解除して公開中に戻します。よろしいですか？"
            : "このフォームをアーカイブします。検索画面には表示されなくなります。よろしいですか？"
        }
        options={[
          {
            label: "キャンセル",
            value: "cancel",
            onSelect: () => setConfirmArchive({ open: false, formId: null, targetIds: [], multiple: false, allArchived: false, hasPublished: false }),
          },
          {
            label: confirmArchive.allArchived ? "解除" : "アーカイブ",
            value: "archive",
            variant: "primary",
            onSelect: confirmArchiveAction,
          },
        ]}
      />

      <ConfirmDialog
        open={confirmDelete.open}
        title="フォームを削除"
        message={
          confirmDelete.multiple
            ? "選択したフォームをまとめて削除します。元に戻すことはできません。よろしいですか？"
            : "このフォームを削除します。元に戻すことはできません。よろしいですか？"
        }
        options={[
          {
            label: "キャンセル",
            value: "cancel",
            onSelect: () => setConfirmDelete({ open: false, formId: null, targetIds: [], multiple: false }),
          },
          {
            label: "削除",
            value: "delete",
            variant: "danger",
            onSelect: confirmDeleteAction,
          },
        ]}
      />

      <ImportUrlDialog
        open={importDialogOpen}
        url={importUrl}
        onUrlChange={setImportUrl}
        onImport={handleImportFromDrive}
        onCancel={() => setImportDialogOpen(false)}
      />

      <AlertDialog open={alertState.open} title={alertState.title} message={alertState.message} onClose={closeAlert} />
    </AppLayout>
  );
}

function ImportUrlDialog({ open, url, onUrlChange, onImport, onCancel }) {
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) {
      setError("");
    }
  }, [open]);

  if (!open) return null;

  const handleImport = () => {
    const trimmed = (url || "").trim();
    if (!trimmed) {
      setError("Google Drive URLを入力してください");
      return;
    }
    setError("");
    onImport();
  };

  return (
    <div className="admin-import-overlay">
      <div className="admin-import-panel">
        <h3 className="nf-text-18 nf-fw-700 nf-mb-8">Google Driveからインポート</h3>
        <p className="nf-mb-16 nf-text-muted nf-text-14">
          ファイルURLまたはフォルダURLを入力してください。
        </p>

        <div className="nf-mb-16">
          <label className="nf-block nf-mb-6 nf-text-13 nf-fw-600">
            Google Drive URL
          </label>
          <input
            type="text"
            value={url}
            onChange={(event) => {
              onUrlChange(event.target.value);
              if (error) setError("");
            }}
            className="nf-input admin-import-input"
            placeholder="https://drive.google.com/file/d/... または https://drive.google.com/drive/folders/..."
          />
          {error && <p className="nf-mt-6 nf-text-danger-strong nf-text-12">{error}</p>}
          <p className="nf-mt-6 nf-text-muted nf-text-11">
            ・ファイルURL: そのフォームのみをインポート<br />
            ・フォルダURL: フォルダ内の全ての.jsonファイルをインポート<br />
            ・既にプロパティサービスに存在するフォームIDは自動的にスキップされます
          </p>
        </div>

        <div className="nf-row nf-gap-12 nf-mt-24 nf-justify-end">
          <button type="button" className="nf-btn-outline admin-import-btn" onClick={onCancel}>
            キャンセル
          </button>
          <button
            type="button"
            className="admin-import-btn admin-import-btn-primary"
            onClick={handleImport}
          >
            インポート
          </button>
        </div>
      </div>
    </div>
  );
}
