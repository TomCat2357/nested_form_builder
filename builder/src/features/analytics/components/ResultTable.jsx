import React, { useEffect, useMemo, useRef, useState } from "react";
import { useCancellable } from "../../../app/hooks/useCancellable.js";
import { filterDisplayColumns, getColumnDisplayLabel, shouldKeepRowFromSql } from "../utils/metaColumnDisplay.js";
import { toFiniteNumberOrNull as toFiniteNumber } from "../utils/computeShared.js";
import { buildTableStyleTokens, truncateForDisplay, resolveTruncateLength } from "../utils/tableStyle.js";
import { buildCompiledOverrides, resolveCellBorders } from "../utils/tableStyleCellBorders.js";
import {
  parseExcludeList,
  compileRowExcludePredicate,
  extractRowExcludeExpr,
} from "../utils/heatmapUtils.js";
import { buildHeatRanges, getHeatRange } from "../utils/heatmapRanges.js";
import { detectNumericColumns, heatBackground } from "../utils/heatmapColor.js";
import { precompileExpressions } from "../../expression/alasqlExpressionEvaluator.js";

function isEmptyValue(v) {
  return v === null || v === undefined || v === "";
}

// 列ソート: 両方数値なら数値順、それ以外は文字列順（numeric:true で "10" > "2"）。空値は常に末尾。
function sortRows(rows, column, dir) {
  const sign = dir === "desc" ? -1 : 1;
  const indexed = rows.map((r, i) => [r, i]);
  indexed.sort(([ra, ia], [rb, ib]) => {
    const a = ra ? ra[column] : undefined;
    const b = rb ? rb[column] : undefined;
    const aEmpty = isEmptyValue(a);
    const bEmpty = isEmptyValue(b);
    if (aEmpty && bEmpty) return ia - ib;
    if (aEmpty) return 1;
    if (bEmpty) return -1;
    const an = toFiniteNumber(a);
    const bn = toFiniteNumber(b);
    let cmp;
    if (an !== null && bn !== null) {
      cmp = an - bn;
    } else {
      cmp = String(a).localeCompare(String(b), undefined, { numeric: true });
    }
    if (cmp === 0) return ia - ib;
    return sign * cmp;
  });
  return indexed.map(([r]) => r);
}

