// =============================================
// Forms Folder Store — 空フォルダも永続化するためのフォルダ登録簿（フォーム版）。
// PropertiesService に { version, folders: ["a", "a/b", ...] } 形で保存する。
// 画面に出すフォルダ = 登録簿のパス ∪ フォーム由来 (form.folder) のパス。
//
// 登録簿 CRUD のロジック本体は sharedFolderStore.gs（StdFolderStore_*）に集約済み。本ファイルは
//   - 全箇所で流用される文字列ヘルパ（normalize / addPathWithAncestors / sort）
//   - forms 用 adapter
//   - 既存の公開シグネチャ（Forms_*）を維持する薄いラッパー
// のみを持つ。
// =============================================

// フロント normalizeFolderPath (builder/src/utils/folderTree.js) と同一規則。
// "/a//b/ " → "a/b"、未指定や非文字列は ""。
function Forms_normalizeFolderPath_(raw) {
  if (typeof raw !== "string") return "";
  return raw
    .split("/")
    .map(function(seg) { return String(seg).trim(); })
    .filter(function(seg) { return seg.length > 0; })
    .join("/");
}

// path とその全祖先を out (Object set) に登録する。"a/b/c" → "a","a/b","a/b/c"。
function Forms_addPathWithAncestors_(out, path) {
  var normalized = Forms_normalizeFolderPath_(path);
  if (!normalized) return;
  var segs = normalized.split("/");
  var acc = "";
  for (var i = 0; i < segs.length; i++) {
    acc = acc ? acc + "/" + segs[i] : segs[i];
    out[acc] = true;
  }
}

// 日本語ロケールで親→子の順に安定ソートする。
function Forms_sortFolderPaths_(paths) {
  var arr = (paths || []).slice();
  arr.sort(function(a, b) { return String(a).localeCompare(String(b), "ja"); });
  return arr;
}

// StdFolderStore_* コアに渡す forms 用 adapter（型差分をここに閉じ込める）。
function Forms_folderStoreAdapter_() {
  return {
    kind: "forms",
    foldersPropertyKey: NFB_FOLDERS_PROPERTY_KEY,
    getMapping: function() { return Forms_getMapping_(); },
    saveMapping: function(m) { return Forms_saveMapping_(m); },
    listItems: function() { return Forms_listForms_({ includeArchived: true }).forms || []; },
    getItemFolder: function(id) {
      var form = Forms_getForm_(id);
      return form ? Forms_normalizeFolderPath_(form.folder) : null;
    },
    // フォームは modifiedAt を JST 文字列 + modifiedAtUnixMs（シリアル）で保持する。
    stampFolderModified: function(json) {
      var nowSerial = Sheets_dateToSerial_(new Date());
      json.modifiedAt = Sheets_formatJstString_(nowSerial);
      json.modifiedAtUnixMs = nowSerial;
    },
    driveEnsureForPath: function(p) { return FormsDrive_ensureFolderForPath_(p); },
    driveMoveFileToPath: function(fileId, p) { return FormsDrive_moveFormFileToPath_(fileId, p); },
    driveMovePathFolder: function(o, n) { return FormsDrive_movePathFolder_(o, n); },
    driveTrashPathFolder: function(p) { return FormsDrive_trashPathFolder_(p); },
    deleteItems: function(ids) { return Forms_deleteForms_(ids); },
    movedIdsKey: "movedFormIds",
    deletedCountKey: "deletedFormCount",
    itemNoun: "フォーム",
    lockPrefix: "",
    // 中央辞書エントリで「名前」を保持するキー（移動時の同名衝突採番で参照/更新する）。
    entryNameKey: "title"
  };
}

// ---- StdFolderStore_* への薄いラッパー（既存の公開シグネチャを維持） ----

function Forms_getFolders_() {
  return StdFolderStore_getFolders_(NFB_FOLDERS_PROPERTY_KEY);
}
function Forms_saveFolders_(paths) {
  return StdFolderStore_saveFolders_(NFB_FOLDERS_PROPERTY_KEY, paths);
}
function Forms_collectFolders_(formsArray) {
  return StdFolderStore_collectFolders_(Forms_folderStoreAdapter_(), formsArray);
}
function Forms_listFolders_(formsArray) {
  return StdFolderStore_listFolders_(Forms_folderStoreAdapter_(), formsArray);
}
function Forms_createFolder_(path) {
  return StdFolderStore_createFolder_(Forms_folderStoreAdapter_(), path);
}
function Forms_setFormFolder_(formId, folderPath) {
  return StdFolderStore_setItemFolder_(Forms_folderStoreAdapter_(), formId, folderPath);
}
function Forms_moveItems_(payload) {
  var raw = payload || {};
  return StdFolderStore_moveItems_(Forms_folderStoreAdapter_(), {
    itemIds: raw.formIds,
    folderPaths: raw.folderPaths,
    destPath: raw.destPath
  });
}
function Forms_renameFolder_(payload) {
  return StdFolderStore_renameFolder_(Forms_folderStoreAdapter_(), payload);
}
function Forms_deleteFolder_(path) {
  return StdFolderStore_deleteFolder_(Forms_folderStoreAdapter_(), path);
}
