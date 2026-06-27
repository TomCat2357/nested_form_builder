/**
 * 検索ページの URL 検索パラメータ（?q / ?sort / ?page）を更新した新しい
 * URLSearchParams を返す純粋関数群。setSearchParams 呼び出しは呼び出し側の責務。
 *
 * useSearchPageState から切り出した副作用なしのロジック。挙動は元の inline 実装と同一。
 */

import { buildInitialSort } from "./searchPageSettings.js";

// 検索キーワードを更新。空なら q を削除し、page は常に 1 へリセットする。
export const buildSearchChangeParams = (searchParams, value) => {
  const next = new URLSearchParams(searchParams);
  if (value) next.set("q", value);
  else next.delete("q");
  next.set("page", "1");
  return next;
};

// 指定列のソートをトグル。同じ列なら昇降を反転、別列なら desc から始める。
export const buildSortToggleParams = (searchParams, key) => {
  const next = new URLSearchParams(searchParams);
  const current = buildInitialSort(next);
  const order = current.key === key ? (current.order === "desc" ? "asc" : "desc") : "desc";
  next.set("sort", `${key}:${order}`);
  return next;
};

// ページ番号を更新。
export const buildPageChangeParams = (searchParams, nextPage) => {
  const next = new URLSearchParams(searchParams);
  next.set("page", String(nextPage));
  return next;
};
