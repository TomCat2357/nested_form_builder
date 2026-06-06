// =============================================
// Analytics Folder Store — Question / Dashboard の空フォルダも永続化するためのフォルダ登録簿。
// PropertiesService に { version, folders: ["a", "a/b", ...] } 形で保存する。
// 画面に出すフォルダ = 登録簿のパス ∪ アイテム由来 (item.folder) のパス。
//
// type: "questions" | "dashboards" でパラメータ化する。登録簿 CRUD のロジック本体は
// sharedFolderStore.gs（StdFolderStore_*）に集約済みで、本ファイルは property key ヘルパ・
// type 別 adapter・既存公開シグネチャ（Analytics_*）を維持する薄いラッパーのみを持つ。
// 文字列ヘルパ（Forms_normalizeFolderPath_ など）は formsFolderStore.gs のものを流用する。
// =============================================

var ANALYTICS_QUESTIONS_FOLDERS_PROPERTY_KEY = "nfb.analytics.questions.folders";
var ANALYTICS_DASHBOARDS_FOLDERS_PROPERTY_KEY = "nfb.analytics.dashboards.folders";

// ---- property key ヘルパー ----

function Analytics_getFoldersPropertyKey_(type) {
  return type === "questions"
    ? ANALYTICS_QUESTIONS_FOLDERS_PROPERTY_KEY
    : ANALYTICS_DASHBOARDS_FOLDERS_PROPERTY_KEY;
}

// StdFolderStore_* コアに渡す type 別 adapter（型差分をここに閉じ込める）。
function Analytics_folderStoreAdapter_(type) {
  return {
    kind: type,
    foldersPropertyKey: Analytics_getFoldersPropertyKey_(type),
    getMapping: function() { return Analytics_getMapping_(type); },
    saveMapping: function(m) { return Analytics_saveMapping_(type, m); },
    listItems: function() {
      var listRes = Analytics_listTemplates_(type, { includeArchived: true });
      return (listRes && listRes[Analytics_getResultListKey_(type)]) || [];
    },
    getItemFolder: function(id) {
      var mapping = Analytics_getMapping_(type);
      var fileId = Nfb_resolveFileIdFromEntry_(mapping[id]);
      if (!fileId) return null;
      try {
        return Forms_normalizeFolderPath_(Nfb_readJsonFileById_(fileId).json.folder);
      } catch (err) {
        Logger.log("[Analytics_folderStoreAdapter_.getItemFolder:" + type + "] " + id + ": " + err);
        return null;
      }
    },
    // analytics は modifiedAt を ms（Date.now()）で保持する。
    stampFolderModified: function(json) { json.modifiedAt = Date.now(); },
    driveEnsureForPath: function(p) { return AnalyticsDrive_ensureFolderForPath_(type, p); },
    driveMoveFileToPath: function(fileId, p) { return AnalyticsDrive_moveItemFileToPath_(type, fileId, p); },
    driveMovePathFolder: function(o, n) { return AnalyticsDrive_movePathFolder_(type, o, n); },
    driveTrashPathFolder: function(p) { return AnalyticsDrive_trashPathFolder_(type, p); },
    deleteItems: function(ids) { return Analytics_deleteTemplates_(type, ids); },
    movedIdsKey: "movedIds",
    deletedCountKey: "deletedCount",
    itemNoun: "アイテム",
    lockPrefix: "アナリティクス ",
    // 中央辞書エントリで「名前」を保持するキー（移動時の同名衝突採番で参照/更新する）。
    entryNameKey: "name"
  };
}

// ---- StdFolderStore_* への薄いラッパー（既存の公開シグネチャを維持） ----

function Analytics_getFolders_(type) {
  return StdFolderStore_getFolders_(Analytics_getFoldersPropertyKey_(type));
}
function Analytics_saveFoldersRegistry_(type, paths) {
  return StdFolderStore_saveFolders_(Analytics_getFoldersPropertyKey_(type), paths);
}
function Analytics_collectFolders_(type, itemsArray) {
  return StdFolderStore_collectFolders_(Analytics_folderStoreAdapter_(type), itemsArray);
}
function Analytics_listFolders_(type) {
  return StdFolderStore_listFolders_(Analytics_folderStoreAdapter_(type));
}
function Analytics_createFolder_(type, path) {
  return StdFolderStore_createFolder_(Analytics_folderStoreAdapter_(type), path);
}
function Analytics_setItemFolder_(type, id, folderPath) {
  return StdFolderStore_setItemFolder_(Analytics_folderStoreAdapter_(type), id, folderPath);
}
function Analytics_moveItems_(type, payload) {
  var raw = payload || {};
  return StdFolderStore_moveItems_(Analytics_folderStoreAdapter_(type), {
    itemIds: raw.itemIds,
    folderPaths: raw.folderPaths,
    destPath: raw.destPath
  });
}
function Analytics_renameFolder_(type, payload) {
  return StdFolderStore_renameFolder_(Analytics_folderStoreAdapter_(type), payload);
}
function Analytics_deleteFolder_(type, path) {
  return StdFolderStore_deleteFolder_(Analytics_folderStoreAdapter_(type), path);
}
