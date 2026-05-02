import React, { useEffect, useMemo, useRef } from "react";
import echarts from "../echartsRegistry.js";

export function buildChartOption(widget, rows) {
  const chartType = widget.chart || "line";
  const encode = widget.encode || {};
  const xKey = encode.x;
  const yKeys = Array.isArray(encode.y) ? encode.y : (encode.y ? [encode.y] : []);

  const baseOption = {
    tooltip: { trigger: chartType === "pie" ? "item" : "axis" },
    legend: { show: yKeys.length > 1 || chartType === "pie" },
    ...(widget.options || {}),
  };

  if (chartType === "pie") {
    const nameKey = encode.name || xKey;
    const valueKey = encode.value || yKeys[0];
    return {
      ...baseOption,
      series: [
        {
          type: "pie",
          radius: "65%",
          data: rows.map((row) => ({ name: row?.[nameKey], value: row?.[valueKey] })),
        },
      ],
    };
  }

  return {
    ...baseOption,
    grid: { left: 48, right: 24, top: 48, bottom: 48, containLabel: true, ...(widget.options?.grid || {}) },
    xAxis: { type: "category", data: rows.map((row) => row?.[xKey]), ...(widget.options?.xAxis || {}) },
    yAxis: { type: "value", ...(widget.options?.yAxis || {}) },
    series: yKeys.map((yKey) => ({
      name: yKey,
      type: chartType === "scatter" ? "scatter" : chartType,
      data: rows.map((row) => row?.[yKey]),
    })),
  };
}

export default function EChartsWidget({ widget, rows, height = 320 }) {
  const containerRef = useRef(null);
  const instanceRef = useRef(null);

  const option = useMemo(() => buildChartOption(widget, Array.isArray(rows) ? rows : []), [widget, rows]);

  useEffect(() => {
    if (!containerRef.current) return undefined;
    if (!instanceRef.current) {
      instanceRef.current = echarts.init(containerRef.current);
    }
    instanceRef.current.setOption(option, true);
    const handleResize = () => instanceRef.current?.resize();
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [option]);

  useEffect(() => {
    return () => {
      if (instanceRef.current) {
        instanceRef.current.dispose();
        instanceRef.current = null;
      }
    };
  }, []);

  return (
    <div className="dashboard-widget dashboard-widget-echarts">
      {widget.title && <h4 className="dashboard-widget-title">{widget.title}</h4>}
      <div ref={containerRef} style={{ width: "100%", height }} />
    </div>
  );
}
