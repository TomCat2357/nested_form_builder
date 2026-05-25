import { useEffect } from "react";

/**
 * 非同期処理付き useEffect の `let cancelled = false; ... return () => { cancelled = true; }`
 * パターンを集約するフック。
 *
 * `asyncFn(isCancelled, setCleanup)` の引数:
 *   - `isCancelled()` : in-flight 中のキャンセル判定。
 *   - `setCleanup(fn)` : アンマウント / deps 変化時に呼ぶ cleanup を同期的に登録する。
 *
 * cleanup を同期的に登録する設計は、async 処理が走っている最中の unmount でも
 * cleanup が確実に呼ばれるようにするため（async 関数の `return` で渡す方式だと
 * 登録前 unmount でリーク）。
 *
 * @param {(isCancelled: () => boolean, setCleanup: (fn: () => void) => void) => (Promise<void> | void)} asyncFn
 * @param {Array<any>} deps
 */
export function useCancellable(asyncFn, deps) {
  useEffect(() => {
    let cancelled = false;
    let cleanup = null;
    const isCancelled = () => cancelled;
    const setCleanup = (fn) => { cleanup = typeof fn === "function" ? fn : null; };
    Promise.resolve()
      .then(() => asyncFn(isCancelled, setCleanup))
      .catch(() => { /* asyncFn 側で try/catch すること */ });
    return () => {
      cancelled = true;
      if (cleanup) {
        try { cleanup(); } catch (_e) { /* noop */ }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
