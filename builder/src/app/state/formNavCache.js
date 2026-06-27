import { withTransaction, waitForRequest, STORE_NAMES } from './dbHelpers.js';

// 目次ツリー（buildSchemaMapItems の出力）を formId キーで保存する軽量キャッシュ。
// フォーム修正画面を開いた瞬間にサイドバー目次を即表示するためだけに使う。
// ナビ表示専用で、schema/設定の編集ソースには流用しない（古い版が編集に混ざる
// 巻き戻りを再発させない）。喪失してもフォーム本体ロード後に再生成される。

// 目次ツリーを保存する（冪等・上書き）。items は buildSchemaMapItems の出力。
export async function saveFormNavToCache(formId, items) {
  if (!formId || !Array.isArray(items)) return;
  await withTransaction(STORE_NAMES.formNav, 'readwrite', async (store) => {
    await waitForRequest(store.put({ id: formId, items, savedAt: Date.now() }));
  });
}

// 目次ツリーを読み出す。未保存なら null。
export async function getFormNavFromCache(formId) {
  if (!formId) return null;
  return await withTransaction(STORE_NAMES.formNav, 'readonly', async (store) => {
    const record = await waitForRequest(store.get(formId));
    if (!record || !Array.isArray(record.items)) return null;
    return { items: record.items, savedAt: record.savedAt || null };
  });
}

// 目次キャッシュを削除する（フォーム削除時のクリーンアップ用・任意）。
export async function deleteFormNavFromCache(formId) {
  if (!formId) return;
  await withTransaction(STORE_NAMES.formNav, 'readwrite', async (store) => {
    await waitForRequest(store.delete(formId));
  });
}
