import React, { useRef, useState } from "react";
import ResultTable from "./ResultTable.jsx";
import { useCancellable } from "../../../app/hooks/useCancellable.js";
import { loadChartJs } from "../utils/cdnLoader.js";
import { detectColumnType, getValueColumnsFromColumns } from "../utils/columnValueInference.js";
import { getColumnDisplayLabel, resolveColumnKey } from "../utils/metaColumnDisplay.js";
import { NumberView, DetailView, ProgressBarView, TrendView, GaugeView, FunnelView, WaterfallView } from "./SimpleVizRenderers.jsx";
import PivotTable from "./PivotTable.jsx";
import EchartsRenderer from "./EchartsRenderer.jsx";
import MapRenderer from "./MapRenderer.jsx";
import { resolveSeriesColor, normalizeChartStyle } from "../utils/chartPalette.js";
import { isPlainObject } from "../../../utils/objectShape.js";

// Chart.js を使わず HTML / SVG / Chart.js ラッパで描画する型。
// useEffect の Chart.js ロードをスキップするための判定にも使う。
const NON_CHARTJS_NATIVE_TYPES = new Set([
  "table", "scalar",
  "number", "detail", "progressBar", "trend", "gauge", "funnel", "waterfall",
  "pivotTable", "sunburst", "sankey", "pinMap", "gridMap", "regionMap",
]);

// pointStyle: "none" は Chart.js では無効 → pointRadius: 0 に変換する
function resolvePointStyle(lineStyle) {
  const ps = lineStyle?.pointStyle || "circle";
  return ps === "none" ? "circle" : ps;
}
function resolvePointRadius(lineStyle) {
  if (lineStyle?.pointStyle === "none") return 0;
  return typeof lineStyle?.pointRadius === "number" ? lineStyle.pointRadius : 3;
}

// axis.title を Chart.js の scale.title 形式へ
function axisTitleFor(axisCfg) {
  const text = axisCfg && typeof axisCfg.title === "string" ? axisCfg.title.trim() : "";
  return { display: !!text, text };
}

// スキーマ (compiledColumns) → fallbackTypeMap → FIXED_DATE_KEYS の順で列型を決定する。
// rows 走査による型推測は廃止し、schema を単一情報源とする。SQL モードでは
// inferCompiledColumnsFromSql が compiledColumns を構築し、解決できなかった列は
// フォーム schema 由来の fallbackTypeMap で補完する。複合式の出力列は最終的に
// null（型不明）となり UI 側で degrade する。
const getColumnType = (compiledColumns, name, fallbackTypeMap) =>
  detectColumnType(compiledColumns, name, fallbackTypeMap || null);

