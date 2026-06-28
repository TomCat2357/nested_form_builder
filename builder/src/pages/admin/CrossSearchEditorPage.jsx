import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import AppLayout from "../../app/components/AppLayout.jsx";
import ConfirmDialog from "../../app/components/ConfirmDialog.jsx";
import SearchableSelect from "../../app/components/SearchableSelect.jsx";
import { formsToOptions } from "../../app/components/searchableSelectOptions.js";
import { useConfirmDialog } from "../../app/hooks/useConfirmDialog.js";
import { useBeforeUnloadGuard } from "../../app/hooks/useBeforeUnloadGuard.js";
import { useDirtyTracking } from "../../app/hooks/useDirtyTracking.js";
import { useTempIdRedirect } from "../../app/hooks/useTempIdRedirect.js";
import { useAuth } from "../../app/state/authContext.jsx";
import { useAppData } from "../../app/state/AppDataProvider.jsx";
import { normalizeFolderPath } from "../../utils/folderTree.js";
import { getCrossSearchById, saveCrossSearch } from "../../features/analytics/crossFormSearchStore.js";
import { buildColumnPickerTable } from "../../features/analytics/crossSearch/buildColumnPickerTable.js";
import CrossSearchColumnPicker from "../../features/analytics/crossSearch/CrossSearchColumnPicker.jsx";

const buildEditPath = (id) => `/admin/cross-searches/${id}/edit`;
const emptyCfs = { name: "", description: "", folder: "", formIds: [], columns: [] };

