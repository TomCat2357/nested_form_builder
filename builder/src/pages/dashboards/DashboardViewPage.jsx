import React, { useEffect, useState } from "react";
import { useParams, useLocation } from "react-router-dom";
import AppLayout from "../../app/components/AppLayout.jsx";
import { useAuth } from "../../app/state/authContext.jsx";
import { useAppData } from "../../app/state/AppDataProvider.jsx";
import { useTempIdRedirect } from "../../app/hooks/useTempIdRedirect.js";
import { useAsyncResource } from "../../app/hooks/useAsyncResource.js";
import { analyticsGasClient } from "../../features/analytics/analyticsGasClient.js";
import { resolveDashboardLinks, saveDashboard } from "../../features/analytics/analyticsStore.js";
import { isV2, defaultFilterValue, defaultSimpleFilterValue } from "../../features/analytics/utils/dashboardSchema.js";
import { clearAnalyticsSourceTableCache } from "../../features/analytics/analyticsAlaSql.js";
import DashboardGrid from "../../features/analytics/components/DashboardGrid.jsx";
import DashboardFilterBar from "../../features/analytics/components/DashboardFilterBar.jsx";
import SimpleFilterBar from "../../features/analytics/components/SimpleFilterBar.jsx";

const buildDashboardViewPath = (id) => `/dashboards/${id}`;

export default function DashboardViewPage() {
  const { dashboardId } = useParams();
  // 一時 ID のダッシュボードをディープリンクで開いた場合、アップロード完了後に実 ID へ置き換える。
  useTempIdRedirect(dashboardId, buildDashboardViewPath);
  const location = useLocation();
  const { isAdmin } = useAuth();
  const { forms } = useAppData();

  const [filterValues, setFilterValues] = useState({});
  const [simpleFilterValues, setSimpleFilterValues] = useState({});
  // インクリメントすると全カードがクエリを再実行する（スプレッドシートから最新データを取り直す）
  const [refreshNonce, setRefreshNonce] = useState(0);
  // 閲覧者の一時グローバルフィルタ。ソーステーブル側に WHERE を適用する（ページ滞在中のみ）
  const [globalWhereExpr, setGlobalWhereExpr] = useState("");
  const [globalFilterDraft, setGlobalFilterDraft] = useState("");
  const [globalFilterOpen, setGlobalFilterOpen] = useState(false);

  const { data: fetched, loading, error } = useAsyncResource(
    async () => {
      const res = await analyticsGasClient.getDashboard(dashboardId);
      const d = res.dashboard;
      if (!d || !isV2(d)) return d;
      // リンク切れカードを標準フォルダ 02_questions から再リンクする。
      // 検出したら（管理者のみ保存可能なので）自動で保存し直す。
      const { dashboard: repaired, changed } = await resolveDashboardLinks(d);
      if (changed && isAdmin) {
        try {
          await saveDashboard(repaired);
        } catch (err) {
          console.warn("[DashboardViewPage] auto-relink save failed:", err);
        }
      }
      return repaired;
    },
    [dashboardId, isAdmin],
  );

  const dashboard = fetched && isV2(fetched) ? fetched : null;
  const legacyError = fetched && !isV2(fetched)
    ? "このダッシュボードは旧形式です。再作成してください。"
    : null;

  useEffect(() => {
    if (!dashboard) return;
    const init = {};
    for (const f of dashboard.filters || []) {
      init[f.id] = defaultFilterValue(f);
    }
    setFilterValues(init);
    const simpleInit = {};
    for (const sf of dashboard.simpleFilters || []) {
      simpleInit[sf.id] = defaultSimpleFilterValue();
    }
    setSimpleFilterValues(simpleInit);
  }, [dashboard]);

  return (
    <AppLayout
      title={dashboard?.name || "ダッシュボード"}
      fallbackPath={location.state?.from || "/?view=dashboards"}
      sidebarActions={
        dashboard && (
          <>
            <button
              type="button"
              onClick={() => {
                // 1時間キャッシュを破棄して全カードを最新データで再実行する。
                clearAnalyticsSourceTableCache();
                setRefreshNonce((n) => n + 1);
              }}
              className="nf-btn-outline nf-btn-sidebar"
            >
              🔄 更新
            </button>
            <button
              type="button"
              onClick={() => {
                setGlobalFilterDraft(globalWhereExpr);
                setGlobalFilterOpen((v) => !v);
              }}
              className="nf-btn-outline nf-btn-sidebar"
            >
              詳細フィルター{globalWhereExpr ? " • 適用中" : ""}
            </button>
          </>
        )
      }
    >
      {loading && <p className="nf-text-subtle">読み込み中...</p>}
      {error && <p className="nf-text-warning">{error}</p>}
      {legacyError && <p className="nf-text-warning">{legacyError}</p>}
      {dashboard && (
        <>
          {globalFilterOpen && (
            <div className="nf-card" style={{ padding: "0.75rem", marginBottom: "0.75rem" }}>
              <div style={{ marginBottom: "0.25rem", fontWeight: 600 }}>一時グローバルフィルター</div>
              <div className="nf-text-subtle" style={{ fontSize: "0.85em", marginBottom: "0.5rem" }}>
                各カードのソーステーブル（view 形式）に WHERE を適用します。列名は <code>[列名]</code> で囲んでください
                （ネスト列は <code>[親__子]</code> 形式）。選択肢列はラベル文字列で比較します。該当列を持たないテーブルは無視されます。
              </div>
              <textarea
                value={globalFilterDraft}
                onChange={(e) => setGlobalFilterDraft(e.target.value)}
                placeholder="例: [受付日] > '2025-01-01'"
                rows={2}
                style={{ width: "100%", fontFamily: "monospace", marginBottom: "0.5rem" }}
              />
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button
                  type="button"
                  className="nf-btn"
                  onClick={() => {
                    setGlobalWhereExpr(globalFilterDraft.trim());
                    setGlobalFilterOpen(false);
                  }}
                >
                  適用
                </button>
                <button
                  type="button"
                  className="nf-btn-outline"
                  onClick={() => {
                    setGlobalWhereExpr("");
                    setGlobalFilterDraft("");
                  }}
                >
                  クリア
                </button>
                <button
                  type="button"
                  className="nf-btn-outline"
                  onClick={() => setGlobalFilterOpen(false)}
                >
                  閉じる
                </button>
              </div>
            </div>
          )}
          <DashboardFilterBar
            filters={dashboard.filters || []}
            values={filterValues}
            onChange={setFilterValues}
          />
          <SimpleFilterBar
            simpleFilters={dashboard.simpleFilters || []}
            values={simpleFilterValues}
            onChange={setSimpleFilterValues}
          />
          {(dashboard.cards || []).length === 0 ? (
            <p className="nf-text-subtle">カードがありません。</p>
          ) : (
            <DashboardGrid
              dashboard={dashboard}
              filterValues={filterValues}
              simpleFilters={dashboard.simpleFilters || []}
              simpleFilterValues={simpleFilterValues}
              forms={forms}
              isAdmin={isAdmin}
              editable={false}
              viewerControls
              refreshNonce={refreshNonce}
              globalWhereExpr={globalWhereExpr}
            />
          )}
        </>
      )}
    </AppLayout>
  );
}
