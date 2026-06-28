/**
 * 串刺しフォーム検索（cross-form search）= 第 3 のメタエンティティのデータアクセス層。
 *
 * Question / Dashboard と完全に同じ makeEntityStore（オフラインファースト保存・SWR 一覧・
 * フォルダ操作）を crossSearchCache + analyticsGasClient("CrossSearch") に組み合わせるだけ。
 * 個別ロジックは持たない。GAS 側は analyticsApi.gs の type "crossSearches" が受ける。
 *
 * 定義オブジェクトの形:
 *   { id, name, description, folder, archived, createdAt, modifiedAt, driveFileUrl,
 *     formIds: ["<formId>", ...],                    // 参照フォーム（順序保持）
 *     columns: [{ path: "親/子", label, type }] }    // 串刺しで表示する列（スラッシュパスが識別子）
 */

import { makeEntityStore } from "./analyticsStore.js";
import { crossSearchCache } from "./analyticsCache.js";
import { analyticsGasClient } from "./analyticsGasClient.js";

const crossSearchStore = makeEntityStore({
  one: "crossSearch",
  many: "crossSearches",
  cache: crossSearchCache,
  gas: analyticsGasClient,
});

export const listCrossSearches = crossSearchStore.list;
export const listCrossSearchesSWR = crossSearchStore.listSWR;
export const getCrossSearchById = crossSearchStore.getById;
export const saveCrossSearch = crossSearchStore.save;
export const deleteCrossSearches = crossSearchStore.removeBatch;
export const deleteCrossSearchesWithFiles = crossSearchStore.removeBatchWithFiles;
export const archiveCrossSearches = crossSearchStore.archiveBatch;
export const unarchiveCrossSearches = crossSearchStore.unarchiveBatch;
export const copyCrossSearch = crossSearchStore.copy;
export const exportCrossSearches = crossSearchStore.exportItems;
export const importCrossSearchesFromDrive = crossSearchStore.importFromDrive;
export const registerImportedCrossSearch = crossSearchStore.registerImported;
export const listCrossSearchFolders = crossSearchStore.listFolders;
export const createCrossSearchFolder = crossSearchStore.createFolder;
export const moveCrossSearches = crossSearchStore.moveItems;
export const renameCrossSearchFolder = crossSearchStore.renameFolder;
export const deleteCrossSearchFolder = crossSearchStore.deleteFolder;
