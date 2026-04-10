import React, { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import JSZip from "jszip";
import AppLayout from "../app/components/AppLayout.jsx";
import ConfirmDialog from "../app/components/ConfirmDialog.jsx";
import { useAppData } from "../app/state/AppDataProvider.jsx";
import { useFormCacheSync } from "../app/hooks/useFormCacheSync.js";
import { useSetSelection } from "../app/hooks/useSetSelection.js";
import { dataStore } from "../app/state/dataStore.js";
import { useAlert } from "../app/hooks/useAlert.js";
import { DEFAULT_THEME, applyThemeWithFallback } from "../app/theme/theme.js";
import { useBuilderSettings } from "../features/settings/settingsStore.js";
import { importFormsFromDrive, hasScriptRun } from "../services/gasClient.js";
import { toUnixMs, formatUnixMsDateTimeMs } from "../utils/dateTime.js";
import { buildSharedFormUrl } from "../utils/formShareUrl.js";
import ImportUrlDialog from "./AdminImportUrlDialog.jsx";

const formatDisplayFieldsSummary = (form) => {
  if (!form) return "";
  const settings = Array.isArray(form.displayFieldSettings) && form.displayFieldSettings.length
    ? form.displayFieldSettings
    : (Array.isArray(form.importantFields) ? form.importantFields.map((path) => ({ path })) : []);
  if (!settings.length) return "";
  return settings
    .filter((item) => item?.path)
    .map((item) => item.path)
    .join(", ");
};

const toComparableUnixMs = (value) => {
  const ms = Number.isFinite(value) ? value : toUnixMs(value);
  return Number.isFinite(ms) ? ms : 0;
};

const formatUnixMsValue = (value) => {
  const ms = toComparableUnixMs(value);
  return ms > 0 ? formatUnixMsDateTimeMs(ms) : "---";
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
  const { forms, loadFailures, loadingForms, lastSyncedAt, archiveForm, unarchiveForm, archiveForms, unarchiveForms, deleteForms, refreshForms, exportForms, copyForm, registerImportedForm } = useAppData();
  const { settings } = useBuilderSettings();
  const navigate = useNavigate();
  const { showAlert, showOutputAlert } = useAlert();
const { selected, toggle: toggleSelect, selectAll: selectAllRaw, clear: clearSelection, clearByIds: clearSelectionByIds } = useSetSelection();
  const [confirmArchive, setConfirmArchive] = useState({ open: false, formId: null, targetIds: [], multiple: false, allArchived: false, hasPublished: false });
  const [confirmDelete, setConfirmDelete] = useState({ open: false, formId: null, targetIds: [], multiple: false });
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importUrl, setImportUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [copiedId, setCopiedId] = useState(null);
  const [confirmCopy, setConfirmCopy] = useState({ open: false, formId: null });
  const [copying, setCopying] = useState(false);

  
  const sortedForms = useMemo(() => {
    const list = forms.slice();
    list.sort(
      (a, b) => toComparableUnixMs(b.modifiedAtUnixMs ?? b.modifiedAt) -
        toComparableUnixMs(a.modifiedAtUnixMs ?? a.modifiedAt)
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
      modifiedAtUnixMs: toUnixMs(item.lastTriedAt),
      loadError: item,
    }));
    rows.sort(
      (a, b) => toComparableUnixMs(b.modifiedAtUnixMs ?? b.modifiedAt) -
        toComparableUnixMs(a.modifiedAtUnixMs ?? a.modifiedAt)
    );
    return rows;
  }, [loadFailures]);

  const adminForms = useMemo(() => [...sortedForms, ...loadFailureRows], [sortedForms, loadFailureRows]);

  const selectAll = (checked) => {
    if (checked) selectAllRaw(adminForms.map((form) => form.id));
    else clearSelection();
  };

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
    setExporting(true);
    try {
      const targets = await exportForms(Array.from(selected));
      if (!targets.length) {
        showAlert("エクスポート可能なデータがありません");
        return;
      }

      let blob, filename, mimeType;

      if (targets.length === 1) {
        const form = targets[0];
        const safeTitle = (form.settings?.formTitle || "form").replace(/[\\/:*?"<>|\r\n]/g, "_").replace(/^\.+/, "");
        filename = `${safeTitle}.json`;
        mimeType = "application/json";
        blob = new Blob([JSON.stringify(form, null, 2)], { type: mimeType });
      } else {
        const zip = new JSZip();
        targets.forEach((form) => {
          const safeTitle = (form.settings?.formTitle || "form").replace(/[\\/:*?"<>|\r\n]/g, "_").replace(/^\.+/, "");
          zip.file(`${safeTitle}.json`, JSON.stringify(form, null, 2));
        });
        blob = await zip.generateAsync({ type: "blob" });
        filename = `forms_${new Date().toISOString().replace(/[:.-]/g, "")}.zip`;
        mimeType = "application/zip";
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      showAlert("エクスポートファイルをダウンロードしました。");
    } catch (err) {
      showAlert(`エクスポートに失敗しました: ${err.message || "不明なエラー"}`);
    } finally {
      setExporting(false);
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
    const createdAtUnixMs = toUnixMs(raw.createdAtUnixMs ?? raw.createdAt);
    const modifiedAtUnixMs = toUnixMs(raw.modifiedAtUnixMs ?? raw.modifiedAt);

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
      createdAt: Number.isFinite(createdAtUnixMs) ? createdAtUnixMs : raw.createdAt, // 作成日時を保持
      modifiedAt: Number.isFinite(modifiedAtUnixMs) ? modifiedAtUnixMs : raw.modifiedAt, // 更新日時を保持
      createdAtUnixMs: Number.isFinite(createdAtUnixMs) ? createdAtUnixMs : null,
      modifiedAtUnixMs: Number.isFinite(modifiedAtUnixMs) ? modifiedAtUnixMs : null,
    };
  };

  const flattenImportedContents = (contents) => {
    const list = [];
    let invalidPayloadCount = 0;
    (Array.isArray(contents) ? contents : []).forEach((item) => {
      // GASから返ってくる新形式: { form, fileId, fileUrl }
      if (item && item.form && item.fileId) {
        const sanitized = sanitizeImportedForm(item.form);
        if (sanitized) {
          list.push({ form: sanitized, fileId: item.fileId, fileUrl: item.fileUrl || null });
        } else {
          invalidPayloadCount += 1;
        }
      } else {
        invalidPayloadCount += 1;
      }
    });
    return { list, invalidPayloadCount };
  };

  const startImportWorkflow = useCallback(
    async (parsedContents, { skipped = 0, parseFailed = 0 } = {}) => {
      const { list: queue, invalidPayloadCount } = flattenImportedContents(parsedContents);
      const detail = buildImportDetail(skipped, parseFailed, { useRegisteredLabel: true });
      if (!queue.length) {
        showAlert(`取り込めるフォームはありませんでした${detail}。`);
        return;
      }

      setImporting(true);
      let imported = 0;
      let saveFailed = invalidPayloadCount;

      try {
        for (const item of queue) {
          try {
            // fileIdがある場合はコピーなしで登録（元ファイルをそのまま管理）
            await registerImportedForm({
              form: item.form,
              fileId: item.fileId,
              fileUrl: item.fileUrl,
            });
            imported += 1;
          } catch (error) {
            saveFailed += 1;
            console.warn("[DriveImport] failed to import one form", {
              formId: item?.form?.id,
              title: item?.form?.settings?.formTitle,
              error: error?.message || error,
            });
          }
        }

        clearSelection();
        const saveFailedDetail = saveFailed > 0 ? `（保存失敗 ${saveFailed} 件）` : "";

        // 結果メッセージ
        if (imported > 0) {
          showAlert(`${imported} 件のフォームを取り込みました${detail}${saveFailedDetail}。`);
        } else {
          showAlert(`取り込めるフォームはありませんでした${detail}${saveFailedDetail}。`);
        }
        console.log(
          `[DriveImport] success=${imported}, alreadyRegistered=${skipped}, parseFailed=${parseFailed}, saveFailed=${saveFailed}`,
        );
      } catch (error) {
        console.error("[DriveImport] import workflow failed", error);
        showAlert(error?.message || "スキーマの取り込み中にエラーが発生しました");
      } finally {
        setImporting(false);
      }
    },
    [registerImportedForm, showAlert],
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
    const fullUrl = buildSharedFormUrl(baseUrl, formId);
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

  const handleCopySelected = () => {
    if (copying) return;
    if (!hasScriptRun()) {
      showAlert("コピー機能はGoogle Apps Script環境でのみ利用可能です");
      return;
    }
    const selectedForm = sortedForms.find((f) => selected.has(f.id));
    if (!selectedForm || selectedForm.loadError) {
      showAlert("コピー可能なフォームを1件選択してください。");
      return;
    }
    setConfirmCopy({ open: true, formId: selectedForm.id });
  };

  const confirmCopyAction = async () => {
    const formId = confirmCopy.formId;
    setConfirmCopy({ open: false, formId: null });
    if (!formId) return;

    setCopying(true);
    try {
      await copyForm(formId);
      clearSelection();
      showAlert("フォームをコピーしました。スプレッドシートの設定を確認してください。");
    } catch (error) {
      showAlert("フォームのコピーに失敗しました: " + (error.message || "不明なエラー"));
    } finally {
      setCopying(false);
    }
  };

  useFormCacheSync({
    enabled: true,
    formsCount: forms.length + (loadFailures || []).length,
    lastSyncedAt,
    loadingForms,
    refreshForms,
    label: "admin-dashboard",
  });

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
          <button type="button" className="nf-btn-outline nf-btn-sidebar nf-text-13" onClick={handleExport} disabled={exporting || selected.size === 0}>
            {exporting ? "エクスポート中..." : "エクスポート"}
          </button>
          <button
            type="button"
            className="nf-btn-outline nf-btn-sidebar nf-text-13"
            onClick={handleCopySelected}
            disabled={copying || selected.size !== 1}
          >
            {copying ? "コピー中..." : "コピー"}
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
            onClick={() => refreshForms({ reason: "manual:admin-dashboard", background: false })}
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
                const lastUpdated = isLoadError
                  ? formatUnixMsValue(loadError?.lastTriedAt)
                  : formatUnixMsValue(form.modifiedAtUnixMs ?? form.modifiedAt);
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
                        <button
                          type="button"
                          className="admin-form-id admin-form-id-btn"
                          onClick={(e) => handleCopyId(form.id, e)}
                          title="クリックでURLをコピー"
                        >
                          {form.id}
                        </button>
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
            ? "選択したフォームのリンクを管理一覧から外します。フォームファイル自体は削除されません。よろしいですか？"
            : "このフォームのリンクを管理一覧から外します。フォームファイル自体は削除されません。よろしいですか？"
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

      <ConfirmDialog
        open={confirmCopy.open}
        title="フォームをコピー"
        message={
          "コピーしたフォームは、コピー元と同じスプレッドシートにデータが保存されます。" +
          "そのままではデータが混在するため、コピー後にフォーム設定画面から新しいスプレッドシートのURLに変更してください。"
        }
        options={[
          {
            label: "キャンセル",
            value: "cancel",
            onSelect: () => setConfirmCopy({ open: false, formId: null }),
          },
          {
            label: "コピー",
            value: "copy",
            variant: "primary",
            onSelect: confirmCopyAction,
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

</AppLayout>
  );
}
