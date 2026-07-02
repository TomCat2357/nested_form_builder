/**
 * Analytics メタエンティティ（Question / Dashboard / CrossSearch）の CRUD ファクトリ
 * （analyticsStore.js から分離）。
 *
 * キャッシュ更新を伴う CRUD ラッパが完全に機械的なので、エンティティ名
 * (単数 one / 複数 many) と cache・gasClient・任意フックから一式を生成する。
 * analyticsGasClient.js / analyticsCache.js のファクトリ方式を踏襲。
 */

import { deepClone } from "../../core/schema.js";
import { genLocalId, isLocalId } from "../../core/ids.js";
import { enqueueOpJob, deleteJobsForLocalId, deleteOpJobsForFolderPrefix } from "../../app/state/uploadQueue.js";
import { kickUploadWorker, enqueueEntitySave } from "../../app/state/uploadWorker.js";
import { registryStore } from "../../app/state/registryStore.js";
import { emitAnalyticsCacheChanged } from "./analyticsCache.js";
import {
  normalizeFolderPath,
  isUnderFolder,
  reassignEntityFolder,
  reparentFolders,
  renameFolderPaths,
  removeFolderSubtree,
} from "../../utils/folderTree.js";
import { evaluateCacheForAnalytics } from "../../app/state/cachePolicy.js";

function filterArchived_(items, includeArchived) {
  if (includeArchived) return items;
  return items.filter((item) => !item?.archived);
}

function stripExportFields_(item) {
  const clone = deepClone(item || {});
  delete clone.id;
  delete clone.driveFileUrl;
  delete clone.archived;
  delete clone.createdAt;
  delete clone.modifiedAt;
  return clone;
}

/**
 * @param {object} cfg
 * @param {string} cfg.one  結果オブジェクトのキー (例: "question")。先頭大文字版が GAS メソッド名の元になる
 * @param {string} cfg.many 結果リストのキー (例: "questions")
 * @param {{ saveAll, getAll, upsert, remove }} cfg.cache
 * @param {object} cfg.gas  analyticsGasClient（list<E>s / get<E> / save<E> / ... を持つ）
 * @param {(items: any[]) => any[]} [cfg.sanitizeList] GAS / キャッシュから読んだ配列を整形（既定: 恒等）
 * @param {(data: any) => void} [cfg.validateBeforeSave] save 前の検証フック（既定: なし）
 */
