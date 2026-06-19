/**
 * 開いた履歴（openHistory）に基づく起動時の先行プリフェッチ。
 *
 * 「よく開く × 最近」上位 N 件のフォーム/ダッシュボードについて、まだキャッシュに
 * （鮮度内で）無いレコードだけを、ユーザーが開く前にバックグラウンドで温める。
 * 重い処理は dataStore.listEntries（メモリ常駐レコードへの取り込み）。
 *
 * ダッシュボードは自身に直接レコードが無く、カード → question → formSources の経路で
 * ソースフォームを解決し、そのレコードを温める。
 *
 * 設計上の約束:
 *   - 起動を妨げない: いかなる失敗も throw しない（fire-and-forget）。
 *   - GAS に優しい: 対象フォームは dedup し、逐次（直列）に温める。
 *   - 無駄打ちしない: 鮮度内のフォームはスキップ（= 「キャッシュに無いときだけ先行呼び出し」）。
 */

import { ensureArray } from "../../utils/arrays.js";
import { PREFETCH_TOP_N } from "../../core/constants.js";
import { getTopOpened } from "./openHistoryStore.js";
import { dataStore } from "./dataStore.js";
import { getRecordsFromCache } from "./recordsMemoryStore.js";
import { evaluateCacheForRecords } from "./cachePolicy.js";
import { dashboardCache, questionCache } from "../../features/analytics/analyticsCache.js";
import { analyticsGasClient } from "../../features/analytics/analyticsGasClient.js";

/**
 * 1 フォームのレコードを温める。鮮度内ならスキップ。失敗は握り潰す。
 * @param {string} formId
 * @param {Set<string>} seen 既処理 formId（重複呼び出し防止）
 */
async function warmFormRecords(formId, seen) {
  if (!formId || seen.has(formId)) return;
  seen.add(formId);
  try {
    const cache = await getRecordsFromCache(formId);
    const hasData = (cache?.entries?.length || 0) > 0;
    const decision = evaluateCacheForRecords({ lastSyncedAt: cache?.lastSyncedAt || null, hasData });
    // 既にキャッシュ鮮度内なら何もしない（先行取得は不要）。
    if (decision.isFresh) return;
    await dataStore.listEntries(formId);
  } catch (err) {
    // 未設定フォーム（spreadsheet 未構成）や local_ 未アップロード等は静かにスキップ。
    console.warn("[prefetchTopOpened] warm form skipped", formId, err?.message || err);
  }
}

/**
 * ダッシュボードのソースフォーム id 群を解決する。
 * キャッシュ済み定義を優先し、無ければ GAS から取得（best-effort）。
 * @returns {Promise<string[]>}
 */
async function resolveDashboardSourceFormIds(dashboardId, dashMap, questionMap) {
  let def = dashMap.get(dashboardId);
  if (!def) {
    try {
      def = (await analyticsGasClient.getDashboard(dashboardId))?.dashboard || null;
    } catch (_err) { /* 取得失敗は無視（先読みは best-effort） */ }
  }
  if (!def || !Array.isArray(def.cards)) return [];

  const formIds = [];
  for (const card of def.cards) {
    const questionId = card?.questionId;
    if (!questionId) continue;
    let q = questionMap.get(questionId);
    if (!q) {
      try {
        q = (await analyticsGasClient.getQuestion(questionId))?.question || null;
      } catch (_err) { /* 同上 */ }
    }
    const query = q?.query;
    if (!query) continue;
    for (const src of (ensureArray(query.formSources))) {
      if (src?.formId) formIds.push(src.formId);
    }
    // SQL モード等で raw SQL から参照されるフォーム（保存時に再構築済み）も拾う。
    for (const fid of (ensureArray(query.referencedFormIds))) {
      if (fid) formIds.push(fid);
    }
  }
  return formIds;
}

/**
 * 上位 N 件のフォーム/ダッシュボードのレコードを先行プリフェッチする。
 * @param {object} [opts]
 * @param {number} [opts.topN] 各エンティティ種別で先読みする件数
 */
export async function prefetchTopOpened({ topN = PREFETCH_TOP_N } = {}) {
  try {
    const [topForms, topDashboards] = await Promise.all([
      getTopOpened("form", topN),
      getTopOpened("dashboard", topN),
    ]);
    if (topForms.length === 0 && topDashboards.length === 0) return;

    // 定義は IndexedDB キャッシュから一括取得して Map 化（カード/フォーム参照解決用）。
    const [dashAll, questionAll] = await Promise.all([
      dashboardCache.getAll().catch(() => []),
      questionCache.getAll().catch(() => []),
    ]);
    const dashMap = new Map(dashAll.map((d) => [d.id, d]));
    const questionMap = new Map(questionAll.map((q) => [q.id, q]));

    // 温める対象フォーム id を収集（フォーム自身 ＋ ダッシュボードのソースフォーム）。
    const targetFormIds = [];
    for (const f of topForms) {
      if (f?.entityId) targetFormIds.push(f.entityId);
    }
    for (const d of topDashboards) {
      if (!d?.entityId) continue;
      const ids = await resolveDashboardSourceFormIds(d.entityId, dashMap, questionMap);
      targetFormIds.push(...ids);
    }

    // dedup しつつ逐次に温める（GAS 負荷を抑える）。
    const seen = new Set();
    for (const formId of targetFormIds) {
      await warmFormRecords(formId, seen);
    }
  } catch (err) {
    console.warn("[prefetchTopOpened] failed", err);
  }
}
