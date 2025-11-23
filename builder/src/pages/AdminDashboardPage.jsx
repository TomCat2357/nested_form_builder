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

const tableStyle = {
  width: "100%",
  borderCollapse: "collapse",
  background: "#fff",
  borderRadius: 12,
  overflow: "hidden",
};

const thStyle = {
  textAlign: "left",
  padding: "12px 16px",
  borderBottom: "1px solid #E5E7EB",
  background: "#F8FAFC",
  fontSize: 13,
  fontWeight: 600,
};

const tdStyle = {
  padding: "12px 16px",
  borderBottom: "1px solid #F1F5F9",
  fontSize: 13,
  color: "#1F2937",
};

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

const buttonStyle = {
  padding: "6px 12px",
  borderRadius: 8,
  border: "1px solid #CBD5E1",
  background: "#fff",
  cursor: "pointer",
  fontSize: 13,
};

const labelMuted = { fontSize: 12, color: "#6B7280" };

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
  const { forms, loadFailures, loadingForms, archiveForm, unarchiveForm, deleteForms, refreshForms, exportForms, createForm } = useAppData();
  const navigate = useNavigate();
  const { alertState, showAlert, closeAlert } = useAlert();
  const [selected, setSelected] = useState(() => new Set());
  const [confirmArchive, setConfirmArchive] = useState({ open: false, formId: null, targetIds: [], multiple: false, allArchived: false, hasPublished: false });
  const [confirmDelete, setConfirmDelete] = useState({ open: false, formId: null, targetIds: [], multiple: false });
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importUrl, setImportUrl] = useState("");
  const [importing, setImporting] = useState(false);

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

  const confirmArchiveAction = async () => {
    const targetIds = (confirmArchive.targetIds && confirmArchive.targetIds.length
      ? confirmArchive.targetIds
      : confirmArchive.formId
        ? [confirmArchive.formId]
        : []);
    if (!targetIds.length) return;

    if (confirmArchive.allArchived) {
      for (const formId of targetIds) {
        await unarchiveForm(formId);
      }
    } else {
      for (const formId of targetIds) {
        await archiveForm(formId);
      }
    }

    clearSelectionByIds(targetIds);
    setConfirmArchive({ open: false, formId: null, targetIds: [], multiple: false, allArchived: false, hasPublished: false });
  };

  const confirmDeleteAction = async () => {
    const targetIds = (confirmDelete.targetIds && confirmDelete.targetIds.length
      ? confirmDelete.targetIds
      : confirmDelete.formId
        ? [confirmDelete.formId]
        : []);
    if (!targetIds.length) return;

    await deleteForms(targetIds);

    clearSelectionByIds(targetIds);
    setConfirmDelete({ open: false, formId: null, targetIds: [], multiple: false });
  };

  const goToEditor = (formId) => {
    navigate(`/admin/forms/${formId}/edit`);
  };

  const handleCreateNew = () => {
    navigate("/admin/forms/new");
  };

  const sidebarButtonStyle = {
    ...buttonStyle,
    width: "100%",
    textAlign: "left",
  };

  return (
    <AppLayout
      title="フォーム管理"
      badge="管理"
      fallbackPath="/"
      sidebarActions={
        <>
          <button type="button" style={sidebarButtonStyle} onClick={handleCreateNew}>
            新規作成
          </button>
          <button type="button" style={sidebarButtonStyle} onClick={handleImport}>
            {importing ? "インポート中..." : "インポート"}
          </button>
          <button type="button" style={sidebarButtonStyle} onClick={handleExport} disabled={selected.size === 0}>
            エクスポート
          </button>
          <button
            type="button"
            style={sidebarButtonStyle}
            onClick={handleArchiveSelected}
            disabled={selected.size === 0}
          >
            アーカイブ
          </button>
          <button
            type="button"
            style={{
              ...sidebarButtonStyle,
              borderColor: "#FCA5A5",
              background: "#FEF2F2",
            }}
            onClick={handleDeleteSelected}
            disabled={selected.size === 0}
          >
            削除
          </button>
        </>
      }
    >
      {loadingForms ? (
        <p style={{ color: "#6B7280" }}>読み込み中...</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>
                  <input type="checkbox" checked={adminForms.length > 0 && selected.size === adminForms.length} onChange={(event) => selectAll(event.target.checked)} />
                </th>
                <th style={thStyle}>名称</th>
                <th style={thStyle}>更新日時</th>
                <th style={thStyle}>表示項目</th>
                <th style={thStyle}>状態</th>
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
                    style={{ cursor: isLoadError ? "default" : "pointer", background: isLoadError ? "#FEF2F2" : undefined }}
                    onClick={() => {
                      if (!isLoadError) {
                        goToEditor(form.id);
                      }
                    }}
                  >
                    <td style={tdStyle} onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={selected.has(form.id)} onChange={() => toggleSelect(form.id)} />
                      {isLoadError && <div style={{ color: "#B91C1C", fontSize: 11, marginTop: 4 }}>削除のみ可能</div>}
                    </td>
                    <td style={tdStyle}>
                      {isLoadError ? (
                        <>
                          <div style={{ fontWeight: 600, color: "#B91C1C" }}>{loadError?.fileName || "(名称不明)"}</div>
                          <div style={{ color: "#991B1B", fontSize: 12 }}>フォームID: {form.id}</div>
                          {loadError?.fileId && <div style={{ color: "#991B1B", fontSize: 12 }}>ファイルID: {loadError.fileId}</div>}
                          {loadError?.driveFileUrl && (
                            <div style={{ marginTop: 6 }}>
                              <a
                                href={loadError.driveFileUrl}
                                target="_blank"
                                rel="noreferrer"
                                onClick={(event) => event.stopPropagation()}
                                style={{ color: "#2563EB", textDecoration: "underline", fontSize: 12 }}
                              >
                                Driveで確認
                              </a>
                            </div>
                          )}
                        </>
                      ) : (
                        <>
                          <div style={{ fontWeight: 600 }}>{form.settings?.formTitle || "(無題)"}</div>
                          {form.description && <div style={{ color: "#475569", fontSize: 12 }}>{form.description}</div>}
                        </>
                      )}
                    </td>
                    <td style={tdStyle}>{lastUpdated}</td>
                    <td style={tdStyle}>
                      {isLoadError ? (
                        <>
                          <div style={{ color: "#B91C1C", fontWeight: 600 }}>読み込みエラー</div>
                          <div style={{ color: "#991B1B", fontSize: 12 }}>{loadError?.errorMessage || "読み込みに失敗しました"}</div>
                          {loadError?.errorStage && <div style={{ color: "#991B1B", fontSize: 11, marginTop: 4 }}>ステージ: {loadError.errorStage}</div>}
                        </>
                      ) : summary ? (
                        summary
                      ) : (
                        <span style={labelMuted}>設定なし</span>
                      )}
                    </td>
                    <td style={tdStyle}>
                      {isLoadError ? (
                        <span style={{ color: "#DC2626", fontWeight: 600 }}>読み込みエラー</span>
                      ) : form.archived ? (
                        <span style={{ color: "#DC2626" }}>アーカイブ済み</span>
                      ) : (
                        <span style={{ color: "#16A34A" }}>公開中</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {adminForms.length === 0 && (
                <tr>
                  <td style={{ ...tdStyle, textAlign: "center" }} colSpan={5}>
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
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}
    >
      <div style={{ background: "#fff", borderRadius: 12, padding: 24, width: "min(520px, 90vw)", boxShadow: "0 20px 45px rgba(15,23,42,0.25)" }}>
        <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Google Driveからインポート</h3>
        <p style={{ marginBottom: 16, color: "#475569", fontSize: 14 }}>
          ファイルURLまたはフォルダURLを入力してください。
        </p>

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 600 }}>
            Google Drive URL
          </label>
          <input
            type="text"
            value={url}
            onChange={(event) => {
              onUrlChange(event.target.value);
              if (error) setError("");
            }}
            style={{ width: "100%", border: "1px solid #CBD5E1", borderRadius: 8, padding: "8px 10px", fontSize: 14 }}
            placeholder="https://drive.google.com/file/d/... または https://drive.google.com/drive/folders/..."
          />
          {error && <p style={{ marginTop: 6, color: "#DC2626", fontSize: 12 }}>{error}</p>}
          <p style={{ marginTop: 6, color: "#64748B", fontSize: 11 }}>
            ・ファイルURL: そのフォームのみをインポート<br />
            ・フォルダURL: フォルダ内の全ての.jsonファイルをインポート<br />
            ・既にプロパティサービスに存在するフォームIDは自動的にスキップされます
          </p>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, marginTop: 24 }}>
          <button type="button" style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #CBD5E1", background: "#fff" }} onClick={onCancel}>
            キャンセル
          </button>
          <button
            type="button"
            style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "#2563EB", color: "#fff" }}
            onClick={handleImport}
          >
            インポート
          </button>
        </div>
      </div>
    </div>
  );
}
