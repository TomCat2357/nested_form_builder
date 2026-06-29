import { ensureArray } from "../../utils/arrays.js";
import { STORE_NAMES } from "./dbHelpers.js";
import { makeListCache } from "../../features/analytics/analyticsCache.js";

// フォーム一覧キャッシュは Question/Dashboard と同形のリストストア。共通ファクトリ
// makeListCache（keyPath:"id" + META 1 行）へ委譲し、forms 固有のメタ
// （failures / propertyStoreMode / folders）は extraMeta として META 行へ載せる。
// 公開シグネチャ（saveFormsToCache / getFormsFromCache）は据え置き、呼び出し側は無改修。
// 旧実装が各 form 行へ冗長付与していた lastSyncedAt は廃止（誰も行レベルでは読まない）。
const formsListCache = makeListCache(STORE_NAMES.forms);

// lastSyncedAt は「最後にサーバから一覧をフル取得した時刻」を表す。
// stampSyncTime=true はサーバ取得経路（refreshForms）のみが渡す。ローカルの楽観的更新
// では既存メタの値を据え置き、SWR の再同期タイマーを延長しない。
export async function saveFormsToCache(forms, loadFailures = [], propertyStoreMode = "", { stampSyncTime = false, folders } = {}) {
  // folders 未指定（楽観的更新など）は既存値を据え置く。
  const prev = await formsListCache.getMeta();
  const prevFolders = Array.isArray(prev?.folders) ? prev.folders : [];
  const nextFolders = Array.isArray(folders) ? folders : prevFolders;
  await formsListCache.saveAll(forms, {
    stampSyncTime,
    extraMeta: { failures: loadFailures, propertyStoreMode, folders: nextFolders },
  });
}

export async function getFormsFromCache() {
  const [forms, meta] = await Promise.all([formsListCache.getAll(), formsListCache.getMeta()]);
  return {
    forms,
    loadFailures: meta?.failures || [],
    lastSyncedAt: meta?.lastSyncedAt || null,
    propertyStoreMode: meta?.propertyStoreMode || "",
    folders: ensureArray(meta?.folders),
  };
}
