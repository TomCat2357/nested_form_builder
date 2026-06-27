/**
 * 検索ページの列集合・置換依存列・バックフィル対象 fieldId を導出する純粋関数群。
 *
 * useSearchPageState の useMemo 本体から切り出した副作用なしのロジック。
 * 各関数の入出力・分岐は元の inline 実装と同一。
 */

import { buildComputedFieldPathsById } from "../../core/computedFields.js";
import { traverseSchema } from "../../core/schemaUtils.js";
import { FULL_QUERY_SUBST_RE } from "../../core/constants.js";
import { createBaseColumns, createHitExcerptColumn } from "./searchTable.js";
import { SQL_MODE_RE } from "./searchSyntaxPreprocessor.js";

// 検索スコープ用の列集合。メタ4項目（No./ID/作成日時/最終更新日時）は表示・非表示に
// 関わらず常に検索対象とするため、表示列に含まれていない非表示メタ列を補って superset を作る。
export const buildSearchScopeColumns = (columns) => {
  const presentKeys = new Set(columns.map((column) => column.key));
  const hiddenMeta = createBaseColumns().filter((column) => !presentKeys.has(column.key));
  return hiddenMeta.length ? [...columns, ...hiddenMeta] : columns;
};

// 簡易検索モード（キーワード入力あり かつ SQL モードでない）かどうか。
export const isHitColumnActive = (query) => {
  const keyword = (query || "").trim();
  return Boolean(keyword) && !SQL_MODE_RE.test(keyword);
};

// 表示専用の列構成。ヒット列はレンダリング用のこちらにのみ含める。
export const buildDisplayColumns = (hitColumnActive, columns) =>
  hitColumnActive ? [createHitExcerptColumn(), ...columns] : columns;

// 「子データ / full-query 依存の置換」が出る表示列（読込中・再計算の対象判定に使う）。
export const buildDependentSubstColumns = ({
  hasDependentSubstitutions,
  substitutionChildRefs,
  normalizedSchema,
  displayColumns,
}) => {
  if (!hasDependentSubstitutions) return [];
  const byFieldId = substitutionChildRefs.byFieldId;
  const pathsById = buildComputedFieldPathsById(normalizedSchema);
  const out = [];
  for (const col of displayColumns) {
    if (!col || !col.path) continue;
    let info = col.fieldId && byFieldId[col.fieldId] ? byFieldId[col.fieldId] : null;
    if (!info) {
      for (const fid of Object.keys(byFieldId)) {
        if (pathsById[fid] === col.path) { info = byFieldId[fid]; break; }
      }
    }
    if (!info) continue;
    out.push({
      columnKey: col.key,
      path: col.path,
      needsChild: info.childFormIds.length > 0,
      needsFullQuery: info.hasFullQuery === true,
    });
  }
  return out;
};

// 同期バックフィル（processedEntries）が補完してよい置換 fieldId。子データ/full-query 依存の
// 置換は子データ無しで誤った値を書かないよう除外し、recompute effect に任せる。
// 除外対象なし（= 依存置換なし）のときは null を返す = 全置換（従来挙動）。
export const buildSameRecordBackfillFieldIds = ({
  hasDependentSubstitutions,
  normalizedSchema,
  substitutionChildRefs,
}) => {
  if (!hasDependentSubstitutions) return null;
  const all = Object.keys(buildComputedFieldPathsById(normalizedSchema));
  const dependent = new Set(Object.keys(substitutionChildRefs.byFieldId));
  return all.filter((fid) => !dependent.has(fid));
};

// full-query({{SELECT}}) 置換を含む substitution フィールドのテンプレ文字列を改行連結する。
// hasFullQuerySubstitution が偽なら空文字（prefetch をスキップさせる）。
export const buildFullQueryTemplates = (normalizedSchema, hasFullQuerySubstitution) => {
  if (!hasFullQuerySubstitution) return "";
  const tpls = [];
  traverseSchema(normalizedSchema, (field) => {
    if (field?.type === "substitution" && typeof field?.templateText === "string" && FULL_QUERY_SUBST_RE.test(field.templateText)) {
      tpls.push(field.templateText);
    }
  });
  return tpls.join("\n");
};