// viz.axis から min/max を Chart.js の scale 設定にマージ可能な形に変換する。
// auto:true / 値が無効 / 入力なし → {} を返す（既存の自動スケーリング維持）。
function axisRangeFor(axisCfg, columnType) {
  if (!axisCfg || axisCfg.auto !== false) return {};
  const norm = (v) => {
    if (v === null || v === undefined || v === "") return undefined;
    if (columnType === "date") {
      const d = v instanceof Date ? v : new Date(v);
      return Number.isFinite(d.getTime()) ? d : undefined;
    }
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  const out = {};
  const min = norm(axisCfg.min);
  const max = norm(axisCfg.max);
  if (min !== undefined) out.min = min;
  if (max !== undefined) out.max = max;
  return out;
}

// 列型に応じて軸に渡せる値へ正規化する。
// - date 列: Date オブジェクトに揃える (ISO 文字列 / epoch ms / Date 受け入れ)。Chart.js time scale が解釈する。
// - その他: 有限数値のみ通す。
// 値が無効・空白なら null を返し、呼び出し側でプロットから除外できるようにする。
function toAxisValue(raw, columnType) {
  if (raw === null || raw === undefined || raw === "") return null;
  if (columnType === "date") {
    const d = raw instanceof Date ? raw : (typeof raw === "number" ? new Date(raw) : new Date(String(raw)));
    return Number.isFinite(d.getTime()) ? d : null;
  }
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : null;
}

// viz.chartStyle が設定されている場合に Chart.js options に被せる差分を返す。
// scales 系のみ buildScaleStyle() で軸ごとに使う。
//
// 設定されていない場合は null を返し、呼び出し側で「適用しない」を判定できるようにする
// （既存 Question の見た目を保ったまま、新規にカスタムした分だけ反映されるのが目的）。
function buildChartStyleOverrides(viz) {
  if (!viz?.chartStyle) return null;
  const cs = normalizeChartStyle(viz.chartStyle);
  const plugins = {};
  const titleText = cs.title.text.trim();
  plugins.title = {
    display: !!titleText,
    text: titleText,
    font: { size: cs.title.fontSize },
  };
  if (cs.title.color) plugins.title.color = cs.title.color;
  const legendDisplay = cs.legend.position !== "hidden";
  plugins.legend = {
    display: legendDisplay,
    position: legendDisplay ? cs.legend.position : "top",
    labels: { font: { size: cs.legend.fontSize } },
  };
  if (cs.legend.color) plugins.legend.labels.color = cs.legend.color;
  const layout = { padding: { ...cs.padding } };
  return { plugins, layout, _cs: cs };
}

// 軸 (x または y) の scale 設定に被せる chartStyle 由来の差分。
// axisKey = "x" | "y"。chartStyle が無いときは null。
function buildScaleStyle(viz, axisKey) {
  if (!viz?.chartStyle) return null;
  const cs = normalizeChartStyle(viz.chartStyle);
  const gridCfg = cs.grid[axisKey] || cs.grid.x;
  const grid = { display: gridCfg.display };
  if (gridCfg.color) grid.color = gridCfg.color;
  const ticks = { font: { size: cs.tick.fontSize } };
  if (cs.tick.color) ticks.color = cs.tick.color;
  const titleFont = { font: { size: cs.axisTitle.fontSize } };
  if (cs.axisTitle.color) titleFont.color = cs.axisTitle.color;
  return { grid, ticks, titleFont };
}

// オブジェクトの深いマージ（plain object のみ。配列は置換）。
// scales: { x: { grid: {...}, ticks: {...} } } の階層マージに使う。
function mergeDeep(base, patch) {
  if (!patch) return base;
  if (!base) return patch;
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const k of Object.keys(patch)) {
    const bv = base[k];
    const pv = patch[k];
    if (isPlainObject(pv) && isPlainObject(bv)) {
      out[k] = mergeDeep(bv, pv);
    } else {
      out[k] = pv;
    }
  }
  return out;
}

// 軸 scale 設定に chartStyle 由来の {grid, ticks, titleFont} を被せる。
// 既存 scale.title (text 等) は維持しつつ font / color を追加する。
function applyAxisStyle(scale, axisStyle) {
  if (!axisStyle) return scale;
  const next = mergeDeep(scale, { grid: axisStyle.grid, ticks: axisStyle.ticks });
  if (next.title) {
    next.title = mergeDeep(next.title, axisStyle.titleFont);
  }
  return next;
}

