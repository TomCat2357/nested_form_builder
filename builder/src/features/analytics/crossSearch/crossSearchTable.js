/**
 * 串刺しフォーム検索の結果テーブル列を構築する。
 *
 * 単一フォーム検索（searchTable.js）の部品（createBaseColumns / createDisplayColumn /
 * buildHeaderRowsLayout）を再利用し、最左に合成「フォーム名」列を足す。CFS 定義の columns
 * （スラッシュパス）は同一パスが 1 列に統合される（各レコードは自分のフォームの値を入れる）。
 */

import {
  createBaseColumns,
  createDisplayColumn,
  buildHeaderRowsLayout,
} from "../../search/searchTable.js";
import { normalizeSearchText } from "../../search/searchTableValues.js";

export const CROSS_SEARCH_FORM_NAME_KEY = "__formName";

// 各レコードの出自フォーム名を出す最左の合成列。検索対象外（searchable:false）・ソート可。
export function createFormNameColumn() {
  return {
    key: CROSS_SEARCH_FORM_NAME_KEY,
    segments: ["フォーム名"],
    sortable: true,
    searchable: false,
    getValue: (entry) => {
      const name = String(entry?.__formName || "");
      return { display: name, search: normalizeSearchText(name), sort: name };
    },
  };
}

/**
 * CFS 定義の columns（[{ path, label, type }]）から表示列・検索列・ヘッダ行を作る。
 * 表示列 = [フォーム名] + メタ4列（No./ID/作成/更新） + CFS 列。
 * 検索列 = メタ4列 + CFS 列（フォーム名は検索対象外）。
 */
export function buildCrossSearchColumns(cfsColumns) {
  const cols = Array.isArray(cfsColumns) ? cfsColumns : [];
  const metaColumns = createBaseColumns();
  const pathColumns = cols
    .filter((c) => c && c.path)
    .map((c) => createDisplayColumn(String(c.path), c.type || ""));

  const formNameColumn = createFormNameColumn();
  const displayColumns = [formNameColumn, ...metaColumns, ...pathColumns];
  const searchColumns = [...metaColumns, ...pathColumns];
  const headerRows = buildHeaderRowsLayout(displayColumns);
  return { displayColumns, searchColumns, headerRows };
}
