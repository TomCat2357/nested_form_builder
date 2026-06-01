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
  return type === "questions" ? "questions" : "dashboards";
}

// type → drivemap を保存する Script Property キー。
function AnalyticsDrive_drivemapKey_(type) {
  return type === "questions"
    ? NFB_ANALYTICS_QUESTIONS_FOLDER_DRIVE_MAP_KEY
    : NFB_ANALYTICS_DASHBOARDS_FOLDER_DRIVE_MAP_KEY;
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

// 既存の仮想フォルダ/アイテムを物理 Drive 構造へ一括反映する（手動・冪等）。
// auto-organize off では skip。
function AnalyticsDrive_backfillPhysicalFolders_(type) {
  var base = AnalyticsDrive_baseFolderOrNull_(type);
  if (!base) return { ok: true, skipped: true, reason: "標準フォルダが無効です" };

  // 1) 既知フォルダ（登録簿 ∪ item 由来。親→子順）を物理化。
  var paths = Analytics_collectFolders_(type);
  for (var i = 0; i < paths.length; i++) {
    AnalyticsDrive_ensureFolderForPath_(type, paths[i]);
  }

  // 2) 各アイテムファイルを item.folder に対応する物理フォルダへ移動。
  var mapping = Analytics_getMapping_(type);
  var movedFiles = 0;
  for (var id in mapping) {
    if (!mapping.hasOwnProperty(id)) continue;
    var fileId = Nfb_resolveFileIdFromEntry_(mapping[id]);
    if (!fileId) continue;
    var folder = "";
    try {
      folder = Forms_normalizeFolderPath_(Nfb_readJsonFileById_(fileId).json.folder);
    } catch (e) { folder = ""; }
    if (AnalyticsDrive_moveItemFileToPath_(type, fileId, folder)) movedFiles++;
  }
  return { ok: true, folders: paths.length, movedFiles: movedFiles };
}
