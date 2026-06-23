/**
 * registryStore — フロント IndexedDB の registry 作業キャッシュ（Phase 3）。
 *
 * 位置づけ: Script Properties registry（{ 物理ID(fileId), 論理パス(folder＋ファイル名) } の
 * 最小・耐久バックストップ）の、フロント側ミラー（派生・再構成可能なキャッシュ）。
 * GAS は IndexedDB を読めないため、サーバ側解決（保存/整合/コピー）は引き続き Script Properties を
 * 使い、フロントは速い参照解決と一覧フォルダ表示のためにこのキャッシュを使う。
 *
 * 値: { id(=fileId), kind, fileId, folder, name, driveFileUrl }。
 *   kind ("forms" | "questions" | "dashboards") を第一級にして 3 種を 1 ストアへ統合する。
 *
 * 喪失耐性: 空（または upgrade 失敗）でも list API / GAS 再構成 API から再生成できる（データ損失なし）。
 *
 * analyticsCache.js の makeListCache パターンを registry 向けに流用する。
 */

import { STORE_NAMES } from "../../core/constants.js";
import { withTransaction, waitForRequest } from "./dbHelpers.js";

export const REGISTRY_KINDS = ["forms", "questions", "dashboards"];

// メタ行（kind ごとの最終サーバ同期時刻）。エンティティ行（id=fileId）と区別するため prefix を付ける。
const META_PREFIX = "__registry_meta__:";
const metaId = (kind) => META_PREFIX + kind;
const isMetaRow = (record) => typeof record?.id === "string" && record.id.indexOf(META_PREFIX) === 0;

// list API の項目（forms は title / analytics は name でラベルを持つ）を registry エントリへ正規化する。
// fileId が無い項目は登録しない（registry の key は物理 ID）。
function normalizeEntry(entry, kind) {
  if (!entry) return null;
  const fileId = entry.fileId || entry.id || "";
  if (!fileId) return null;
  const id = String(fileId);
  const name = typeof entry.name === "string" ? entry.name
    : (typeof entry.title === "string" ? entry.title : "");
  return {
    id,
    kind: entry.kind || kind || "",
    fileId: id,
    folder: typeof entry.folder === "string" ? entry.folder : "",
    name,
    driveFileUrl: typeof entry.driveFileUrl === "string" ? entry.driveFileUrl : "",
  };
}

const storeName = STORE_NAMES.registry;

// 1 件を upsert する（楽観的更新・保存ジョブ完了の付け替え用）。kind 省略時は entry.kind を使う。
async function upsert(entry, kind) {
  const normalized = normalizeEntry(entry, kind);
  if (!normalized || !normalized.kind) return null;
  await withTransaction(storeName, "readwrite", async (store) => {
    await waitForRequest(store.put(normalized));
  });
  return normalized;
}

// list API 取得時に、その kind の registry を充填／更新する。
// stampSyncTime=true（サーバからのフル取得）なら、その kind の既存行を入れ替えてから書き込み、
// lastSyncedAt を打刻する（削除・リネームを反映）。false なら個別 put のみ（楽観的更新）。
async function fillFromList(kind, items, { stampSyncTime = false } = {}) {
  const list = Array.isArray(items) ? items : [];
  const normalized = list.map((it) => normalizeEntry(it, kind)).filter(Boolean);
  await withTransaction(storeName, "readwrite", async (store) => {
    if (stampSyncTime) {
      // その kind の既存エンティティ行を一掃してから入れ直す（他 kind・メタ行は温存）。
      const all = (await waitForRequest(store.getAll())) || [];
      for (const rec of all) {
        if (!isMetaRow(rec) && rec?.kind === kind) await waitForRequest(store.delete(rec.id));
      }
    }
    for (const entry of normalized) await waitForRequest(store.put(entry));
    if (stampSyncTime) await waitForRequest(store.put({ id: metaId(kind), lastSyncedAt: Date.now() }));
  });
  return normalized;
}

// registry エントリを読み出す。kind 指定でその種別のみ、省略で全種別。メタ行は除外。
async function loadAll(kind) {
  return await withTransaction(storeName, "readonly", async (store) => {
    const all = (await waitForRequest(store.getAll())) || [];
    return all.filter((rec) => !isMetaRow(rec) && (kind ? rec?.kind === kind : true));
  });
}

// fileId（=id）でエントリを 1 件取得する。無ければ null。
async function get(fileId) {
  if (!fileId) return null;
  return await withTransaction(storeName, "readonly", async (store) => {
    const rec = await waitForRequest(store.get(String(fileId)));
    return rec && !isMetaRow(rec) ? rec : null;
  });
}

// 1 件削除（リンク解除・削除時）。
async function remove(fileId) {
  if (!fileId) return;
  await withTransaction(storeName, "readwrite", async (store) => {
    await waitForRequest(store.delete(String(fileId)));
  });
}

// registry 全体を消去（喪失再構成テスト・明示リセット用）。
async function clear() {
  await withTransaction(storeName, "readwrite", async (store) => {
    await waitForRequest(store.clear());
  });
}

// kind の最終サーバ同期時刻（未同期は null）。
async function lastSyncedAt(kind) {
  return await withTransaction(storeName, "readonly", async (store) => {
    const meta = await waitForRequest(store.get(metaId(kind)));
    return meta?.lastSyncedAt ?? null;
  });
}

// kind（省略で全体）の registry が空か。喪失（再構成が必要）の検出に使う。
async function isEmpty(kind) {
  const rows = await loadAll(kind);
  return rows.length === 0;
}

export const registryStore = {
  upsert,
  fillFromList,
  loadAll,
  get,
  remove,
  clear,
  lastSyncedAt,
  isEmpty,
  normalizeEntry,
};
