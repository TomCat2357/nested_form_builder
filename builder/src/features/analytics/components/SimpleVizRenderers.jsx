import React, { useRef } from "react";
import { useCancellable } from "../../../app/hooks/useCancellable.js";
import { loadChartJs } from "../utils/cdnLoader.js";
import { formatNumber, formatDeltaPercent } from "../utils/formatNumber.js";
import { computeTrend } from "../utils/trendCompute.js";
import { computeWaterfall } from "../utils/waterfallCompute.js";
import { getColumnDisplayLabel } from "../utils/metaColumnDisplay.js";
import { paletteColor } from "../utils/chartPalette.js";

/**
 * Number — 単一値を書式付きで大きく表示する。
 */
export function NumberView({ rows, columns, viz }) {
  const valueField = (viz?.yFields && viz.yFields[0]) || columns?.[0] || "";
  const raw = rows?.[0]?.[valueField];
  const display = formatNumber(raw, viz?.format);
  return (
    <div style={{ textAlign: "center", padding: "24px" }}>
      <div style={{ fontSize: 48, fontWeight: 700, lineHeight: 1.1, color: "var(--nf-text)" }}>{display}</div>
      {valueField && <div className="nf-text-subtle" style={{ marginTop: 6, fontSize: 12 }}>{getColumnDisplayLabel(valueField)}</div>}
    </div>
  );
}

/**
 * Detail — rows[0] の全列を key/value で縦並び表示。
 */
