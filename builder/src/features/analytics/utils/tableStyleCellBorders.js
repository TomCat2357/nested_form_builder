/**
 * tableStyle tokens から「セル 4 辺の最終 CSS 文字列」を解決するピュア関数。
 *
 * 設計:
 *   - base は「borderBottom = horizontal」「borderRight = vertical」のみ。borderTop / borderLeft は "none"。
 *     borderCollapse: collapse 前提なので、隣接セルの bottom/right が「行間の横線・列間の縦線」になる。
 *     これにより既存挙動（旧形式では `border-bottom` だけ描画していた）を寸分維持できる。
 *   - overrides は配列順に評価し、行/列セレクタにマッチしたら該当辺だけ差し替える。
 *     borderTop / borderLeft も override によって初めて出現する。
 *     先勝ち（先に書いたオーバーライドが優先）— ユーザーが UI で並び替えできる前提。
 *   - ヘッダ行は borderBottom を「horizontal の 2 倍幅版」に置換する従来挙動を維持。
 *   - 行オーバーライドは body 行のみに適用（ヘッダ・合計行には適用しない）。
 *   - 列オーバーライドはヘッダ・合計行にも適用（列は表全体を貫くため）。
 */

import {
  parseRowSelector,
  compileRowPredicate,
  parseColumnSelector,
  compileColumnPredicate,
} from "./tableStyleRowSelector.js";

/**
 * 単一の `{ width, style, color }` 罫線オブジェクトを CSS 宣言文字列に整形する。
 * width=0 / style="none" / null は "none"。
 */
export function borderLineDeclaration(line) {
  if (!line) return "none";
  if (line.style === "none" || line.width === 0) return "none";
  return `${line.width}px ${line.style} ${line.color}`;
}

function emphasizeHorizontal(line) {
  return {
    width: Math.max(line.width * 2, 1),
    color: line.color,
    style: line.style,
  };
}

/**
 * tokens.overrides をパース・predicate コンパイル済みの形にプリビルドする。
 * テーブル描画の度に毎セルで再パースしないようにするため、ResultTable / PivotTable は
 * 一度だけ buildCompiledOverrides を呼んで結果を使い回す。
 *
 * 戻り値:
 *   - compiled: 既存のコンパイル済みエントリ配列（描画ループで参照）
 *   - exprs: 行 override の非空式文字列リスト（呼び出し側が precompileExpressions に渡す用）。
 *           行セレクタは AlaSQL 式評価ベースで、同期評価には事前 precompile が必要。
 */
export function buildCompiledOverrides(tokens) {
  const list = (tokens && tokens.overrides) || [];
  const exprs = [];
  const compiled = list.map((o) => {
    const line = { width: o.width, color: o.color, style: o.style };
    if (o.target === "row") {
      const parsed = parseRowSelector(o.selector);
      if (!parsed.isEmpty) exprs.push(parsed.expr);
      const matches = compileRowPredicate(parsed);
      return { kind: "row", edges: o.edges, line, matches };
    }
    const cols = parseColumnSelector(o.selector);
    const matches = compileColumnPredicate(cols);
    return { kind: "column", edges: o.edges, line, matches };
  });
  return { compiled, exprs };
}

export function resolveCellBorders({
  tokens,
  compiledOverrides,
  rowData,
  displayRowIndex,
  columnName,
  isHeader = false,
  isTotalRow = false,
}) {
  const horizontal = tokens.horizontal;
  const vertical = tokens.vertical;

  // base: 既存挙動互換 — bottom と right だけ描画、top/left は "none"
  let topLine = null;
  let bottomLine = horizontal;
  let leftLine = null;
  let rightLine = vertical;

  if (isHeader) {
    bottomLine = emphasizeHorizontal(horizontal);
  }

  const setIfUnset = (edge, line) => {
    if (edge === "top" && !topSet) { topLine = line; topSet = true; }
    else if (edge === "bottom" && !bottomSet) { bottomLine = line; bottomSet = true; }
    else if (edge === "left" && !leftSet) { leftLine = line; leftSet = true; }
    else if (edge === "right" && !rightSet) { rightLine = line; rightSet = true; }
  };

  let topSet = false;
  let bottomSet = false;
  let leftSet = false;
  let rightSet = false;

  if (compiledOverrides && compiledOverrides.length > 0) {
    for (const o of compiledOverrides) {
      if (o.kind === "row") {
        if (isHeader || isTotalRow) continue;
        if (!o.matches(rowData, displayRowIndex)) continue;
        if (o.edges === "top" || o.edges === "both") setIfUnset("top", o.line);
        if (o.edges === "bottom" || o.edges === "both") setIfUnset("bottom", o.line);
      } else if (o.kind === "column") {
        if (!o.matches(columnName)) continue;
        if (o.edges === "left" || o.edges === "both") setIfUnset("left", o.line);
        if (o.edges === "right" || o.edges === "both") setIfUnset("right", o.line);
      }
    }
  }

  return {
    borderTop: borderLineDeclaration(topLine),
    borderBottom: borderLineDeclaration(bottomLine),
    borderLeft: borderLineDeclaration(leftLine),
    borderRight: borderLineDeclaration(rightLine),
  };
}
