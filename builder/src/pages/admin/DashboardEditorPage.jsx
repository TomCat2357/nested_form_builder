import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import AppLayout from "../../app/components/AppLayout.jsx";
import ConfirmDialog from "../../app/components/ConfirmDialog.jsx";
import { useConfirmDialog } from "../../app/hooks/useConfirmDialog.js";
import { useBeforeUnloadGuard } from "../../app/hooks/useBeforeUnloadGuard.js";
import { useCancellable } from "../../app/hooks/useCancellable.js";
import { useAuth } from "../../app/state/authContext.jsx";
import { useAppData } from "../../app/state/AppDataProvider.jsx";
import { listQuestions, saveDashboard } from "../../features/analytics/analyticsStore.js";
import { analyticsGasClient } from "../../features/analytics/analyticsGasClient.js";
import { genDashboardId, genCardId, genFilterId } from "../../core/ids.js";
import {
  createEmptyV2,
  isV2,
  computeDefaultCardPosition,
  defaultFilterValue,
  defaultSimpleFilterValue,
  createMessageCardDefaults,
  FILTER_TYPES,
  MAX_SIMPLE_FILTERS,
} from "../../features/analytics/utils/dashboardSchema.js";
import { getFormColumns, getFormViewColumns } from "../../features/analytics/analyticsSchemaColumns.js";
import DashboardGrid from "../../features/analytics/components/DashboardGrid.jsx";
import DashboardFilterBar from "../../features/analytics/components/DashboardFilterBar.jsx";
import SimpleFilterBar from "../../features/analytics/components/SimpleFilterBar.jsx";
import DashboardCardFilterMappingDialog from "../../features/analytics/components/DashboardCardFilterMappingDialog.jsx";
import { buildAppUrl } from "../../utils/appUrl.js";
import { normalizeFolderPath } from "../../utils/folderTree.js";

// フォーム schema の列型 ("number"|"date"|"string"|"boolean"|"unknown") を
// 簡易フィルタの valueType ("number"|"date"|"text") へマップする。
function columnTypeToValueType(type) {
  if (type === "number") return "number";
  if (type === "date") return "date";
  return "text";
}

