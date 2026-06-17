import React, { useMemo, useState } from "react";
import { CHART_PALETTE, DEFAULT_LINE_STYLE, DEFAULT_CHART_STYLE, normalizeChartStyle } from "../utils/chartPalette.js";
import { LABEL_STYLE, HEADER_LABEL_STYLE, RESET_BUTTON_STYLE } from "../utils/styleConstants.js";
import { useStylePathSetter } from "./useStylePathSetter.js";
import { getChartControlVisibility, isPieLike, dashToString, stringToDash } from "../utils/chartStyleControlsLogic.js";

// 表示判定は chartStyleControlsLogic.js に集約。VisualizePanel 互換のため経路を維持して再公開する。
export { isChartStyleSupported } from "../utils/chartStyleControlsLogic.js";

// 折れ線・棒・円・散布図 共通のスタイルカスタマイズ UI。
// 既存 TableStyleControls の minColor/maxColor パターンを踏襲（カラーピッカー + 既定リセット）。
//
// 対象タイプ別の表示:
//   line / area / combo  → 線種・ポイント形状・ポイント半径 + 系列色 + 軸ラベル
//   bar / stackedBar / row → 系列色 + 軸ラベル
//   pie / donut          → セグメント色（軸ラベル無し）
//   scatter              → ポイント形状・ポイント半径 + 系列色 + 軸ラベル
//
// それ以外の vizType ではこの UI 全体を非表示にする（呼び出し側 VisualizePanel 側でガード）。

const CURVE_OPTIONS = [
  { value: "linear", label: "直線（カクカク）" },
  { value: "smooth", label: "スムーズ（曲線）" },
];

const DASH_PRESETS = [
  { value: "", label: "実線" },
  { value: "5,5", label: "破線" },
  { value: "2,3", label: "点線" },
  { value: "8,4,2,4", label: "一点鎖線" },
];

const POINT_STYLE_OPTIONS = [
  { value: "circle", label: "●" },
  { value: "rect", label: "■" },
  { value: "rectRot", label: "◆" },
  { value: "triangle", label: "▲" },
  { value: "cross", label: "✚" },
  { value: "star", label: "★" },
  { value: "none", label: "（なし）" },
];

const LEGEND_POSITION_OPTIONS = [
  { value: "top", label: "上" },
  { value: "right", label: "右" },
  { value: "bottom", label: "下" },
  { value: "left", label: "左" },
  { value: "hidden", label: "非表示" },
];