export default function ResultTable({ rows, columns, heatmap, tableStyle, compiledColumns, fallbackTypeMap, sql }) {
  // SQL に `\b_row\b` が含まれていれば隠し列 `_row` を表示する opt-in。
  const displayColumns = useMemo(
    () => filterDisplayColumns(columns, { keepRow: shouldKeepRowFromSql(sql) }),
    [columns, sql]
  );
  const [sortState, setSortState] = useState(null);

  const safeRows = Array.isArray(rows) ? rows : [];
  const sortedRows = useMemo(() => {
    if (!sortState || !sortState.column || !displayColumns.includes(sortState.column)) return safeRows;
    return sortRows(safeRows, sortState.column, sortState.dir);
  }, [safeRows, sortState, displayColumns]);

  const heatEnabled = !!(heatmap && heatmap.enabled);
  const direction = heatmap?.direction || "column";
  const heatMinColor = heatmap?.minColor || "";
  const heatMaxColor = heatmap?.maxColor || "";

  const tokens = buildTableStyleTokens(tableStyle);
  const columnTokens = tokens.column || { widthMap: new Map(), minWidth: null, maxWidth: null };
  const explicitWidthOf = (col) => columnTokens.widthMap.get(col); // 未指定なら undefined
  const truncateLen = resolveTruncateLength(tokens);
  // 列幅は常に content-adaptive。min/max が設定されていればクランプ。
  const cellMinMaxStyle = {
    minWidth: columnTokens.minWidth ? `${columnTokens.minWidth}px` : undefined,
    maxWidth: columnTokens.maxWidth ? `${columnTokens.maxWidth}px` : undefined,
  };
  // buildCompiledOverrides は { compiled: [...], exprs: [...] } を返す。
  // exprs は行 override の非空式リストで、precompileExpressions に渡して同期評価を可能にする。
  const compiledOverrides = useMemo(() => buildCompiledOverrides(tokens), [tableStyle]);

  // 行 override の式 + heatmap 行除外式を集約して precompile する。
  // ready が false の間は罫線 override / 行除外を noop にして既存挙動を維持。
  const exprs = useMemo(() => {
    const out = [...compiledOverrides.exprs];
    const ex = extractRowExcludeExpr(heatmap);
    if (ex) out.push(ex);
    return out;
  }, [compiledOverrides.exprs, heatmap?.enabled, heatmap?.excludeRows]);
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

  const excludeColumns = useMemo(
    () => (heatEnabled ? parseExcludeList(heatmap?.excludeColumns) : new Set()),
    [heatEnabled, heatmap?.excludeColumns]
  );
  const excludeRowPredicate = useMemo(() => {
    if (!heatEnabled || !ready) return null;
    return compileRowExcludePredicate(heatmap?.excludeRows).predicate;
  }, [heatEnabled, ready, heatmap?.excludeRows]);

  const numericCols = useMemo(
    () => (heatEnabled ? detectNumericColumns(sortedRows, displayColumns, compiledColumns, fallbackTypeMap, excludeColumns) : new Set()),
    [heatEnabled, sortedRows, displayColumns, compiledColumns, fallbackTypeMap, excludeColumns]
  );
  const heatMeta = useMemo(
    () => (heatEnabled ? buildHeatRanges(sortedRows, displayColumns, numericCols, direction, excludeRowPredicate) : null),
    [heatEnabled, sortedRows, displayColumns, numericCols, direction, excludeRowPredicate]
  );

  const cycleSort = (col) => {
    setSortState((prev) => {
      if (!prev || prev.column !== col) return { column: col, dir: "asc" };
      if (prev.dir === "asc") return { column: col, dir: "desc" };
      return null;
    });
  };

  // 上下 2 本の横スクロールバーを同期させる（SearchTable と同じ仕組み）。
  // テーブルが縦に長くても下までスクロールせずに横移動できるよう、上にもバーを出す。
  const topScrollRef = useRef(null);
  const bottomScrollRef = useRef(null);
  const tableRef = useRef(null);
  const syncingScrollRef = useRef(false);
  const [showTopScrollbar, setShowTopScrollbar] = useState(false);
  const [topScrollInnerWidth, setTopScrollInnerWidth] = useState(0);

  useEffect(() => {
    const topScrollEl = topScrollRef.current;
    const bottomScrollEl = bottomScrollRef.current;
    const tableEl = tableRef.current;
    if (!topScrollEl || !bottomScrollEl || !tableEl) return undefined;

    const syncScroll = (source, target) => {
      if (!source || !target) return;
      if (syncingScrollRef.current) return;
      if (target.scrollLeft === source.scrollLeft) return;
      syncingScrollRef.current = true;
      target.scrollLeft = source.scrollLeft;
      syncingScrollRef.current = false;
    };

    const updateTopScrollbar = () => {
      const scrollWidth = tableEl.scrollWidth;
      const clientWidth = bottomScrollEl.clientWidth;
      const hasOverflow = scrollWidth > clientWidth + 1;

      setTopScrollInnerWidth((prev) => (prev === scrollWidth ? prev : scrollWidth));
      setShowTopScrollbar((prev) => (prev === hasOverflow ? prev : hasOverflow));

      if (topScrollEl.scrollLeft !== bottomScrollEl.scrollLeft) {
        topScrollEl.scrollLeft = bottomScrollEl.scrollLeft;
      }
    };

    const handleTopScroll = () => syncScroll(topScrollEl, bottomScrollEl);
    const handleBottomScroll = () => syncScroll(bottomScrollEl, topScrollEl);

    topScrollEl.addEventListener("scroll", handleTopScroll);
    bottomScrollEl.addEventListener("scroll", handleBottomScroll);

    let resizeObserver = null;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => {
        updateTopScrollbar();
      });
      resizeObserver.observe(tableEl);
      resizeObserver.observe(bottomScrollEl);
    } else if (typeof window !== "undefined") {
      window.addEventListener("resize", updateTopScrollbar);
    }

    updateTopScrollbar();

    return () => {
      topScrollEl.removeEventListener("scroll", handleTopScroll);
      bottomScrollEl.removeEventListener("scroll", handleBottomScroll);
      if (resizeObserver) {
        resizeObserver.disconnect();
      } else if (typeof window !== "undefined") {
        window.removeEventListener("resize", updateTopScrollbar);
      }
    };
  }, [displayColumns, sortedRows]);

  if (!displayColumns || displayColumns.length === 0) {
    return <p className="nf-text-subtle">データがありません。</p>;
  }

  // 行 override 評価は precompile 完了後に有効化。それまでは空配列を渡してオーバーライド無視。
  const activeCompiledOverrides = ready ? compiledOverrides.compiled : [];
  const cellPadding = `${tokens.paddingY}px ${tokens.paddingX}px`;
  const rowHeightStyle = tokens.rowHeight > 0 ? { height: `${tokens.rowHeight}px` } : null;

  // 常に content-adaptive: 列幅は内容で決まり、min/max でクランプされる。
  // 内容が maxWidth を超えるセルは overflowWrap: anywhere / wordBreak: break-word で折り返す。
  const tableStyleProp = { width: "auto", minWidth: "100%", tableLayout: "auto", borderCollapse: "collapse" };

  return (
    <>
      <div className={`search-table-top-scroll${showTopScrollbar ? "" : " is-hidden"}`} ref={topScrollRef} aria-hidden="true">
        <div className="search-table-top-scroll-inner" style={{ width: `${topScrollInnerWidth}px` }} />
      </div>
      <div className="search-table-wrap" ref={bottomScrollRef}>
        <table
          ref={tableRef}
          className="search-table"
          style={tableStyleProp}
        >
          <colgroup>
            {displayColumns.map((col) => {
              // 明示幅のある列のみ「優先幅」ヒントとして width 指定。それ以外は内容で決まる。
              const w = explicitWidthOf(col);
              return <col key={col} style={w ? { width: `${w}px` } : undefined} />;
            })}
          </colgroup>
          <thead>
            <tr>
              {displayColumns.map((col) => {
                const active = sortState && sortState.column === col;
                const indicator = active ? (sortState.dir === "asc" ? " ▲" : " ▼") : "";
                const borders = resolveCellBorders({
                  tokens, compiledOverrides: activeCompiledOverrides, columnName: col, isHeader: true,
                });
                const headerLabel = truncateForDisplay(getColumnDisplayLabel(col), truncateLen);
                const headerTitle = headerLabel.truncated ? `${headerLabel.full} （クリックで並び替え）` : "クリックで並び替え";
                return (
                  <th
                    key={col}
                    onClick={() => cycleSort(col)}
                    title={headerTitle}
                    style={{
                      padding: cellPadding,
                      textAlign: "left",
                      verticalAlign: "top",
                      borderTop: borders.borderTop,
                      borderBottom: borders.borderBottom,
                      borderLeft: borders.borderLeft,
                      borderRight: borders.borderRight,
                      background: tokens.customized ? tokens.headerBg : undefined,
                      color: tokens.customized && tokens.headerColor ? tokens.headerColor : undefined,
                      cursor: "pointer",
                      userSelect: "none",
                      wordBreak: "break-word",
                      ...cellMinMaxStyle,
                      ...rowHeightStyle,
                    }}
                  >
                    {headerLabel.text}{indicator}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row, i) => {
              const displayRowIndex = i + 1;
              const rowDataForEval = { ...(row || {}), _dispRow: displayRowIndex };
              const rowExcluded = !!(excludeRowPredicate && excludeRowPredicate(row, displayRowIndex));
              return (
              <tr key={i}>
                {displayColumns.map((col) => {
                  const raw = row ? row[col] : undefined;
                  let heatBg;
                  if (heatEnabled && !rowExcluded && numericCols.has(col)) {
                    const n = toFiniteNumber(raw);
                    if (n !== null) {
                      heatBg = heatBackground(n, getHeatRange(heatMeta, col, i), heatMinColor, heatMaxColor);
                    }
                  }
                  // heatmap が色を出しているセルでは zebra を抑止 (heatmap = 値の大小表示が主役)。
                  const zebraBg = !heatBg && tokens.zebra.enabled && i % 2 === 1
                    ? tokens.zebra.color
                    : undefined;
                  const borders = resolveCellBorders({
                    tokens, compiledOverrides: activeCompiledOverrides,
                    rowData: rowDataForEval, displayRowIndex, columnName: col,
                  });
                  const display = truncateForDisplay(raw, truncateLen);
                  return (
                    <td
                      key={col}
                      title={display.truncated ? display.full : undefined}
                      style={{
                        padding: cellPadding,
                        borderTop: borders.borderTop,
                        borderBottom: borders.borderBottom,
                        borderLeft: borders.borderLeft,
                        borderRight: borders.borderRight,
                        backgroundColor: heatBg || zebraBg,
                        verticalAlign: "top",
                        overflowWrap: "anywhere",
                        ...cellMinMaxStyle,
                        ...rowHeightStyle,
                      }}
                    >
                      {display.text}
                    </td>
                  );
                })}
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