export function DetailView({ rows, columns }) {
  const r = rows?.[0] || {};
  const cols = Array.isArray(columns) ? columns : Object.keys(r);
  return (
    <div style={{ padding: "16px", overflow: "auto", maxHeight: 400 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <tbody>
          {cols.map((c) => (
            <tr key={c} style={{ borderBottom: "1px solid var(--nf-border)" }}>
              <th style={{ textAlign: "left", padding: "6px 10px", verticalAlign: "top", color: "var(--nf-text-subtle)", width: "30%" }}>
                {getColumnDisplayLabel(c)}
              </th>
              <td style={{ padding: "6px 10px", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                {r[c] === null || r[c] === undefined ? "—" : String(r[c])}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows && rows.length > 1 && (
        <p className="nf-text-subtle" style={{ marginTop: 8, fontSize: 11 }}>1 行目を表示（{rows.length} 行）</p>
      )}
    </div>
  );
}

/**
 * ProgressBar — 値 vs viz.goal の進捗バー。
 */
export function ProgressBarView({ rows, columns, viz }) {
  const valueField = (viz?.yFields && viz.yFields[0]) || columns?.[0] || "";
  const raw = rows?.[0]?.[valueField];
  const value = typeof raw === "number" ? raw : Number(raw);
  const goal = typeof viz?.goal === "number" ? viz.goal : Number(viz?.goal);
  const validGoal = Number.isFinite(goal) && goal > 0;
  const validValue = Number.isFinite(value);
  const ratio = validGoal && validValue ? Math.max(0, Math.min(1.5, value / goal)) : 0;
  const pctDisplay = validGoal && validValue ? (value / goal * 100).toFixed(1) + "%" : "—";
  const fillColor = ratio >= 1 ? "#37BC9B" : ratio >= 0.7 ? "#5D9CEC" : "#E8B86D";

  return (
    <div style={{ padding: "20px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 13 }}>
        <span>{formatNumber(value, viz?.format)}</span>
        <span className="nf-text-subtle">目標: {validGoal ? formatNumber(goal, viz?.format) : "未設定"}</span>
      </div>
      <div style={{ height: 24, background: "var(--nf-bg-subtle, #eee)", borderRadius: 4, overflow: "hidden", position: "relative" }}>
        <div style={{
          width: Math.min(100, ratio * 100) + "%",
          height: "100%",
          background: fillColor,
          transition: "width 200ms ease-out",
        }} />
        {ratio > 1 && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "flex-end", paddingRight: 8, fontSize: 11, fontWeight: 700, color: "#fff" }}>
            {Math.round(ratio * 100)}%
          </div>
        )}
      </div>
      <div style={{ marginTop: 8, fontSize: 12, color: "var(--nf-text-subtle)" }}>
        達成率: {pctDisplay}
      </div>
    </div>
  );
}

/**
 * Trend — 時系列の最新値 + 前回比 + ミニスパークライン (SVG)。
 */
export function TrendView({ rows, viz }) {
  const xField = viz?.xField || "";
  const yField = (viz?.yFields && viz.yFields[0]) || "";
  const trend = computeTrend(rows, xField, yField);
  const display = formatNumber(trend.current, viz?.format);
  const delta = formatDeltaPercent(trend.current, trend.previous);
  const isUp = trend.current !== null && trend.previous !== null && trend.current > trend.previous;
  const isDown = trend.current !== null && trend.previous !== null && trend.current < trend.previous;
  const deltaColor = isUp ? "#37BC9B" : isDown ? "#FF6B6B" : "var(--nf-text-subtle)";

  return (
    <div style={{ padding: "20px", textAlign: "center" }}>
      <div style={{ fontSize: 42, fontWeight: 700, lineHeight: 1.1 }}>{display}</div>
      {trend.previous !== null && (
        <div style={{ marginTop: 6, fontSize: 14, color: deltaColor }}>
          {isUp ? "▲" : isDown ? "▼" : "■"} {delta}
          <span className="nf-text-subtle" style={{ marginLeft: 8, fontSize: 11 }}>
            前回: {formatNumber(trend.previous, viz?.format)}
          </span>
        </div>
      )}
      {trend.sparkline.length >= 2 && <Sparkline values={trend.sparkline} />}
      {yField && <div className="nf-text-subtle" style={{ marginTop: 8, fontSize: 11 }}>{getColumnDisplayLabel(yField)}</div>}
    </div>
  );
}

function Sparkline({ values }) {
  const w = 200;
  const h = 40;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const dx = w / Math.max(values.length - 1, 1);
  const points = values.map((v, i) => `${i * dx},${h - ((v - min) / span) * h}`).join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ marginTop: 10, display: "block", marginLeft: "auto", marginRight: "auto" }}>
      <polyline points={points} fill="none" stroke="#4C7EFF" strokeWidth="2" />
    </svg>
  );
}

/**
 * Gauge — Chart.js doughnut を半円ゲージとして使う。
 * 値が viz.goal に対する達成率を可視化。
 */
export function GaugeView({ rows, columns, viz }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  const valueField = (viz?.yFields && viz.yFields[0]) || columns?.[0] || "";
  const raw = rows?.[0]?.[valueField];
  const value = typeof raw === "number" ? raw : Number(raw);
  const goal = typeof viz?.goal === "number" ? viz.goal : Number(viz?.goal);
  const validGoal = Number.isFinite(goal) && goal > 0;
  const validValue = Number.isFinite(value);
  const ratio = validGoal && validValue ? Math.max(0, Math.min(1, value / goal)) : 0;

  useCancellable(async (isCancelled, setCleanup) => {
    if (!validGoal || !validValue) return;
    let createdChart = null;
    setCleanup(() => {
      if (createdChart) {
        try { createdChart.destroy(); } catch (_e) { /* noop */ }
      }
    });
    try {
      const Chart = await loadChartJs();
      if (isCancelled() || !canvasRef.current) return;
      const fillColor = ratio >= 1 ? "#37BC9B" : ratio >= 0.7 ? "#5D9CEC" : "#E8B86D";
      createdChart = new Chart(canvasRef.current, {
        type: "doughnut",
        data: {
          datasets: [{
            data: [ratio, 1 - ratio],
            backgroundColor: [fillColor, "rgba(0,0,0,0.08)"],
            borderWidth: 0,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          rotation: -90,
          circumference: 180,
          cutout: "70%",
          plugins: { legend: { display: false }, tooltip: { enabled: false } },
        },
      });
      chartRef.current = createdChart;
    } catch (_e) { /* CDN ロード失敗時は静かに無視: 値は HTML で表示済み */ }
  }, [ratio, validGoal, validValue]);

  if (!validGoal || !validValue) {
    return (
      <div style={{ padding: 24, textAlign: "center" }}>
        <div style={{ fontSize: 36, fontWeight: 700 }}>{formatNumber(value, viz?.format)}</div>
        <div className="nf-text-subtle" style={{ fontSize: 12, marginTop: 6 }}>
          ゲージ表示には目標値の設定が必要です
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: "relative", width: "100%", height: 200, padding: "12px 0" }}>
      <canvas ref={canvasRef} />
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", paddingBottom: 18, pointerEvents: "none" }}>
        <div style={{ fontSize: 28, fontWeight: 700 }}>{formatNumber(value, viz?.format)}</div>
        <div className="nf-text-subtle" style={{ fontSize: 11, marginTop: 4 }}>
          目標 {formatNumber(goal, viz?.format)} ({(ratio * 100).toFixed(1)}%)
        </div>
      </div>
    </div>
  );
}

/**
 * Funnel — 各ステップの値を比率付き横バーで縦に並べる純 HTML。
 * xField にステップ名、yField に値。値は降順想定 (compileStages の orderBy で並べる)。
 */
export function FunnelView({ rows, viz }) {
  const xField = viz?.xField || "";
  const yField = (viz?.yFields && viz.yFields[0]) || "";
  if (!Array.isArray(rows) || rows.length === 0 || !yField) {
    return <p className="nf-text-subtle">データがありません。</p>;
  }
  const series = rows.map((r) => {
    const raw = r[yField];
    const n = typeof raw === "number" ? raw : Number(raw);
    return {
      label: r[xField] === null || r[xField] === undefined ? "" : String(r[xField]),
      value: Number.isFinite(n) ? n : 0,
    };
  });
  const top = series[0]?.value || 0;
  if (top <= 0) return <p className="nf-text-subtle">先頭ステップの値が 0 以下のため描画できません。</p>;

  return (
    <div style={{ padding: "16px" }}>
      {series.map((s, i) => {
        const ratio = s.value / top;
        const pct = (ratio * 100).toFixed(1);
        const dropPct = i === 0 ? null : ((1 - s.value / series[i - 1].value) * 100).toFixed(1);
        return (
          <div key={i} style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
            <div style={{ width: 120, fontSize: 12, paddingRight: 8, textAlign: "right", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.label}</div>
            <div style={{ flex: 1, position: "relative", height: 28, background: "var(--nf-bg-subtle, #eee)", borderRadius: 4, overflow: "hidden" }}>
              <div style={{ width: pct + "%", height: "100%", background: paletteColor(i), transition: "width 200ms ease-out" }} />
              <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", paddingLeft: 8, fontSize: 12, color: "var(--nf-text)", fontWeight: 600 }}>
                {formatNumber(s.value, viz?.format)} <span className="nf-text-subtle" style={{ marginLeft: 6, fontWeight: 400 }}>{pct}%</span>
              </div>
            </div>
            {dropPct !== null && (
              <div style={{ width: 60, fontSize: 11, color: "#FF6B6B", paddingLeft: 8 }}>−{dropPct}%</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Waterfall — Chart.js bar の floating bar (data: [start, end]) で累積遷移を表示。
 */
export function WaterfallView({ rows, viz }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);
  const xField = viz?.xField || "";
  const yField = (viz?.yFields && viz.yFields[0]) || "";

  useCancellable(async (isCancelled, setCleanup) => {
    if (!Array.isArray(rows) || rows.length === 0 || !yField) return;
    let createdChart = null;
    setCleanup(() => {
      if (createdChart) {
        try { createdChart.destroy(); } catch (_e) { /* noop */ }
      }
    });
    try {
      const Chart = await loadChartJs();
      if (isCancelled() || !canvasRef.current) return;
      const wf = computeWaterfall(rows, xField, yField);
      const colors = wf.bars.map((b) => b.kind === "up" ? "#37BC9B" : b.kind === "down" ? "#FF6B6B" : "#888");
      createdChart = new Chart(canvasRef.current, {
        type: "bar",
        data: {
          labels: wf.bars.map((b) => b.label),
          datasets: [{
            label: yField,
            data: wf.bars.map((b) => [b.start, b.end]),
            backgroundColor: colors,
            borderColor: colors,
            borderWidth: 1,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: { y: { beginAtZero: true } },
        },
      });
      chartRef.current = createdChart;
    } catch (_e) { /* noop */ }
  }, [rows, xField, yField]);

  if (!Array.isArray(rows) || rows.length === 0) {
    return <p className="nf-text-subtle">データがありません。</p>;
  }
  return (
    <div style={{ position: "relative", width: "100%", height: 320 }}>
      <canvas ref={canvasRef} />
    </div>
  );
}
