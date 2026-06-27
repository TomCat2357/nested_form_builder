// PlaygroundPage の純関数ヘルパー（DOM / React 非依存）。
// node:test で直接ユニットテストできるよう JSX から分離している。
import { buildSimpleSearchColumns } from "../features/search/searchTable.js";

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
