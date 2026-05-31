import React, { useEffect, useMemo, useState } from "react";
import ChartRenderer from "./ChartRenderer.jsx";
import CardViewerControls from "./CardViewerControls.jsx";
import CardExpandModal from "./CardExpandModal.jsx";
import { getQuestionById } from "../analyticsStore.js";
import { executeDashboardCard } from "../dashboardFilters.js";
import { mergeViz } from "../utils/mergeViz.js";
import { applyDateFilter, applyTimeFilter } from "../utils/dateRangePresets.js";
import { triggerCsvDownload, triggerDataUrlDownload, sanitizeFileBaseName } from "../utils/exportResultData.js";
import { useAsyncResource } from "../../../app/hooks/useAsyncResource.js";
import { buildAppUrl } from "../../../utils/appUrl.js";

/**
 * RGL の 1 セル分。Question を取得し、ダッシュボードフィルタを適用して描画する。
 *
 * 編集モード (editable) では右上に編集用ボタン (削除 / フィルタマッピング / カスタムタイトル) を出す。
 * 閲覧モードでは viewerControls=true のとき右上に閲覧者向けの一時操作ボタン (グラフ調整 /
 * 期間フィルタ / CSV・PNG / 拡大) を出す。これらの一時操作は元の Question / Dashboard を変更しない。
 * onColumnsLoaded(cardId, columns) でこのカードの結果列を親に通知し、
 * フィルタマッピング UI で「どの列にフィルタをかけるか」の選択肢を作れるようにする。
 */
