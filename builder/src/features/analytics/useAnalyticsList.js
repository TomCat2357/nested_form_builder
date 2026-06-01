import { useCallback, useEffect, useRef, useState } from "react";
import { subscribeAnalyticsCache } from "./analyticsCache.js";

/**
 * Analytics 一覧（Question / Dashboard）の SWR フック。
 * キャッシュ済みデータを即座に表示し、鮮度に応じてバックグラウンドで更新する。
 *
 * 一覧コンポーネント（HomeDashboards / AdminAnalyticsListPage）で共有するため、
 * ストア側の `listSWR`（{ items, blocking, sync } を返す）だけを受け取る薄いラッパ。
 *
 * @param {object} cfg
 * @param {(opts: { includeArchived?: boolean, forceRefresh?: boolean }) => Promise<{ items: any[], blocking: boolean, sync: Promise<any[]>|null }>} cfg.listSWR
 * @param {boolean} [cfg.includeArchived] アーカイブ済みも含めて取得するか
 * @returns {{ items: any[], loading: boolean, refreshing: boolean, error: string|null, refresh: () => Promise<void> }}
 *   - loading: 表示できるデータが無く、初回取得を待っている間だけ true
 *   - refreshing: 既存表示を保ったまま裏で更新中なら true
 *   - refresh: 手動再取得（既存表示を残したまま取り直す）
 */
export function useAnalyticsList({ listSWR, includeArchived = false }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  // アンマウント / 再実行後に古い非同期結果を破棄するためのトークン。
  const runIdRef = useRef(0);

  const run = useCallback(async ({ forceRefresh = false } = {}) => {
    const runId = ++runIdRef.current;
    setError(null);
    let result;
    try {
      result = await listSWR({ includeArchived, forceRefresh });
    } catch (err) {
      if (runId === runIdRef.current) {
        setError(err.message || String(err));
        setLoading(false);
        setRefreshing(false);
      }
      return;
    }
    if (runId !== runIdRef.current) return;

    setItems(result.items);
    // blocking のときはキャッシュを信用せず取得完了までスピナーを出し続ける。
    setLoading(result.blocking);

    if (!result.sync) {
      setLoading(false);
      return;
    }
    // 表示できるデータがあるなら「更新中...」、無いならスピナー継続。
    setRefreshing(!result.blocking);
    try {
      const fresh = await result.sync;
      if (runId !== runIdRef.current) return;
      setItems(fresh);
    } catch (err) {
      if (runId !== runIdRef.current) return;
      setError(err.message || String(err));
    } finally {
      if (runId === runIdRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [listSWR, includeArchived]);

  useEffect(() => {
    run();
    return () => { runIdRef.current += 1; };
  }, [run]);

  // オフライン保存の楽観的更新やバックグラウンドアップロード成功（一時 ID→実 ID の付け替え）で
  // キャッシュが変わったら、キャッシュ優先で再評価して一覧へ反映する。
  useEffect(() => subscribeAnalyticsCache(() => { run(); }), [run]);

  const refresh = useCallback(() => run({ forceRefresh: true }), [run]);

  return { items, loading, refreshing, error, refresh };
}
