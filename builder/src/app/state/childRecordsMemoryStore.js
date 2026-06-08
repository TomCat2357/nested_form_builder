/**
 * 子フォーム（formLink）の「回答レコード詳細」と「件数バッジ」の per-session メモリキャッシュ。
 *
 * recordsMemoryStore.js と同じ流儀（モジュールレベル Map シングルトン / lastSyncedAt メタ /
 * 例外を投げない読み出し / テスト用 reset）に倣う。レコード本体が v6+ でメモリ常駐に
 * なったのと同じ理由で、子データもタブ単位の揮発キャッシュとして持つ（reload で消える）。
 *
 * キーは `childFormId::pid`。1 エントリは以下:
 *   { childData: object|null, count: number|null, lastSyncedAt: number }
 *
 * - childData は childFormData.js の buildChildDataObject() が返す合成オブジェクト
 *   （{ childFormId, childFormName, childFormUrl, count, truncated?, records } / includeChildData=ON 用）。
 * - "detail" エントリ（childData あり）は count も持つので、count 読みも満たす。
 *   逆（count のみ）は detail 読みを満たさない。
 *
 * SWR の鮮度判定は呼び出し側（PreviewPage）が cachePolicy.js の evaluateCacheForRecords に
 * lastSyncedAt を渡して行う。本ストアはしきい値を持たない。
 */

// childFormId::pid → { childData, count, lastSyncedAt }
const store = new Map();

// 子フォームのレコード変化（保存・複製による invalidate）を購読するリスナ集合。
// 親の PreviewPage が自分の formLink 子フォームの変化を受けて、件数バッジ・取り込み子データ・
// full-query 集計を再計算するために使う（サーバ往復せずローカル warm ストアから再計算する）。
const changeListeners = new Set();

/**
 * 子フォームのレコード変化を購読する。invalidateChildForm / invalidateChildRecords が呼ばれると
 * 該当 childFormId を引数にリスナが呼ばれる。返り値の関数で購読解除する。
 *
 * @param {(childFormId: string) => void} fn
 * @returns {() => void} unsubscribe
 */
export function subscribeChildFormChange(fn) {
  if (typeof fn !== "function") return () => {};
  changeListeners.add(fn);
  return () => { changeListeners.delete(fn); };
}

function notifyChildFormChange_(childFormId) {
  const id = String(childFormId || "").trim();
  if (!id) return;
  for (const fn of changeListeners) {
    try { fn(id); } catch (_e) { /* リスナ例外は他リスナへ波及させない */ }
  }
}

export const childCacheKey = (childFormId, pid) =>
  `${String(childFormId || "").trim()}::${String(pid || "").trim()}`;

/**
 * 子データ（詳細 or 件数）をキャッシュから読み出す。例外は投げない。
 *
 * @param {string} childFormId
 * @param {string} pid 親レコード id
 * @param {{kind?: "detail"|"count"}} [opts] detail は childData 必須、count は count 非 null で満たす。
 * @returns {Promise<{hasData:boolean, childData:object|null, count:number|null, lastSyncedAt:number|null}>}
 */
export async function getChildRecordsFromCache(childFormId, pid, { kind = "detail" } = {}) {
  const key = childCacheKey(childFormId, pid);
  const entry = store.get(key);
  if (!entry) {
    return { hasData: false, childData: null, count: null, lastSyncedAt: null };
  }
  const hasData = kind === "detail" ? entry.childData != null : entry.count != null;
  return {
    hasData,
    childData: entry.childData ?? null,
    count: entry.count ?? null,
    lastSyncedAt: entry.lastSyncedAt ?? null,
  };
}

/**
 * 子レコード詳細（includeChildData=ON）をキャッシュへ保存する。count も childData.count から設定。
 *
 * @param {string} childFormId
 * @param {string} pid
 * @param {object} childData buildChildDataObject() の戻り値
 */
export async function saveChildDataToCache(childFormId, pid, childData) {
  if (!childFormId || !pid || !childData || typeof childData !== "object") return;
  const key = childCacheKey(childFormId, pid);
  const count = Number.isFinite(childData.count) ? childData.count : null;
  store.set(key, { childData, count, lastSyncedAt: Date.now() });
}

/**
 * 件数バッジのみをキャッシュへ保存する（detail は持たない）。
 *
 * @param {string} childFormId
 * @param {string} pid
 * @param {number} count
 */
export async function saveChildCountToCache(childFormId, pid, count) {
  if (!childFormId || !pid || !Number.isFinite(count)) return;
  const key = childCacheKey(childFormId, pid);
  store.set(key, { childData: null, count, lastSyncedAt: Date.now() });
}

/**
 * 指定 childFormId に紐づく全 pid のエントリを破棄する（子レコード保存/複製時の無効化）。
 * childFormId が未参照なら no-op。
 *
 * @param {string} childFormId
 */
export async function invalidateChildForm(childFormId) {
  const id = String(childFormId || "").trim();
  if (!id) return;
  const prefix = `${id}::`;
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
  notifyChildFormChange_(id);
}

/**
 * 単一の childFormId::pid エントリを破棄する。
 *
 * @param {string} childFormId
 * @param {string} pid
 */
export async function invalidateChildRecords(childFormId, pid) {
  store.delete(childCacheKey(childFormId, pid));
  notifyChildFormChange_(childFormId);
}

// テスト用 — キャッシュを空にする。
export function __resetChildRecordsCacheForTests() {
  store.clear();
}
