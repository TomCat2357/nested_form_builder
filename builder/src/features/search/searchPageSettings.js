/**
 * 検索ページの表示設定（pageSize / テーブル最大幅 / セル表示上限 / ヒット列最小幅）を
 * override → フォーム設定 → グローバル設定 の優先順で解決する純粋関数群。
 *
 * useSearchPageState から切り出した副作用なしのロジック。挙動は元の inline 実装と同一。
 */

import { parseSearchCellDisplayLimit } from "./searchTableValues.js";
import { DEFAULT_HIT_COLUMN_MIN_WIDTH } from "./searchTable.js";
import { DEFAULT_PAGE_SIZE } from "../../core/constants.js";

export const buildInitialSort = (params) => {
  const raw = params.get("sort");
  if (!raw) return { key: "No.", order: "desc" };
  const lastColonIndex = raw.lastIndexOf(":");
  if (lastColonIndex === -1) return { key: raw, order: "desc" };
  const key = raw.slice(0, lastColonIndex);
  const order = raw.slice(lastColonIndex + 1);
  return { key: key || "No.", order: order === "asc" ? "asc" : "desc" };
};

// pageSize の意味論:
//   負値（典型: -1）→ 全件表示。Number.MAX_SAFE_INTEGER で表現することで
//     pagedEntries の slice(0, +N) が全件返却、totalPages も 1 に収束する。
//     Infinity は Math.ceil(N / Infinity) = 0 を踏むので避ける。
//   0 / NaN / 未設定 → DEFAULT_PAGE_SIZE にフォールバック（従来挙動）。
//   正の有限数 → そのまま採用。
export const resolvePageSize = (rawPageSize) => {
  const value = Number(rawPageSize);
  if (value < 0) return Number.MAX_SAFE_INTEGER;
  return value > 0 ? value : DEFAULT_PAGE_SIZE;
};

// テーブル最大幅。override → フォーム設定 → グローバル設定 の順。いずれも未設定なら null。
export const resolveTableMaxWidth = (overrideValue, formValue, settingsValue) =>
  Number(overrideValue) || Number(formValue) || Number(settingsValue) || null;

// セル表示文字数上限。override → フォーム設定 → グローバル設定 の順。いずれも未設定なら null。
export const resolveCellDisplayLimit = (overrideValue, formValue, settingsValue) =>
  parseSearchCellDisplayLimit(overrideValue) ||
  parseSearchCellDisplayLimit(formValue) ||
  parseSearchCellDisplayLimit(settingsValue) ||
  null;

// 検索ヒット箇所列の最小幅。override → フォーム設定 → グローバル設定 の順に解決し、
// いずれも未設定なら既定値を使う。0 / 負値 / NaN は既定値にフォールバック。
export const resolveHitColumnMinWidth = (overrideValue, formValue, settingsValue) => {
  const candidates = [overrideValue, formValue, settingsValue];
  for (const candidate of candidates) {
    const value = Number(candidate);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return DEFAULT_HIT_COLUMN_MIN_WIDTH;
};

// URL ?page の要求値。下限のみ 1 で丸める（上限クランプは totalPages 確定後に呼び出し側で行う）。
export const resolveRequestedPage = (rawPage) => Math.max(1, Number(rawPage || 1));

// 総件数・要求ページ・ページサイズから、表示用のページネーション値を計算する。
// page は要求値を totalPages で上限クランプする（表示件数増加で総ページ数が減ったとき
// URL に残った大きい page が範囲外になる回帰を防ぐ）。startIndex / endIndex は 1 始まり、
// 0 件のときは両方 0。
export const computePagination = (totalEntries, requestedPage, pageSize) => {
  const totalPages = Math.max(1, Math.ceil(totalEntries / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const startIndex = totalEntries === 0 ? 0 : (page - 1) * pageSize + 1;
  const endIndex = totalEntries === 0 ? 0 : Math.min(page * pageSize, totalEntries);
  return { totalPages, page, startIndex, endIndex };
};