function buildChartConfig(type, viz, rows, columns, compiledColumns, fallbackTypeMap) {
  const rawXField = viz?.xField || columns?.[0] || "";
  const xField = resolveColumnKey(rawXField, columns, compiledColumns);
  // Y 軸が空のとき: 数値・日付列のみをフォールバック対象にする (X 軸列は除外)。
  // これにより文字列列・メタ列が凡例に紛れ込まなくなる。
  // 旧設定で displayLabel ("数量 合計" 等) が yFields に入っているケースを resolveColumnKey で吸収する。
  const yFields = (viz?.yFields && viz.yFields.length > 0
    ? viz.yFields.map((f) => resolveColumnKey(f, columns, compiledColumns))
    : getValueColumnsFromColumns(columns, compiledColumns, fallbackTypeMap).filter((c) => c !== xField));
  const showLegend = viz?.showLegend !== false;
  const labels = rows.map((r) => r[xField] === null || r[xField] === undefined ? "" : String(r[xField]));

  if (type === "pie" || type === "donut") {
    const valueField = yFields[0] || "";
    const csOver = buildChartStyleOverrides(viz);
    // pie/donut の系列キーは各行の labels[i]（カテゴリ値）。viz.series で色上書き可。
    // chartStyle 未設定時は既存挙動どおり凡例を右に出してパイ本体を潰さない。
    const pieOptions = {
      responsive: true,
      maintainAspectRatio: false,
      cutout: type === "donut" ? "55%" : 0,
      plugins: { legend: { display: showLegend, position: "right" } },
    };
    return {
      type: "pie",
      data: {
        labels,
        datasets: [{
          data: rows.map((r) => r[valueField]),
          backgroundColor: labels.map((seg, i) => resolveSeriesColor(viz, seg, i)),
        }],
      },
      options: csOver ? mergeDeep(pieOptions, { plugins: csOver.plugins, layout: csOver.layout }) : pieOptions,
    };
  }

  if (type === "scatter") {
    const xType = getColumnType(compiledColumns, xField, fallbackTypeMap);
    const yTypes = yFields.map((f) => getColumnType(compiledColumns, f, fallbackTypeMap));
    const allYDate = yTypes.length > 0 && yTypes.every((t) => t === "date");
    const sLineStyle = viz?.lineStyle || null;
    const sPointStyle = resolvePointStyle(sLineStyle);
    const sPointRadius = sLineStyle?.pointStyle === "none"
      ? 0
      : (typeof sLineStyle?.pointRadius === "number" ? sLineStyle.pointRadius : 4);
    const datasets = yFields.map((field, i) => {
      const yType = getColumnType(compiledColumns, field, fallbackTypeMap);
      const points = [];
      for (const r of rows) {
        const x = toAxisValue(r[xField], xType);
        const y = toAxisValue(r[field], yType);
        if (x === null || y === null) continue;
        points.push({ x, y });
      }
      const color = resolveSeriesColor(viz, field, i);
      return {
        label: getColumnDisplayLabel(field, compiledColumns),
        data: points,
        backgroundColor: color,
        borderColor: color,
        pointStyle: sPointStyle,
        pointRadius: sPointRadius,
        showLine: false,
      };
    });
    // axis.title が空ならフィールド名を表示（既存挙動）、指定があればそれを優先
    const userXTitle = viz?.axis?.x?.title;
    const xTitleText = typeof userXTitle === "string" && userXTitle.trim()
      ? userXTitle.trim()
      : (xField ? getColumnDisplayLabel(xField, compiledColumns) : "");
    const userYTitle = viz?.axis?.y?.title;
    const yTitleText = typeof userYTitle === "string" && userYTitle.trim() ? userYTitle.trim() : "";
    const csOver = buildChartStyleOverrides(viz);
    const xAxisStyle = buildScaleStyle(viz, "x");
    const yAxisStyle = buildScaleStyle(viz, "y");
    const baseScaleX = {
      type: xType === "date" ? "time" : "linear",
      title: { display: !!xTitleText, text: xTitleText },
      ...axisRangeFor(viz?.axis?.x, xType),
    };
    const baseScaleY = allYDate
      ? { type: "time", title: { display: !!yTitleText, text: yTitleText }, ...axisRangeFor(viz?.axis?.y, "date") }
      : { beginAtZero: false, title: { display: !!yTitleText, text: yTitleText }, ...axisRangeFor(viz?.axis?.y, "number") };
    const baseOptions = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: showLegend } },
      scales: {
        x: applyAxisStyle(baseScaleX, xAxisStyle),
        y: applyAxisStyle(baseScaleY, yAxisStyle),
      },
    };
    return {
      type: "scatter",
      data: { datasets },
      options: csOver ? mergeDeep(baseOptions, { plugins: csOver.plugins, layout: csOver.layout }) : baseOptions,
    };
  }

  // bar / stackedBar / row / line / area / combo
  const yTypes = yFields.map((f) => getColumnType(compiledColumns, f, fallbackTypeMap));
  const allYDate = yTypes.length > 0 && yTypes.every((t) => t === "date");

  const isLineLike = type === "line" || type === "area";
  const isComboLike = type === "combo";
  const stacked = type === "stackedBar" || type === "area";
  const horizontal = type === "row";

  const lineStyle = viz?.lineStyle || null;
  // viz.lineStyle.curve: "linear" (カクカク=tension 0) / "smooth" (曲線=tension 0.4)
  const tension = lineStyle?.curve === "smooth" ? 0.4 : 0;
  const borderDash = Array.isArray(lineStyle?.borderDash) ? lineStyle.borderDash : [];
  const pointStyle = resolvePointStyle(lineStyle);
  const pointRadius = resolvePointRadius(lineStyle);

  const datasets = yFields.map((field, i) => {
    let seriesType;
    if (isComboLike) {
      seriesType = i === 0 ? "bar" : "line";
    } else if (isLineLike) {
      seriesType = "line";
    } else {
      seriesType = "bar";
    }
    const color = resolveSeriesColor(viz, field, i);
    const ds = {
      type: seriesType,
      label: getColumnDisplayLabel(field, compiledColumns),
      data: allYDate
        ? rows.map((r) => toAxisValue(r[field], "date"))
        : rows.map((r) => r[field]),
      backgroundColor: color,
      borderColor: color,
      borderWidth: seriesType === "line" ? 2 : 1,
      fill: type === "area",
      tension: seriesType === "line" ? tension : 0,
    };
    if (seriesType === "line") {
      ds.borderDash = borderDash;
      ds.pointStyle = pointStyle;
      ds.pointRadius = pointRadius;
      ds.pointBackgroundColor = color;
      ds.pointBorderColor = color;
    }
    return ds;
  });

  // Chart.js base type. Combo は "bar" を base にして dataset.type で混在させる。
  const baseType = isLineLike ? "line" : "bar";

  const yColumnType = allYDate ? "date" : "number";
  const yRange = axisRangeFor(viz?.axis?.y, yColumnType);
  // カテゴリ軸（横棒なら y、それ以外は x）のラベルが省略・クリップされないよう、
  // 回転と autoSkip パディングを明示する。ダッシュボードカードの低い高さでも
  // ラベルが消えないようにするのが主目的。
  const categoryTicks = { autoSkip: true, autoSkipPadding: 8, maxRotation: horizontal ? 0 : 60, minRotation: 0 };
  const valueScale = allYDate ? { type: "time", ...yRange } : { beginAtZero: true, ...yRange };
  const xTitle = axisTitleFor(viz?.axis?.x);
  const yTitle = axisTitleFor(viz?.axis?.y);
  let scales;
  if (stacked) {
    scales = {
      x: { stacked: true, ticks: categoryTicks, title: xTitle },
      y: { stacked: true, ...valueScale, title: yTitle },
    };
  } else if (horizontal) {
    // 横棒: x が値軸 / y がカテゴリ軸
    scales = {
      x: { ...valueScale, title: xTitle },
      y: { ticks: categoryTicks, title: yTitle },
    };
  } else {
    scales = {
      x: { ticks: categoryTicks, title: xTitle },
      y: { ...valueScale, title: yTitle },
    };
  }
  const csOver = buildChartStyleOverrides(viz);
  const xAxisStyle = buildScaleStyle(viz, "x");
  const yAxisStyle = buildScaleStyle(viz, "y");
  const baseOptions = {
    responsive: true,
    maintainAspectRatio: false,
    indexAxis: horizontal ? "y" : "x",
    plugins: { legend: { display: showLegend } },
    scales: {
      x: applyAxisStyle(scales.x, xAxisStyle),
      y: applyAxisStyle(scales.y, yAxisStyle),
    },
  };
  return {
    type: baseType,
    data: { labels, datasets },
    options: csOver ? mergeDeep(baseOptions, { plugins: csOver.plugins, layout: csOver.layout }) : baseOptions,
  };
}