export default function ChartStyleControls({
  vizType,
  lineStyle,
  series,
  axis,
  chartStyle,
  onLineStyleChange,
  onSeriesChange,
  onAxisChange,
  onChartStyleChange,
  availableSeries,
}) {
  const [open, setOpen] = useState(false);

  const {
    showLineControls,
    showPointControls,
    showAxisLabels,
    showSeriesColors,
    showAxisCustomization,
  } = getChartControlVisibility(vizType);

  // この vizType ではカスタマイズ項目がひとつも無い → 何も描画しない
  if (!showLineControls && !showPointControls && !showAxisLabels && !showSeriesColors) {
    return null;
  }

  const cs = useMemo(() => normalizeChartStyle(chartStyle), [chartStyle]);
  const setCs = (patch) => onChartStyleChange?.({ ...cs, ...patch });
  const { setPath: setCsPath } = useStylePathSetter(cs, onChartStyleChange);
  const resetChartStyle = () => onChartStyleChange?.(null);
  const isCsUnset = !chartStyle;

  const ls = { ...DEFAULT_LINE_STYLE, ...(lineStyle || {}) };
  const setLine = (patch) => onLineStyleChange?.({ ...ls, ...patch });

  const seriesMap = series && typeof series === "object" ? series : {};
  const setSeriesColor = (key, color) => {
    const next = { ...seriesMap };
    if (!color) {
      delete next[key];
    } else {
      next[key] = { ...(next[key] || {}), color };
    }
    onSeriesChange?.(next);
  };
  const resetSeriesColor = (key) => {
    const next = { ...seriesMap };
    delete next[key];
    onSeriesChange?.(next);
  };

  const axisX = axis?.x || {};
  const axisY = axis?.y || {};
  const setAxisTitle = (which, text) => {
    onAxisChange?.({
      x: which === "x" ? { ...axisX, title: text } : axisX,
      y: which === "y" ? { ...axisY, title: text } : axisY,
    });
  };

  // availableSeries が空でも、ユーザーが将来データを得たときの上書きを保持できるよう
  // 既存 seriesMap のキーを補完表示する。
  const seriesKeys = useMemo(() => {
    const set = new Set();
    (availableSeries || []).forEach((s) => { if (s) set.add(s); });
    Object.keys(seriesMap).forEach((k) => set.add(k));
    return Array.from(set);
  }, [availableSeries, seriesMap]);

  const dashStr = dashToString(ls.borderDash);
  const isDashPreset = DASH_PRESETS.some((p) => p.value === dashStr);

  return (
    <div style={{ marginBottom: "10px", padding: "8px 10px", border: "1px solid var(--nf-border)", borderRadius: 4 }}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="nf-btn-outline"
          style={{ fontSize: "12px", padding: "2px 8px" }}
        >
          {open ? "▼" : "▶"} グラフ見た目（色・線・形・軸ラベル）{isCsUnset ? "" : " ★"}
        </button>
        {!isCsUnset && (
          <button
            type="button"
            onClick={resetChartStyle}
            className="nf-btn-outline"
            style={{ fontSize: "11px", padding: "2px 8px" }}
            title="タイトル / 凡例 / グリッド / 背景 / 余白 などを既定に戻す"
          >
            見た目を既定に戻す
          </button>
        )}
      </div>
      {open && (
        <div style={{ marginTop: "10px", display: "flex", flexDirection: "column", gap: "10px" }}>
          {showLineControls && (
            <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center" }}>
              <span style={HEADER_LABEL_STYLE}>折れ線:</span>
              <label style={LABEL_STYLE}>
                線の形
                <select
                  className="nf-input"
                  value={ls.curve}
                  onChange={(e) => setLine({ curve: e.target.value })}
                  style={{ marginLeft: 4 }}
                >
                  {CURVE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
              <label style={LABEL_STYLE}>
                線種
                <select
                  className="nf-input"
                  value={isDashPreset ? dashStr : "__custom__"}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "__custom__") return;
                    setLine({ borderDash: stringToDash(v) });
                  }}
                  style={{ marginLeft: 4 }}
                >
                  {DASH_PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                  {!isDashPreset && <option value="__custom__">カスタム</option>}
                </select>
              </label>
              <label style={LABEL_STYLE} title="例: 5,5 = 破線 / 2,3 = 点線">
                カスタム線種
                <input
                  className="nf-input"
                  type="text"
                  value={dashStr}
                  onChange={(e) => setLine({ borderDash: stringToDash(e.target.value) })}
                  placeholder="例: 5,5"
                  style={{ width: 90, marginLeft: 4 }}
                />
              </label>
            </div>
          )}

          {showPointControls && (
            <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center" }}>
              <span style={HEADER_LABEL_STYLE}>ポイント:</span>
              <label style={LABEL_STYLE}>
                形状
                <select
                  className="nf-input"
                  value={ls.pointStyle}
                  onChange={(e) => setLine({ pointStyle: e.target.value })}
                  style={{ marginLeft: 4 }}
                >
                  {POINT_STYLE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
              <label style={LABEL_STYLE}>
                サイズ
                <input
                  className="nf-input"
                  type="number"
                  min="0"
                  max="20"
                  value={ls.pointRadius}
                  onChange={(e) => setLine({ pointRadius: Number(e.target.value) })}
                  style={{ width: 60, marginLeft: 4 }}
                />
              </label>
            </div>
          )}

          {showAxisLabels && (
            <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center" }}>
              <span style={HEADER_LABEL_STYLE}>軸ラベル:</span>
              <label style={LABEL_STYLE}>
                X 軸
                <input
                  className="nf-input"
                  type="text"
                  value={axisX.title || ""}
                  onChange={(e) => setAxisTitle("x", e.target.value)}
                  placeholder="例: 月"
                  style={{ width: 140, marginLeft: 4 }}
                />
              </label>
              <label style={LABEL_STYLE}>
                Y 軸
                <input
                  className="nf-input"
                  type="text"
                  value={axisY.title || ""}
                  onChange={(e) => setAxisTitle("y", e.target.value)}
                  placeholder="例: 頭数"
                  style={{ width: 140, marginLeft: 4 }}
                />
              </label>
            </div>
          )}

          {showSeriesColors && (
            <div>
              <div style={{ marginBottom: 4 }}>
                <span style={HEADER_LABEL_STYLE}>
                  {isPieLike(vizType) ? "セグメント色:" : "系列色:"}
                </span>
                <span className="nf-text-subtle" style={{ fontSize: 11, marginLeft: 8 }}>
                  未指定は既定パレットから自動割当
                </span>
              </div>
              {seriesKeys.length === 0 ? (
                <p className="nf-text-subtle" style={{ fontSize: 11, margin: "4px 0" }}>
                  ※ クエリ実行後に系列名が表示されます。
                </p>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 6 }}>
                  {seriesKeys.map((key, i) => {
                    const overridden = !!seriesMap[key]?.color;
                    const colorValue = seriesMap[key]?.color || CHART_PALETTE[i % CHART_PALETTE.length];
                    return (
                      <div key={key} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                        <input
                          type="color"
                          value={colorValue}
                          onChange={(e) => setSeriesColor(key, e.target.value)}
                          style={{ verticalAlign: "middle" }}
                        />
                        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={key}>
                          {key}
                        </span>
                        {overridden && (
                          <button
                            type="button"
                            onClick={() => resetSeriesColor(key)}
                            title="既定パレットに戻す"
                            style={RESET_BUTTON_STYLE}
                          >×</button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <div style={{ paddingTop: 8, borderTop: "1px dashed var(--nf-border)", display: "flex", flexDirection: "column", gap: "10px" }}>
            <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center" }}>
              <span style={HEADER_LABEL_STYLE}>タイトル:</span>
              <label style={LABEL_STYLE}>
                テキスト
                <input
                  className="nf-input"
                  type="text"
                  value={cs.title.text}
                  onChange={(e) => setCsPath(["title", "text"], e.target.value)}
                  placeholder="例: 月別売上"
                  style={{ width: 200, marginLeft: 4 }}
                />
              </label>
              <label style={LABEL_STYLE}>
                文字サイズ
                <input
                  className="nf-input"
                  type="number"
                  min="8"
                  max="48"
                  value={cs.title.fontSize}
                  onChange={(e) => setCsPath(["title", "fontSize"], Number(e.target.value))}
                  style={{ width: 60, marginLeft: 4 }}
                />
              </label>
              <label style={LABEL_STYLE}>
                文字色
                <input
                  type="color"
                  value={cs.title.color || "#222222"}
                  onChange={(e) => setCsPath(["title", "color"], e.target.value)}
                  style={{ marginLeft: 4, verticalAlign: "middle" }}
                />
                <button
                  type="button"
                  onClick={() => setCsPath(["title", "color"], "")}
                  title="既定に戻す"
                  style={RESET_BUTTON_STYLE}
                >×</button>
              </label>
            </div>

            <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center" }}>
              <span style={HEADER_LABEL_STYLE}>凡例:</span>
              <label style={LABEL_STYLE}>
                位置
                <select
                  className="nf-input"
                  value={cs.legend.position}
                  onChange={(e) => setCsPath(["legend", "position"], e.target.value)}
                  style={{ marginLeft: 4 }}
                >
                  {LEGEND_POSITION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
              <label style={{ ...LABEL_STYLE, opacity: cs.legend.position === "hidden" ? 0.5 : 1 }}>
                文字サイズ
                <input
                  className="nf-input"
                  type="number"
                  min="8"
                  max="32"
                  value={cs.legend.fontSize}
                  disabled={cs.legend.position === "hidden"}
                  onChange={(e) => setCsPath(["legend", "fontSize"], Number(e.target.value))}
                  style={{ width: 60, marginLeft: 4 }}
                />
              </label>
              <label style={{ ...LABEL_STYLE, opacity: cs.legend.position === "hidden" ? 0.5 : 1 }}>
                文字色
                <input
                  type="color"
                  value={cs.legend.color || "#222222"}
                  disabled={cs.legend.position === "hidden"}
                  onChange={(e) => setCsPath(["legend", "color"], e.target.value)}
                  style={{ marginLeft: 4, verticalAlign: "middle" }}
                />
                <button
                  type="button"
                  onClick={() => setCsPath(["legend", "color"], "")}
                  disabled={cs.legend.position === "hidden"}
                  title="既定に戻す"
                  style={RESET_BUTTON_STYLE}
                >×</button>
              </label>
            </div>

            {showAxisCustomization && (
              <>
                <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center" }}>
                  <span style={HEADER_LABEL_STYLE}>グリッド:</span>
                  <label style={LABEL_STYLE}>
                    <input
                      type="checkbox"
                      checked={cs.grid.x.display}
                      onChange={(e) => setCsPath(["grid", "x", "display"], e.target.checked)}
                      style={{ marginRight: 4 }}
                    />
                    X 軸グリッド
                  </label>
                  <label style={{ ...LABEL_STYLE, opacity: cs.grid.x.display ? 1 : 0.5 }}>
                    色
                    <input
                      type="color"
                      value={cs.grid.x.color || "#e5e5e5"}
                      disabled={!cs.grid.x.display}
                      onChange={(e) => setCsPath(["grid", "x", "color"], e.target.value)}
                      style={{ marginLeft: 4, verticalAlign: "middle" }}
                    />
                    <button
                      type="button"
                      onClick={() => setCsPath(["grid", "x", "color"], "")}
                      disabled={!cs.grid.x.display}
                      title="既定に戻す"
                      style={RESET_BUTTON_STYLE}
                    >×</button>
                  </label>
                  <label style={LABEL_STYLE}>
                    <input
                      type="checkbox"
                      checked={cs.grid.y.display}
                      onChange={(e) => setCsPath(["grid", "y", "display"], e.target.checked)}
                      style={{ marginRight: 4 }}
                    />
                    Y 軸グリッド
                  </label>
                  <label style={{ ...LABEL_STYLE, opacity: cs.grid.y.display ? 1 : 0.5 }}>
                    色
                    <input
                      type="color"
                      value={cs.grid.y.color || "#e5e5e5"}
                      disabled={!cs.grid.y.display}
                      onChange={(e) => setCsPath(["grid", "y", "color"], e.target.value)}
                      style={{ marginLeft: 4, verticalAlign: "middle" }}
                    />
                    <button
                      type="button"
                      onClick={() => setCsPath(["grid", "y", "color"], "")}
                      disabled={!cs.grid.y.display}
                      title="既定に戻す"
                      style={RESET_BUTTON_STYLE}
                    >×</button>
                  </label>
                </div>

                <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center" }}>
                  <span style={HEADER_LABEL_STYLE}>軸目盛:</span>
                  <label style={LABEL_STYLE}>
                    文字サイズ
                    <input
                      className="nf-input"
                      type="number"
                      min="8"
                      max="24"
                      value={cs.tick.fontSize}
                      onChange={(e) => setCsPath(["tick", "fontSize"], Number(e.target.value))}
                      style={{ width: 60, marginLeft: 4 }}
                    />
                  </label>
                  <label style={LABEL_STYLE}>
                    文字色
                    <input
                      type="color"
                      value={cs.tick.color || "#222222"}
                      onChange={(e) => setCsPath(["tick", "color"], e.target.value)}
                      style={{ marginLeft: 4, verticalAlign: "middle" }}
                    />
                    <button
                      type="button"
                      onClick={() => setCsPath(["tick", "color"], "")}
                      title="既定に戻す"
                      style={RESET_BUTTON_STYLE}
                    >×</button>
                  </label>
                  <span style={{ width: 12 }} />
                  <span style={HEADER_LABEL_STYLE}>軸タイトル:</span>
                  <label style={LABEL_STYLE}>
                    文字サイズ
                    <input
                      className="nf-input"
                      type="number"
                      min="8"
                      max="24"
                      value={cs.axisTitle.fontSize}
                      onChange={(e) => setCsPath(["axisTitle", "fontSize"], Number(e.target.value))}
                      style={{ width: 60, marginLeft: 4 }}
                    />
                  </label>
                  <label style={LABEL_STYLE}>
                    文字色
                    <input
                      type="color"
                      value={cs.axisTitle.color || "#222222"}
                      onChange={(e) => setCsPath(["axisTitle", "color"], e.target.value)}
                      style={{ marginLeft: 4, verticalAlign: "middle" }}
                    />
                    <button
                      type="button"
                      onClick={() => setCsPath(["axisTitle", "color"], "")}
                      title="既定に戻す"
                      style={RESET_BUTTON_STYLE}
                    >×</button>
                  </label>
                </div>
              </>
            )}

            <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center" }}>
              <span style={HEADER_LABEL_STYLE}>背景:</span>
              <label style={LABEL_STYLE}>
                色
                <input
                  type="color"
                  value={cs.background || "#ffffff"}
                  onChange={(e) => setCs({ background: e.target.value })}
                  style={{ marginLeft: 4, verticalAlign: "middle" }}
                />
                <button
                  type="button"
                  onClick={() => setCs({ background: "" })}
                  title="背景色を未指定（透明）に戻す"
                  style={RESET_BUTTON_STYLE}
                >×</button>
              </label>
              <span style={{ width: 12 }} />
              <span style={HEADER_LABEL_STYLE}>余白 (px):</span>
              <label style={LABEL_STYLE}>
                上
                <input
                  className="nf-input"
                  type="number"
                  min="0"
                  max="80"
                  value={cs.padding.top}
                  onChange={(e) => setCsPath(["padding", "top"], Number(e.target.value))}
                  style={{ width: 56, marginLeft: 4 }}
                />
              </label>
              <label style={LABEL_STYLE}>
                右
                <input
                  className="nf-input"
                  type="number"
                  min="0"
                  max="80"
                  value={cs.padding.right}
                  onChange={(e) => setCsPath(["padding", "right"], Number(e.target.value))}
                  style={{ width: 56, marginLeft: 4 }}
                />
              </label>
              <label style={LABEL_STYLE}>
                下
                <input
                  className="nf-input"
                  type="number"
                  min="0"
                  max="80"
                  value={cs.padding.bottom}
                  onChange={(e) => setCsPath(["padding", "bottom"], Number(e.target.value))}
                  style={{ width: 56, marginLeft: 4 }}
                />
              </label>
              <label style={LABEL_STYLE}>
                左
                <input
                  className="nf-input"
                  type="number"
                  min="0"
                  max="80"
                  value={cs.padding.left}
                  onChange={(e) => setCsPath(["padding", "left"], Number(e.target.value))}
                  style={{ width: 56, marginLeft: 4 }}
                />
              </label>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
