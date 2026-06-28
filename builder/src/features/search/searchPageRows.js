/**
 * 検索ページの行データ整形（処理済み行・ヒット抜粋付き行・読込中セルの判定）を行う純粋関数群。
 *
 * useSearchPageState の useMemo 本体から切り出した副作用なしのロジック。
 * 各関数の入出力・分岐は元の inline 実装と同一。
 */

import { backfillComputedFieldValues } from "../../core/computedFields.js";
import { computeRowValues } from "./searchTableValues.js";
import { buildRowHitExcerpts } from "./searchQueryEngine.js";
import { pad2 } from "../../utils/dateTime.js";

// entries を「行 + 計算済みセル値 + バックフィル結果 + 元 entry」へ整形する。
// 計算項目が無いフォームでは backfill をスキップする（従来挙動）。
export const buildProcessedEntries = ({
  entries,
  searchColumns,
  normalizedSchema,
  hasComputedFields,
  sameRecordBackfillFieldIds,
}) => {
  return entries.map((entry) => {
    if (!hasComputedFields) {
      return {
        entry,
        values: computeRowValues(entry, searchColumns),
        backfillResult: null,
        originalEntry: entry,
      };
    }
    const backfillResult = backfillComputedFieldValues(normalizedSchema, entry?.data, undefined, sameRecordBackfillFieldIds);
    const effectiveEntry = backfillResult.changed ? { ...entry, data: backfillResult.data } : entry;
    return {
      entry: effectiveEntry,
      values: computeRowValues(effectiveEntry, searchColumns),
      backfillResult,
      originalEntry: entry,
    };
  });
};

// 表示中ページの各行にヒット抜粋を付与し（hitColumnActive 時のみ）、
// 「子データ / full-query 依存の置換セルが 空 かつ 未解決」の列キーを pendingCellKeys に集めて行へ付与する。
export const buildDisplayPagedEntries = ({
  pagedEntries,
  hitColumnActive,
  searchColumns,
  query,
  cellDisplayLimit,
  dependentSubstColumns,
  childDataReady,
  fullQueryReady,
  queryTokensByEntry,
  recomputePending,
}) => {
  const withHits = hitColumnActive
    ? pagedEntries.map((row) => ({
        ...row,
        hitExcerpts: buildRowHitExcerpts(row, searchColumns, query, { cellDisplayLimit }),
      }))
    : pagedEntries;
  if (dependentSubstColumns.length === 0) return withHits;
  return withHits.map((row) => {
    const data = row.entry?.data || {};
    const id = String(row.entry?.id || "");
    const pending = new Set();
    for (const c of dependentSubstColumns) {
      const stored = data[c.path];
      if (!(stored === undefined || stored === null || stored === "")) continue;
      let ready = true;
      if (c.needsChild && !childDataReady) ready = false;
      if (c.needsFullQuery && !(fullQueryReady && queryTokensByEntry.has(id))) ready = false;
      if (recomputePending && (c.needsChild || c.needsFullQuery)) ready = false;
      if (!ready) pending.add(c.columnKey);
    }
    return pending.size > 0 ? { ...row, pendingCellKeys: pending } : row;
  });
};

// 検索結果エクスポート用のファイル名（検索結果_<タイトル>_<YYYYMMDD_HHMMSS>.xlsx）。
export const buildExportFilename = (form, now = new Date()) => {
  const timestamp = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}_${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`;
  return `検索結果_${form?.settings?.formTitle || form?.id || "form"}_${timestamp}.xlsx`;
};
