import React, { useMemo, useState } from "react";
import { useCancellable } from "../../../app/hooks/useCancellable.js";
import { pivot } from "../utils/pivotCompute.js";
import { formatNumber } from "../utils/formatNumber.js";
import { getColumnDisplayLabel } from "../utils/metaColumnDisplay.js";
import {
  buildTableStyleTokens,
  truncateForDisplay,
  resolveTruncateLength,
} from "../utils/tableStyle.js";
import {
  borderLineDeclaration,
  buildCompiledOverrides,
  resolveCellBorders,
} from "../utils/tableStyleCellBorders.js";
import { precompileExpressions } from "../../expression/alasqlExpressionEvaluator.js";

// 文字列 MIN/MAX 結果は数値書式 (decimals / prefix / suffix) を通さずそのまま表示する。
// null / undefined は空欄。boolean も String() で可読化する。
function formatPivotCell(v, fmt) {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return formatNumber(v, fmt);
  return String(v);
}

/**
 * PivotTable — viz.pivot.{rowField, colField, valueField, agg} で
 * クエリ結果をクロス集計した HTML 表を描画する。
 *
 * viz.tableStyle が指定されていれば罫線・padding・ヘッダ色・zebra をその設定で描画する。
 * 未設定 (null/undefined) のときは buildTableStyleTokens が現状ハードコード値を返すので
 * 既存質問の見た目は寸分違わず維持される。
 */
