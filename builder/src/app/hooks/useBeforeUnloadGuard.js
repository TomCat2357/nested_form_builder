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
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);
}
