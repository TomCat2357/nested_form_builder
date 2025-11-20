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
  const { forms, loadingForms, archiveForm, unarchiveForm, deleteForm, refreshForms, exportForms } = useAppData();
  const navigate = useNavigate();
  const { alertState, showAlert, closeAlert } = useAlert();
  const [selected, setSelected] = useState(() => new Set());
  const [confirmArchive, setConfirmArchive] = useState({ open: false, formId: null });
  const [confirmDelete, setConfirmDelete] = useState({ open: false, formId: null });
  const conflictResolverRef = useRef(null);
  const [conflictDialog, setConflictDialog] = useState(null);
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

  const handleImport = async () => {
    if (importing) return;
    const promptText = [
      "DriveのファイルURLまたはフォルダURLを入力してください。",
      "ファイルの場合はその1件だけ、フォルダの場合はフォルダ内の.jsonを読み込みます。",
      "空欄またはキャンセルで中止します。",
    ].join("\n");
    const targetUrl = window.prompt(promptText, "");
    if (targetUrl === null) return;
    const trimmed = (targetUrl || "").trim();
    if (!trimmed) return;

    setImporting(true);
    try {
      const formsFromDrive = await dataStore.importFormsFromDrive(trimmed);
      await startImportWorkflow(formsFromDrive);
    } catch (error) {
      console.error(error);
      showAlert(error?.message || "Driveからのインポートに失敗しました");
    } finally {
      setImporting(false);
    }
  };

  const generateUniqueName = useCallback((baseName, existingNames) => {
    const trimmed = (baseName || "").trim();
    if (!trimmed) return "";
    if (!existingNames.has(trimmed)) return trimmed;
    const base = trimmed.replace(/\s\(\d+\)$/u, "");
    let counter = 2;
    let candidate = `${base} (${counter})`;
    while (existingNames.has(candidate)) {
      counter += 1;
      candidate = `${base} (${counter})`;
    }
    return candidate;
  }, []);

  const openConflictDialog = useCallback((payload) => {
    setConflictDialog(payload);
    return new Promise((resolve) => {
      conflictResolverRef.current = resolve;
    });
  }, []);

  const closeConflictDialog = useCallback((result) => {
    const resolver = conflictResolverRef.current;
    conflictResolverRef.current = null;
    setConflictDialog(null);
    if (resolver) resolver(result);
  }, []);

  const sanitizeImportedForm = (raw) => {
    if (!raw || typeof raw !== "object") return null;
    const schema = Array.isArray(raw.schema) ? raw.schema : [];
    return {
      name: typeof raw.name === "string" ? raw.name : "",
      description: typeof raw.description === "string" ? raw.description : "",
      schema,
      settings: raw && typeof raw.settings === "object" && !Array.isArray(raw.settings) ? raw.settings : {},
      archived: !!raw.archived,
      schemaVersion: Number.isFinite(raw.schemaVersion) ? raw.schemaVersion : 1,
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
    async (parsedContents) => {
      const queue = flattenImportedContents(parsedContents);
      if (!queue.length) {
        showAlert("有効なフォームがありませんでした。");
        return;
      }

      let applyChoice = null;
      let overwritten = 0;
      let normalSaved = 0; // 通常保存（同名が存在しない場合）
      let savedAs = 0; // 別名保存（同名が存在して別名で保存した場合）
      let aborted = false;

      const existingMap = new Map();
      const existingNames = new Set();
      forms.forEach((form) => {
        existingMap.set(form.name, form);
        existingNames.add(form.name);
      });

      const ensureUnique = (name) => generateUniqueName(name, existingNames);

      try {
        for (let index = 0; index < queue.length; index += 1) {
          const item = queue[index];
          const baseName = (item.name || "").trim();
          if (!baseName) {
            continue;
          }

          const conflict = existingNames.has(baseName);
          let action = conflict ? "overwrite" : "saveas";
          let renameMode = conflict ? "auto" : "custom";
          let targetName = baseName;

          if (conflict) {
            let choice = applyChoice;
            if (!choice) {
              const suggestedName = ensureUnique(baseName);
              choice = await openConflictDialog({
                name: baseName,
                index: index + 1,
                total: queue.length,
                suggestedName,
              });

              if (!choice) {
                aborted = true;
                break;
              }

              if (choice.action === "abort") {
                // チェックボックスがONの場合は全件中止、OFFの場合はこのファイルだけスキップ
                if (choice.applyToRest) {
                  aborted = true;
                  break;
                } else {
                  // このファイルだけスキップして次へ
                  continue;
                }
              }

              if (choice.applyToRest) {
                applyChoice = choice;
              }
            }

            action = choice.action;
            renameMode = choice.renameMode || "auto";

            if (action === "abort") {
              // applyToRestがtrueの場合は全件中止済み、falseの場合はこのファイルだけスキップ
              continue;
            }

            if (action === "saveas") {
              if (renameMode === "auto") {
                targetName = ensureUnique(baseName);
              } else {
                targetName = ensureUnique(choice.newName || baseName);
              }
            }
          } else {
            targetName = ensureUnique(baseName);
          }

          if (aborted) break;

          const payload = {
            name: targetName,
            description: item.description,
            schema: item.schema,
            settings: item.settings,
            archived: item.archived,
            schemaVersion: item.schemaVersion,
          };

          if (conflict && action === "overwrite") {
            const existing = existingMap.get(baseName);
            if (existing) {
              await dataStore.updateForm(existing.id, {
                ...payload,
                name: existing.name,
                archived: existing.archived,
              });
              overwritten += 1;
            }
          } else if (action === "saveas") {
            const createdForm = await dataStore.createForm({ ...payload, name: targetName, archived: false });
            if (createdForm?.name) {
              existingMap.set(createdForm.name, createdForm);
              existingNames.add(createdForm.name);
            } else {
              existingNames.add(targetName);
            }
            // 同名が存在しない場合は通常保存、存在する場合は別名保存
            if (conflict) {
              savedAs += 1;
            } else {
              normalSaved += 1;
            }
          } else if (action === "overwrite") {
            // conflict resolution might have set overwrite without existing (should not happen)
            const existing = existingMap.get(baseName);
            if (existing) {
              await dataStore.updateForm(existing.id, {
                ...payload,
                name: existing.name,
                archived: existing.archived,
              });
              overwritten += 1;
            }
          }

          if (!conflict || action === "saveas") {
            existingNames.add(targetName);
          }
        }

        await refreshForms();
        setSelected(new Set());

        if (aborted) {
          showAlert(`アップロードを中止しました（上書き ${overwritten} 件、通常保存 ${normalSaved} 件、別名保存 ${savedAs} 件）。`);
        } else {
          showAlert(`アップロードが完了しました（上書き ${overwritten} 件、通常保存 ${normalSaved} 件、別名保存 ${savedAs} 件）。`);
        }
      } catch (error) {
        console.error(error);
        showAlert(error?.message || "スキーマの取り込み中にエラーが発生しました");
      }
    },
    [forms, generateUniqueName, refreshForms],
  );

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
                  <input type="checkbox" checked={selected.size === sortedForms.length && sortedForms.length > 0} onChange={(event) => selectAll(event.target.checked)} />
                </th>
                <th style={thStyle}>名称</th>
                <th style={thStyle}>更新日時</th>
                <th style={thStyle}>表示項目</th>
                <th style={thStyle}>状態</th>
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
                  </tr>
                );
              })}
              {sortedForms.length === 0 && (
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

      {conflictDialog && (
        <ImportConflictDialog
          {...conflictDialog}
          onSubmit={(result) => closeConflictDialog(result)}
          onCancel={() => closeConflictDialog(null)}
        />
      )}

      <AlertDialog open={alertState.open} title={alertState.title} message={alertState.message} onClose={closeAlert} />
    </AppLayout>
  );
}

