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
import { isLocalId } from "../../core/ids.js";
import { getTopOpened } from "./openHistoryStore.js";
import { dataStore } from "./dataStore.js";
import { getFormsFromCache } from "./formsCache.js";
import { formHasSpreadsheet } from "./dataStoreHelpers.js";
import { getRecordsFromCache } from "./recordsMemoryStore.js";
import { evaluateCacheForRecords } from "./cachePolicy.js";
import { dashboardCache, questionCache } from "../../features/analytics/analyticsCache.js";
import { analyticsGasClient } from "../../features/analytics/analyticsGasClient.js";

/**
 * 1 フォームのレコードを温める。鮮度内ならスキップ。失敗は握り潰す。
 *
 * 先読みは「確実に温められるフォーム」だけを対象にする。次は静かに除外する（無駄な GAS 往復と
 * console エラーを避ける。本来開いたときに通常ロードされるので機能上の支障はない）:
 *   - local_ 未アップロードフォーム（サーバに無い → nfbGetForm が "Form not found"）
 *   - 一覧キャッシュに無いフォーム（コピー直後・削除済みが履歴に残った等）
 *   - スプレッドシート未構成フォーム（同期しても "スプレッドシートID 未設定" になる）
 * @param {string} formId
 * @param {Set<string>} seen 既処理 formId（重複呼び出し防止）
 * @param {Map<string, object>} formsById 一覧キャッシュの formId → フォーム定義
 */
async function warmFormRecords(formId, seen, formsById) {
  if (!formId || seen.has(formId)) return;
  seen.add(formId);
  if (isLocalId(formId)) return;
  const form = formsById ? formsById.get(formId) : null;
  if (!form || !formHasSpreadsheet(form)) return;
  try {
    const cache = await getRecordsFromCache(formId);
    const hasData = (cache?.entries?.length || 0) > 0;
    const decision = evaluateCacheForRecords({ lastSyncedAt: cache?.lastSyncedAt || null, hasData });
    // 既にキャッシュ鮮度内なら何もしない（先行取得は不要）。
    if (decision.isFresh) return;
    // quiet=true でサーバ同期の失敗ログ（console.error）を抑える（先読みの失敗は想定内）。
    await dataStore.listEntries(formId, { quiet: true });
  } catch (err) {
    // ここに来るのは想定外の一過性失敗（オフライン等）。先読みは best-effort なので静かに warn のみ。
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
    // フォーム一覧キャッシュも取り込み、温める前に「サーバに在る × スプレッドシート構成済み」かを判定する。
    const [dashAll, questionAll, formsCache] = await Promise.all([
      dashboardCache.getAll().catch(() => []),
      questionCache.getAll().catch(() => []),
      getFormsFromCache().catch(() => ({ forms: [] })),
    ]);
    const dashMap = new Map(dashAll.map((d) => [d.id, d]));
    const questionMap = new Map(questionAll.map((q) => [q.id, q]));
    const formsById = new Map((formsCache?.forms || []).map((f) => [f.id, f]));

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
      await warmFormRecords(formId, seen, formsById);
    }
  } catch (err) {
    console.warn("[prefetchTopOpened] failed", err);
  }
}
