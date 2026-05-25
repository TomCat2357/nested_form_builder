import React, { useRef, useState } from "react";
import { loadEcharts } from "../utils/cdnLoader.js";
import { useCancellable } from "../../../app/hooks/useCancellable.js";
import { buildSunburstTree } from "../utils/sunburstCompute.js";
import { buildSankeyData } from "../utils/sankeyCompute.js";

/**
 * EchartsRenderer — sunburst / sankey を描画する ECharts ラッパ。
 * 必要なときだけ ECharts を CDN ロードし、ResizeObserver でレスポンシブ対応する。
 */
export default function EchartsRenderer({ type, viz, rows, columns }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const [error, setError] = useState("");

  useCancellable(async (isCancelled, setCleanup) => {
    if (!rows || rows.length === 0) return;
    let resizeObserver = null;
    setCleanup(() => {
      if (resizeObserver) {
        try { resizeObserver.disconnect(); } catch (_e) { /* noop */ }
      }
      if (chartRef.current) {
        try { chartRef.current.dispose(); } catch (_e) { /* noop */ }
        chartRef.current = null;
      }
    });

    let echarts;
    try {
      echarts = await loadEcharts();
    } catch (err) {
      if (!isCancelled()) setError(err.message || String(err));
      return;
    }
    if (isCancelled() || !containerRef.current) return;

    const option = buildOption(type, viz, rows, columns);
    if (!option) {
      if (!isCancelled()) setError("可視化に必要な設定が不足しています。");
      return;
    }

    const inst = echarts.init(containerRef.current);
    inst.setOption(option);
    chartRef.current = inst;

    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => {
        if (chartRef.current) chartRef.current.resize();
      });
      resizeObserver.observe(containerRef.current);
    }
  }, [type, viz, rows, columns]);

  if (error) {
    return <p className="nf-text-warning">グラフ描画エラー: {error}</p>;
  }
  return <div ref={containerRef} style={{ width: "100%", height: 360 }} />;
}

function buildOption(type, viz, rows, columns) {
  if (type === "sunburst") {
    const cfg = viz?.pivot || {};
    const rawLevels = cfg.rowField || "";
    const levels = rawLevels.split(",").map((s) => s.trim()).filter(Boolean);
    if (levels.length === 0) return null;
    const valueField = cfg.valueField || "";
    const data = buildSunburstTree(rows, levels, valueField);
    if (data.length === 0) return null;
    return {
      tooltip: { trigger: "item", formatter: (p) => `${p.name}: ${p.value}` },
      series: [{
        type: "sunburst",
        data,
        radius: [0, "90%"],
        label: { rotate: "radial" },
        emphasis: { focus: "ancestor" },
      }],
    };
  }

  if (type === "sankey") {
    const cfg = viz?.sankey || {};
    if (!cfg.sourceField || !cfg.targetField) return null;
    const { nodes, links } = buildSankeyData(rows, cfg.sourceField, cfg.targetField, cfg.valueField || "");
    if (nodes.length === 0 || links.length === 0) return null;
    return {
      tooltip: { trigger: "item", formatter: (p) => p.name },
      series: [{
        type: "sankey",
        data: nodes,
        links,
        emphasis: { focus: "adjacency" },
        lineStyle: { color: "gradient", curveness: 0.5 },
      }],
    };
  }

  return null;
}