function ImportConflictDialog({ name, index, total, suggestedName, onSubmit, onCancel }) {
  const [action, setAction] = useState("overwrite");
  const [newName, setNewName] = useState(suggestedName);
  const [applyToRest, setApplyToRest] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setAction("overwrite");
    setNewName(suggestedName);
    setApplyToRest(false);
    setError("");
  }, [name, index, total, suggestedName]);

  const handleConfirm = () => {
    if (action === "saveas") {
      const trimmed = (newName || "").trim();
      if (!trimmed) {
        setError("別名を入力してください");
        return;
      }
      const renameMode = trimmed === suggestedName ? "auto" : "custom";
      onSubmit({ action, newName: trimmed, applyToRest, renameMode });
      return;
    }
    onSubmit({ action, applyToRest });
  };

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}
    >
      <div style={{ background: "#fff", borderRadius: 12, padding: 24, width: "min(520px, 90vw)", boxShadow: "0 20px 45px rgba(15,23,42,0.25)" }}>
        <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>フォーム名が重複しています</h3>
        <p style={{ marginBottom: 16, color: "#475569" }}>
          「{name}」は既に存在します（{index}/{total}）。処理を選択してください。
        </p>

        <div style={{ display: "grid", gap: 12 }}>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="radio" name="import-conflict-action" value="overwrite" checked={action === "overwrite"} onChange={() => setAction("overwrite")} />
            <span>上書き</span>
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="radio" name="import-conflict-action" value="saveas" checked={action === "saveas"} onChange={() => setAction("saveas")} />
            <span>別名保存</span>
          </label>
          {action === "saveas" && (
            <div style={{ marginLeft: 24 }}>
              <input
                type="text"
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                style={{ width: "100%", border: "1px solid #CBD5E1", borderRadius: 8, padding: "8px 10px" }}
                placeholder={`${name} (2)`}
              />
              {error && <p style={{ marginTop: 6, color: "#DC2626", fontSize: 12 }}>{error}</p>}
              <p style={{ marginTop: 6, color: "#64748B", fontSize: 12 }}>既存の名称と重複する場合は自動的に番号が付与されます。</p>
            </div>
          )}
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="radio" name="import-conflict-action" value="abort" checked={action === "abort"} onChange={() => setAction("abort")} />
            <span>アップロード中止</span>
          </label>
        </div>

        <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 16 }}>
          <input type="checkbox" checked={applyToRest} onChange={(event) => setApplyToRest(event.target.checked)} />
          <span>この選択を残り全件に適用する</span>
        </label>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, marginTop: 24 }}>
          <button type="button" style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #CBD5E1", background: "#fff" }} onClick={onCancel}>
            キャンセル
          </button>
          <button
            type="button"
            style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "#2563EB", color: "#fff" }}
            onClick={handleConfirm}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