export default function CrossSearchEditorPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { crossSearchId } = useParams();
  useTempIdRedirect(crossSearchId, buildEditPath);
  const { isAdmin } = useAuth();
  const { forms } = useAppData();
  const isEdit = Boolean(crossSearchId);

  const initialFolder = isEdit ? "" : normalizeFolderPath(location.state?.folder || "");
  const [cfs, setCfs] = useState({ ...emptyCfs, folder: initialFolder });
  const [loading, setLoading] = useState(isEdit);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  // 「列名呼び出し」を押した（= 列ピッカーを表示する）か。編集時はロード後に自動表示する。
  const [revealed, setRevealed] = useState(false);
  const unsavedDialog = useConfirmDialog();

  useEffect(() => {
    if (!isAdmin) navigate("/", { replace: true });
  }, [isAdmin, navigate]);

  // 既存定義のロード。
  useEffect(() => {
    let cancelled = false;
    if (!isEdit) return undefined;
    setLoading(true);
    getCrossSearchById(crossSearchId)
      .then((loaded) => {
        if (cancelled) return;
        if (loaded) {
          setCfs({
            ...emptyCfs,
            ...loaded,
            formIds: Array.isArray(loaded.formIds) ? loaded.formIds : [],
            columns: Array.isArray(loaded.columns) ? loaded.columns : [],
          });
          setRevealed(true);
        } else {
          setError("串刺し検索が見つかりませんでした。");
        }
      })
      .catch((err) => { if (!cancelled) setError(err.message || String(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [crossSearchId, isEdit]);

  const formsById = useMemo(() => {
    const m = new Map();
    for (const f of forms) m.set(f.id, f);
    return m;
  }, [forms]);

  // 選択フォームを buildColumnPickerTable 入力形 [{ formId, formName, schema }] に整える。
  const selectedForms = useMemo(
    () => cfs.formIds
      .map((id) => formsById.get(id))
      .filter(Boolean)
      .map((f) => ({ formId: f.id, formName: f.settings?.formTitle || f.id, schema: f.schema || [] })),
    [cfs.formIds, formsById],
  );

  // 列ピッカー表（revealed のときだけ構築。フォーム変更で自動再構築される）。
  const pickerTable = useMemo(
    () => (revealed ? buildColumnPickerTable(selectedForms) : null),
    [revealed, selectedForms],
  );

  const selectedPaths = useMemo(
    () => new Set((cfs.columns || []).map((c) => c.path)),
    [cfs.columns],
  );

  // ----- フォーム選択 -----
  const handleAddForm = (formId) => {
    if (!formId) return;
    setCfs((c) => (c.formIds.includes(formId) ? c : { ...c, formIds: [...c.formIds, formId] }));
  };
  const handleRemoveForm = (formId) => {
    setCfs((c) => ({ ...c, formIds: c.formIds.filter((id) => id !== formId) }));
  };

  // ----- 列選択 -----
  const handleToggleColumn = (path, checked) => {
    setCfs((c) => {
      if (checked) {
        if (c.columns.some((col) => col.path === path)) return c;
        const row = pickerTable?.rows.find((r) => r.path === path);
        const col = { path, label: row?.label || path, type: row?.type || "" };
        return { ...c, columns: [...c.columns, col] };
      }
      return { ...c, columns: c.columns.filter((col) => col.path !== path) };
    });
  };
  const handleToggleAllColumns = (checked) => {
    setCfs((c) => {
      if (!checked) return { ...c, columns: [] };
      const rows = pickerTable?.rows || [];
      return { ...c, columns: rows.map((r) => ({ path: r.path, label: r.label, type: r.type })) };
    });
  };

  // ----- Dirty tracking -----
  const snapshot = useMemo(() => JSON.stringify(cfs), [cfs]);
  const baselineReady = !isEdit || !loading;
  const isDirty = useDirtyTracking(snapshot, baselineReady);
  useBeforeUnloadGuard(isDirty);

  const goBack = useCallback(
    () => navigate(location.state?.from || "/admin/cross-searches"),
    [navigate, location.state],
  );
  const handleBack = () => {
    if (isDirty) { unsavedDialog.open(); return false; }
  };

  const handleSave = async () => {
    const name = (cfs.name || "").trim();
    if (!name) { setError("串刺し検索の名前を入力してください。"); return; }
    if (cfs.formIds.length === 0) { setError("対象フォームを 1 つ以上選んでください。"); return; }
    if (cfs.columns.length === 0) { setError("表示する列を 1 つ以上選んでください。"); return; }
    // フォーム変更で表示対象でなくなった列を除外して保存する。
    const table = buildColumnPickerTable(selectedForms);
    const validPaths = new Set(table.rows.map((r) => r.path));
    const columns = cfs.columns.filter((col) => validPaths.has(col.path));

    setSaving(true);
    setError(null);
    try {
      await saveCrossSearch({
        ...(isEdit ? { id: crossSearchId } : {}),
        ...cfs,
        name,
        formIds: [...cfs.formIds],
        columns,
      });
      navigate(location.state?.from || "/admin/cross-searches");
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setSaving(false);
    }
  };

  const confirmOptions = [
    { label: "保存して続行", value: "save", variant: "primary", onSelect: async () => { unsavedDialog.close(); await handleSave(); } },
    { label: "保存せずに戻る", value: "discard", onSelect: () => { unsavedDialog.close(); goBack(); } },
    { label: "キャンセル", value: "cancel", onSelect: unsavedDialog.close },
  ];

  if (!isAdmin) return null;

  return (
    <AppLayout
      title={isEdit ? "串刺し検索 編集" : "串刺し検索 作成"}
      fallbackPath={location.state?.from || "/admin/cross-searches"}
      onBack={handleBack}
      sidebarActions={
        <button type="button" onClick={handleSave} disabled={saving} className="nf-btn-outline nf-btn-sidebar">
          {saving ? "保存中..." : "保存"}
        </button>
      }
    >
      {loading && <p className="nf-text-subtle">読み込み中...</p>}
      {error && <p className="nf-text-warning">{error}</p>}

      {!loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <div>
              <label className="nf-label">串刺し検索の名前</label>
              <input
                className="nf-input"
                type="text"
                value={cfs.name || ""}
                onChange={(e) => setCfs((c) => ({ ...c, name: e.target.value }))}
                placeholder="例: 申込・問合せ横断"
                style={{ width: 300 }}
              />
            </div>
            <div style={{ flex: 1, minWidth: 240 }}>
              <label className="nf-label">説明（任意）</label>
              <input
                className="nf-input"
                type="text"
                value={cfs.description || ""}
                onChange={(e) => setCfs((c) => ({ ...c, description: e.target.value }))}
                style={{ width: "100%", maxWidth: 500 }}
              />
            </div>
            <div>
              <label className="nf-label">フォルダ（任意）</label>
              <input
                className="nf-input"
                type="text"
                value={cfs.folder || ""}
                onChange={(e) => setCfs((c) => ({ ...c, folder: e.target.value }))}
                placeholder="例: 営業/横断  （空欄=フォルダなし）"
                style={{ width: 300 }}
              />
            </div>
          </div>

          {/* 対象フォーム選択 */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <label className="nf-label" style={{ marginBottom: 0 }}>対象フォーム（複数選択）</label>
              <SearchableSelect
                value=""
                onChange={(v) => handleAddForm(v)}
                placeholder="+ フォームを検索して追加"
                options={formsToOptions(forms.filter((f) => !cfs.formIds.includes(f.id)))}
                selectStyle={{ fontSize: 12 }}
              />
            </div>
            {cfs.formIds.length === 0 ? (
              <p className="nf-text-subtle" style={{ fontSize: 12 }}>対象フォームが未選択です。検索ボックスから追加してください。</p>
            ) : (
              <div className="nf-row nf-gap-6 nf-wrap">
                {cfs.formIds.map((id) => {
                  const f = formsById.get(id);
                  const name = f?.settings?.formTitle || id;
                  return (
                    <span key={id} className="cfs-form-chip">
                      {name}
                      <button type="button" className="cfs-form-chip-x" onClick={() => handleRemoveForm(id)} title="外す">×</button>
                    </span>
                  );
                })}
              </div>
            )}
          </div>

          {/* 列名呼び出し */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <label className="nf-label" style={{ marginBottom: 0 }}>表示する列</label>
              <button
                type="button"
                className="nf-btn-outline"
                style={{ fontSize: 12 }}
                onClick={() => setRevealed(true)}
                disabled={cfs.formIds.length === 0}
                title="選択フォームの表示列を呼び出す"
              >
                列名呼び出し
              </button>
            </div>
            <p className="nf-text-subtle" style={{ fontSize: 12, marginTop: 0 }}>
              各フォームで「表示」にした列を横断統合して一覧します。同じ列名は 1 行にまとめ、
              列はあるが表示対象でないフォームはグレーで示します。チェックした列が串刺し検索の結果に出ます。
            </p>
            {revealed && (
              <CrossSearchColumnPicker
                table={pickerTable}
                selectedPaths={selectedPaths}
                onToggle={handleToggleColumn}
                onToggleAll={handleToggleAllColumns}
              />
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={unsavedDialog.state.open}
        title="未保存の変更があります"
        message="保存せずに離れますか？"
        options={confirmOptions}
      />
    </AppLayout>
  );
}
