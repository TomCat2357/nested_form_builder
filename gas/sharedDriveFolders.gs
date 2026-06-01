// =============================================
// Shared Drive Folders — 仮想フォルダ階層を物理 Google Drive フォルダにミラーする型汎用コア。
//
// formsDriveFolders.gs（01_forms 配下）と analyticsDriveFolders.gs（02_questions /
// 03_dashboards 配下）はロジックが完全に対称だったため、本ファイルにコアを集約し、
// それぞれの FormsDrive_* / AnalyticsDrive_* は descriptor を渡す薄いラッパーになる。
//
// descriptor 形:
//   {
//     stdKey:      標準フォルダキー（StdFolders_autoFileFolderOrNull_ 用。"forms"|"questions"|"dashboards"）
//     drivemapKey: drivemap を保存する Script Property キー
//     getProps:    () -> PropertiesService インスタンス（forms/analytics で取得元が異なるため関数で渡す）
//     label:       ログ用の識別子
//   }
//
// 純粋・汎用な小ヘルパ（FormsDrive_folderByIdOrNull_ / FormsDrive_childFolderByName_ /
// FormsDrive_parentPath_ / FormsDrive_rekeyMapForRelocate_）は formsDriveFolders.gs で
// 定義済みのものをそのまま流用する。
// =============================================

// drivemap (path -> folderId) を取得する。version 不一致・parse 失敗時は空オブジェクト。
function SharedDrive_getPathMap_(desc) {
  var props = desc.getProps();
  var raw = props.getProperty(desc.drivemapKey);
  if (!raw) return {};
  try {
    var parsed = JSON.parse(raw);
    if (parsed && parsed.version === NFB_FOLDER_DRIVE_MAP_PROPERTY_VERSION && parsed.map && typeof parsed.map === "object") {
      return parsed.map;
    }
  } catch (err) {
    Logger.log("[SharedDrive_getPathMap_:" + desc.label + "] parse failed: " + err);
  }
  return {};
}

// drivemap を保存する（versioned JSON）。
function SharedDrive_savePathMap_(desc, map) {
  var props = desc.getProps();
  props.setProperty(
    desc.drivemapKey,
    JSON.stringify({ version: NFB_FOLDER_DRIVE_MAP_PROPERTY_VERSION, map: (map && typeof map === "object") ? map : {} })
  );
}

// 物理ツリーの基点 = 標準フォルダ。標準フォルダ無効/ルート未解決なら null。
function SharedDrive_baseFolderOrNull_(desc) {
  return StdFolders_autoFileFolderOrNull_(desc.stdKey);
}

// 仮想パスに対応する物理フォルダを解決・作成する（祖先も ensure）。
//   path === ""    → base
//   base が null   → null（auto-organize off。呼び出し側はフォールバック）
function SharedDrive_ensureFolderForPath_(desc, path) {
  var normalized = Forms_normalizeFolderPath_(path);
  var base = SharedDrive_baseFolderOrNull_(desc);
  if (!base) return null;
  if (!normalized) return base;

  var map = SharedDrive_getPathMap_(desc);
  // キャッシュ済み leaf が生きていれば即返す。
  var cached = FormsDrive_folderByIdOrNull_(map[normalized]);
  if (cached) return cached;

  // base から segment ごとに traverse / create。
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
  if (dirty) SharedDrive_savePathMap_(desc, map);
  return parent;
}

