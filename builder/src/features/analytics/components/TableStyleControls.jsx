import React, { useId, useMemo, useState } from "react";
import {
  DEFAULT_TABLE_STYLE,
  DEFAULT_TRUNCATE_LENGTH,
  COLUMN_WIDTH_MIN,
  COLUMN_WIDTH_MAX,
  TRUNCATE_LENGTH_MIN,
  TRUNCATE_LENGTH_MAX,
  TABLE_BORDER_STYLES,
  ROW_OVERRIDE_EDGES,
  COLUMN_OVERRIDE_EDGES,
} from "../utils/tableStyle.js";
import { parseRowSelector, parseColumnSelector } from "../utils/tableStyleRowSelector.js";
import {
  applyAddOverride,
  applyUpdateOverride,
  applyRemoveOverride,
  applySetMinMaxWidth,
  applyAddColumnWidth,
  applyUpdateColumnWidth,
  applyRemoveColumnWidth,
} from "../utils/tableStyleMutations.js";
import HeatmapStyleControls from "./HeatmapStyleControls.jsx";
import { LABEL_STYLE, HEADER_LABEL_STYLE, RESET_BUTTON_STYLE } from "../utils/styleConstants.js";
import { useStylePathSetter } from "./useStylePathSetter.js";

const ROW_EDGE_LABELS = { top: "上", bottom: "下", both: "上下" };
const COLUMN_EDGE_LABELS = { left: "左", right: "右", both: "左右" };

const HELP_ICON_STYLE = { fontSize: 10, cursor: "help", opacity: 0.7, marginLeft: 4, userSelect: "none" };

// 列幅 UI のヘルプ文言。
// 列幅は常に content-adaptive (`table-layout: auto`)。各列はその列の最大文字数のセルに合わせて
// 自動で伸縮し、最小幅・最大幅でクランプされる。内容が最大幅を超えるセルは折り返し表示。
// 列ごとの幅は「優先幅」ヒントで、内容によって伸縮し得る。
const COLUMN_WIDTH_HELP =
  "列幅は内容に応じて自動で伸縮します。最小幅・最大幅を設定するとそれぞれの範囲にクランプされ、最大幅を超えるセルは折り返し表示されます。列ごとの幅は「優先幅」のヒントで、内容に応じて伸縮します。";
const TRUNCATE_HELP =
  "セルの文字列を N 文字で切り詰めて末尾に「…」を付けます。0 にすると省略しません。tooltip (hover) で全文を確認できます。未設定の場合は 50 文字。";

const ROW_SELECTOR_PLACEHOLDER = "AlaSQL の WHERE 式（true で適用）。例: `月` > 4 AND `日` = 30 / _dispRow IN (1,3,5) / `項目` = '対応件数'";
const COLUMN_SELECTOR_PLACEHOLDER = "例: 項目, 対応件数";

/**
 * テーブル見た目（罫線 / セル / ヘッダ / 縞模様 / ヒートマップ）の編集 UI。
 *
 * 罫線設定は「横 (行間) / 縦 (列間) の 2 系統」+ 「特定行・列のオーバーライド配列」。
 * オーバーライド 1 件 = { target: 'row'|'column', selector, edges, width, color, style }。
 * 行セレクタは AlaSQL の WHERE 節相当の式（隠し列 `_row` = ソート前 1-based、`_dispRow` = 表示行 1-based）。
 * 列セレクタはカンマ区切りの列名。
 */
