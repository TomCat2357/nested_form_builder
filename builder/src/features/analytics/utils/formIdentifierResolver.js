import { normalizeFolderPath, joinFolderPath } from "../../../utils/folderTree.js";

// フォームの葉タイトル（＝Drive ファイル名・フォルダを含まない表示名）。
function formLeafTitle(form) {
  return (form && form.settings && form.settings.formTitle) || (form && form.name) || "";
}

/**
 * フォルダ込みフォーム名（"フォルダ/サブ/フォーム名"）を返す。folder 空ならタイトルのみ。
 * SQL の参照・保存する formName・UI 表示で用いる正規の識別名。
 */
export function formQualifiedName(form) {
  if (!form) return "";
  return joinFolderPath(form.folder, formLeafTitle(form));
}

/**
 * フォーム参照の索引を構築する。
 *   byId        : fileId → form
 *   byTitle     : 葉タイトル → form（同名は最古を保持）
 *   byTitleAll  : 葉タイトル → form[]（曖昧検知・エラー例示用）
 *   byPath      : 正規化フォルダ込み名 → form（同名は最古を保持）
 * 葉タイトルが衝突する場合、バレ名（フォルダなし）参照は曖昧として解決しない。
 */
export function buildFormIndex(forms) {
  const byId = new Map();
  const byTitle = new Map();
  const byTitleAll = new Map();
  const byPath = new Map();
  const list = Array.isArray(forms) ? forms.slice() : [];
  list.sort((a, b) => {
    const at = Number(a?.createdAtUnixMs || a?.createdAt || 0);
    const bt = Number(b?.createdAtUnixMs || b?.createdAt || 0);
    return at - bt;
  });
  for (const form of list) {
    if (!form || !form.id) continue;
    byId.set(String(form.id), form);
    const title = formLeafTitle(form);
    if (title) {
      if (!byTitle.has(title)) byTitle.set(title, form);
      if (!byTitleAll.has(title)) byTitleAll.set(title, []);
      byTitleAll.get(title).push(form);
      const path = formQualifiedName(form);
      if (path && !byPath.has(path)) byPath.set(path, form);
    }
  }
  return { byId, byTitle, byTitleAll, byPath };
}

/** token に紐づく葉タイトルが索引内で複数フォームに対応する（バレ名が曖昧）か。 */
export function isAmbiguousBareTitle(token, index) {
  if (!token || !index || !index.byTitleAll) return false;
  const key = String(token);
  if (key.indexOf("/") !== -1) return false;
  const all = index.byTitleAll.get(key);
  return !!(all && all.length > 1);
}

/**
 * 参照トークンをフォームへ解決する。
 *   - "/" を含む → フォルダ込み名としてパス厳密一致（無ければ null）。
 *   - バレ名     → 葉タイトルが一意なら解決 / 同名複数は曖昧として null / それ以外は id 一致。
 */
export function resolveFormRef(token, index) {
  if (!token || !index) return null;
  const key = String(token);
  if (key.indexOf("/") !== -1) {
    const path = normalizeFolderPath(key);
    return (index.byPath && index.byPath.get(path)) || null;
  }
  if (index.byTitle && index.byTitle.has(key)) {
    if (isAmbiguousBareTitle(key, index)) return null; // 曖昧 → フォルダ込み指定を促す
    return index.byTitle.get(key);
  }
  if (index.byId && index.byId.has(key)) return index.byId.get(key);
  return null;
}