const DEFAULT_CHART_CONTAINER_STYLE = { position: "relative", width: "100%", height: 300 };

export default function ChartRenderer({ viz, rows, columns, compiledColumns, fallbackTypeMap, onChartInstance, containerStyle, sql }) {
  const type = viz?.type || "table";
  const canvasRef = useRef(null);
  const chartRef = useRef(null);
  const [error, setError] = useState("");

  useCancellable(async (isCancelled, setCleanup) => {
    if (NON_CHARTJS_NATIVE_TYPES.has(type)) return;
    if (!rows || rows.length === 0) return;

    let createdChart = null;
    setCleanup(() => {
      if (createdChart) {
        try { createdChart.destroy(); } catch (_e) { /* noop */ }
      }
      if (chartRef.current === createdChart) chartRef.current = null;
      if (onChartInstance) onChartInstance(null);
    });

    try {
      const Chart = await loadChartJs();
      if (isCancelled() || !canvasRef.current) return;
      const config = buildChartConfig(type, viz, rows, columns, compiledColumns, fallbackTypeMap);
      createdChart = new Chart(canvasRef.current, config);
      chartRef.current = createdChart;
      if (onChartInstance) onChartInstance(createdChart);
    } catch (err) {
      if (!isCancelled()) setError(err.message || String(err));
    }
  }, [type, viz, rows, columns, compiledColumns, fallbackTypeMap, onChartInstance]);

  if (!rows || rows.length === 0) {
    return <p className="nf-text-subtle">データがありません。</p>;
  }

  if (type === "table") {
    return <ResultTable rows={rows} columns={columns} heatmap={viz?.heatmap} tableStyle={viz?.tableStyle} compiledColumns={compiledColumns} fallbackTypeMap={fallbackTypeMap} sql={sql} />;
  }

  if (type === "scalar") {
    const rawValueField = (viz?.yFields && viz.yFields[0]) || columns?.[0] || "";
    const valueField = resolveColumnKey(rawValueField, columns, compiledColumns);
    const raw = rows[0]?.[valueField];
    const display = raw === null || raw === undefined ? "—" : (typeof raw === "number" ? raw.toLocaleString() : String(raw));
    return (
      <div style={{ textAlign: "center", padding: "24px" }}>
        <div style={{ fontSize: 48, fontWeight: 700, lineHeight: 1.1, color: "var(--nf-text)" }}>{display}</div>
        {valueField && <div className="nf-text-subtle" style={{ marginTop: 6, fontSize: 12 }}>{getColumnDisplayLabel(valueField, compiledColumns)}</div>}
        {rows.length > 1 && <div className="nf-text-subtle" style={{ marginTop: 4, fontSize: 11 }}>1 行目を表示（{rows.length} 行）</div>}
      </div>
    );
  }

  if (type === "number") return <NumberView rows={rows} columns={columns} viz={viz} />;
  if (type === "detail") return <DetailView rows={rows} columns={columns} />;
  if (type === "progressBar") return <ProgressBarView rows={rows} columns={columns} viz={viz} />;
  if (type === "trend") return <TrendView rows={rows} viz={viz} />;
  if (type === "gauge") return <GaugeView rows={rows} columns={columns} viz={viz} />;
  if (type === "funnel") return <FunnelView rows={rows} viz={viz} />;
  if (type === "waterfall") return <WaterfallView rows={rows} viz={viz} />;
  if (type === "pivotTable") return <PivotTable rows={rows} viz={viz} />;
  if (type === "sunburst" || type === "sankey") return <EchartsRenderer type={type} viz={viz} rows={rows} columns={columns} />;
  if (type === "pinMap" || type === "gridMap" || type === "regionMap") return <MapRenderer type={type} viz={viz} rows={rows} />;

  if (error) {
    return <p className="nf-text-warning">グラフ描画エラー: {error}</p>;
  }

  // chartStyle.background が空文字以外なら canvas コンテナの背景に適用する。
  // tableStyle.header.bg と同様に、空 = 既定（透明）。
  const csBg = viz?.chartStyle ? normalizeChartStyle(viz.chartStyle).background : "";
  const baseContainer = containerStyle || DEFAULT_CHART_CONTAINER_STYLE;
  const mergedContainer = csBg ? { ...baseContainer, backgroundColor: csBg } : baseContainer;
  return (
    <div style={mergedContainer}>
      <canvas ref={canvasRef} />
    </div>
  );
}
