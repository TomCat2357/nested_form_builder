import React, { useMemo, useState, useEffect } from "react";
import ChartRenderer from "./ChartRenderer.jsx";
import AxisRangeControls from "./AxisRangeControls.jsx";
import TableStyleControls from "./TableStyleControls.jsx";
import ChartStyleControls, { isChartStyleSupported } from "./ChartStyleControls.jsx";
import ResizablePreview from "./ResizablePreview.jsx";
import { CHART_AXIS_REQUIREMENTS, VIZ_TYPES } from "../utils/suggestChartType.js";
import { filterDisplayColumns, getColumnDisplayLabel, resolveColumnKey, rawYFieldsToDisplay, displayYFieldsToRaw } from "../utils/metaColumnDisplay.js";
import { detectColumnType, getValueColumnsForAgg } from "../utils/columnValueInference.js";
import { AGG_TYPE_MATRIX } from "../utils/aggregationCompatibility.js";
import { detectAxisTypes } from "../utils/axisTypes.js";

const CHECKBOX_MAX_COLUMNS = 20;

const CHART_FILL_CONTAINER_STYLE = { position: "relative", width: "100%", height: "100%" };

function parseYFields(text) {
  return text.split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * クエリ実行結果に対する可視化選択 + チャート描画。
 * クエリ組み立て（StagesPanel / SQL textarea）からは独立。
 *
 * vizOptions は format / goal / pivot / geo などタイプ固有の追加設定。
 * onVizOptionsChange((prev) => next) で更新する。
 */
export default function VisualizePanel({
  vizType,
  xField,
  yFields,
  onVizTypeChange,
  onXFieldChange,
  onYFieldsChange,
  result,
  viz,
  compiledColumns,
  heatmap,
  onHeatmapChange,
  vizOptions,
  onVizOptionsChange,
}) {
  const [yInputMode, setYInputMode] = useState("text");
  const fallbackTypeMap = result?.fallbackTypeMap || null;

  const availableColumns = useMemo(
    () => filterDisplayColumns(result?.columns),
    [result]
  );

  // 候補となる条件 (detectColumnType に委譲):
  //   1. compiledColumns の type / role (compileStages または inferCompiledColumnsFromSql が構築)
  //   2. result.fallbackTypeMap (フォーム schema 由来の AlaSQL safe key → 型) — compiledColumns で
  //      解決できなかった列の補完。SQL モードで複合式の出力列はここでも解決できないため degrade する。
  //   3. FIXED_DATE_KEYS (createdAt 等) は常に date
  //   4. それ以外は型不明 → 候補から外れて UI は自由入力に degrade
  const valueColumns = useMemo(() => {
    return availableColumns.filter((name) => {
      const t = detectColumnType(compiledColumns, name, fallbackTypeMap);
      return t === "number" || t === "date";
    });
  }, [compiledColumns, availableColumns, fallbackTypeMap]);

  // 軸スケール UI 用の x/y 軸型と表示フラグ。yFields 未指定時はエディタでは軸 UI を出さない (yTypeWhenEmpty: null)。
  const { xAxisType, yAxisType, showAxis: showAxisControls, showX: showAxisX, showY: showAxisY } = useMemo(
    () => detectAxisTypes({
      type: vizType,
      xField,
      yFields: parseYFields(yFields),
      columns: availableColumns,
      compiledColumns,
      fallbackTypeMap,
      yTypeWhenEmpty: null,
    }),
    [vizType, xField, yFields, availableColumns, compiledColumns, fallbackTypeMap]
  );

  const canUseCheckbox = valueColumns.length > 0 && valueColumns.length <= CHECKBOX_MAX_COLUMNS;

  // チェックボックスモードを保てなくなったら自動で text に戻す
  useEffect(() => {
    if (yInputMode === "checkbox" && !canUseCheckbox) setYInputMode("text");
  }, [yInputMode, canUseCheckbox]);

  const req = CHART_AXIS_REQUIREMENTS[vizType] || CHART_AXIS_REQUIREMENTS.table;

  // ChartStyleControls の表示対象（line/bar/pie/scatter 系のみ）
  const showChartStyleControls = isChartStyleSupported(vizType);

  // 系列キー一覧: pie/donut は xField 列の値（カテゴリ）、それ以外は yFields。
  // クエリ実行前は空配列でも UI 側は「※ クエリ実行後に系列名が表示されます」と案内する。
  // NOTE: `if (!result) return null` より前で呼び出して Hook 数を安定させる（React error #310 対策）
  const availableSeriesForStyle = useMemo(() => {
    if (!showChartStyleControls) return [];
    if (vizType === "pie" || vizType === "donut") {
      const rows = result?.rows || [];
      const xKey = resolveColumnKey(xField, availableColumns, compiledColumns);
      if (!xKey) return [];
      const set = new Set();
      rows.forEach((r) => {
        const v = r?.[xKey];
        if (v === null || v === undefined) return;
        set.add(String(v));
      });
      return Array.from(set);
    }
    // line / bar / scatter 系: yFields をそのまま系列キーに使う
    return parseYFields(yFields)
      .map((f) => resolveColumnKey(f, availableColumns, compiledColumns))
      .filter(Boolean);
  }, [showChartStyleControls, vizType, result, xField, yFields, availableColumns, compiledColumns]);

  if (!result) return null;

  const xLabel = req.xLabel || "X 軸";
  const yLabel = req.yLabel || (req.y === "single" ? "値の列" : "Y 軸（カンマ区切り）");
  const datalistId = "viz-cols-" + (valueColumns.length || 0);

  const selectedYSet = new Set(parseYFields(yFields).map((f) => resolveColumnKey(f, availableColumns, compiledColumns)));

  const handleCheckboxToggle = (col) => {
    const current = parseYFields(yFields);
    let next;
    if (current.includes(col)) {
      next = current.filter((c) => c !== col);
    } else {
      next = [...current, col];
    }
    onYFieldsChange(next.join(","));
  };

  const showYInputModeToggle = req.y === "multi";
  const showHeatmapControls = vizType === "table";

  return (
    <div>
      <label className="nf-label">可視化</label>
      <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "10px" }}>
        <div>
          <span style={{ fontSize: "12px", marginRight: "6px" }}>グラフ種別</span>
          <select className="nf-input" value={vizType} onChange={(e) => onVizTypeChange(e.target.value)}>
            {VIZ_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        {req.x && (
          <div>
            <span style={{ fontSize: "12px", marginRight: "6px" }}>{xLabel}</span>
            {availableColumns.length > 0 ? (
              <select
                className="nf-input"
                value={resolveColumnKey(xField, availableColumns, compiledColumns)}
                onChange={(e) => onXFieldChange(e.target.value)}
                style={{ minWidth: "140px" }}
              >
                <option value="">列を選択...</option>
                {availableColumns.map((c) => <option key={c} value={c}>{getColumnDisplayLabel(c, compiledColumns)}</option>)}
              </select>
            ) : (
              <input
                className="nf-input"
                type="text"
                value={xField}
                onChange={(e) => onXFieldChange(e.target.value)}
                placeholder="列名"
                style={{ width: "120px" }}
              />
            )}
          </div>
        )}
        {req.y === "single" && (
          <div>
            <span style={{ fontSize: "12px", marginRight: "6px" }}>{yLabel}</span>
            {valueColumns.length > 0 ? (
              <select
                className="nf-input"
                value={resolveColumnKey(parseYFields(yFields)[0] || "", availableColumns, compiledColumns)}
                onChange={(e) => onYFieldsChange(e.target.value)}
                style={{ minWidth: "140px" }}
              >
                <option value="">列を選択...</option>
                {valueColumns.map((c) => <option key={c} value={c}>{getColumnDisplayLabel(c, compiledColumns)}</option>)}
              </select>
            ) : (
              <input
                className="nf-input"
                type="text"
                value={rawYFieldsToDisplay(yFields, compiledColumns)}
                onChange={(e) => onYFieldsChange(displayYFieldsToRaw(e.target.value, availableColumns, compiledColumns))}
                placeholder={valueColumns.length > 0 ? getColumnDisplayLabel(valueColumns[0], compiledColumns) : "列名"}
                style={{ width: "160px" }}
              />
            )}
          </div>
        )}
        {req.y === "multi" && (
          <div>
            <span style={{ fontSize: "12px", marginRight: "6px" }}>{yLabel}</span>
            {yInputMode === "text" ? (
              <input
                className="nf-input"
                type="text"
                value={rawYFieldsToDisplay(yFields, compiledColumns)}
                onChange={(e) => onYFieldsChange(displayYFieldsToRaw(e.target.value, availableColumns, compiledColumns))}
                placeholder={valueColumns.length > 0 ? valueColumns.slice(0, 2).map((c) => getColumnDisplayLabel(c, compiledColumns)).join(",") : "列名1,列名2"}
                style={{ width: "240px" }}
                list={valueColumns.length > 0 ? datalistId : undefined}
              />
            ) : null}
            {valueColumns.length > 0 && (
              <datalist id={datalistId}>
                {valueColumns.map((c) => {
                  const label = getColumnDisplayLabel(c, compiledColumns);
                  return <option key={c} value={label} label={label === c ? undefined : c} />;
                })}
              </datalist>
            )}
          </div>
        )}
      </div>

      {showYInputModeToggle && (
        <div style={{ marginBottom: "10px" }}>
          <span style={{ fontSize: "12px", marginRight: "8px" }}>Y 軸の入力方法</span>
          <label style={{ marginRight: "12px", fontSize: "12px" }}>
            <input
              type="radio"
              name="y-input-mode"
              value="text"
              checked={yInputMode === "text"}
              onChange={() => setYInputMode("text")}
              style={{ marginRight: "4px" }}
            />
            カンマ区切り入力
          </label>
          <label
            style={{ fontSize: "12px", opacity: canUseCheckbox ? 1 : 0.5 }}
            title={
              canUseCheckbox
                ? ""
                : valueColumns.length === 0
                  ? "数値・日付列の候補がありません"
                  : `候補が ${CHECKBOX_MAX_COLUMNS} 列を超えるため使用できません`
            }
          >
            <input
              type="radio"
              name="y-input-mode"
              value="checkbox"
              checked={yInputMode === "checkbox"}
              onChange={() => setYInputMode("checkbox")}
              disabled={!canUseCheckbox}
              style={{ marginRight: "4px" }}
            />
            チェックボックス選択
          </label>
          {yInputMode === "checkbox" && canUseCheckbox && (
            <div style={{ marginTop: "6px", display: "flex", flexWrap: "wrap", gap: "6px 14px", padding: "6px 10px", border: "1px solid var(--nf-border)", borderRadius: "4px" }}>
              {valueColumns.map((c) => (
                <label key={c} style={{ fontSize: "12px" }}>
                  <input
                    type="checkbox"
                    checked={selectedYSet.has(c)}
                    onChange={() => handleCheckboxToggle(c)}
                    style={{ marginRight: "4px" }}
                  />
                  {getColumnDisplayLabel(c, compiledColumns)}
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      {req.extras?.includes("format") && (
        <FormatControls
          format={vizOptions?.format}
          onChange={(format) => onVizOptionsChange?.({ ...(vizOptions || {}), format })}
        />
      )}
      {req.extras?.includes("goal") && (
        <GoalControl
          goal={vizOptions?.goal}
          onChange={(goal) => onVizOptionsChange?.({ ...(vizOptions || {}), goal })}
        />
      )}
      {req.extras?.includes("pivot") && (
        <PivotControls
          pivot={vizOptions?.pivot}
          availableColumns={availableColumns}
          compiledColumns={compiledColumns}
          fallbackTypeMap={fallbackTypeMap}
          onChange={(pivot) => onVizOptionsChange?.({ ...(vizOptions || {}), pivot })}
          isSunburst={vizType === "sunburst"}
        />
      )}
      {req.extras?.includes("geo") && (
        <GeoControls
          geo={vizOptions?.geo}
          availableColumns={availableColumns}
          valueColumns={valueColumns}
          vizType={vizType}
          onChange={(geo) => onVizOptionsChange?.({ ...(vizOptions || {}), geo })}
        />
      )}
      {req.extras?.includes("sankey") && (
        <SankeyControls
          sankey={vizOptions?.sankey}
          availableColumns={availableColumns}
          valueColumns={valueColumns}
          onChange={(sankey) => onVizOptionsChange?.({ ...(vizOptions || {}), sankey })}
        />
      )}
      {req.extras?.includes("tableStyle") && (
        <TableStyleControls
          tableStyle={vizOptions?.tableStyle}
          onChange={(tableStyle) => onVizOptionsChange?.({ ...(vizOptions || {}), tableStyle })}
          showHeatmap={showHeatmapControls}
          heatmap={heatmap}
          onHeatmapChange={onHeatmapChange}
          availableColumns={availableColumns}
        />
      )}

      {showAxisControls && (
        <AxisRangeControls
          axis={vizOptions?.axis}
          xType={xAxisType}
          yType={yAxisType}
          showX={showAxisX}
          showY={showAxisY}
          onChange={(axis) => onVizOptionsChange?.({ ...(vizOptions || {}), axis })}
        />
      )}

      {showChartStyleControls && (
        <ChartStyleControls
          vizType={vizType}
          lineStyle={vizOptions?.lineStyle}
          series={vizOptions?.series}
          axis={vizOptions?.axis}
          chartStyle={vizOptions?.chartStyle}
          availableSeries={availableSeriesForStyle}
          onLineStyleChange={(lineStyle) => onVizOptionsChange?.({ ...(vizOptions || {}), lineStyle })}
          onSeriesChange={(series) => onVizOptionsChange?.({ ...(vizOptions || {}), series })}
          onAxisChange={(axis) => onVizOptionsChange?.({ ...(vizOptions || {}), axis })}
          onChartStyleChange={(chartStyle) => onVizOptionsChange?.({ ...(vizOptions || {}), chartStyle })}
        />
      )}

      <ResizablePreview vizType={vizType}>
        <ChartRenderer
          viz={viz}
          rows={result.rows}
          columns={result.columns}
          compiledColumns={compiledColumns}
          fallbackTypeMap={fallbackTypeMap}
          sql={result?.compiledSql}
          containerStyle={CHART_FILL_CONTAINER_STYLE}
        />
      </ResizablePreview>
      <p className="nf-text-subtle" style={{ marginTop: "6px" }}>
        {result.rows.length} 行
      </p>
    </div>
  );
}

function FormatControls({ format, onChange }) {
  const f = format || {};
  const set = (patch) => onChange({ ...f, ...patch });
  return (
    <div style={{ marginBottom: "10px", display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
      <span style={{ fontSize: "12px", fontWeight: 600 }}>書式:</span>
      <label style={{ fontSize: "12px" }}>
        prefix
        <input className="nf-input" type="text" value={f.prefix || ""} onChange={(e) => set({ prefix: e.target.value })} style={{ width: 70, marginLeft: 4 }} />
      </label>
      <label style={{ fontSize: "12px" }}>
        suffix
        <input className="nf-input" type="text" value={f.suffix || ""} onChange={(e) => set({ suffix: e.target.value })} style={{ width: 70, marginLeft: 4 }} />
      </label>
      <label style={{ fontSize: "12px" }}>
        小数桁
        <input className="nf-input" type="number" min="0" max="10" value={f.decimals === null || f.decimals === undefined ? "" : f.decimals} onChange={(e) => set({ decimals: e.target.value === "" ? null : Number(e.target.value) })} style={{ width: 60, marginLeft: 4 }} />
      </label>
      <label style={{ fontSize: "12px" }}>
        ロケール
        <input className="nf-input" type="text" value={f.locale || ""} onChange={(e) => set({ locale: e.target.value })} placeholder="ja-JP" style={{ width: 80, marginLeft: 4 }} />
      </label>
    </div>
  );
}

function GoalControl({ goal, onChange }) {
  return (
    <div style={{ marginBottom: "10px", display: "flex", gap: "10px", alignItems: "center" }}>
      <span style={{ fontSize: "12px", fontWeight: 600 }}>目標値:</span>
      <input
        className="nf-input"
        type="number"
        value={goal === null || goal === undefined ? "" : goal}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        style={{ width: 140 }}
        placeholder="未設定"
      />
    </div>
  );
}

function PivotControls({ pivot, availableColumns, compiledColumns, fallbackTypeMap, onChange, isSunburst }) {
  const p = pivot || {};
  const currentAgg = p.agg || "sum";
  // 集計関数 (agg) に応じた値列候補。AGG_TYPE_MATRIX を単一情報源とする。
  //   - sum/avg → number / date のみ
  //   - count → 全列 (列任意で動作)
  //   - min/max → number / date / string
  const pivotValueColumns = useMemo(
    () => getValueColumnsForAgg(availableColumns, compiledColumns, fallbackTypeMap, currentAgg),
    [availableColumns, compiledColumns, fallbackTypeMap, currentAgg]
  );
  const set = (patch) => onChange({ ...p, ...patch });
  // agg 切替時に、現在の valueField が新 agg と非互換になる場合は解除する。
  // 型不明 (compiledColumns / fallback に無い) 列は許容のまま残す。
  const handleAggChange = (nextAgg) => {
    const spec = AGG_TYPE_MATRIX[nextAgg];
    const allowed = spec ? spec.allowedTypes : null;
    let nextValueField = p.valueField;
    if (nextValueField && allowed) {
      const t = detectColumnType(compiledColumns, nextValueField, fallbackTypeMap);
      if (t && !allowed.includes(t)) {
        nextValueField = "";
      }
    }
    set({ agg: nextAgg, valueField: nextValueField });
  };
  // 数値以外の値列を許容する集計か (UI の placeholder を切替えるため)
  const allowsNonNumeric = currentAgg === "count" || currentAgg === "min" || currentAgg === "max";
  return (
    <div style={{ marginBottom: "10px", padding: "8px 10px", border: "1px solid var(--nf-border)", borderRadius: 4, display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
      <span style={{ fontSize: "12px", fontWeight: 600 }}>{isSunburst ? "サンバースト:" : "ピボット:"}</span>
      <label style={{ fontSize: "12px" }}>
        {isSunburst ? "階層列 (カンマ区切り)" : "行 (rowField)"}
        <input className="nf-input" type="text" value={p.rowField || ""} onChange={(e) => set({ rowField: e.target.value })} placeholder={isSunburst ? "国,都道府県,市区町村" : "列名"} style={{ width: 200, marginLeft: 4 }} list="viz-cols-pivot" />
      </label>
      {!isSunburst && (
        <label style={{ fontSize: "12px" }}>
          列 (colField)
          <input className="nf-input" type="text" value={p.colField || ""} onChange={(e) => set({ colField: e.target.value })} placeholder="列名" style={{ width: 140, marginLeft: 4 }} list="viz-cols-pivot" />
        </label>
      )}
      <label style={{ fontSize: "12px" }}>
        値 (valueField)
        <input className="nf-input" type="text" value={p.valueField || ""} onChange={(e) => set({ valueField: e.target.value })} placeholder={allowsNonNumeric ? "列名 (任意)" : "数値列"} style={{ width: 140, marginLeft: 4 }} list="viz-cols-pivot-val" />
      </label>
      <label style={{ fontSize: "12px" }}>
        集計
        <select className="nf-input" value={currentAgg} onChange={(e) => handleAggChange(e.target.value)} style={{ marginLeft: 4 }}>
          <option value="sum">sum</option>
          <option value="count">count</option>
          <option value="avg">avg</option>
          <option value="min">min</option>
          <option value="max">max</option>
        </select>
      </label>
      <datalist id="viz-cols-pivot">
        {availableColumns.map((c) => <option key={c} value={c} />)}
      </datalist>
      <datalist id="viz-cols-pivot-val">
        {pivotValueColumns.map((c) => <option key={c} value={c} />)}
      </datalist>
    </div>
  );
}

function GeoControls({ geo, availableColumns, valueColumns, vizType, onChange }) {
  const g = geo || {};
  const set = (patch) => onChange({ ...g, ...patch });
  const isRegion = vizType === "regionMap";
  return (
    <div style={{ marginBottom: "10px", padding: "8px 10px", border: "1px solid var(--nf-border)", borderRadius: 4, display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
      <span style={{ fontSize: "12px", fontWeight: 600 }}>地理:</span>
      {!isRegion && (
        <>
          <label style={{ fontSize: "12px" }}>
            緯度列
            <input className="nf-input" type="text" value={g.latField || ""} onChange={(e) => set({ latField: e.target.value })} placeholder="lat" style={{ width: 120, marginLeft: 4 }} list="viz-cols-geo" />
          </label>
          <label style={{ fontSize: "12px" }}>
            経度列
            <input className="nf-input" type="text" value={g.lngField || ""} onChange={(e) => set({ lngField: e.target.value })} placeholder="lng" style={{ width: 120, marginLeft: 4 }} list="viz-cols-geo" />
          </label>
          {vizType === "gridMap" && (
            <label style={{ fontSize: "12px" }}>
              グリッドサイズ(度)
              <input className="nf-input" type="number" step="0.01" min="0.01" value={g.gridSize || 0.1} onChange={(e) => set({ gridSize: Number(e.target.value) || 0.1 })} style={{ width: 80, marginLeft: 4 }} />
            </label>
          )}
        </>
      )}
      {isRegion && (
        <label style={{ fontSize: "12px" }}>
          都道府県列
          <input className="nf-input" type="text" value={g.regionField || ""} onChange={(e) => set({ regionField: e.target.value })} placeholder="prefecture" style={{ width: 160, marginLeft: 4 }} list="viz-cols-geo" />
        </label>
      )}
      <label style={{ fontSize: "12px" }}>
        値列 (任意)
        <input className="nf-input" type="text" value={g.valueField || ""} onChange={(e) => set({ valueField: e.target.value })} placeholder="数値列" style={{ width: 120, marginLeft: 4 }} list="viz-cols-geo-val" />
      </label>
      <datalist id="viz-cols-geo">
        {availableColumns.map((c) => <option key={c} value={c} />)}
      </datalist>
      <datalist id="viz-cols-geo-val">
        {valueColumns.map((c) => <option key={c} value={c} />)}
      </datalist>
    </div>
  );
}

function SankeyControls({ sankey, availableColumns, valueColumns, onChange }) {
  const s = sankey || {};
  const set = (patch) => onChange({ ...s, ...patch });
  return (
    <div style={{ marginBottom: "10px", padding: "8px 10px", border: "1px solid var(--nf-border)", borderRadius: 4, display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
      <span style={{ fontSize: "12px", fontWeight: 600 }}>サンキー:</span>
      <label style={{ fontSize: "12px" }}>
        source 列
        <input className="nf-input" type="text" value={s.sourceField || ""} onChange={(e) => set({ sourceField: e.target.value })} style={{ width: 120, marginLeft: 4 }} list="viz-cols-sankey" />
      </label>
      <label style={{ fontSize: "12px" }}>
        target 列
        <input className="nf-input" type="text" value={s.targetField || ""} onChange={(e) => set({ targetField: e.target.value })} style={{ width: 120, marginLeft: 4 }} list="viz-cols-sankey" />
      </label>
      <label style={{ fontSize: "12px" }}>
        value 列
        <input className="nf-input" type="text" value={s.valueField || ""} onChange={(e) => set({ valueField: e.target.value })} style={{ width: 120, marginLeft: 4 }} list="viz-cols-sankey-val" />
      </label>
      <datalist id="viz-cols-sankey">
        {availableColumns.map((c) => <option key={c} value={c} />)}
      </datalist>
      <datalist id="viz-cols-sankey-val">
        {valueColumns.map((c) => <option key={c} value={c} />)}
      </datalist>
    </div>
  );
}
