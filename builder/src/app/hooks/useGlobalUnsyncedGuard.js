import { useEffect } from "react";
import { hasAnyUnsynced, syncStateListeners } from "../../features/search/globalSyncState.js";

/**
 * メモリ上に未アップロードのレコードがある状態でページを離脱しようとしたら、
 * ブラウザの標準ダイアログで確認させる。
 *
 * PR-7 で IndexedDB のレコードキャッシュを撤去したため、リロード/タブ閉じで
 * 未同期データが完全に失われる。SearchPage 専用ガードでは Question 画面など
 * からの離脱を捕捉できないので、App ルートに常駐させる。
 */
export function useGlobalUnsyncedGuard() {
  useEffect(() => {
    let dirty = hasAnyUnsynced();
    const refreshDirty = () => {
      dirty = hasAnyUnsynced();
    };
    syncStateListeners.add(refreshDirty);

    const handleBeforeUnload = (event) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "未アップロードの変更があります。このまま離れると変更が失われる可能性があります。";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      syncStateListeners.delete(refreshDirty);
    };
  }, []);
}
