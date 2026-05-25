import { useEffect, useState } from "react";

/**
 * 非同期リソース取得 + キャンセル対応のフック。
 * deps 変化時 / アンマウント時に in-flight Promise の結果を破棄する。
 *
 * @param {() => Promise<any>} asyncFn
 * @param {Array<any>} deps
 * @returns {{ data: any, loading: boolean, error: string | null, setData: Function }}
 */
export function useAsyncResource(asyncFn, deps) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.resolve()
      .then(() => asyncFn())
      .then((res) => { if (!cancelled) setData(res); })
      .catch((err) => { if (!cancelled) setError(err.message || String(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading, error, setData };
}
