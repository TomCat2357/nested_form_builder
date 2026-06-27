/**
 * フォルダパス文字列と一覧のドリルダウン / 検索のための純関数群。
 * folder は "a/b/c" 形式の正規化済みパス、未指定は ""。
 */

import { asTrimmedString } from "./strings.js";

/** 生のフォルダ入力を正規化する。"/a//b/ " → "a/b"、未指定や非文字列は ""。 */
export function normalizeFolderPath(raw) {
  if (typeof raw !== "string") return "";
  return raw
    .split("/")
    .map((seg) => seg.trim())
    .filter((seg) => seg.length > 0)
    .join("/");
}

/**
 * フォルダパスと葉名を "/" で結合し正規化する。folder 空なら leaf のみ。
 * フォルダ込みフォーム名（"フォルダ/サブ/フォーム名"）の組み立てに使う。
 */
export function joinFolderPath(folder, leaf) {
  const f = typeof folder === "string" ? folder : "";
  const l = typeof leaf === "string" ? leaf : "";
  return normalizeFolderPath(f + "/" + l);
}

/**
 * folder が base 自身またはその子孫かを判定する（検索のフォルダスコープ用）。
 * base="" は全件対象として常に true。
 */
export function isUnderFolder(folder, base) {
  const f = normalizeFolderPath(folder);
  const b = normalizeFolderPath(base);
  if (b === "") return true;
  return f === b || f.indexOf(b + "/") === 0;
}

/** 正規表現の特殊文字をエスケープしてリテラル化する。 */
export function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 検索クエリから名前マッチャ (predicate) を作る。
 * - 空クエリ: 常に true
 * - 正規表現として解釈（大文字小文字無視・部分一致）。"二三" は "一二三" にマッチ。
 * - 不正な正規表現はリテラル部分一致にフォールバック（入力途中で壊れない）。
 */
export function compileNameMatcher(query) {
  const q = asTrimmedString(query);
  if (!q) return () => true;
  let re;
  try {
    re = new RegExp(q, "i");
  } catch {
    re = new RegExp(escapeRegExp(q), "i");
  }
  return (name) => re.test(typeof name === "string" ? name : String(name == null ? "" : name));
}

/**
 * currentPath 直下のフォルダとアイテムに分割する。
 * フォルダの count は配下（子孫含む）のアイテム件数。
 *
 * extraFolderPaths（登録簿の永続フォルダパス）を渡すと、アイテムを持たない空フォルダも
 * 子フォルダとして列挙する（count は 0）。
 *
 * @param {Array} items
 * @param {{ getFolder: (item: any) => string, currentPath?: string, extraFolderPaths?: Array<string> }} opts
 * @returns {{ folders: Array<{name: string, path: string, count: number}>, items: Array }}
 */
export function buildFolderLevel(items, { getFolder, currentPath = "", extraFolderPaths = [] } = {}) {
  const base = normalizeFolderPath(currentPath);
  const prefix = base ? base + "/" : "";
  const directItems = [];
  const folderCounts = new Map(); // childName -> count（子孫含む）

  const noteChild = (folder, increment) => {
    if (folder === base) return false; // base 自身（直下アイテム扱い）
    // base 配下でないものは無視（base が "" のときは全件が配下）
    if (base && !(folder + "/").startsWith(prefix)) return false;
    const rest = base ? folder.slice(prefix.length) : folder;
    if (!rest) return false;
    const childName = rest.split("/")[0];
    folderCounts.set(childName, (folderCounts.get(childName) || 0) + increment);
    return true;
  };

  for (const item of items || []) {
    const folder = normalizeFolderPath(getFolder ? getFolder(item) : "");
    if (folder === base) {
      directItems.push(item);
      continue;
    }
    noteChild(folder, 1);
  }

  // 登録簿の空フォルダを 0 件として確保（既にカウント済みの子は増えない）
  for (const raw of extraFolderPaths || []) {
    const folder = normalizeFolderPath(raw);
    if (!folder) continue;
    const handled = noteChild(folder, 0);
    if (handled) {
      const rest = base ? folder.slice(prefix.length) : folder;
      const childName = rest.split("/")[0];
      if (!folderCounts.has(childName)) folderCounts.set(childName, 0);
    }
  }

  const folders = Array.from(folderCounts.entries())
    .map(([name, count]) => ({ name, path: prefix + name, count }))
    .sort((a, b) => a.name.localeCompare(b.name, "ja"));

  return { folders, items: directItems };
}

/** path 配下（path 自身 or "path/" 前方一致）のアイテム件数。削除確認の件数算出用。 */
export function countItemsUnder(items, getFolder, path) {
  const base = normalizeFolderPath(path);
  if (!base) return (items || []).length;
  const prefix = base + "/";
  let count = 0;
  for (const item of items || []) {
    const folder = normalizeFolderPath(getFolder ? getFolder(item) : "");
    if (folder === base || folder.startsWith(prefix)) count += 1;
  }
  return count;
}

/** path が既知フォルダ集合に含まれるか（移動先の存在チェック用）。空は常に true（=最上位）。 */
export function folderExists(paths, path) {
  const target = normalizeFolderPath(path);
  if (!target) return true;
  return (paths || []).some((p) => normalizeFolderPath(p) === target);
}