// 仮想パスに対応する物理フォルダを「探すだけ」（作成しない）。無ければ null。
function SharedDrive_lookupFolderForPath_(desc, path) {
  var normalized = Forms_normalizeFolderPath_(path);
  var base = SharedDrive_baseFolderOrNull_(desc);
  if (!base) return null;
  if (!normalized) return base;

  var map = SharedDrive_getPathMap_(desc);
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

// 物理フォルダの移動 + リネーム（mv 相当。リネーム=親同一・leaf 変更、移動=親変更）。
// サブツリーは Drive 上で一体移動されるため、配下ファイルの個別移動は不要。
function SharedDrive_movePathFolder_(desc, oldPath, newPath) {
  var oldN = Forms_normalizeFolderPath_(oldPath);
  var newN = Forms_normalizeFolderPath_(newPath);
  if (!oldN || !newN || oldN === newN) return false;
  var base = SharedDrive_baseFolderOrNull_(desc);
  if (!base) return false;

  try {
    var folder = SharedDrive_lookupFolderForPath_(desc, oldN);
    if (!folder) {
      // 物理フォルダが未作成 → 移動対象なし。将来のファイル配置のため新パスだけ用意。
      SharedDrive_ensureFolderForPath_(desc, newN);
      return false;
    }
    var oldParent = FormsDrive_parentPath_(oldN);
    var newParent = FormsDrive_parentPath_(newN);
    var oldLeaf = oldN.split("/").pop();
    var newLeaf = newN.split("/").pop();

    if (newParent !== oldParent) {
      var dest = SharedDrive_ensureFolderForPath_(desc, newParent); // "" → base
      if (dest) folder.moveTo(dest);
    }
    if (newLeaf !== oldLeaf) {
      folder.setName(newLeaf);
    }

    var map = FormsDrive_rekeyMapForRelocate_(SharedDrive_getPathMap_(desc), oldN, newN);
    map[newN] = folder.getId();
    SharedDrive_savePathMap_(desc, map);
    return true;
  } catch (err) {
    Logger.log("[SharedDrive_movePathFolder_:" + desc.label + "] failed " + oldN + " -> " + newN + ": " + err);
    return false;
  }
}

// 物理フォルダをゴミ箱へ（配下も一括 trash）。drivemap から path + 子孫を除去。
function SharedDrive_trashPathFolder_(desc, path) {
  var normalized = Forms_normalizeFolderPath_(path);
  if (!normalized) return false;
  var base = SharedDrive_baseFolderOrNull_(desc);
  if (!base) return false;

  try {
    var folder = SharedDrive_lookupFolderForPath_(desc, normalized);
    if (folder) folder.setTrashed(true);

    var map = SharedDrive_getPathMap_(desc);
    var prefix = normalized + "/";
    var next = {};
    for (var key in map) {
      if (!map.hasOwnProperty(key)) continue;
      if (key === normalized || key.indexOf(prefix) === 0) continue;
      next[key] = map[key];
    }
    SharedDrive_savePathMap_(desc, next);
    return !!folder;
  } catch (err) {
    Logger.log("[SharedDrive_trashPathFolder_:" + desc.label + "] failed " + normalized + ": " + err);
    return false;
  }
}

// fileId のファイルが base 配下のどの相対フォルダパスにあるかを返す。base 直下なら ""。
// base 配下に無い / 解決不能なら null（= 構成外）。整合エンジンの「物理パス P」算出に使う。
function SharedDrive_relativeFolderOfFile_(desc, fileId) {
  if (!fileId) return null;
  var base = SharedDrive_baseFolderOrNull_(desc);
  if (!base) return null;
  try {
    var baseId = base.getId();
    var file = DriveApp.getFileById(fileId);
    var parents = file.getParents();
    if (!parents || !parents.hasNext()) return null;
    var parent = parents.next();
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
    Logger.log("[SharedDrive_relativeFolderOfFile_:" + desc.label + "] " + fileId + ": " + err);
  }
  return null;
}

// ファイルを path に対応する物理フォルダへ移動する（既に正しい親なら no-op）。
function SharedDrive_moveFileToPath_(desc, fileId, path) {
  if (!fileId) return false;
  var base = SharedDrive_baseFolderOrNull_(desc);
  if (!base) return false;

  try {
    var target = SharedDrive_ensureFolderForPath_(desc, path);
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
    Logger.log("[SharedDrive_moveFileToPath_:" + desc.label + "] failed " + fileId + " -> " + path + ": " + err);
    return false;
  }
}
