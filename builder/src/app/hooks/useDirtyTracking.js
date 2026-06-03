import { useEffect, useRef, useState } from "react";

/**
 * snapshot（直列化済みの編集内容）の初回値をベースラインとして記録し、以後の変化を
 * isDirty として返す。baselineReady が true になった最初のレンダーでベースラインを確定する
 * （非同期ロード完了を待ってから基準を取る用途）。
 * @param {string} snapshot 現在の編集内容を直列化した文字列
 * @param {boolean} baselineReady ベースラインを確定してよいか（ロード完了など）
 * @returns {boolean} isDirty
 */
export function useDirtyTracking(snapshot, baselineReady) {
  const baselineRef = useRef(null);
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    if (!baselineReady) return;
    if (baselineRef.current === null) {
      baselineRef.current = snapshot;
      setIsDirty(false);
      return;
    }
    setIsDirty(baselineRef.current !== snapshot);
  }, [baselineReady, snapshot]);

  return isDirty;
}
