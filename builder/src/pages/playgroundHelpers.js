// PlaygroundPage の純関数ヘルパー（DOM / React 非依存）。
// node:test で直接ユニットテストできるよう JSX から分離している。
import { buildSimpleSearchColumns } from "../features/search/searchTable.js";
import { FIXED_PATHS } from "../features/analytics/utils/columnIdentifierResolver.js";
import { NON_SEARCHABLE_META_KEYS } from "../core/constants.js";

// 検索の簡易構文（`列名:値`）で実際に効く固定メタ列のみ（NON_SEARCHABLE_META_KEYS を除く）。
export const SEARCHABLE_META_PATHS = FIXED_PATHS.filter((k) => !NON_SEARCHABLE_META_KEYS.includes(k));

/**
 * フォームスキーマから「フィールド挿入」候補のパス一覧（ラベル | 連結）を取り出す。
 * buildSimpleSearchColumns（base=[]）が全リーフフィールドを pipePath 付き列に正規化するので再利用する。
 * @param {{ schema?: Array }} form
 * @returns {string[]} 重複排除済みのフィールドパス一覧
 */
export function formFieldPaths(form) {
  if (!form || !Array.isArray(form.schema)) return [];
  const cols = buildSimpleSearchColumns(form, []);
  const seen = new Set();
  const out = [];
  for (const c of cols) {
    if (c && c.path && !seen.has(c.path)) {
      seen.add(c.path);
      out.push(c.path);
    }
  }
  return out;
}

/**
 * 「フィールド挿入」候補の完全版（固定メタ列 + スキーマフィールド）を返す。
 * メタ列は FIXED_PATHS（`[列名]` 記法で実際に解決できる固定列の正規リスト）が既定。
 * @param {{ schema?: Array }} form
 * @param {{ metaPaths?: string[] }} [options] metaPaths を絞り込みたい場合に指定（例: SEARCHABLE_META_PATHS）
 * @returns {{ path: string, isMeta: boolean }[]}
 */
export function fieldInsertOptions(form, { metaPaths = FIXED_PATHS } = {}) {
  const metaOpts = metaPaths.map((path) => ({ path, isMeta: true }));
  const fieldOpts = formFieldPaths(form).map((path) => ({ path, isMeta: false }));
  return [...metaOpts, ...fieldOpts];
}

/**
 * textarea の選択範囲 [start, end) を snippet で置換した結果と、挿入後のキャレット位置を返す。
 * 純関数（DOM 非依存）。実際の focus / setSelectionRange は呼び出し側（insertAtCursor）が行う。
 * @param {string} value 現在のテキスト
 * @param {number} start 選択開始位置
 * @param {number} end 選択終了位置
 * @param {string} snippet 挿入文字列
 * @returns {{ next: string, caret: number }}
 */
export function computeInsertion(value, start, end, snippet) {
  const base = value || "";
  const ins = snippet || "";
  const len = base.length;
  // 不正な位置は末尾追記にフォールバック（selectionStart が無い環境など）。
  const s = Number.isInteger(start) && start >= 0 && start <= len ? start : len;
  const e = Number.isInteger(end) && end >= s && end <= len ? end : s;
  const next = base.slice(0, s) + ins + base.slice(e);
  return { next, caret: s + ins.length };
}
