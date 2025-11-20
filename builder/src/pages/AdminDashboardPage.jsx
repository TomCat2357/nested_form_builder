import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import AppLayout from "../app/components/AppLayout.jsx";
import ConfirmDialog from "../app/components/ConfirmDialog.jsx";
import AlertDialog from "../app/components/AlertDialog.jsx";
import { useAppData } from "../app/state/AppDataProvider.jsx";
import { dataStore } from "../app/state/dataStore.js";
import { useAlert } from "../app/hooks/useAlert.js";
import { DISPLAY_MODES, DISPLAY_MODE_LABELS } from "../core/displayModes.js";
import { importFormByUrl, getAutoDetectedGasUrl } from "../services/gasClient.js";

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
    .map((item) => {
      if (item.mode === DISPLAY_MODES.COMPACT) {
        return `${item.path}（${DISPLAY_MODE_LABELS[DISPLAY_MODES.COMPACT]}）`;
      }
      return item.path;
    })
    .join(", ");
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

export default function AdminDashboardPage() {
  const { forms, loadingForms, error, archiveForm, unarchiveForm, deleteForm, refreshForms, exportForms } = useAppData();
  const navigate = useNavigate();
  const { alertState, showAlert, closeAlert } = useAlert();
  const [selected, setSelected] = useState(() => new Set());
  const [confirmArchive, setConfirmArchive] = useState({ open: false, formId: null });
  const [confirmDelete, setConfirmDelete] = useState({ open: false, formId: null });
  const [importDialog, setImportDialog] = useState({ open: false, fileUrl: "" });
  const [importing, setImporting] = useState(false);

  const sortedForms = useMemo(() => {
    const list = forms.slice();
    list.sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime());
    return list;
  }, [forms]);

  const toggleSelect = (formId) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(formId)) next.delete(formId);
      else next.add(formId);
      return next;
    });
  };

  const selectAll = (checked) => {
    if (checked) setSelected(new Set(sortedForms.map((form) => form.id)));
    else setSelected(new Set());
  };

  const handleArchiveSelected = () => {
    if (!selected.size) {
      showAlert("アーカイブするフォームを選択してください。");
      return;
    }

    // 選択されたフォームの状態をチェック
    const selectedForms = sortedForms.filter((form) => selected.has(form.id));
    const allArchived = selectedForms.every((form) => form.archived);
    const hasPublished = selectedForms.some((form) => !form.archived);

    const firstId = Array.from(selected)[0];
    setConfirmArchive({
      open: true,
      formId: firstId,
      multiple: selected.size > 1,
      allArchived,
      hasPublished
    });
  };

  const handleDeleteSelected = () => {
    if (!selected.size) {
      showAlert("削除するフォームを選択してください。");
      return;
    }
    const firstId = Array.from(selected)[0];
    setConfirmDelete({ open: true, formId: firstId, multiple: selected.size > 1 });
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
      const filename = `${form.name || form.id}.json`;
      const blob = new Blob([JSON.stringify(form, null, 2)], { type: "application/json" });
      saveAs(blob, filename);
    } else {
      // 複数の場合はZIPファイルとして保存
      const zip = new JSZip();
      targets.forEach((form) => {
        const filename = `${form.name || form.id}.json`;
        zip.file(filename, JSON.stringify(form, null, 2));
      });
      const blob = await zip.generateAsync({ type: "blob" });
      saveAs(blob, `forms_${new Date().toISOString().replace(/[:.-]/g, "")}.zip`);
    }
  };

  const handleImport = () => {
    if (importing) return;
    setImportDialog({ open: true, fileUrl: "" });
  };

  const handleImportSubmit = async () => {
    const { fileUrl } = importDialog;
    if (!fileUrl || !fileUrl.trim()) {
      showAlert("ファイルURLを入力してください");
      return;
    }

    setImporting(true);
    try {
      console.log('[AdminDashboardPage] インポート開始:', { fileUrl: fileUrl.trim() });
      const gasUrl = getAutoDetectedGasUrl();
      console.log('[AdminDashboardPage] GAS URL:', gasUrl);

      const result = await importFormByUrl({ gasUrl, fileUrl: fileUrl.trim() });
      console.log('[AdminDashboardPage] インポート成功:', result);

      await refreshForms();
      showAlert("フォームをインポートしました");
      setImportDialog({ open: false, fileUrl: "" });
    } catch (error) {
      console.error('[AdminDashboardPage] インポートエラー:', error);
      console.error('[AdminDashboardPage] エラー詳細:', {
        name: error?.name,
        message: error?.message,
        stack: error?.stack,
        cause: error?.cause
      });
      showAlert(error?.message || "インポートに失敗しました");
    } finally {
      setImporting(false);
    }
  };

  const confirmArchiveAction = async () => {
    if (!confirmArchive.formId) return;

    // すべてアーカイブ済みの場合は解除処理
    if (confirmArchive.allArchived) {
      if (confirmArchive.multiple) {
        for (const formId of selected) {
          await unarchiveForm(formId);
        }
        setSelected(new Set());
      } else {
        await unarchiveForm(confirmArchive.formId);
      }
    } else {
      // それ以外はアーカイブ処理
      if (confirmArchive.multiple) {
        for (const formId of selected) {
          await archiveForm(formId);
        }
        setSelected(new Set());
      } else {
        await archiveForm(confirmArchive.formId);
      }
    }
    setConfirmArchive({ open: false, formId: null, multiple: false, allArchived: false, hasPublished: false });
  };

  const confirmDeleteAction = async () => {
    if (!confirmDelete.formId) return;
    if (confirmDelete.multiple) {
      // 複数選択時は全件削除
      for (const formId of selected) {
        await deleteForm(formId);
      }
      setSelected(new Set());
    } else {
      // 単一削除
      await deleteForm(confirmDelete.formId);
    }
    setConfirmDelete({ open: false, formId: null, multiple: false });
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
          <button type="button" style={sidebarButtonStyle} onClick={handleImport} disabled={importing}>
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
      {/* エラー表示（GAS URL未設定） */}
      {error && (
        <div
          style={{
            margin: "20px",
            padding: "20px",
            border: "2px solid #dc2626",
            borderRadius: "8px",
            backgroundColor: "#fef2f2",
            color: "#991b1b",
          }}
        >
          <h3 style={{ margin: "0 0 10px 0", fontSize: "16px", fontWeight: "bold" }}>
            ⚠️ エラー
          </h3>
          <p style={{ margin: 0, fontSize: "14px" }}>
            {error}
          </p>
        </div>
      )}

      {loadingForms ? (
        <p style={{ color: "#6B7280" }}>読み込み中...</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>
                  <input type="checkbox" checked={selected.size === sortedForms.length && sortedForms.length > 0} onChange={(event) => selectAll(event.target.checked)} />
                </th>
                <th style={thStyle}>名称</th>
                <th style={thStyle}>更新日時</th>
                <th style={thStyle}>表示項目</th>
                <th style={thStyle}>状態</th>
                <th style={thStyle}>ファイルURL</th>
              </tr>
            </thead>
            <tbody>
              {sortedForms.map((form) => {
                const summary = formatDisplayFieldsSummary(form);
                return (
                  <tr
                    key={form.id}
                    style={{ cursor: "pointer" }}
                    onClick={() => goToEditor(form.id)}
                  >
                    <td style={tdStyle} onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={selected.has(form.id)} onChange={() => toggleSelect(form.id)} />
                    </td>
                    <td style={tdStyle}>
                      <div style={{ fontWeight: 600 }}>{form.name}</div>
                      {form.description && <div style={{ color: "#475569", fontSize: 12 }}>{form.description}</div>}
                    </td>
                    <td style={tdStyle}>{new Date(form.modifiedAt).toLocaleString()}</td>
                    <td style={tdStyle}>
                      {summary ? summary : <span style={labelMuted}>設定なし</span>}
                    </td>
                    <td style={tdStyle}>{form.archived ? <span style={{ color: "#DC2626" }}>アーカイブ済み</span> : <span style={{ color: "#16A34A" }}>公開中</span>}</td>
                    <td
                      style={{ ...tdStyle, color: "#2563EB", cursor: "pointer", maxWidth: "200px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (form.fileUrl) {
                          navigator.clipboard.writeText(form.fileUrl);
                          showAlert("URLをコピーしました");
                        }
                      }}
                      title={form.fileUrl || "URLなし"}
                    >
                      {form.fileUrl ? "クリックでコピー" : <span style={labelMuted}>-</span>}
                    </td>
                  </tr>
                );
              })}
              {sortedForms.length === 0 && (
                <tr>
                  <td style={{ ...tdStyle, textAlign: "center" }} colSpan={6}>
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
            onSelect: () => setConfirmArchive({ open: false, formId: null }),
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
        message="アーカイブ済みフォームを完全に削除します。元に戻すことはできません。よろしいですか？"
        options={[
          {
            label: "キャンセル",
            value: "cancel",
            onSelect: () => setConfirmDelete({ open: false, formId: null }),
          },
          {
            label: "削除",
            value: "delete",
            variant: "danger",
            onSelect: confirmDeleteAction,
          },
        ]}
      />

      {/* Import Dialog */}
      {importDialog.open && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}
        >
          <div style={{ background: "#fff", borderRadius: 12, padding: 24, width: "min(520px, 90vw)", boxShadow: "0 20px 45px rgba(15,23,42,0.25)" }}>
            <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>フォームをインポート</h3>
            <p style={{ marginBottom: 16, color: "#475569", fontSize: 14 }}>
              Google DriveのフォームファイルURLを入力してください。
            </p>
            <input
              type="text"
              value={importDialog.fileUrl}
              onChange={(e) => setImportDialog({ ...importDialog, fileUrl: e.target.value })}
              placeholder="https://drive.google.com/file/d/..."
              style={{
                width: "100%",
                border: "1px solid #CBD5E1",
                borderRadius: 8,
                padding: "10px 12px",
                fontSize: 14,
                marginBottom: 16,
              }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 12 }}>
              <button
                type="button"
                style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #CBD5E1", background: "#fff" }}
                onClick={() => setImportDialog({ open: false, fileUrl: "" })}
              >
                キャンセル
              </button>
              <button
                type="button"
                style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "#2563EB", color: "#fff" }}
                onClick={handleImportSubmit}
                disabled={importing}
              >
                {importing ? "インポート中..." : "インポート"}
              </button>
            </div>
          </div>
        </div>
      )}

      <AlertDialog open={alertState.open} title={alertState.title} message={alertState.message} onClose={closeAlert} />
    </AppLayout>
  );
}