export default function DashboardCardFrame({
  card,
  filters,
  filterValues,
  simpleFilters,
  simpleFilterValues,
  forms,
  isAdmin,
  editable,
  viewerControls = true,
  refreshNonce = 0,
  globalWhereExpr = "",
  questionsById,
  questions = [],
  onRemove,
  onChangeTitle,
  onRelink,
  onOpenMapping,
  onColumnsLoaded,
}) {
  // forms 未到着のままカードを実行すると executeDashboardCard 内で AlaSQL の
  // tables 未登録参照や「対象フォームが見つかりません」エラーで止まり、forms が
  // 後から到着しても再評価されない。formsReady を deps にして到着後に走らせる。
  const formsReady = !!(forms && forms.length > 0);
  const filterMappingsKey = JSON.stringify(card.filterMappings || {});
  const filterValuesKey = JSON.stringify(filterValues || {});
  const simpleFiltersKey = JSON.stringify(simpleFilters || []);
  const simpleFilterValuesKey = JSON.stringify(simpleFilterValues || {});

  const [question, setQuestion] = useState(() => questionsById?.get?.(card.questionId) || null);

  // 閲覧者の一時状態（リロード / 別画面遷移で消える。元データには影響しない）
  const [vizOverride, setVizOverride] = useState(null);
  const [dateFilter, setDateFilter] = useState(null);
  const [chartInstance, setChartInstance] = useState(null);
  const [expanded, setExpanded] = useState(false);
  // 差し替え（再リンク）ポップオーバーの状態
  const [relinkOpen, setRelinkOpen] = useState(false);
  const [relinkText, setRelinkText] = useState("");

  // 入力文字列を questionId へ解決する: id 一致 → 名前一致 → そのまま raw id 扱い。
  const resolveRelinkInput = (text) => {
    const t = (text || "").trim();
    if (!t) return "";
    const byId = questions.find((q) => q.id === t);
    if (byId) return byId.id;
    const byName = questions.find((q) => q.name === t);
    if (byName) return byName.id;
    return t;
  };

  const commitRelinkText = () => {
    const id = resolveRelinkInput(relinkText);
    if (!id) return;
    onRelink(card.id, id);
    setRelinkOpen(false);
    setRelinkText("");
  };

  const { data: result, loading, error } = useAsyncResource(async () => {
    if (!formsReady) return null;
    const cached = questionsById?.get?.(card.questionId) || null;
    const q = cached || await getQuestionById(card.questionId);
    setQuestion(q || null);
    if (!q) return { ok: false, error: "Question が見つかりません" };
    return await executeDashboardCard(q, card, filters, filterValues, { forms, globalWhereExpr, simpleFilters, simpleFilterValues });
    // forms / questionsById はリファレンス変化が頻繁なので deps から外す:
    // forms は formsReady で到着判定、questionsById は同一 questionId に対して
    // キャッシュ内容が変わらない前提（編集後の再表示は再マウントで吸収）。
    // refreshNonce は閲覧者の「データ再取得」で全カードを再実行させるためのキー。
    // globalWhereExpr は閲覧者の一時グローバルフィルタ（ソーステーブル側を絞る）。
    // simpleFilters* は簡易フィルタ（元レコードテーブル側を絞る）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.id, card.questionId, filterMappingsKey, filterValuesKey, simpleFiltersKey, simpleFilterValuesKey, formsReady, refreshNonce, globalWhereExpr]);

  useEffect(() => {
    if (result?.ok && Array.isArray(result.columns) && onColumnsLoaded) {
      onColumnsLoaded(card.id, result.columns);
    }
  }, [result, card.id, onColumnsLoaded]);

  const baseViz = question?.visualization || null;
  const mergedViz = useMemo(
    () => (vizOverride ? mergeViz(baseViz, vizOverride) : baseViz),
    [baseViz, vizOverride]
  );
  const displayRows = useMemo(() => {
    if (!result?.ok || !Array.isArray(result.rows)) return [];
    if (!dateFilter) return result.rows;
    return dateFilter.kind === "time"
      ? applyTimeFilter(result.rows, dateFilter)
      : applyDateFilter(result.rows, dateFilter);
  }, [result, dateFilter]);

  const displayTitle = isAdmin
    ? (card.title || question?.name || "Question")
    : (card.title || "");
  // 編集モードでは、カスタムタイトル設定時に元の Question 名が見えなくなるのを防ぐため
  // ヘッダ直下に小さく元 Question 名を併記する
  const showOriginalQuestionName =
    editable && !!card.title && !!question?.name && card.title !== question.name;

  const fileBase = sanitizeFileBaseName(displayTitle || (isAdmin ? question?.name : "") || "chart", "chart");

  return (
    <div
      className="nf-card"
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        position: "relative",
      }}
    >
      <div
        className="dashboard-card-header"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "4px 6px",
          borderBottom: "1px solid var(--nf-border, #e0e0e0)",
          cursor: editable ? "move" : "default",
          flexShrink: 0,
        }}
      >
        <div style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: 1 }}>
          <h3
            style={{ margin: 0, fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            title={question?.name || ""}
          >
            {displayTitle}
          </h3>
          {showOriginalQuestionName && (
            <span
              className="nf-text-subtle"
              style={{ fontSize: 10, lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
              title={question.name}
            >
              元: {question.name}
            </span>
          )}
        </div>
        {editable && (
          <span style={{ display: "inline-flex", gap: 4, flexShrink: 0 }} onMouseDown={(e) => e.stopPropagation()}>
            {onChangeTitle && (
              <button
                type="button"
                className="nf-btn-outline"
                style={{ fontSize: 11, padding: "1px 6px" }}
                onClick={() => {
                  const v = window.prompt("カスタムタイトル", card.title || "");
                  if (v !== null) onChangeTitle(card.id, v);
                }}
                title="タイトル編集"
              >名</button>
            )}
            {card.questionId && (
              <button
                type="button"
                className="nf-btn-outline"
                style={{ fontSize: 11, padding: "1px 6px", display: "inline-flex", alignItems: "center" }}
                title="Question を新しいタブで編集"
                onClick={() => {
                  const url = buildAppUrl(`/admin/questions/${card.questionId}`);
                  window.open(url, "_blank", "noopener,noreferrer");
                }}
              >✎</button>
            )}
            {onRelink && (
              <button
                type="button"
                className="nf-btn-outline"
                style={{ fontSize: 11, padding: "1px 6px" }}
                onClick={() => setRelinkOpen((v) => !v)}
                title="リンク先 Question を差し替え"
              >⇆</button>
            )}
            {onOpenMapping && (
              <button
                type="button"
                className="nf-btn-outline"
                style={{ fontSize: 11, padding: "1px 6px" }}
                onClick={() => onOpenMapping(card.id)}
                title="フィルタマッピング"
              >⚙</button>
            )}
            {onRemove && (
              <button
                type="button"
                className="nf-btn-outline nf-btn-danger"
                style={{ fontSize: 11, padding: "1px 6px" }}
                onClick={() => onRemove(card.id)}
                title="削除"
              >✕</button>
            )}
          </span>
        )}
        {viewerControls && result?.ok && (
          <span style={{ display: "inline-flex", gap: 4, flexShrink: 0 }} onMouseDown={(e) => e.stopPropagation()}>
            <CardViewerControls
              viz={mergedViz}
              vizOverride={vizOverride}
              dateFilter={dateFilter}
              columns={result.columns}
              compiledColumns={result.compiledColumns}
              fallbackTypeMap={result.fallbackTypeMap}
              rows={result.rows}
              hasChartInstance={!!chartInstance}
              onVizOverrideChange={setVizOverride}
              onDateFilterChange={setDateFilter}
              onExpand={() => setExpanded(true)}
              onExportCsv={() => triggerCsvDownload(displayRows, result.columns, result.compiledColumns, fileBase + ".csv", { sql: result.compiledSql })}
              onExportPng={() => { if (chartInstance) triggerDataUrlDownload(chartInstance.toBase64Image(), fileBase + ".png"); }}
            />
          </span>
        )}
      </div>

      {relinkOpen && onRelink && (
        <div
          className="nf-card"
          style={{
            position: "absolute",
            top: 30,
            right: 4,
            zIndex: 20,
            width: 260,
            padding: 8,
            display: "flex",
            flexDirection: "column",
            gap: 6,
            boxShadow: "0 2px 8px rgba(0,0,0,0.18)",
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div style={{ fontSize: 11, fontWeight: 600 }}>リンク先 Question を差し替え</div>
          <select
            className="nf-input"
            defaultValue=""
            style={{ fontSize: 12 }}
            onChange={(e) => {
              if (e.target.value) {
                onRelink(card.id, e.target.value);
                setRelinkOpen(false);
                setRelinkText("");
              }
            }}
          >
            <option value="">一覧から選択...</option>
            {questions.map((q) => (
              <option key={q.id} value={q.id}>{q.name || q.id}</option>
            ))}
          </select>
          <input
            className="nf-input"
            type="text"
            value={relinkText}
            placeholder="id か Question 名を入力"
            style={{ fontSize: 12 }}
            onChange={(e) => setRelinkText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") commitRelinkText(); }}
          />
          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
            <button
              type="button"
              className="nf-btn-outline"
              style={{ fontSize: 11, padding: "2px 6px" }}
              onClick={commitRelinkText}
            >差し替え</button>
            <button
              type="button"
              className="nf-btn-outline"
              style={{ fontSize: 11, padding: "2px 6px" }}
              onClick={() => { setRelinkOpen(false); setRelinkText(""); }}
            >閉じる</button>
          </div>
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, padding: 8, overflow: "auto" }}>
        {loading && <p className="nf-text-subtle" style={{ margin: 0 }}>読み込み中...</p>}
        {error && <p className="nf-text-warning" style={{ margin: 0 }}>{error}</p>}
        {result && (
          result.ok
            ? <ChartRenderer
                viz={mergedViz}
                rows={displayRows}
                columns={result.columns}
                compiledColumns={result.compiledColumns}
                fallbackTypeMap={result.fallbackTypeMap}
                onChartInstance={setChartInstance}
                sql={result.compiledSql}
              />
            : <p className="nf-text-warning" style={{ margin: 0 }}>{result.error}</p>
        )}
      </div>

      {result?.ok && (
        <CardExpandModal
          open={expanded}
          onClose={() => setExpanded(false)}
          title={displayTitle || (isAdmin ? question?.name : "") || "グラフ"}
          viz={mergedViz}
          rows={displayRows}
          columns={result.columns}
          compiledColumns={result.compiledColumns}
          fallbackTypeMap={result.fallbackTypeMap}
          sql={result.compiledSql}
        />
      )}
    </div>
  );
}
