/**
 * 開いたフォーム/ダッシュボードの履歴ストア（IndexedDB: openHistory, v9）。
 *
 * 1 件 = 1 エンティティ。key は "<entityType>:<entityId>"。
 * 「よく開く順 ＋ 最近順」のハイブリッドで上位 N 件を選ぶための openCount / lastOpenedAt を持つ。
 * これを起動時の先行プリフェッチ（prefetchTopOpened.js）が利用する。
 *
 * 記録は fire-and-forget（UI を止めない）。失敗は console.warn で握り潰す。
 */

import { STORE_NAMES, withTransaction, waitForRequest } from "./dbHelpers.js";
import { OPEN_HISTORY_MAX_ENTRIES, OPEN_HISTORY_HALF_LIFE_DAYS } from "../../core/constants.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const historyKey = (entityType, entityId) => `${entityType}:${entityId}`;

/**
 * 履歴エントリ群を「よく開く × 最近」のスコアで降順ソートし上位 limit 件を返す純関数。
 * score = openCount * 2^(-ageDays / HALF_LIFE)。Date.now() は now で注入（テスト容易化）。
 *
 * @param {Array<{entityType:string, entityId:string, openCount:number, lastOpenedAt:number}>} entries
 * @param {object} [opts]
 * @param {number} [opts.now] 基準時刻（ms）。既定は Date.now()
 * @param {number} [opts.limit] 返す最大件数。未指定なら全件
 * @param {number} [opts.halfLifeDays] recency 減衰の半減期（日）
 * @returns {Array} スコア降順に並べたエントリ（元オブジェクトのまま）
 */
export function rankOpenHistory(entries, { now = Date.now(), limit = Infinity, halfLifeDays = OPEN_HISTORY_HALF_LIFE_DAYS } = {}) {
  const list = Array.isArray(entries) ? entries.filter(Boolean) : [];
  const scoreOf = (e) => {
    const count = Number.isFinite(e?.openCount) ? e.openCount : 0;
    const last = Number.isFinite(e?.lastOpenedAt) ? e.lastOpenedAt : 0;
    const ageDays = Math.max(0, (now - last) / MS_PER_DAY);
    const decay = Math.pow(2, -ageDays / halfLifeDays);
    return count * decay;
  };
  // スコア降順。同点は最近開いた順（lastOpenedAt 降順）で安定化する。
  const ranked = list
    .map((e) => ({ e, score: scoreOf(e) }))
    .sort((a, b) => (b.score - a.score) || ((b.e?.lastOpenedAt || 0) - (a.e?.lastOpenedAt || 0)))
    .map((x) => x.e);
  return Number.isFinite(limit) ? ranked.slice(0, limit) : ranked;
}

/**
 * フォーム/ダッシュボードを開いたことを記録する。openCount を +1 し lastOpenedAt を更新。
 * 失敗しても投げない（fire-and-forget）。
 */
export async function recordOpen(entityType, entityId) {
  if (!entityType || !entityId) return;
  try {
    await withTransaction(STORE_NAMES.openHistory, "readwrite", async (store) => {
      const key = historyKey(entityType, entityId);
      const existing = await waitForRequest(store.get(key));
      const next = {
        key,
        entityType,
        entityId,
        openCount: (Number.isFinite(existing?.openCount) ? existing.openCount : 0) + 1,
        lastOpenedAt: Date.now(),
      };
      await waitForRequest(store.put(next));

      // 肥大防止: 上限超過なら lastOpenedAt が古い順に prune する。
      const all = await waitForRequest(store.getAll());
      if (Array.isArray(all) && all.length > OPEN_HISTORY_MAX_ENTRIES) {
        const stale = all
          .slice()
          .sort((a, b) => (a?.lastOpenedAt || 0) - (b?.lastOpenedAt || 0))
          .slice(0, all.length - OPEN_HISTORY_MAX_ENTRIES);
        for (const item of stale) {
          await waitForRequest(store.delete(item.key));
        }
      }
    });
  } catch (err) {
    console.warn("[openHistoryStore] recordOpen failed", err);
  }
}

/**
 * 指定エンティティ種別の上位 limit 件を「よく開く × 最近」スコア順で返す。
 * @param {"form"|"dashboard"} entityType
 * @param {number} limit
 * @returns {Promise<Array<{entityType:string, entityId:string, openCount:number, lastOpenedAt:number}>>}
 */
export async function getTopOpened(entityType, limit) {
  try {
    const all = await withTransaction(STORE_NAMES.openHistory, "readonly", async (store) => {
      return (await waitForRequest(store.getAll())) || [];
    });
    const filtered = entityType ? all.filter((e) => e?.entityType === entityType) : all;
    return rankOpenHistory(filtered, { limit });
  } catch (err) {
    console.warn("[openHistoryStore] getTopOpened failed", err);
    return [];
  }
}
