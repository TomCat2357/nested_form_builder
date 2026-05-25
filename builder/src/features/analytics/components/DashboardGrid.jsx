import React, { useState } from "react";
import * as ReactNamespace from "react";
import * as ReactDOMNamespace from "react-dom";
import { useCancellable } from "../../../app/hooks/useCancellable.js";
import { loadReactGridLayout } from "../utils/cdnLoader.js";
import { mergeLayoutIntoCards, getCardType, CARD_TYPE_MESSAGE } from "../utils/dashboardSchema.js";
import DashboardCardFrame from "./DashboardCardFrame.jsx";
import DashboardMessageCard from "./DashboardMessageCard.jsx";

/**
 * react-grid-layout (CDN ロード) を使ったダッシュボードグリッド。
 * editable=true ではドラッグ・リサイズ可能、false では読み取り専用。
 *
 * RGL の UMD ビルドが React/ReactDOM のグローバル参照を要求するので
 * useEffect で一度だけ window に貼ってからロードする。
 */
export default function DashboardGrid({
  dashboard,
  filterValues,
  simpleFilters = [],
  simpleFilterValues,
  forms,
  isAdmin,
  editable,
  viewerControls,
  refreshNonce = 0,
  globalWhereExpr = "",
  globalWhereVariant = "data",
  questionsById,
  onCardsChange,
  onRemoveCard,
  onChangeCardTitle,
  onOpenMapping,
  onColumnsLoaded,
  onUpdateCard,
}) {
  const [WrappedGrid, setWrappedGrid] = useState(null);
  const [loadError, setLoadError] = useState(null);

  useCancellable(async (isCancelled) => {
    if (!window.React) window.React = ReactNamespace;
    if (!window.ReactDOM) window.ReactDOM = ReactDOMNamespace;

    try {
      const mod = await loadReactGridLayout();
      if (isCancelled()) return;
      const GridLayout =
        mod.default || mod.GridLayout || (typeof mod === "function" ? mod : null);
      const WidthProvider = mod.WidthProvider || (mod.default && mod.default.WidthProvider);
      if (!GridLayout || !WidthProvider) {
        setLoadError("react-grid-layout の API 形式が想定外です");
        return;
      }
      const Wrapped = WidthProvider(GridLayout);
      // 関数コンポーネントを state に入れる場合、setState(value) だと
      // 「関数を呼んで結果を state にする」と解釈されてしまうため
      // 関数を返す関数の形で渡す。
      setWrappedGrid(() => Wrapped);
    } catch (err) {
      if (!isCancelled()) setLoadError(err.message || String(err));
    }
  }, []);

  if (loadError) {
    return <p className="nf-text-warning">グリッドの読み込みに失敗しました: {loadError}</p>;
  }
  if (!WrappedGrid) {
    return <p className="nf-text-subtle">グリッド準備中...</p>;
  }

  const layoutCfg = dashboard.layout || {};
  const cols = layoutCfg.cols || 12;
  const rowHeight = layoutCfg.rowHeight || 60;
  const margin = layoutCfg.margin || [8, 8];
  const containerPadding = layoutCfg.containerPadding || [0, 0];

  const layout = (dashboard.cards || []).map((c) => ({
    i: c.id,
    x: c.x ?? 0,
    y: c.y ?? 0,
    w: c.w ?? 6,
    h: c.h ?? 4,
    minW: c.minW ?? 2,
    minH: c.minH ?? 2,
  }));

  const handleLayoutChange = (newLayout) => {
    if (!editable || !onCardsChange) return;
    onCardsChange(mergeLayoutIntoCards(dashboard.cards || [], newLayout));
  };

  const handleResizeStop = () => {
    // Chart.js / ECharts / Leaflet がリサイズイベントを拾って再計算するよう発火
    window.dispatchEvent(new Event("resize"));
  };

  return (
    <WrappedGrid
      className="dashboard-grid"
      layout={layout}
      cols={cols}
      rowHeight={rowHeight}
      margin={margin}
      containerPadding={containerPadding}
      isDraggable={!!editable}
      isResizable={!!editable}
      draggableHandle=".dashboard-card-header"
      onLayoutChange={handleLayoutChange}
      onResizeStop={handleResizeStop}
      compactType="vertical"
    >
      {(dashboard.cards || []).map((card) => (
        <div key={card.id}>
          {getCardType(card) === CARD_TYPE_MESSAGE ? (
            <DashboardMessageCard
              card={card}
              editable={editable}
              onUpdate={editable ? onUpdateCard : null}
              onRemove={editable ? onRemoveCard : null}
            />
          ) : (
            <DashboardCardFrame
              card={card}
              filters={dashboard.filters || []}
              filterValues={filterValues}
              simpleFilters={simpleFilters}
              simpleFilterValues={simpleFilterValues}
              forms={forms}
              isAdmin={isAdmin}
              editable={editable}
              viewerControls={viewerControls}
              refreshNonce={refreshNonce}
              globalWhereExpr={globalWhereExpr}
              globalWhereVariant={globalWhereVariant}
              questionsById={questionsById}
              onRemove={editable ? onRemoveCard : null}
              onChangeTitle={editable ? onChangeCardTitle : null}
              onOpenMapping={editable ? onOpenMapping : null}
              onColumnsLoaded={onColumnsLoaded}
            />
          )}
        </div>
      ))}
    </WrappedGrid>
  );
}
