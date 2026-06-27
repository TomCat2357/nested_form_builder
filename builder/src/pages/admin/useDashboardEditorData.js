// DashboardEditorPage のデータロードを束ねるカスタムフック。
// Question 一覧 / dashboard 本体のロードと、それに紐づく state を集約する。
// コンポーネントから副作用と初期化ロジックを切り出すだけで、挙動は元のまま維持する。

import { useState } from "react";
import { useCancellable } from "../../app/hooks/useCancellable.js";
import { listQuestions, saveDashboard, resolveDashboardLinks } from "../../features/analytics/analyticsStore.js";
import { analyticsGasClient } from "../../features/analytics/analyticsGasClient.js";
import {
  createEmptyV2,
  isV2,
  defaultFilterValue,
  defaultSimpleFilterValue,
} from "../../features/analytics/utils/dashboardSchema.js";

// dashboardId / initialFolder を受け取り、編集ドラフトと各種 state / setter を返す。
export function useDashboardEditorData({ dashboardId, initialFolder }) {
  const [dashboard, setDashboard] = useState(() => ({ ...createEmptyV2({ id: null }), folder: initialFolder }));
  const [questions, setQuestions] = useState([]);
  const [loading, setLoading] = useState(!!dashboardId);
  const [error, setError] = useState(null);
  const [previewValues, setPreviewValues] = useState({});
  const [simpleFilterPreviewValues, setSimpleFilterPreviewValues] = useState({});

  // Question 一覧は初回のみロード（deps []）。背景リフレッシュで再ロードせず、編集中に
  // 参照解決（questionsById 経由のカード表示）が裏で揺れないようにする保護。
  useCancellable(async (isCancelled) => {
    try {
      // 編集画面は開くたびにサーバ最新(.json)を取得する（キャッシュは使わない）。
      const qs = await listQuestions({ forceRefresh: true });
      if (isCancelled()) return;
      setQuestions(qs);
    } catch (err) {
      if (isCancelled()) return;
      console.warn("[DashboardEditorPage] listQuestions failed:", err);
    }
  }, []);

  // dashboard 本体は dashboardId ごとに 1 回だけロード（deps [dashboardId]）。遅延更新で
  // setDashboard を再実行せず、編集中の作業コピー（dashboard ドラフト）を潰さないための保護。
  useCancellable(async (isCancelled) => {
    if (!dashboardId) {
      setDashboard(createEmptyV2({ id: null }));
      return;
    }
    setLoading(true);
    try {
      const res = await analyticsGasClient.getDashboard(dashboardId);
      if (isCancelled()) return;
      const d = res.dashboard;
      if (!isV2(d)) {
        setError("このダッシュボードは旧形式です。新規作成してください。");
        setDashboard(createEmptyV2({ id: dashboardId }));
      } else {
        // リンク切れカードを標準フォルダ 02_questions から再リンクし、検出したら保存し直す。
        let toUse = d;
        try {
          const { dashboard: repaired, changed } = await resolveDashboardLinks(d);
          if (isCancelled()) return;
          toUse = repaired;
          if (changed) {
            try {
              await saveDashboard(repaired);
            } catch (err) {
              console.warn("[DashboardEditorPage] auto-relink save failed:", err);
            }
          }
        } catch (err) {
          console.warn("[DashboardEditorPage] resolveDashboardLinks failed:", err);
        }
        if (isCancelled()) return;
        setDashboard(toUse);
      }
      // フィルタの初期値で previewValues を埋める
      const initVals = {};
      for (const f of d?.filters || []) {
        initVals[f.id] = defaultFilterValue(f);
      }
      setPreviewValues(initVals);
      const simpleInit = {};
      for (const sf of d?.simpleFilters || []) {
        simpleInit[sf.id] = defaultSimpleFilterValue();
      }
      setSimpleFilterPreviewValues(simpleInit);
    } catch (err) {
      if (isCancelled()) return;
      setError(err.message || String(err));
    } finally {
      if (!isCancelled()) setLoading(false);
    }
  }, [dashboardId]);

  return {
    dashboard,
    setDashboard,
    questions,
    loading,
    error,
    setError,
    previewValues,
    setPreviewValues,
    simpleFilterPreviewValues,
    setSimpleFilterPreviewValues,
  };
}