export default function DashboardEditorPage() {
  const navigate = useNavigate();
  const { dashboardId } = useParams();
  const location = useLocation();
  const { isAdmin } = useAuth();
  const { forms } = useAppData();
  const isEdit = Boolean(dashboardId);

  // 新規作成時は一覧で開いていたフォルダ (location.state.folder) を初期フォルダにする。
  const initialFolder = isEdit ? "" : normalizeFolderPath(location.state?.folder || "");
  const [dashboard, setDashboard] = useState(() => ({ ...createEmptyV2({ id: null }), folder: initialFolder }));
  const [questions, setQuestions] = useState([]);
  const [loading, setLoading] = useState(!!dashboardId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [previewValues, setPreviewValues] = useState({});
  const [simpleFilterPreviewValues, setSimpleFilterPreviewValues] = useState({});
  const [mappingCardId, setMappingCardId] = useState(null);
  const [cardColumnsMap, setCardColumnsMap] = useState({}); // cardId -> columns

  const unsavedDialog = useConfirmDialog();
  const baselineRef = useRef(null);
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    if (!isAdmin) navigate("/", { replace: true });
  }, [isAdmin, navigate]);

  const questionsById = useMemo(() => {
    const m = new Map();
    for (const q of questions) m.set(q.id, q);
    return m;
  }, [questions]);

  // 簡易フィルタの項目候補。ダッシュボードの各カード（Question）が参照する
  // フォーム・variant から列メタを集約し、AlaSQL safe key で重複排除する。
  // 元レコードテーブルへ適用するため、列識別子は getFormColumns / getFormViewColumns の alaSqlKey。
  const availableColumns = useMemo(() => {
    const formsById = new Map((forms || []).map((f) => [f.id, f]));
    const byKey = new Map(); // alaSqlKey -> { alaSqlKey, key, label, type }
    for (const card of dashboard.cards || []) {
      const q = questionsById.get(card.questionId);
      if (!q || !q.query) continue;
      const sources = [];
      if (q.query.mode === "gui" && q.query.gui?.formId) {
        sources.push({ formId: q.query.gui.formId, variant: q.query.gui.variant === "view" ? "view" : "data" });
      } else if (q.query.mode === "sql" && Array.isArray(q.query.formSources)) {
        for (const s of q.query.formSources) {
          sources.push({ formId: s.formId, variant: s.variant === "view" ? "view" : "data" });
        }
      }
      for (const src of sources) {
        const form = formsById.get(src.formId);
        if (!form) continue;
        const cols = src.variant === "view" ? getFormViewColumns(form) : getFormColumns(form);
        for (const c of cols) {
          if (!byKey.has(c.alaSqlKey)) {
            byKey.set(c.alaSqlKey, { alaSqlKey: c.alaSqlKey, key: c.key, label: c.label, type: c.type });
          }
        }
      }
    }
    return Array.from(byKey.values());
  }, [dashboard.cards, questionsById, forms]);

  useCancellable(async (isCancelled) => {
    try {
      const qs = await listQuestions();
      if (isCancelled()) return;
      setQuestions(qs);
    } catch (err) {
      if (isCancelled()) return;
      console.warn("[DashboardEditorPage] listQuestions failed:", err);
    }
  }, []);

  useCancellable(async (isCancelled) => {
    if (!dashboardId) {
      setDashboard(createEmptyV2({ id: null }));
      return;
    }
    setLoading(true);
    try {
      const res = await analyticsGasClient.getDashboard(dashboardId);
      if (isCancelled()) return;
      const d = res.dashboard;
      if (!isV2(d)) {
        setError("このダッシュボードは旧形式です。新規作成してください。");
        setDashboard(createEmptyV2({ id: dashboardId }));
      } else {
        setDashboard(d);
      }
      // フィルタの初期値で previewValues を埋める
      const initVals = {};
      for (const f of d?.filters || []) {
        initVals[f.id] = defaultFilterValue(f);
      }
      setPreviewValues(initVals);
      const simpleInit = {};
      for (const sf of d?.simpleFilters || []) {
        simpleInit[sf.id] = defaultSimpleFilterValue();
      }
      setSimpleFilterPreviewValues(simpleInit);
    } catch (err) {
      if (isCancelled()) return;
      setError(err.message || String(err));
    } finally {
      if (!isCancelled()) setLoading(false);
    }
  }, [dashboardId]);

  // ----- Cards -----
  const handleAddCard = (questionId) => {
    if (!questionId) return;
    const pos = computeDefaultCardPosition(dashboard.cards);
    const newCard = {
      id: genCardId(),
      questionId,
      title: "",
      ...pos,
      filterMappings: {},
    };
    setDashboard((d) => ({ ...d, cards: [...d.cards, newCard] }));
  };

  const handleAddMessageCard = () => {
    const pos = computeDefaultCardPosition(dashboard.cards, { w: 6, h: 3 });
    const newCard = {
      id: genCardId(),
      ...createMessageCardDefaults(),
      ...pos,
    };
    setDashboard((d) => ({ ...d, cards: [...d.cards, newCard] }));
  };

  const handleUpdateCard = (cardId, patch) => {
    setDashboard((d) => ({
      ...d,
      cards: d.cards.map((c) => (c.id === cardId ? { ...c, ...patch } : c)),
    }));
  };

  const handleCardsChange = (newCards) => {
    setDashboard((d) => ({ ...d, cards: newCards }));
  };

  const handleRemoveCard = (cardId) => {
    setDashboard((d) => ({ ...d, cards: d.cards.filter((c) => c.id !== cardId) }));
    setCardColumnsMap((m) => {
      const next = { ...m };
      delete next[cardId];
      return next;
    });
  };

  const handleChangeCardTitle = (cardId, title) => {
    setDashboard((d) => ({
      ...d,
      cards: d.cards.map((c) => c.id === cardId ? { ...c, title } : c),
    }));
  };

  const handleColumnsLoaded = (cardId, columns) => {
    setCardColumnsMap((m) => ({ ...m, [cardId]: columns }));
  };

  // ----- Filters -----
  const handleAddFilter = (type) => {
    const id = genFilterId();
    const newFilter = {
      id,
      label: "新しいフィルタ",
      type,
      default: defaultFilterValue({ type }),
    };
    if (type === "category") newFilter.options = { values: [], multi: false };
    setDashboard((d) => ({ ...d, filters: [...(d.filters || []), newFilter] }));
    setPreviewValues((v) => ({ ...v, [id]: defaultFilterValue(newFilter) }));
  };

  const handleFilterChange = (filterId, patch) => {
    setDashboard((d) => ({
      ...d,
      filters: (d.filters || []).map((f) => f.id === filterId ? { ...f, ...patch } : f),
    }));
  };

  const handleRemoveFilter = (filterId) => {
    setDashboard((d) => ({
      ...d,
      filters: (d.filters || []).filter((f) => f.id !== filterId),
      // 各カードからもマッピング削除
      cards: d.cards.map((c) => {
        if (!c.filterMappings || !c.filterMappings[filterId]) return c;
        const next = { ...c.filterMappings };
        delete next[filterId];
        return { ...c, filterMappings: next };
      }),
    }));
    setPreviewValues((v) => {
      const next = { ...v };
      delete next[filterId];
      return next;
    });
  };

  const handleMappingChange = (cardId, mappings) => {
    setDashboard((d) => ({
      ...d,
      cards: d.cards.map((c) => c.id === cardId ? { ...c, filterMappings: mappings } : c),
    }));
  };

  // ----- 簡易フィルタ -----
  const handleAddSimpleFilter = () => {
    const id = genFilterId();
    const newFilter = { id, column: "", label: "", valueType: "text" };
    setDashboard((d) => ({ ...d, simpleFilters: [...(d.simpleFilters || []), newFilter] }));
    setSimpleFilterPreviewValues((v) => ({ ...v, [id]: defaultSimpleFilterValue() }));
  };

  const handleSimpleFilterChange = (filterId, patch) => {
    setDashboard((d) => ({
      ...d,
      simpleFilters: (d.simpleFilters || []).map((f) => f.id === filterId ? { ...f, ...patch } : f),
    }));
  };

  // 項目（列）選択時に、その列の型から valueType を決め、未入力ならラベルも初期化する。
  const handleSimpleFilterColumnSelect = (filterId, alaSqlKey) => {
    const col = availableColumns.find((c) => c.alaSqlKey === alaSqlKey);
    const valueType = col ? columnTypeToValueType(col.type) : "text";
    setDashboard((d) => ({
      ...d,
      simpleFilters: (d.simpleFilters || []).map((f) => {
        if (f.id !== filterId) return f;
        const label = f.label && f.label.trim() ? f.label : (col ? col.label : "");
        return { ...f, column: alaSqlKey, valueType, label };
      }),
    }));
  };

  const handleRemoveSimpleFilter = (filterId) => {
    setDashboard((d) => ({
      ...d,
      simpleFilters: (d.simpleFilters || []).filter((f) => f.id !== filterId),
    }));
    setSimpleFilterPreviewValues((v) => {
      const next = { ...v };
      delete next[filterId];
      return next;
    });
  };

  // ----- Dirty tracking -----
  const snapshot = useMemo(() => JSON.stringify({ dashboard }), [dashboard]);
  const baselineReady = !dashboardId || !loading;

  useEffect(() => {
    if (!baselineReady) return;
    if (baselineRef.current === null) {
      baselineRef.current = snapshot;
      setIsDirty(false);
      return;
    }
    setIsDirty(baselineRef.current !== snapshot);
  }, [baselineReady, snapshot]);

  useBeforeUnloadGuard(isDirty);

  const goBack = useCallback(() => navigate(location.state?.from || "/admin/dashboards"), [navigate, location.state]);

  const handleCancel = () => {
    if (!isDirty) { goBack(); return; }
    unsavedDialog.open();
  };

  const handleBack = () => {
    if (isDirty) {
      unsavedDialog.open();
      return false;
    }
  };

  // ----- Save -----
  const handleSave = async () => {
    if (!dashboard.name || !dashboard.name.trim()) {
      setError("ダッシュボード名を入力してください。");
      return;
    }

    setSaving(true);
    setError(null);

    const payload = {
      ...dashboard,
      id: dashboard.id || dashboardId || genDashboardId(),
      schemaVersion: 2,
      name: dashboard.name.trim(),
      description: (dashboard.description || "").trim(),
      folder: normalizeFolderPath(dashboard.folder),
      modifiedAt: Date.now(),
    };

    try {
      await saveDashboard(payload);
      navigate(location.state?.from || "/admin/dashboards");
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setSaving(false);
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
        goBack();
      },
    },
    {
      label: "キャンセル",
      value: "cancel",
      onSelect: unsavedDialog.close,
    },
  ];

  const mappingCard = mappingCardId ? dashboard.cards.find((c) => c.id === mappingCardId) : null;

  if (!isAdmin) return null;

  return (
    <AppLayout
      title={dashboardId ? "Dashboard 編集" : "Dashboard 作成"}
      fallbackPath="/admin/dashboards"
      onBack={handleBack}
      sidebarActions={
        <>
          <button type="button" onClick={handleSave} disabled={saving} className="nf-btn-outline nf-btn-sidebar">
            {saving ? "保存中..." : "保存"}
          </button>
          <button type="button" onClick={handleCancel} className="nf-btn-outline nf-btn-sidebar">
            キャンセル
          </button>
        </>
      }
    >
      {loading && <p className="nf-text-subtle">読み込み中...</p>}
      {error && <p className="nf-text-warning">{error}</p>}

      {!loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <div>
              <label className="nf-label">ダッシュボード名</label>
              <input
                className="nf-input"
                type="text"
                value={dashboard.name || ""}
                onChange={(e) => setDashboard((d) => ({ ...d, name: e.target.value }))}
                placeholder="例: 月次レポート"
                style={{ width: 300 }}
              />
            </div>
            <div style={{ flex: 1, minWidth: 240 }}>
              <label className="nf-label">説明（任意）</label>
              <input
                className="nf-input"
                type="text"
                value={dashboard.description || ""}
                onChange={(e) => setDashboard((d) => ({ ...d, description: e.target.value }))}
                style={{ width: "100%", maxWidth: 500 }}
              />
            </div>
            <div>
              <label className="nf-label">フォルダ（任意）</label>
              <input
                className="nf-input"
                type="text"
                value={dashboard.folder || ""}
                onChange={(e) => setDashboard((d) => ({ ...d, folder: e.target.value }))}
                placeholder="例: 営業/月次  （空欄=フォルダなし）"
                style={{ width: 300 }}
              />
            </div>
          </div>

          {dashboardId && dashboard.driveFileUrl && (
            <div>
              <label className="nf-label">実体ファイル URL（Drive 上の JSON）</label>
              <input
                className="nf-input nf-input--readonly"
                type="text"
                value={dashboard.driveFileUrl}
                readOnly
                onFocus={(e) => e.target.select()}
                title="この Dashboard の実体（Drive 上の JSON ファイル）の URL。表示専用で編集できません。"
                style={{ width: "100%", maxWidth: 640, background: "var(--surface-subtle)", color: "var(--text-muted)" }}
              />
              <p className="nf-text-11 nf-text-muted nf-mt-4 nf-mb-0">
                この Dashboard 定義が保存されている Drive 上の場所です。どれが実体かを確認するための表示専用で、編集はできません。
              </p>
            </div>
          )}

          <p className="nf-text-11 nf-text-muted nf-mb-0">
            Dashboard 定義は標準フォルダ構成の <code>03_dashboards</code> に保存されます。
          </p>

          {/* フィルタ定義 */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <label className="nf-label" style={{ marginBottom: 0 }}>共通フィルタ</label>
              <span style={{ display: "inline-flex", gap: 6 }}>
                {FILTER_TYPES.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className="nf-btn-outline"
                    style={{ fontSize: 11, padding: "2px 6px" }}
                    onClick={() => handleAddFilter(t)}
                  >
                    + {t}
                  </button>
                ))}
              </span>
            </div>

            {(dashboard.filters || []).length === 0 && (
              <p className="nf-text-subtle" style={{ fontSize: 12 }}>
                共通フィルタなし。「+ dateRange」などから追加できます。
              </p>
            )}

            {(dashboard.filters || []).map((f) => (
              <div key={f.id} className="nf-card" style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 8px", marginBottom: 6 }}>
                <span className="nf-text-subtle" style={{ fontSize: 11, minWidth: 80 }}>{f.type}</span>
                <input
                  type="text"
                  className="nf-input"
                  value={f.label || ""}
                  onChange={(e) => handleFilterChange(f.id, { label: e.target.value })}
                  placeholder="ラベル"
                  style={{ fontSize: 12, padding: "2px 6px", flex: 1, maxWidth: 200 }}
                />
                {f.type === "category" && (
                  <input
                    type="text"
                    className="nf-input"
                    value={(f.options?.values || []).join(",")}
                    onChange={(e) => {
                      const vals = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
                      handleFilterChange(f.id, { options: { ...(f.options || {}), values: vals } });
                    }}
                    placeholder="選択肢 (カンマ区切り)"
                    style={{ fontSize: 12, padding: "2px 6px", flex: 1 }}
                  />
                )}
                {f.type === "category" && (
                  <label style={{ fontSize: 11, display: "inline-flex", alignItems: "center", gap: 3 }}>
                    <input
                      type="checkbox"
                      checked={!!f.options?.multi}
                      onChange={(e) => handleFilterChange(f.id, { options: { ...(f.options || {}), multi: e.target.checked } })}
                    />
                    複数選択
                  </label>
                )}
                <button
                  type="button"
                  className="nf-btn-outline nf-btn-danger"
                  style={{ fontSize: 11, padding: "2px 6px" }}
                  onClick={() => handleRemoveFilter(f.id)}
                >
                  削除
                </button>
              </div>
            ))}
          </div>

          {/* 簡易フィルタ定義 */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <label className="nf-label" style={{ marginBottom: 0 }}>
                簡易フィルタ（項目名で絞り込み・最大{MAX_SIMPLE_FILTERS}）
              </label>
              <button
                type="button"
                className="nf-btn-outline"
                style={{ fontSize: 11, padding: "2px 6px" }}
                onClick={handleAddSimpleFilter}
                disabled={(dashboard.simpleFilters || []).length >= MAX_SIMPLE_FILTERS}
              >
                + 簡易フィルタ追加
              </button>
            </div>

            <p className="nf-text-subtle" style={{ fontSize: 12, marginTop: 0 }}>
              項目（フォームの列）を選ぶと、閲覧時に最小・最大の値だけ入力して全カードを絞り込めます。
              項目を持たないカードには適用されません。複数項目は AND で結合します。
            </p>

            {(dashboard.simpleFilters || []).map((f) => (
              <div key={f.id} className="nf-card" style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 8px", marginBottom: 6, flexWrap: "wrap" }}>
                <select
                  className="nf-input"
                  value={f.column || ""}
                  onChange={(e) => handleSimpleFilterColumnSelect(f.id, e.target.value)}
                  style={{ fontSize: 12, padding: "2px 6px", minWidth: 200 }}
                >
                  <option value="">項目を選択...</option>
                  {availableColumns.map((c) => (
                    <option key={c.alaSqlKey} value={c.alaSqlKey}>{c.key}</option>
                  ))}
                  {/* 既存の選択が候補一覧に無い場合（カード未描画等）も値を保持して表示する */}
                  {f.column && !availableColumns.some((c) => c.alaSqlKey === f.column) && (
                    <option value={f.column}>{f.column}（候補外）</option>
                  )}
                </select>
                <span className="nf-text-subtle" style={{ fontSize: 11, minWidth: 48 }}>{f.valueType}</span>
                <input
                  type="text"
                  className="nf-input"
                  value={f.label || ""}
                  onChange={(e) => handleSimpleFilterChange(f.id, { label: e.target.value })}
                  placeholder="ラベル（任意）"
                  style={{ fontSize: 12, padding: "2px 6px", flex: 1, maxWidth: 200 }}
                />
                <button
                  type="button"
                  className="nf-btn-outline nf-btn-danger"
                  style={{ fontSize: 11, padding: "2px 6px" }}
                  onClick={() => handleRemoveSimpleFilter(f.id)}
                >
                  削除
                </button>
              </div>
            ))}
          </div>

          {/* カード追加 */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <label className="nf-label" style={{ marginBottom: 0 }}>カード</label>
            <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
              <select
                className="nf-input"
                onChange={(e) => {
                  if (e.target.value) {
                    handleAddCard(e.target.value);
                    e.target.value = "";
                  }
                }}
                defaultValue=""
                style={{ fontSize: 12 }}
              >
                <option value="">+ Question を選んで追加</option>
                {questions.map((q) => (
                  <option key={q.id} value={q.id}>{q.name || q.id}</option>
                ))}
              </select>
              <button
                type="button"
                className="nf-btn-outline"
                onClick={handleAddMessageCard}
                style={{ fontSize: 12 }}
                title="ダッシュボード上で直接編集できるテキストウィジェットを追加"
              >+ メッセージボックス</button>
              <button
                type="button"
                className="nf-btn-outline"
                onClick={() => {
                  const url = buildAppUrl("/admin/questions/new");
                  window.open(url, "_blank", "noopener,noreferrer");
                }}
                style={{ fontSize: 12 }}
                title="新規 Question を別タブで作成"
              >+ Question を新規作成</button>
            </span>
          </div>

          {/* プレビュー用フィルタバー */}
          <DashboardFilterBar
            filters={dashboard.filters || []}
            values={previewValues}
            onChange={setPreviewValues}
          />
          <SimpleFilterBar
            simpleFilters={(dashboard.simpleFilters || []).filter((f) => f.column)}
            values={simpleFilterPreviewValues}
            onChange={setSimpleFilterPreviewValues}
          />

          {/* グリッド */}
          {dashboard.cards.length === 0 ? (
            <p className="nf-text-subtle">カードがありません。上のセレクタから Question を選ぶか、メッセージボックスを追加してください。</p>
          ) : (
            <DashboardGrid
              dashboard={dashboard}
              filterValues={previewValues}
              simpleFilters={(dashboard.simpleFilters || []).filter((f) => f.column)}
              simpleFilterValues={simpleFilterPreviewValues}
              forms={forms}
              isAdmin={true}
              editable={true}
              viewerControls={false}
              questionsById={questionsById}
              onCardsChange={handleCardsChange}
              onRemoveCard={handleRemoveCard}
              onChangeCardTitle={handleChangeCardTitle}
              onOpenMapping={setMappingCardId}
              onColumnsLoaded={handleColumnsLoaded}
              onUpdateCard={handleUpdateCard}
            />
          )}
        </div>
      )}

      {mappingCard && (
        <DashboardCardFilterMappingDialog
          card={mappingCard}
          filters={dashboard.filters || []}
          cardColumns={cardColumnsMap[mappingCard.id] || []}
          onChange={handleMappingChange}
          onClose={() => setMappingCardId(null)}
        />
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
