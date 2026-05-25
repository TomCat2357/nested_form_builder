import React, { useState } from "react";
import OverlayDialog from "./OverlayDialog.jsx";
import CardVizOverridePanel from "./CardVizOverridePanel.jsx";
import CardDateFilterPanel, { getDateColumns } from "./CardDateFilterPanel.jsx";

const MINI_OVERLAY_STYLE = { alignItems: "flex-start", padding: "10vh 16px 16px", background: "rgba(0,0,0,0.35)" };
const MINI_PANEL_STYLE = { background: "var(--nf-bg, #fff)", padding: 14, maxWidth: 520, width: "min(520px, 95vw)" };
const MINI_HEADER_STYLE = { marginBottom: 10 };

function MiniDialog({ title, onClose, children }) {
  return (
    <OverlayDialog
      open
      onClose={onClose}
      title={title}
      overlayStyle={MINI_OVERLAY_STYLE}
      panelClassName="nf-card"
      panelStyle={MINI_PANEL_STYLE}
      headerStyle={MINI_HEADER_STYLE}
    >
      {children}
    </OverlayDialog>
  );
}

const BTN_STYLE = { fontSize: 11, padding: "1px 6px" };

/**
 * カードヘッダ右側に出る閲覧者向けの一時操作ボタン群。
 * グラフ見た目の上書き / 期間フィルタ / CSV・PNG 書き出し / 拡大表示。
 * 元の Question / Dashboard は一切変更しない。
 */
export default function CardViewerControls({
  viz,
  vizOverride,
  dateFilter,
  columns,
  compiledColumns,
  fallbackTypeMap,
  rows,
  hasChartInstance,
  onVizOverrideChange,
  onDateFilterChange,
  onExpand,
  onExportCsv,
  onExportPng,
}) {
  const [openPanel, setOpenPanel] = useState(null); // null | "viz" | "date"
  const hasDateColumns = getDateColumns(columns, compiledColumns, fallbackTypeMap).length > 0;

  return (
    <>
      <button type="button" className="nf-btn-outline" style={BTN_STYLE} onClick={() => setOpenPanel("viz")} title="グラフ表示を一時調整">{vizOverride ? "調整 ●" : "調整"}</button>
      {hasDateColumns && (
        <button type="button" className="nf-btn-outline" style={BTN_STYLE} onClick={() => setOpenPanel("date")} title="期間で一時的に絞り込み">{dateFilter ? "期間 ●" : "期間"}</button>
      )}
      <button type="button" className="nf-btn-outline" style={BTN_STYLE} onClick={onExportCsv} title="CSV ダウンロード">⬇CSV</button>
      {hasChartInstance && (
        <button type="button" className="nf-btn-outline" style={BTN_STYLE} onClick={onExportPng} title="グラフを PNG 保存">⬇PNG</button>
      )}
      <button type="button" className="nf-btn-outline" style={BTN_STYLE} onClick={onExpand} title="拡大表示">⤢</button>

      {openPanel === "viz" && (
        <MiniDialog title="グラフ表示の一時調整" onClose={() => setOpenPanel(null)}>
          <CardVizOverridePanel
            viz={viz}
            vizOverride={vizOverride}
            columns={columns}
            compiledColumns={compiledColumns}
            fallbackTypeMap={fallbackTypeMap}
            onChange={onVizOverrideChange}
          />
          <p className="nf-text-subtle" style={{ fontSize: 11, marginTop: 10, marginBottom: 0 }}>
            ※ ここでの変更はあなたの画面だけの一時的なものです（再読み込みで元に戻ります）。
          </p>
        </MiniDialog>
      )}
      {openPanel === "date" && (
        <MiniDialog title="期間で一時的に絞り込み" onClose={() => setOpenPanel(null)}>
          <CardDateFilterPanel
            columns={columns}
            compiledColumns={compiledColumns}
            fallbackTypeMap={fallbackTypeMap}
            rows={rows}
            dateFilter={dateFilter}
            onChange={onDateFilterChange}
          />
          <p className="nf-text-subtle" style={{ fontSize: 11, marginTop: 10, marginBottom: 0 }}>
            ※ ここでの絞り込みはあなたの画面だけの一時的なものです（再読み込みで元に戻ります）。
          </p>
        </MiniDialog>
      )}
    </>
  );
}