export default function PivotTable({ rows, viz }) {
  const cfg = viz?.pivot || {};
  const rowField = cfg.rowField || "";
  const colField = cfg.colField || "";
  const valueField = cfg.valueField || "";
  const agg = cfg.agg || "sum";
  const tokens = buildTableStyleTokens(viz?.tableStyle);
  const compiledOverrides = useMemo(() => buildCompiledOverrides(tokens), [viz?.tableStyle]);
  // 行 override の式を precompile してから同期評価できるようにする。ready が false の間は
  // オーバーライドを無視（compiled = []）し、precompile 完了後に正式描画する。
  const exprs = compiledOverrides.exprs;
  const [warmKey, setWarmKey] = useState("");
  const exprsKey = useMemo(() => JSON.stringify(exprs), [exprs]);
  useCancellable(async (isCancelled) => {
    if (exprs.length === 0) {
      setWarmKey(exprsKey);
      return;
    }
    try {
      await precompileExpressions(exprs);
    } finally {
      if (!isCancelled()) setWarmKey(exprsKey);
    }
  }, [exprs, exprsKey]);
  const ready = warmKey === exprsKey;
  const activeCompiledOverrides = ready ? compiledOverrides.compiled : [];
  // tableStyle 未設定時はピボットの旧見た目（4 辺一律 border）を維持。borderCollapse: collapse の
  // テーブルで「外枠も含めた 1px 罫線」を保つには、全セルの 4 辺に horizontal を直接書く。
  // customized=true (ユーザ設定済) では resolveCellBorders 側で per-side + overrides を使う。
  const legacyCellBorder = !tokens.customized ? borderLineDeclaration(tokens.horizontal) : null;

  const data = useMemo(
    () => pivot(rows, rowField, colField, valueField, agg),
    [rows, rowField, colField, valueField, agg]
  );

  if (!rowField || !colField) {
    return (
      <div style={{ padding: 16 }}>
        <p className="nf-text-subtle">
          ピボットテーブルには「行」と「列」の設定が必要です。
        </p>
      </div>
    );
  }
  if (data.rowKeys.length === 0 || data.colKeys.length === 0) {
    return <p className="nf-text-subtle">データがありません。</p>;
  }

  // 列幅は常に content-adaptive。内容が maxWidth を超えるセルは改行で折り返す。
  const truncateLen = resolveTruncateLength(tokens);
  const cellMinMaxStyle = {
    minWidth: tokens.column && tokens.column.minWidth ? `${tokens.column.minWidth}px` : undefined,
    maxWidth: tokens.column && tokens.column.maxWidth ? `${tokens.column.maxWidth}px` : undefined,
  };
  const cellBase = (isHeader, isFirst, rowIdx) => {
    const zebraBg = !isHeader && tokens.zebra.enabled && typeof rowIdx === "number" && rowIdx % 2 === 1
      ? tokens.zebra.color
      : undefined;
    const style = {
      padding: `${tokens.paddingY}px ${tokens.paddingX}px`,
      textAlign: isFirst ? "left" : "right",
      fontWeight: isHeader ? 600 : 400,
      background: isHeader ? tokens.headerBg : (zebraBg || "transparent"),
      whiteSpace: "normal",
      wordBreak: "break-word",
      verticalAlign: "top",
      ...cellMinMaxStyle,
    };
    if (isHeader && tokens.headerColor) style.color = tokens.headerColor;
    if (tokens.rowHeight > 0) style.height = `${tokens.rowHeight}px`;
    return style;
  };

  const borderStyleFor = (opts) => {
    if (legacyCellBorder) return { border: legacyCellBorder };
    const merged = opts && opts.rowData
      ? { ...opts, rowData: { ...opts.rowData, _dispRow: opts.displayRowIndex } }
      : opts;
    const b = resolveCellBorders({ tokens, compiledOverrides: activeCompiledOverrides, ...merged });
    return {
      borderTop: b.borderTop,
      borderBottom: b.borderBottom,
      borderLeft: b.borderLeft,
      borderRight: b.borderRight,
    };
  };

  const cornerLabel = truncateForDisplay(`${getColumnDisplayLabel(rowField)} \\ ${getColumnDisplayLabel(colField)}`, truncateLen);

  return (
    <div style={{ padding: "12px", overflow: "auto", maxHeight: 480 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr>
            <th
              title={cornerLabel.truncated ? cornerLabel.full : undefined}
              style={{ ...cellBase(true, true), ...borderStyleFor({ columnName: rowField, isHeader: true }) }}
            >
              {cornerLabel.text}
            </th>
            {data.colKeys.map((ck) => {
              const d = truncateForDisplay(ck, truncateLen);
              return (
                <th
                  key={ck}
                  title={d.truncated ? d.full : undefined}
                  style={{ ...cellBase(true, false), ...borderStyleFor({ columnName: ck, isHeader: true }) }}
                >
                  {d.text}
                </th>
              );
            })}
            <th style={{ ...cellBase(true, false), ...borderStyleFor({ columnName: "合計", isHeader: true }) }}>合計</th>
          </tr>
        </thead>
        <tbody>
          {data.rowKeys.map((rk, rowIdx) => {
            const rowData = { [rowField]: rk };
            for (const ck of data.colKeys) rowData[ck] = data.cells[rk][ck];
            const displayRowIndex = rowIdx + 1;
            const rkDisplay = truncateForDisplay(rk, truncateLen);
            return (
            <tr key={rk}>
              <th
                title={rkDisplay.truncated ? rkDisplay.full : undefined}
                style={{ ...cellBase(false, true, rowIdx), ...borderStyleFor({ rowData, displayRowIndex, columnName: rowField }) }}
              >
                {rkDisplay.text}
              </th>
              {data.colKeys.map((ck) => {
                const v = data.cells[rk][ck];
                const cellText = truncateForDisplay(formatPivotCell(v, viz?.format), truncateLen);
                return (
                  <td
                    key={ck}
                    title={cellText.truncated ? cellText.full : undefined}
                    style={{ ...cellBase(false, false, rowIdx), ...borderStyleFor({ rowData, displayRowIndex, columnName: ck }) }}
                  >
                    {cellText.text}
                  </td>
                );
              })}
              <td style={{ ...cellBase(false, false, rowIdx), ...borderStyleFor({ rowData, displayRowIndex, columnName: "合計" }), fontWeight: 600 }}>
                {formatNumber(data.rowTotals[rk], viz?.format)}
              </td>
            </tr>
            );
          })}
          <tr>
            <th style={{ ...cellBase(true, true), ...borderStyleFor({ columnName: rowField, isTotalRow: true }), background: tokens.headerBg }}>合計</th>
            {data.colKeys.map((ck) => (
              <td key={ck} style={{ ...cellBase(false, false), ...borderStyleFor({ columnName: ck, isTotalRow: true }), fontWeight: 600, background: tokens.headerBg }}>
                {formatNumber(data.colTotals[ck], viz?.format)}
              </td>
            ))}
            <td style={{ ...cellBase(false, false), ...borderStyleFor({ columnName: "合計", isTotalRow: true }), fontWeight: 700, background: tokens.headerBg }}>
              {formatNumber(data.grandTotal, viz?.format)}
            </td>
          </tr>
        </tbody>
      </table>
      <p className="nf-text-subtle" style={{ marginTop: 6, fontSize: 11 }}>
        集計: {agg}{valueField ? ` (${getColumnDisplayLabel(valueField)})` : ""}
      </p>
    </div>
  );
}