// ---------------------------------------------------------------------------
// 楽観的フォルダ操作のためのパス書換え純関数（move / rename / delete）。
// エンティティの folder 文字列にも folders 登録簿にも同じロジックを使う。
// 「対象外」は null を返し、呼び出し側で「変更なし＝元の値を据え置き」と解釈する。
// ---------------------------------------------------------------------------

/** path の葉名（最後のセグメント）。 */
function leafName(path) {
  const p = normalizeFolderPath(path);
  if (!p) return "";
  const segs = p.split("/");
  return segs[segs.length - 1];
}

/** path の親パス（葉を除いた部分）。最上位は ""。 */
function parentPath(path) {
  const p = normalizeFolderPath(path);
  if (!p) return "";
  return p.split("/").slice(0, -1).join("/");
}

/** 順序を保ったまま重複パスを除去する。 */
function dedupePaths(paths) {
  const seen = new Set();
  const out = [];
  for (const raw of paths || []) {
    const p = normalizeFolderPath(raw);
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

/**
 * 移動: targetPath（フォルダ）を destPath 配下へ移したときの path の新パスを返す。
 * path が target 自身またはその子孫のときのみ新パス、無関係なら null。
 * 例: reparentFolderPath("a/b/c", "a/b", "x") → "x/b/c"
 */
export function reparentFolderPath(path, targetPath, destPath) {
  const p = normalizeFolderPath(path);
  const t = normalizeFolderPath(targetPath);
  if (!t) return null; // 最上位そのものは移動対象にできない
  const newBase = normalizeFolderPath(joinFolderPath(destPath, leafName(t)));
  if (p === t) return newBase;
  if (p.startsWith(t + "/")) return normalizeFolderPath(newBase + p.slice(t.length));
  return null;
}

/** folders 一覧へ複数フォルダ移動（movedPaths → destPath 配下）を適用した新配列。 */
export function reparentFolders(folders, movedPaths, destPath) {
  const moved = (movedPaths || []).map(normalizeFolderPath).filter(Boolean);
  const next = (folders || []).map((raw) => {
    const p = normalizeFolderPath(raw);
    for (const m of moved) {
      const np = reparentFolderPath(p, m, destPath);
      if (np !== null) return np;
    }
    return p;
  });
  return dedupePaths(next);
}

/**
 * 名前変更: targetPath の葉名を newName にしたときの path の新パスを返す。
 * path が target 自身またはその子孫のときのみ新パス、無関係なら null。
 * 例: renameFolderPath("a/b/c", "a/b", "B2") → "a/B2/c"
 */
export function renameFolderPath(path, targetPath, newName) {
  const p = normalizeFolderPath(path);
  const t = normalizeFolderPath(targetPath);
  if (!t) return null;
  const newBase = normalizeFolderPath(joinFolderPath(parentPath(t), newName));
  if (!newBase) return null; // 空名は不可
  if (p === t) return newBase;
  if (p.startsWith(t + "/")) return normalizeFolderPath(newBase + p.slice(t.length));
  return null;
}

/** folders 一覧へフォルダ名変更を適用した新配列。 */
export function renameFolderPaths(folders, targetPath, newName) {
  const next = (folders || []).map((raw) => {
    const p = normalizeFolderPath(raw);
    const np = renameFolderPath(p, targetPath, newName);
    return np !== null ? np : p;
  });
  return dedupePaths(next);
}

/** 削除: path 自身およびその子孫を folders 一覧から除去した新配列。 */
export function removeFolderSubtree(folders, path) {
  const base = normalizeFolderPath(path);
  if (!base) return (folders || []).map(normalizeFolderPath); // 最上位は削除しない
  return (folders || [])
    .map(normalizeFolderPath)
    .filter((p) => p !== base && !p.startsWith(base + "/"));
}

/**
 * 1 エンティティの folder 文字列を操作後の値に再計算する。
 * - op="move":   itemIds に id が含まれれば destPath、配下フォルダ移動なら reparent。
 * - op="rename": 配下なら rename 後のパス。
 * - op="delete": 配下なら null（＝削除対象。呼び出し側でキャッシュ除去）。
 * いずれも対象外なら「変更なし」を表す元の folder（delete は元の folder）を返す。
 * 返り値 null は delete 対象のときのみ。
 *
 * @returns {string|null} 新しい folder（delete 対象は null）
 */
export function reassignEntityFolder(entityFolder, op, params = {}) {
  const folder = normalizeFolderPath(entityFolder);
  if (op === "move") {
    const { itemId, itemIds = [], folderPaths = [], destPath = "" } = params;
    if (itemId && (itemIds || []).includes(itemId)) return normalizeFolderPath(destPath);
    for (const m of folderPaths || []) {
      const np = reparentFolderPath(folder, m, destPath);
      if (np !== null) return np;
    }
    return folder;
  }
  if (op === "rename") {
    const { path, newName } = params;
    const np = renameFolderPath(folder, path, newName);
    return np !== null ? np : folder;
  }
  if (op === "delete") {
    const { path } = params;
    return isUnderFolder(folder, path) ? null : folder;
  }
  return folder;
}

/** パンくず用にパスをセグメント配列へ。"a/b" → [{name:"a",path:"a"},{name:"b",path:"a/b"}] */
export function splitBreadcrumbs(currentPath) {
  const base = normalizeFolderPath(currentPath);
  if (!base) return [];
  const out = [];
  let acc = "";
  for (const seg of base.split("/")) {
    acc = acc ? acc + "/" + seg : seg;
    out.push({ name: seg, path: acc });
  }
  return out;
}