export default function TableStyleControls({
  tableStyle,
  onChange,
  showHeatmap,
  heatmap,
  onHeatmapChange,
  availableColumns,
}) {
  const [open, setOpen] = useState(false);
  const isUnset = !tableStyle;
  const ts = tableStyle || DEFAULT_TABLE_STYLE;

  // 罫線オーバーライド / 列幅などの多段更新は cloneBase 経由、リーフ更新は setPath 経由。
  const { cloneBase, setPath } = useStylePathSetter(isUnset ? DEFAULT_TABLE_STYLE : tableStyle, onChange);

  // 罫線オーバーライド / 列幅の不変更新ロジックは tableStyleMutations.js（純関数）へ集約。
  // ここでは cloneBase() を渡し、戻り値を onChange へ流すだけ（更新系で null＝対象なしは no-op）。
  const addOverride = (target) => onChange(applyAddOverride(cloneBase(), target));

  const updateOverride = (idx, patch) => {
    const next = applyUpdateOverride(cloneBase(), idx, patch);
    if (next) onChange(next);
  };

  const removeOverride = (idx) => onChange(applyRemoveOverride(cloneBase(), idx));

  // 空文字 → null (未設定 sentinel)、数値 → Number()。normalize で範囲外はクランプ済み。
  const setMinMaxWidth = (key, value) => onChange(applySetMinMaxWidth(cloneBase(), key, value));

  const addColumnWidth = () => onChange(applyAddColumnWidth(cloneBase(), COLUMN_WIDTH_MIN));

  const updateColumnWidth = (idx, patch) => {
    const next = applyUpdateColumnWidth(cloneBase(), idx, patch);
    if (next) onChange(next);
  };

  const removeColumnWidth = (idx) => onChange(applyRemoveColumnWidth(cloneBase(), idx));

  const reset = () => onChange(null);

  return (
    <div style={{ marginBottom: "10px", padding: "8px 10px", border: "1px solid var(--nf-border)", borderRadius: 4 }}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="nf-btn-outline"
          style={{ fontSize: "12px", padding: "2px 8px" }}
        >
          {open ? "▼" : "▶"} テーブル見た目{isUnset ? " (未設定)" : ""}
        </button>
        {!isUnset && (
          <button
            type="button"
            onClick={reset}
            className="nf-btn-outline"
            style={{ fontSize: "11px", padding: "2px 8px" }}
          >
            既定に戻す
          </button>
        )}
      </div>
      {open && (
        <div style={{ marginTop: "10px", display: "grid", gridTemplateColumns: "max-content 1fr 1fr 1fr", gap: "8px 14px", alignItems: "center" }}>
          <BorderLineRow
            label="罫線 (横)"
            line={ts.border.horizontal}
            onChange={(patch) => setPath(["border", "horizontal", patch.key], patch.value)}
          />
          <BorderLineRow
            label="罫線 (縦)"
            line={ts.border.vertical}
            onChange={(patch) => setPath(["border", "vertical", patch.key], patch.value)}
          />

          <span style={HEADER_LABEL_STYLE}>セル:</span>
          <label style={LABEL_STYLE}>
            上下 padding
            <input
              className="nf-input"
              type="number"
              min="0"
              max="30"
              value={ts.cell.paddingY}
              onChange={(e) => setPath(["cell", "paddingY"], Number(e.target.value))}
              style={{ width: 60, marginLeft: 4 }}
            />
          </label>
          <label style={LABEL_STYLE}>
            左右 padding
            <input
              className="nf-input"
              type="number"
              min="0"
              max="30"
              value={ts.cell.paddingX}
              onChange={(e) => setPath(["cell", "paddingX"], Number(e.target.value))}
              style={{ width: 60, marginLeft: 4 }}
            />
          </label>
          <label style={LABEL_STYLE}>
            行高 (0=自動)
            <input
              className="nf-input"
              type="number"
              min="0"
              max="80"
              value={ts.cell.rowHeight}
              onChange={(e) => setPath(["cell", "rowHeight"], Number(e.target.value))}
              style={{ width: 70, marginLeft: 4 }}
            />
          </label>

          <span />
          <label style={LABEL_STYLE} title={TRUNCATE_HELP}>
            省略文字数 (0=しない)
            <span style={HELP_ICON_STYLE} title={TRUNCATE_HELP}>?</span>
            <input
              className="nf-input"
              type="number"
              min={TRUNCATE_LENGTH_MIN}
              max={TRUNCATE_LENGTH_MAX}
              value={ts.cell.truncateLength ?? DEFAULT_TRUNCATE_LENGTH}
              onChange={(e) => setPath(["cell", "truncateLength"], Number(e.target.value))}
              style={{ width: 70, marginLeft: 4 }}
              title={TRUNCATE_HELP}
            />
          </label>
          <span />
          <span />

          <span style={HEADER_LABEL_STYLE}>
            列幅:
            <span style={HELP_ICON_STYLE} title={COLUMN_WIDTH_HELP}>?</span>
          </span>
          <label style={LABEL_STYLE} title={COLUMN_WIDTH_HELP}>
            最小幅 (px)
            <input
              className="nf-input"
              type="number"
              min={COLUMN_WIDTH_MIN}
              max={COLUMN_WIDTH_MAX}
              step="10"
              value={(ts.column && ts.column.minWidth != null) ? ts.column.minWidth : ""}
              placeholder="未設定"
              onChange={(e) => setMinMaxWidth("minWidth", e.target.value)}
              style={{ width: 80, marginLeft: 4 }}
              title={COLUMN_WIDTH_HELP}
            />
            <button
              type="button"
              onClick={() => setMinMaxWidth("minWidth", "")}
              title="最小幅を未設定に戻す"
              style={RESET_BUTTON_STYLE}
            >×</button>
          </label>
          <label style={LABEL_STYLE} title={COLUMN_WIDTH_HELP}>
            最大幅 (px)
            <input
              className="nf-input"
              type="number"
              min={COLUMN_WIDTH_MIN}
              max={COLUMN_WIDTH_MAX}
              step="10"
              value={(ts.column && ts.column.maxWidth != null) ? ts.column.maxWidth : ""}
              placeholder="未設定"
              onChange={(e) => setMinMaxWidth("maxWidth", e.target.value)}
              style={{ width: 80, marginLeft: 4 }}
              title={COLUMN_WIDTH_HELP}
            />
            <button
              type="button"
              onClick={() => setMinMaxWidth("maxWidth", "")}
              title="最大幅を未設定に戻す"
              style={RESET_BUTTON_STYLE}
            >×</button>
          </label>
          <span />

          <span style={HEADER_LABEL_STYLE}>ヘッダ:</span>
          <label style={LABEL_STYLE}>
            背景色
            <input
              type="color"
              value={ts.header.bg || "#f5f5f5"}
              onChange={(e) => setPath(["header", "bg"], e.target.value)}
              style={{ marginLeft: 4, verticalAlign: "middle" }}
            />
            <button type="button" onClick={() => setPath(["header", "bg"], "")} title="既定 (CSS 変数) に戻す" style={RESET_BUTTON_STYLE}>×</button>
          </label>
          <label style={LABEL_STYLE}>
            文字色
            <input
              type="color"
              value={ts.header.color || "#222222"}
              onChange={(e) => setPath(["header", "color"], e.target.value)}
              style={{ marginLeft: 4, verticalAlign: "middle" }}
            />
            <button type="button" onClick={() => setPath(["header", "color"], "")} title="既定に戻す" style={RESET_BUTTON_STYLE}>×</button>
          </label>
          <span />

          <span style={HEADER_LABEL_STYLE}>縞模様:</span>
          <label style={LABEL_STYLE}>
            <input
              type="checkbox"
              checked={ts.zebra.enabled}
              onChange={(e) => setPath(["zebra", "enabled"], e.target.checked)}
              style={{ marginRight: 4 }}
            />
            有効
          </label>
          <label style={{ ...LABEL_STYLE, opacity: ts.zebra.enabled ? 1 : 0.5 }}>
            色
            <input
              type="color"
              value={ts.zebra.color || "#f8f8f8"}
              disabled={!ts.zebra.enabled}
              onChange={(e) => setPath(["zebra", "color"], e.target.value)}
              style={{ marginLeft: 4, verticalAlign: "middle" }}
            />
            <button
              type="button"
              onClick={() => setPath(["zebra", "color"], "")}
              disabled={!ts.zebra.enabled}
              title="既定 (薄い黒) に戻す"
              style={RESET_BUTTON_STYLE}
            >×</button>
          </label>
          <span />

          {showHeatmap && (
            <HeatmapStyleControls
              heatmap={heatmap}
              onHeatmapChange={onHeatmapChange}
              availableColumns={availableColumns}
            />
          )}
        </div>
      )}
      {open && (
        <OverrideSection
          overrides={ts.border.overrides || []}
          onUpdate={updateOverride}
          onRemove={removeOverride}
          onAdd={addOverride}
          availableColumns={availableColumns}
        />
      )}
      {open && (
        <ColumnWidthSection
          widths={(ts.column && ts.column.widths) || []}
          onUpdate={updateColumnWidth}
          onRemove={removeColumnWidth}
          onAdd={addColumnWidth}
          availableColumns={availableColumns}
        />
      )}
    </div>
  );
}

