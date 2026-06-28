// =============================================
// Analytics Drive Folders — Question / Dashboard の仮想フォルダ階層を
// 物理 Google Drive フォルダ（02_questions / 03_dashboards 配下）にミラーする。
//
// 設計は formsDriveFolders.gs（forms 版）と完全に対称。ロジック本体は sharedDriveFolders.gs
// （SharedDrive_*）に集約済みで、本ファイルは type ("questions"|"dashboards") ごとの descriptor を
// 渡す薄いラッパーと、analytics 固有のヘルパ（name 探索ツリー走査・backfill）のみを持つ。
//   - 純粋・汎用な小ヘルパ（FormsDrive_folderByIdOrNull_ / FormsDrive_childFolderByName_ /
//     FormsDrive_parentPath_ / FormsDrive_rekeyMapForRelocate_）は forms 版を流用する。
// =============================================

// type → 標準フォルダキー（StdFolders_autoFileFolderOrNull_ 用）。
function AnalyticsDrive_stdKey_(type) {
  if (type === "questions") return "questions";
  if (type === "crossSearches") return "crossSearches";
  return "dashboards";
}

// type → drivemap を保存する Script Property キー。
function AnalyticsDrive_drivemapKey_(type) {
  if (type === "questions") return NFB_ANALYTICS_QUESTIONS_FOLDER_DRIVE_MAP_KEY;
  if (type === "crossSearches") return NFB_ANALYTICS_CROSSSEARCHES_FOLDER_DRIVE_MAP_KEY;
  return NFB_ANALYTICS_DASHBOARDS_FOLDER_DRIVE_MAP_KEY;
}

// 物理ツリーの基点 = 標準フォルダ 02_questions / 03_dashboards。標準フォルダ無効/ルート未解決なら null。
function AnalyticsDrive_baseFolderOrNull_(type) {
  return StdFolders_autoFileFolderOrNull_(AnalyticsDrive_stdKey_(type));
}

// SharedDrive_* に渡す type 別 descriptor。
function AnalyticsDrive_descriptor_(type) {
  return {
    stdKey: AnalyticsDrive_stdKey_(type),
    drivemapKey: AnalyticsDrive_drivemapKey_(type),
    label: type,
    getProps: function() { return Nfb_getActiveProperties_(); }
  };
}

// ---- SharedDrive_* への薄いラッパー（既存の公開シグネチャを維持） ----

function AnalyticsDrive_getPathMap_(type) { return SharedDrive_getPathMap_(AnalyticsDrive_descriptor_(type)); }
function AnalyticsDrive_ensureFolderForPath_(type, path) { return SharedDrive_ensureFolderForPath_(AnalyticsDrive_descriptor_(type), path); }
function AnalyticsDrive_lookupFolderForPath_(type, path) { return SharedDrive_lookupFolderForPath_(AnalyticsDrive_descriptor_(type), path); }
function AnalyticsDrive_movePathFolder_(type, oldPath, newPath) { return SharedDrive_movePathFolder_(AnalyticsDrive_descriptor_(type), oldPath, newPath); }
function AnalyticsDrive_trashPathFolder_(type, path) { return SharedDrive_trashPathFolder_(AnalyticsDrive_descriptor_(type), path); }
function AnalyticsDrive_relativeFolderOfFile_(type, fileId) { return SharedDrive_relativeFolderOfFile_(AnalyticsDrive_descriptor_(type), fileId); }
function AnalyticsDrive_moveItemFileToPath_(type, fileId, path) { return SharedDrive_moveFileToPath_(AnalyticsDrive_descriptor_(type), fileId, path); }

// ---- analytics 固有のヘルパ ----

// base サブツリーを再帰走査し、ファイル名（= name + ".json"）が一致する最初の生存ファイルを返す。
// 論理側 fileId が失われたとき、論理パス（= 名前）で物理ファイルを引き当て直すために使う。無ければ null。
function AnalyticsDrive_findFileByNameInTree_(type, name) {
  var base = AnalyticsDrive_baseFolderOrNull_(type);
  if (!base || !name) return null;
  var targets = {};
  targets[name + ".json"] = true;
  if (typeof Forms_normalizeFormTitle_ === "function") {
    var norm = Forms_normalizeFormTitle_(name);
    if (norm) targets[norm + ".json"] = true;
  }
  // analytics は全ファイルを名前一致対象にする（fileFilter なし）。
  return SharedDrive_findFileByNameRecursive_(base, targets);
}

