import React, { useState } from "react";
import ChartRenderer from "./ChartRenderer.jsx";
import OverlayDialog from "./OverlayDialog.jsx";
import { triggerCsvDownload, triggerDataUrlDownload, sanitizeFileBaseName } from "../utils/exportResultData.js";

const OVERLAY_STYLE = { alignItems: "center", padding: 16, background: "rgba(0,0,0,0.45)" };

const PANEL_STYLE = {
  background: "var(--nf-bg, #fff)",
  width: "min(1100px, 95vw)",
  height: "min(800px, 90vh)",
  display: "flex",
  flexDirection: "column",
  borderRadius: 6,
  overflow: "hidden",
};

const HEADER_STYLE = { padding: "8px 12px", borderBottom: "1px solid var(--nf-border, #e0e0e0)", flexShrink: 0 };
const BODY_STYLE = { flex: 1, minHeight: 0, padding: 12, overflow: "auto" };
const CHART_CONTAINER_STYLE = { position: "relative", width: "100%", height: "100%" };
const ACTION_BTN_STYLE = { fontSize: 12, padding: "2px 8px" };

/**
 * カードを大きく表示する一時モーダル。元の Question / Dashboard は変更しない。
 * グラフは渡された（上書き・期間フィルタ適用後の）viz / rows で再描画する。
 */
export default function CardExpandModal({ open, onClose, title, viz, rows, columns, compiledColumns, fallbackTypeMap, sql }) {
  const [chartInstance, setChartInstance] = useState(null);

  if (!open) return null;

  const baseName = sanitizeFileBaseName(title, "chart");

  const headerActions = (
    <>
      <button
        type="button"
        className="nf-btn-outline"
        style={ACTION_BTN_STYLE}
        onClick={() => triggerCsvDownload(rows, columns, compiledColumns, baseName + ".csv", { sql })}
      >CSV</button>
      {chartInstance && (
        <button
          type="button"
          className="nf-btn-outline"
          style={ACTION_BTN_STYLE}
          onClick={() => triggerDataUrlDownload(chartInstance.toBase64Image(), baseName + ".png")}
        >PNG</button>
      )}
    </>
  );

  return (
    <OverlayDialog
      open={open}
      onClose={onClose}
      title={title || "グラフ"}
      headerActions={headerActions}
      overlayStyle={OVERLAY_STYLE}
      panelStyle={PANEL_STYLE}
      headerStyle={HEADER_STYLE}
      bodyStyle={BODY_STYLE}
    >
      <ChartRenderer
        viz={viz}
        rows={rows}
        columns={columns}
        compiledColumns={compiledColumns}
        fallbackTypeMap={fallbackTypeMap}
        onChartInstance={setChartInstance}
        containerStyle={CHART_CONTAINER_STYLE}
        sql={sql}
      />
    </OverlayDialog>
  );
}