function BorderLineRow({ label, line, onChange }) {
  return (
    <>
      <span style={HEADER_LABEL_STYLE}>{label}:</span>
      <label style={LABEL_STYLE}>
        太さ
        <input
          className="nf-input"
          type="number"
          min="0"
          max="10"
          step="1"
          value={line.width}
          onChange={(e) => onChange({ key: "width", value: Number(e.target.value) })}
          style={{ width: 60, marginLeft: 4 }}
        />
      </label>
      <label style={LABEL_STYLE}>
        色
        <input
          type="color"
          value={line.color || "#cccccc"}
          onChange={(e) => onChange({ key: "color", value: e.target.value })}
          style={{ marginLeft: 4, verticalAlign: "middle" }}
        />
        <button
          type="button"
          onClick={() => onChange({ key: "color", value: "" })}
          title="既定 (CSS 変数) に戻す"
          style={RESET_BUTTON_STYLE}
        >×</button>
      </label>
      <label style={LABEL_STYLE}>
        スタイル
        <select
          className="nf-input"
          value={line.style}
          onChange={(e) => onChange({ key: "style", value: e.target.value })}
          style={{ marginLeft: 4 }}
        >
          {TABLE_BORDER_STYLES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>
    </>
  );
}

function OverrideSection({ overrides, onUpdate, onRemove, onAdd, availableColumns }) {
  return (
    <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px dashed var(--nf-border)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
        <span style={HEADER_LABEL_STYLE}>個別罫線 (行・列オーバーライド):</span>
        <button
          type="button"
          className="nf-btn-outline"
          onClick={() => onAdd("row")}
          style={{ fontSize: "11px", padding: "2px 8px" }}
        >+ 行</button>
        <button
          type="button"
          className="nf-btn-outline"
          onClick={() => onAdd("column")}
          style={{ fontSize: "11px", padding: "2px 8px" }}
        >+ 列</button>
      </div>
      {overrides.length === 0 ? (
        <p className="nf-text-subtle" style={{ fontSize: 11, margin: "4px 0" }}>
          ※ 特定の行や列だけ罫線を変える場合に追加します（例: 合計行の上だけ太線、特定列の右だけ赤線）。
        </p>
      ) : (
        <div style={{ display: "grid", gap: 6 }}>
          {overrides.map((o, idx) => (
            <OverrideRow
              key={idx}
              entry={o}
              onUpdate={(patch) => onUpdate(idx, patch)}
              onRemove={() => onRemove(idx)}
              availableColumns={availableColumns}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ColumnWidthSection({ widths, onUpdate, onRemove, onAdd, availableColumns }) {
  return (
    <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px dashed var(--nf-border)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
        <span style={HEADER_LABEL_STYLE}>
          列ごとの幅上書き:
          <span style={HELP_ICON_STYLE} title={COLUMN_WIDTH_HELP}>?</span>
        </span>
        <button
          type="button"
          className="nf-btn-outline"
          onClick={onAdd}
          style={{ fontSize: "11px", padding: "2px 8px" }}
        >+ 列幅</button>
      </div>
      {widths.length === 0 ? (
        <p className="nf-text-subtle" style={{ fontSize: 11, margin: "4px 0" }}>
          ※ 特定の列だけ幅を変える場合に追加します（例: 「項目」を 320px、「件数」を 60px）。未指定の列は既定幅。
        </p>
      ) : (
        <div style={{ display: "grid", gap: 6 }}>
          {widths.map((w, idx) => (
            <ColumnWidthRow
              key={idx}
              entry={w}
              onUpdate={(patch) => onUpdate(idx, patch)}
              onRemove={() => onRemove(idx)}
              availableColumns={availableColumns}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ColumnWidthRow({ entry, onUpdate, onRemove, availableColumns }) {
  const generatedId = useId();
  const datalistId = `colwidth-cols-${generatedId}`;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto auto", gap: 6, alignItems: "center", fontSize: 12 }}>
      <span style={{ minWidth: 28, fontWeight: 600 }}>列</span>
      <span>
        <input
          className="nf-input"
          type="text"
          value={entry.column}
          onChange={(e) => onUpdate({ column: e.target.value })}
          placeholder="例: 項目"
          list={datalistId}
          style={{ width: "100%" }}
        />
        <datalist id={datalistId}>
          {(availableColumns || []).map((c) => <option key={c} value={c} />)}
        </datalist>
      </span>
      <label style={{ display: "inline-flex", alignItems: "center", gap: 4 }} title={COLUMN_WIDTH_HELP}>
        幅
        <input
          className="nf-input"
          type="number"
          min={COLUMN_WIDTH_MIN}
          max={COLUMN_WIDTH_MAX}
          step="10"
          value={entry.width}
          onChange={(e) => onUpdate({ width: Number(e.target.value) })}
          title={COLUMN_WIDTH_HELP}
          style={{ width: 70 }}
        />
        <span style={{ fontSize: 10 }}>px</span>
      </label>
      <button
        type="button"
        onClick={onRemove}
        className="nf-btn-outline"
        title="削除"
        style={{ fontSize: 11, padding: "2px 6px" }}
      >×</button>
    </div>
  );
}

function OverrideRow({ entry, onUpdate, onRemove, availableColumns }) {
  const isRow = entry.target === "row";
  const edgeOptions = isRow ? ROW_OVERRIDE_EDGES : COLUMN_OVERRIDE_EDGES;
  const edgeLabels = isRow ? ROW_EDGE_LABELS : COLUMN_EDGE_LABELS;
  const placeholder = isRow ? ROW_SELECTOR_PLACEHOLDER : COLUMN_SELECTOR_PLACEHOLDER;
  const generatedId = useId();
  const datalistId = isRow ? undefined : `override-cols-${generatedId}`;

  const selectorError = useMemo(() => {
    if (!entry.selector || !entry.selector.trim()) return "";
    if (isRow) {
      const r = parseRowSelector(entry.selector);
      return r.errors.length > 0 ? r.errors[0] : "";
    }
    const cols = parseColumnSelector(entry.selector);
    return cols.length === 0 ? "列名が読み取れません" : "";
  }, [entry.selector, isRow]);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto auto auto auto auto", gap: 6, alignItems: "center", fontSize: 12 }}>
      <span style={{ minWidth: 28, fontWeight: 600 }}>{isRow ? "行" : "列"}</span>
      <span>
        <input
          className="nf-input"
          type="text"
          value={entry.selector}
          onChange={(e) => onUpdate({ selector: e.target.value })}
          placeholder={placeholder}
          list={datalistId}
          style={{ width: "100%" }}
        />
        {datalistId && (
          <datalist id={datalistId}>
            {(availableColumns || []).map((c) => <option key={c} value={c} />)}
          </datalist>
        )}
        {selectorError && (
          <span style={{ color: "var(--nf-danger, #c00)", fontSize: 10 }}>※ {selectorError}</span>
        )}
      </span>
      <select
        className="nf-input"
        value={entry.edges}
        onChange={(e) => onUpdate({ edges: e.target.value })}
        title="どの辺を上書きするか"
      >
        {edgeOptions.map((v) => <option key={v} value={v}>{edgeLabels[v]}</option>)}
      </select>
      <input
        className="nf-input"
        type="number"
        min="0"
        max="10"
        value={entry.width}
        onChange={(e) => onUpdate({ width: Number(e.target.value) })}
        title="太さ"
        style={{ width: 48 }}
      />
      <input
        type="color"
        value={entry.color || "#cccccc"}
        onChange={(e) => onUpdate({ color: e.target.value })}
        title="色"
        style={{ width: 28, verticalAlign: "middle" }}
      />
      <select
        className="nf-input"
        value={entry.style}
        onChange={(e) => onUpdate({ style: e.target.value })}
        title="スタイル"
      >
        {TABLE_BORDER_STYLES.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
      <button
        type="button"
        onClick={onRemove}
        className="nf-btn-outline"
        title="削除"
        style={{ fontSize: 11, padding: "2px 6px" }}
      >×</button>
    </div>
  );
}
