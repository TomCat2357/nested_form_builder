// =============================================
// Analytics Drive Folders — Question / Dashboard の仮想フォルダ階層を
// 物理 Google Drive フォルダ（02_questions / 03_dashboards 配下）にミラーする。
//
// 設計は formsDriveFolders.gs（forms 版）と完全に対称。type ("questions"|"dashboards")
// でパラメータ化し、物理ツリーの基点を 02_questions / 03_dashboards に切り替えるだけ。
//   - 仮想フォルダパス ("a/b/c") ↔ 物理 Drive フォルダ ID の対応を PropertiesService
//     (type ごとの drivemap キー) にキャッシュし O(1) で解決する。
//   - drivemap が欠損/陳腐化していたら base からの name 探索で再生成（自己修復）。
//   - 標準フォルダが解決できない場合は base=null となり、全関数が no-op に degrade する。
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

// drivemap (path -> folderId) を取得する。version 不一致・parse 失敗時は空オブジェクト。
function AnalyticsDrive_getPathMap_(type) {
  var props = Nfb_getActiveProperties_();
  var raw = props.getProperty(AnalyticsDrive_drivemapKey_(type));
  if (!raw) return {};
  try {
    var parsed = JSON.parse(raw);
    if (parsed && parsed.version === NFB_FOLDER_DRIVE_MAP_PROPERTY_VERSION && parsed.map && typeof parsed.map === "object") {
      return parsed.map;
    }
  } catch (err) {
    Logger.log("[AnalyticsDrive_getPathMap_] parse failed (" + type + "): " + err);
  }
  return {};
}

// drivemap を保存する（versioned JSON）。
function AnalyticsDrive_savePathMap_(type, map) {
  var props = Nfb_getActiveProperties_();
  props.setProperty(
    AnalyticsDrive_drivemapKey_(type),
    JSON.stringify({ version: NFB_FOLDER_DRIVE_MAP_PROPERTY_VERSION, map: (map && typeof map === "object") ? map : {} })
  );
}

// 物理ツリーの基点 = 標準フォルダ 02_questions / 03_dashboards。標準フォルダ無効/ルート未解決なら null。
function AnalyticsDrive_baseFolderOrNull_(type) {
  return StdFolders_autoFileFolderOrNull_(AnalyticsDrive_stdKey_(type));
}

// 仮想パスに対応する物理フォルダを解決・作成する（祖先も ensure）。
//   path === ""    → base（02_questions / 03_dashboards）
//   base が null   → null（auto-organize off。呼び出し側はフォールバック）
function AnalyticsDrive_ensureFolderForPath_(type, path) {
  var normalized = Forms_normalizeFolderPath_(path);
  var base = AnalyticsDrive_baseFolderOrNull_(type);
  if (!base) return null;
  if (!normalized) return base;

  var map = AnalyticsDrive_getPathMap_(type);
  var cached = FormsDrive_folderByIdOrNull_(map[normalized]);
  if (cached) return cached;

  var segs = normalized.split("/");
  var parent = base;
  var acc = "";
  var dirty = false;
  for (var i = 0; i < segs.length; i++) {
    acc = acc ? acc + "/" + segs[i] : segs[i];
    var child = FormsDrive_folderByIdOrNull_(map[acc]);
    if (!child) {
      child = FormsDrive_childFolderByName_(parent, segs[i]) || parent.createFolder(segs[i]);
      map[acc] = child.getId();
      dirty = true;
    }
    parent = child;
  }
  if (dirty) AnalyticsDrive_savePathMap_(type, map);
  return parent;
}

// 仮想パスに対応する物理フォルダを「探すだけ」（作成しない）。無ければ null。
function AnalyticsDrive_lookupFolderForPath_(type, path) {
  var normalized = Forms_normalizeFolderPath_(path);
  var base = AnalyticsDrive_baseFolderOrNull_(type);
  if (!base) return null;
  if (!normalized) return base;

  var map = AnalyticsDrive_getPathMap_(type);
  var cached = FormsDrive_folderByIdOrNull_(map[normalized]);
  if (cached) return cached;

  var segs = normalized.split("/");
  var parent = base;
  for (var i = 0; i < segs.length; i++) {
    var child = FormsDrive_childFolderByName_(parent, segs[i]);
    if (!child) return null;
    parent = child;
  }
  return parent;
}

