import React, { useEffect, useRef, useState } from "react";
import ResultTable from "./ResultTable.jsx";
import { loadChartJs } from "../utils/cdnLoader.js";

const COLORS = [
  "#4C7EFF", "#FF6B6B", "#48CFAD", "#FFCE54", "#A67FE6",
  "#FC6E51", "#37BC9B", "#E8B86D", "#5D9CEC", "#F6BB42",
];

function buildChartConfig(type, viz, rows, columns) {
  const xField = viz?.xField || columns?.[0] || "";
  const yFields = viz?.yFields && viz.yFields.length > 0 ? viz.yFields : (columns?.slice(1) || []);
  const showLegend = viz?.showLegend !== false;
  const labels = rows.map((r) => r[xField] === null || r[xField] === undefined ? "" : String(r[xField]));

  if (type === "pie") {
    const valueField = yFields[0] || "";
    return {
      type: "pie",
      data: {
        labels,
        datasets: [{
          data: rows.map((r) => r[valueField]),
          backgroundColor: rows.map((_, i) => COLORS[i % COLORS.length]),
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: showLegend } },
      },
    };
  }

  if (type === "scatter") {
    const datasets = yFields.map((field, i) => {
      const points = [];
      for (const r of rows) {
        const xRaw = r[xField];
        const yRaw = r[field];
        const xNum = Number(xRaw);
        const yNum = Number(yRaw);
        if (Number.isFinite(xNum) && Number.isFinite(yNum)) {
          points.push({ x: xNum, y: yNum });
        }
      }
      return {
        label: field,
        data: points,
        backgroundColor: COLORS[i % COLORS.length],
        borderColor: COLORS[i % COLORS.length],
        pointRadius: 4,
        showLine: false,
      };
    });
    return {
      type: "scatter",
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: showLegend } },
        scales: {
          x: { type: "linear", title: { display: !!xField, text: xField } },
          y: { beginAtZero: false },
        },
      },
    };
  }

  const datasets = yFields.map((field, i) => ({
    label: field,
    data: rows.map((r) => r[field]),
    backgroundColor: COLORS[i % COLORS.length],
    borderColor: COLORS[i % COLORS.length],
    borderWidth: type === "line" ? 2 : 1,
    fill: false,
    tension: 0.2,
  }));

  return {
    type, // "bar" | "line"
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: showLegend } },
      scales: { y: { beginAtZero: true } },
    },
  };
}

export default function ChartRenderer({ viz, rows, columns }) {
  const type = viz?.type || "table";
  const canvasRef = useRef(null);
  const chartRef = useRef(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (type === "table" || type === "scalar") return;
    if (!rows || rows.length === 0) return;

    let cancelled = false;
    let createdChart = null;

    (async () => {
      try {
        const Chart = await loadChartJs();
        if (cancelled || !canvasRef.current) return;
        const config = buildChartConfig(type, viz, rows, columns);
        createdChart = new Chart(canvasRef.current, config);
        chartRef.current = createdChart;
      } catch (err) {
        if (!cancelled) setError(err.message || String(err));
      }
    })();

    return () => {
      cancelled = true;
      if (createdChart) {
        try { createdChart.destroy(); } catch (_e) { /* noop */ }
      }
      if (chartRef.current === createdChart) chartRef.current = null;
    };
  }, [type, viz, rows, columns]);

  if (!rows || rows.length === 0) {
    return <p className="nf-text-subtle">データがありません。</p>;
  }

  if (type === "table") {
    return <ResultTable rows={rows} columns={columns} />;
  }

  if (type === "scalar") {
    const valueField = (viz?.yFields && viz.yFields[0]) || columns?.[0] || "";
    const raw = rows[0]?.[valueField];
    const display = raw === null || raw === undefined ? "—" : (typeof raw === "number" ? raw.toLocaleString() : String(raw));
    return (
      <div style={{ textAlign: "center", padding: "24px" }}>
        <div style={{ fontSize: 48, fontWeight: 700, lineHeight: 1.1, color: "var(--nf-text)" }}>{display}</div>
        {valueField && <div className="nf-text-subtle" style={{ marginTop: 6, fontSize: 12 }}>{valueField}</div>}
        {rows.length > 1 && <div className="nf-text-subtle" style={{ marginTop: 4, fontSize: 11 }}>1 行目を表示（{rows.length} 行）</div>}
      </div>
    );
  }

  if (error) {
    return <p className="nf-text-warning">グラフ描画エラー: {error}</p>;
  }

  return (
    <div style={{ position: "relative", width: "100%", height: 300 }}>
      <canvas ref={canvasRef} />
    </div>
  );
}
