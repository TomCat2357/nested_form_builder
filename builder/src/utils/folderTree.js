/**
 * フォルダパス文字列と一覧のドリルダウン / 検索のための純関数群。
 * folder は "a/b/c" 形式の正規化済みパス、未指定は ""。
 */

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
  const q = typeof query === "string" ? query.trim() : "";
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
