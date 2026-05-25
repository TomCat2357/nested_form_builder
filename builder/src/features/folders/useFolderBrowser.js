import { useCallback, useMemo, useState } from "react";
import {
  buildFolderLevel,
  compileNameMatcher,
  splitBreadcrumbs,
  normalizeFolderPath,
} from "../../utils/folderTree.js";

/**
 * フォルダのドリルダウン + 名前の正規表現検索を一元管理するフック。
 *
 * - query が非空のとき: searching=true。全フォルダ横断で getName に正規表現を当て、
 *   マッチしたアイテムを visibleItems にフラット表示する（フォルダは非表示）。
 * - query が空のとき: currentPath 直下を folders / visibleItems に分割する。
 *
 * 描画（カード / テーブル行）は呼び出し側に任せる。
 *
 * @param {Array} items
 * @param {{ getFolder: (item:any)=>string, getName: (item:any)=>string, folderPaths?: Array<string> }} accessors
 */
export function useFolderBrowser(items, { getFolder, getName, folderPaths = [] } = {}) {
  const [query, setQuery] = useState("");
  const [currentPath, setCurrentPath] = useState("");

  const searching = query.trim().length > 0;

  const openFolder = useCallback((path) => {
    setCurrentPath(normalizeFolderPath(path));
  }, []);

  const goTo = openFolder;

  const goUp = useCallback(() => {
    setCurrentPath((prev) => {
      const base = normalizeFolderPath(prev);
      if (!base) return "";
      const idx = base.lastIndexOf("/");
      return idx === -1 ? "" : base.slice(0, idx);
    });
  }, []);

  const breadcrumbs = useMemo(() => splitBreadcrumbs(currentPath), [currentPath]);

  const { folders, visibleItems } = useMemo(() => {
    if (searching) {
      const match = compileNameMatcher(query);
      const matched = (items || []).filter((item) => match(getName ? getName(item) : ""));
      return { folders: [], visibleItems: matched };
    }
    const level = buildFolderLevel(items, { getFolder, currentPath, extraFolderPaths: folderPaths });
    return { folders: level.folders, visibleItems: level.items };
  }, [items, searching, query, currentPath, getFolder, getName, folderPaths]);

  return {
    query,
    setQuery,
    searching,
    currentPath,
    breadcrumbs,
    openFolder,
    goTo,
    goUp,
    folders,
    visibleItems,
  };
}