// 物理フォルダの移動 + リネーム（mv 相当）。サブツリーは Drive 上で一体移動される。
function AnalyticsDrive_movePathFolder_(type, oldPath, newPath) {
  var oldN = Forms_normalizeFolderPath_(oldPath);
  var newN = Forms_normalizeFolderPath_(newPath);
  if (!oldN || !newN || oldN === newN) return false;
  var base = AnalyticsDrive_baseFolderOrNull_(type);
  if (!base) return false;

  try {
    var folder = AnalyticsDrive_lookupFolderForPath_(type, oldN);
    if (!folder) {
      // 物理フォルダが未作成 → 移動対象なし。将来のファイル配置のため新パスだけ用意。
      AnalyticsDrive_ensureFolderForPath_(type, newN);
      return false;
    }
    var oldParent = FormsDrive_parentPath_(oldN);
    var newParent = FormsDrive_parentPath_(newN);
    var oldLeaf = oldN.split("/").pop();
    var newLeaf = newN.split("/").pop();

    if (newParent !== oldParent) {
      var dest = AnalyticsDrive_ensureFolderForPath_(type, newParent); // "" → base
      if (dest) folder.moveTo(dest);
    }
    if (newLeaf !== oldLeaf) {
      folder.setName(newLeaf);
    }

    var map = FormsDrive_rekeyMapForRelocate_(AnalyticsDrive_getPathMap_(type), oldN, newN);
    map[newN] = folder.getId();
    AnalyticsDrive_savePathMap_(type, map);
    return true;
  } catch (err) {
    Logger.log("[AnalyticsDrive_movePathFolder_] failed " + oldN + " -> " + newN + " (" + type + "): " + err);
    return false;
  }
}

// 物理フォルダをゴミ箱へ（配下も一括 trash）。drivemap から path + 子孫を除去。
function AnalyticsDrive_trashPathFolder_(type, path) {
  var normalized = Forms_normalizeFolderPath_(path);
  if (!normalized) return false;
  var base = AnalyticsDrive_baseFolderOrNull_(type);
  if (!base) return false;

  try {
    var folder = AnalyticsDrive_lookupFolderForPath_(type, normalized);
    if (folder) folder.setTrashed(true);

    var map = AnalyticsDrive_getPathMap_(type);
    var prefix = normalized + "/";
    var next = {};
    for (var key in map) {
      if (!map.hasOwnProperty(key)) continue;
      if (key === normalized || key.indexOf(prefix) === 0) continue;
      next[key] = map[key];
    }
    AnalyticsDrive_savePathMap_(type, next);
    return !!folder;
  } catch (err) {
    Logger.log("[AnalyticsDrive_trashPathFolder_] failed " + normalized + " (" + type + "): " + err);
    return false;
  }
}

// アイテムファイルを path に対応する物理フォルダへ移動する（既に正しい親なら no-op）。
function AnalyticsDrive_moveItemFileToPath_(type, fileId, path) {
  if (!fileId) return false;
  var base = AnalyticsDrive_baseFolderOrNull_(type);
  if (!base) return false;

  try {
    var target = AnalyticsDrive_ensureFolderForPath_(type, path);
    if (!target) return false;
    var file = DriveApp.getFileById(fileId);
    var parents = file.getParents();
    if (parents && parents.hasNext()) {
      var current = parents.next();
      if (current.getId() === target.getId()) return true; // 既に正しい親
    }
    file.moveTo(target);
    return true;
  } catch (err) {
    Logger.log("[AnalyticsDrive_moveItemFileToPath_] failed " + fileId + " -> " + path + " (" + type + "): " + err);
    return false;
  }
}

// fileId のファイルが base 配下のどの相対フォルダパスにあるかを返す。base 直下なら ""。
// base 配下に無い / 解決不能なら null（= 構成外）。インポート時の「物理位置＝論理パス」導出に使う。
function AnalyticsDrive_relativeFolderOfFile_(type, fileId) {
  if (!fileId) return null;
  var base = AnalyticsDrive_baseFolderOrNull_(type);
  if (!base) return null;
  try {
    var baseId = base.getId();
    var file = DriveApp.getFileById(fileId);
    var parents = file.getParents();
    if (!parents || !parents.hasNext()) return null;
    var parent = parents.next();
    // base 直下 → ""
    var segs = [];
    var seen = {};
    var cur = parent;
    var steps = 0;
    while (cur && steps < 200) {
      steps++;
      var id = cur.getId();
      if (id === baseId) return segs.join("/");
      if (seen[id]) return null;
      seen[id] = true;
      segs.unshift(cur.getName());
      var ps = cur.getParents();
      cur = (ps && ps.hasNext()) ? ps.next() : null;
    }
  } catch (err) {
    Logger.log("[AnalyticsDrive_relativeFolderOfFile_] " + fileId + " (" + type + "): " + err);
  }
  return null;
}

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
  return AnalyticsDrive_findFileByNameRecursive_(base, targets);
}

function AnalyticsDrive_findFileByNameRecursive_(folder, targets) {
  var files = folder.getFiles();
  while (files.hasNext()) {
    var f = files.next();
    if (typeof f.isTrashed === "function" && f.isTrashed()) continue;
    if (targets[f.getName()]) return f;
  }
  var subs = folder.getFolders();
  while (subs.hasNext()) {
    var sub = subs.next();
    if (typeof sub.isTrashed === "function" && sub.isTrashed()) continue;
    var hit = AnalyticsDrive_findFileByNameRecursive_(sub, targets);
    if (hit) return hit;
  }
  return null;
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
      var file = DriveApp.getFileById(fileId);
      var json = JSON.parse(file.getBlob().getDataAsString());
      folder = Forms_normalizeFolderPath_(json && json.folder);
    } catch (e) { folder = ""; }
    if (AnalyticsDrive_moveItemFileToPath_(type, fileId, folder)) movedFiles++;
  }
  return { ok: true, folders: paths.length, movedFiles: movedFiles };
}
