import { useEffect } from "react";

/**
 * isDirty が true のとき、ページ離脱前に確認ダイアログを表示する
 * @param {boolean} isDirty
 */
export function useBeforeUnloadGuard(isDirty) {
  useEffect(() => {
    const handleBeforeUnload = (event) => {
      if (!isDirty) return;
      event.preventDefault();
      event.returnValue = "未アップロードの変更があります。このまま離れると変更が失われる可能性があります。";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);
}