export function makeEntityStore({ one, many, cache, gas, sanitizeList = (items) => items, validateBeforeSave }) {
  const E = one.charAt(0).toUpperCase() + one.slice(1);

  // サーバから全件取得してキャッシュへ保存し、フィルタ済み配列を返す。
  // lastSyncedAt はこの経路でのみ更新する（stampSyncTime: true）。
  // まだ Drive へ上がっていないローカル pending（pendingUpload / 一時 ID = local_…）は
  // サーバ応答に含まれないため、ここで保持マージする。さもないと保存直後のアイテムが
  // サーバ再取得で消える（更新ボタンを押すまで反映されない、の根本原因）。
  // 一時 ID の付け替え（reconcile）後は pendingUpload:false になり次回取得で収束する。
  async function fetchAndStore_(includeArchived) {
    const result = await gas[`list${E}s`]({ includeArchived: true });
    const serverAll = sanitizeList(result[many] || []);
    const cached = await cache.getAll();
    const pendingById = new Map(
      cached.filter((x) => x && (x.pendingUpload || isLocalId(x.id))).map((x) => [x.id, x])
    );
    const serverIds = new Set(serverAll.map((x) => x.id));
    // 既存の編集はローカル pending を上書き勝ちにし、新規（サーバ未知）は先頭へ追加する。
    const all = serverAll.map((s) => (pendingById.has(s.id) ? pendingById.get(s.id) : s));
    for (const [id, item] of pendingById) if (!serverIds.has(id)) all.unshift(item);
    await cache.saveAll(all, { stampSyncTime: true });
    // registry 作業キャッシュをサーバ確定の一覧（serverAll＝実 fileId のみ）で充填／更新する
    // （非ブロッキング・fail-safe）。kind は many（"questions" | "dashboards"）。
    registryStore.fillFromList(many, serverAll, { stampSyncTime: true }).catch(() => {});
    return filterArchived_(all, includeArchived);
  }

  async function list({ forceRefresh = false, includeArchived = false } = {}) {
    if (!forceRefresh) {
      const cached = await cache.getAll();
      if (cached.length > 0) return filterArchived_(sanitizeList(cached), includeArchived);
    }
    return await fetchAndStore_(includeArchived);
  }

  /**
   * SWR 版の一覧取得。キャッシュを即座に返しつつ、鮮度に応じて再取得を仕掛ける。
   * 鮮度判定は evaluateCacheForAnalytics（1 時間で fresh、24 時間で要再取得）に従う。
   *
   * @returns {Promise<{ items: any[], blocking: boolean, sync: Promise<any[]>|null }>}
   *   - items: 即時表示用のキャッシュ済み（フィルタ済み）配列
   *   - blocking: キャッシュが古すぎて信用できず、items を表示せず取得完了を待つべきか
   *   - sync: バックグラウンド/同期の再取得 Promise（不要なら null）。解決値は最新のフィルタ済み配列
   */
  async function listSWR({ includeArchived = false, forceRefresh = false, revalidateWhenFresh = false } = {}) {
    const cached = await cache.getAll();
    const { lastSyncedAt } = await cache.getMeta();
    const sanitized = sanitizeList(cached);
    const hasData = sanitized.length > 0;
    const decision = evaluateCacheForAnalytics({ lastSyncedAt, hasData, forceSync: forceRefresh });
    const items = filterArchived_(sanitized, includeArchived);

    if (decision.isFresh) {
      // fresh でも、一覧画面を開いた（マウント）ときは裏で再検証する（起動 / F5 相当）。
      // 楽観的更新のキャッシュ変更イベントでは revalidateWhenFresh を立てず、GAS 往復を避ける。
      return { items, blocking: false, sync: revalidateWhenFresh ? fetchAndStore_(includeArchived) : null };
    }
    // shouldSync かつ手動更新でない場合のみブロックする（24 時間超 or キャッシュ無し）。
    // 手動の forceRefresh では既存表示を残したまま裏で取り直す。
    const blocking = !forceRefresh && decision.shouldSync;
    return { items, blocking, sync: fetchAndStore_(includeArchived) };
  }

  // キャッシュ優先で単一取得。未ヒット時のみ GAS から個別取得。
  // forceRefresh 時はキャッシュ照合をスキップしてサーバ最新を取得する（編集画面用）。
  async function getById(id, { forceRefresh = false } = {}) {
    if (!id) return null;
    if (!forceRefresh) {
      const cached = await cache.getAll();
      const hit = cached.find((item) => item.id === id);
      if (hit) return hit;
    }
    const result = await gas[`get${E}`](id);
    if (result?.[one]) await cache.upsert(result[one]);
    return result?.[one] || null;
  }

  // オフラインファースト: まず IndexedDB に保存し、Drive へのアップロードはバックグラウンドへ。
  // 新規は一時 ID(local_…) を採番し、アップロード完了時に実 fileId へ付け替える（参照も再リンク）。
  async function save(data) {
    if (validateBeforeSave) validateBeforeSave(data);
    const localId = data.id || genLocalId();
    const record = { ...data, id: localId, pendingUpload: true, modifiedAt: Date.now() };
    return await enqueueEntitySave({
      entityType: one,
      record,
      upsertCache: (r) => cache.upsert(r),
      emit: emitAnalyticsCacheChanged,
    });
  }

  async function remove(id) {
    await deleteJobsForLocalId(id);
    if (!isLocalId(id)) await gas[`delete${E}`](id);
    await cache.remove(id);
    kickUploadWorker();
    emitAnalyticsCacheChanged(one);
  }

  async function removeBatch(ids) {
    if (!ids?.length) return;
    await Promise.all(ids.map((id) => deleteJobsForLocalId(id)));
    const remoteIds = ids.filter((id) => !isLocalId(id));
    if (remoteIds.length) await gas[`delete${E}s`](remoteIds);
    for (const id of ids) await cache.remove(id);
    kickUploadWorker();
    emitAnalyticsCacheChanged(one);
  }

  // removeBatch と同じだが、プロジェクト内（標準フォルダ配下）のファイルは実体も Drive ゴミ箱へ
  // 移動する。プロジェクト外はリンク解除のみで実体を残す（判定は GAS 側がファイルごとに行う）。
  async function removeBatchWithFiles(ids) {
    if (!ids?.length) return;
    await Promise.all(ids.map((id) => deleteJobsForLocalId(id)));
    const remoteIds = ids.filter((id) => !isLocalId(id));
    if (remoteIds.length) await gas[`delete${E}sWithFiles`](remoteIds);
    for (const id of ids) await cache.remove(id);
    kickUploadWorker();
    emitAnalyticsCacheChanged(one);
  }

  // 楽観的＋遅延: アーカイブ状態をキャッシュ上で即時フリップし、GAS 反映は write-behind の
  // op ジョブへ積む（local_ エンティティは save 完了まで依存で待つ）。verb は "archive" / "unarchive"。
  async function setArchivedOne(verb, id) {
    const archived = verb === "archive";
    const all = await cache.getAll();
    const item = all.find((x) => x.id === id);
    const next = item ? { ...item, archived } : null;
    if (next) await cache.upsert(next);
    await enqueueOpJob({ entityType: one, opType: verb, opPayload: { ids: [id] }, dependsOnLocalIds: isLocalId(id) ? [id] : [] });
    kickUploadWorker();
    emitAnalyticsCacheChanged(one);
    return { [one]: next };
  }

  async function setArchivedBatch(verb, ids) {
    if (!ids?.length) return { ok: true, updated: 0, errors: [], [many]: [] };
    const archived = verb === "archive";
    const all = await cache.getAll();
    const byId = new Map(all.map((x) => [x.id, x]));
    const updated = [];
    for (const id of ids) {
      const item = byId.get(id);
      if (!item) continue;
      const next = { ...item, archived };
      await cache.upsert(next);
      updated.push(next);
    }
    await enqueueOpJob({ entityType: one, opType: verb, opPayload: { ids: ids.slice() }, dependsOnLocalIds: ids.filter(isLocalId) });
    kickUploadWorker();
    emitAnalyticsCacheChanged(one);
    return { ok: true, updated: updated.length, errors: [], [many]: updated };
  }

  // 楽観的＋遅延: キャッシュ上の元エンティティを複製し、新規 save ジョブとしてキューへ積む。
  // 名前に「（コピー）」を付与し、アップロード完了で local_ → 実 fileId へ付け替える。
  async function copy(id) {
    const all = await cache.getAll();
    const source = all.find((x) => x.id === id);
    if (!source) {
      // キャッシュ未ヒット時のみ従来のサーバコピーにフォールバック。
      const result = await gas[`copy${E}`](id);
      if (result?.[one]) await cache.upsert(result[one]);
      return result[one];
    }
    const localId = genLocalId();
    const {
      id: _id,
      createdAt: _createdAt,
      modifiedAt: _modifiedAt,
      driveFileUrl: _driveFileUrl,
      pendingUpload: _pendingUpload,
      ...rest
    } = deepClone(source);
    const clone = {
      ...rest,
      id: localId,
      name: `${source.name || ""}（コピー）`,
      archived: false,
      pendingUpload: true,
      modifiedAt: Date.now(),
    };
    if (validateBeforeSave) validateBeforeSave(clone);
    return await enqueueEntitySave({
      entityType: one,
      record: clone,
      upsertCache: (r) => cache.upsert(r),
      emit: emitAnalyticsCacheChanged,
    });
  }

  async function registerImported(payload) {
    const result = await gas[`registerImported${E}`](payload);
    if (result?.[one]) await cache.upsert(result[one]);
    return result[one];
  }

  async function exportItems(ids) {
    const all = await list({ forceRefresh: false, includeArchived: true });
    const idSet = new Set(ids);
    return all.filter((item) => idSet.has(item.id)).map(stripExportFields_);
  }

  async function listFolders() {
    const result = await gas[`list${E}Folders`]();
    return result.folders || [];
  }

  // 楽観的＋遅延: folders 登録簿（一覧ページ保持）へ追加した配列を返し、GAS 実体作成は op ジョブへ。
  async function createFolder(path, { folders = [] } = {}) {
    const normalized = normalizeFolderPath(path);
    const next = !normalized || folders.some((p) => normalizeFolderPath(p) === normalized)
      ? folders.slice()
      : [...folders, normalized];
    await enqueueOpJob({ entityType: one, opType: "createFolder", opPayload: { path } });
    kickUploadWorker();
    return next;
  }

  // 楽観的＋遅延: エンティティの folder をキャッシュ上で即時書換え、GAS 移動は write-behind の
  // op ジョブへ。folders 登録簿は一覧ページが保持するため引数で受け取り、再親付け後の配列を返す。
  async function moveItems(payload, { folders = [] } = {}) {
    const itemIds = Array.isArray(payload?.itemIds) ? payload.itemIds : [];
    const folderPaths = Array.isArray(payload?.folderPaths) ? payload.folderPaths : [];
    const destPath = payload?.destPath || "";

    const all = await cache.getAll();
    for (const item of all) {
      const nf = reassignEntityFolder(item.folder, "move", { itemId: item.id, itemIds, folderPaths, destPath });
      if (nf !== normalizeFolderPath(item.folder)) await cache.upsert({ ...item, folder: nf });
    }
    await enqueueOpJob({ entityType: one, opType: "move", opPayload: payload, dependsOnLocalIds: itemIds.filter(isLocalId) });
    kickUploadWorker();
    emitAnalyticsCacheChanged(one);
    return { folders: reparentFolders(folders, folderPaths, destPath), movedIds: itemIds };
  }

  async function renameFolder(payload, { folders = [] } = {}) {
    const path = payload?.path || "";
    const newName = payload?.newName || "";

    const all = await cache.getAll();
    for (const item of all) {
      const nf = reassignEntityFolder(item.folder, "rename", { path, newName });
      if (nf !== normalizeFolderPath(item.folder)) await cache.upsert({ ...item, folder: nf });
    }
    await enqueueOpJob({ entityType: one, opType: "renameFolder", opPayload: payload });
    kickUploadWorker();
    emitAnalyticsCacheChanged(one);
    return { folders: renameFolderPaths(folders, path, newName), movedIds: [] };
  }

  async function deleteFolder(path, { folders = [] } = {}) {
    const target = normalizeFolderPath(path);
    const all = await cache.getAll();
    let deletedCount = 0;
    for (const item of all) {
      if (!isUnderFolder(item.folder, target)) continue;
      await deleteJobsForLocalId(item.id);
      await cache.remove(item.id);
      deletedCount += 1;
    }
    await deleteOpJobsForFolderPrefix(one, target);
    await enqueueOpJob({ entityType: one, opType: "deleteFolder", opPayload: { path } });
    kickUploadWorker();
    emitAnalyticsCacheChanged(one);
    return { folders: removeFolderSubtree(folders, target), deletedCount };
  }

  return {
    list,
    listSWR,
    getById,
    save,
    remove,
    removeBatch,
    removeBatchWithFiles,
    archiveOne: (id) => setArchivedOne("archive", id),
    unarchiveOne: (id) => setArchivedOne("unarchive", id),
    archiveBatch: (ids) => setArchivedBatch("archive", ids),
    unarchiveBatch: (ids) => setArchivedBatch("unarchive", ids),
    copy,
    importFromDrive: (url) => gas[`import${E}sFromDrive`](url),
    registerImported,
    exportItems,
    listFolders,
    createFolder,
    moveItems,
    renameFolder,
    deleteFolder,
  };
}
