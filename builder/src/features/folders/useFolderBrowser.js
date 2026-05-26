import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  buildFolderLevel,
  compileNameMatcher,
  splitBreadcrumbs,
  normalizeFolderPath,
  isUnderFolder,
} from "../../utils/folderTree.js";

/**
 * フォルダのドリルダウン + 名前の正規表現検索を一元管理するフック。
 *
 * - query が非空のとき: searching=true。currentPath 配下（自身＋子孫）に限って
 *   getName に正規表現を当て、マッチしたアイテムを visibleItems にフラット表示する
 *   （フォルダは非表示）。ルート（currentPath="" ）では全件横断。
 * - query が空のとき: currentPath 直下を folders / visibleItems に分割する。
 *
 * urlParam を指定すると currentPath を URL クエリ（例 ?folder=a/b）に同期し、
 * リロード・戻る・直接遷移でもフォルダ位置を復元できるようにする。未指定なら
 * 従来どおり完全メモリ動作（後方互換）。検索テキスト（query）は同期しない。
 *
 * 描画（カード / テーブル行）は呼び出し側に任せる。
 *
 * @param {Array} items
 * @param {{ getFolder: (item:any)=>string, getName: (item:any)=>string, folderPaths?: Array<string>, urlParam?: string|null }} accessors
 */
export function useFolderBrowser(items, { getFolder, getName, folderPaths = [], urlParam = null } = {}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlPath = urlParam ? normalizeFolderPath(searchParams.get(urlParam) || "") : "";

  const [query, setQuery] = useState("");
  const [currentPath, setCurrentPath] = useState(urlPath);

  const searching = query.trim().length > 0;

  // URL の folder param が外部要因（戻る/直接遷移/復帰）で変わったら currentPath を追従。
  useEffect(() => {
    if (!urlParam) return;
    setCurrentPath((prev) => (prev === urlPath ? prev : urlPath));
  }, [urlParam, urlPath]);

  const applyPath = useCallback((path) => {
    const next = normalizeFolderPath(path);
    setCurrentPath(next);
    if (urlParam) {
      setSearchParams((prev) => {
        const sp = new URLSearchParams(prev);
        if (next) sp.set(urlParam, next);
        else sp.delete(urlParam);
        return sp;
      }, { replace: true });
    }
  }, [urlParam, setSearchParams]);

  const openFolder = useCallback((path) => { applyPath(path); }, [applyPath]);

  const goTo = openFolder;

  const goUp = useCallback(() => {
    const base = normalizeFolderPath(currentPath);
    if (!base) return;
    const idx = base.lastIndexOf("/");
    applyPath(idx === -1 ? "" : base.slice(0, idx));
  }, [currentPath, applyPath]);

  const breadcrumbs = useMemo(() => splitBreadcrumbs(currentPath), [currentPath]);

  const { folders, visibleItems } = useMemo(() => {
    if (searching) {
      const match = compileNameMatcher(query);
      const matched = (items || []).filter((item) =>
        isUnderFolder(getFolder ? getFolder(item) : "", currentPath) &&
        match(getName ? getName(item) : ""),
      );
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
