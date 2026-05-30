// =============================================
// Forms Drive Folders — 仮想フォルダ階層を物理 Google Drive フォルダ（01_forms 配下）にミラーする。
//
// 設計:
//   - 仮想フォルダパス ("a/b/c") ↔ 物理 Drive フォルダ ID の対応を PropertiesService
//     (NFB_FOLDER_DRIVE_MAP_PROPERTY_KEY) にキャッシュし O(1) で解決する（drivemap）。
//   - drivemap が欠損/陳腐化していたら base (01_forms) からの name 探索で再生成（自己修復）。
//   - 標準フォルダ（01_forms）が解決できない場合は base=null となり、全関数が no-op に degrade
//     して現状の「仮想のみ」挙動にフォールバックする。
//   - 通常運用では仮想（登録簿 + form.folder）が正・物理はベストエフォートのミラー。
//     Drive 操作の失敗はログのみで登録簿更新を巻き戻さない（次回 ensure / バックフィル / 走査で自己修復）。
// =============================================

// drivemap (path -> folderId) を取得する。version 不一致・parse 失敗時は空オブジェクト。
function FormsDrive_getPathMap_() {
  var props = Forms_getActiveProps_();
  var raw = props.getProperty(NFB_FOLDER_DRIVE_MAP_PROPERTY_KEY);
  if (!raw) return {};
  try {
    var parsed = JSON.parse(raw);
    if (parsed && parsed.version === NFB_FOLDER_DRIVE_MAP_PROPERTY_VERSION && parsed.map && typeof parsed.map === "object") {
      return parsed.map;
    }
  } catch (err) {
    Logger.log("[FormsDrive_getPathMap_] parse failed: " + err);
  }
  return {};
}

// drivemap を保存する（versioned JSON）。
function FormsDrive_savePathMap_(map) {
  var props = Forms_getActiveProps_();
  props.setProperty(
    NFB_FOLDER_DRIVE_MAP_PROPERTY_KEY,
    JSON.stringify({ version: NFB_FOLDER_DRIVE_MAP_PROPERTY_VERSION, map: (map && typeof map === "object") ? map : {} })
  );
}

// 物理ツリーの基点 = 標準フォルダ 01_forms。標準フォルダ無効/ルート未解決なら null。
function FormsDrive_baseFolderOrNull_() {
  return StdFolders_autoFileFolderOrNull_("forms");
}

// folderId から Folder を取得（trashed/アクセス不能なら null）。
function FormsDrive_folderByIdOrNull_(id) {
  if (!id) return null;
  try {
    var folder = DriveApp.getFolderById(id);
    if (typeof folder.isTrashed === "function" && folder.isTrashed()) return null;
    return folder;
  } catch (e) {
    return null;
  }
}

// parent 直下の name と一致する非 trashed の子フォルダ（最初の 1 件）。無ければ null。
function FormsDrive_childFolderByName_(parent, name) {
  var it = parent.getFoldersByName(name);
  while (it.hasNext()) {
    var folder = it.next();
    if (!(typeof folder.isTrashed === "function" && folder.isTrashed())) return folder;
  }
  return null;
}

// 仮想パスに対応する物理フォルダを解決・作成する（祖先も ensure）。
//   path === ""    → base (01_forms)
//   base が null   → null（auto-organize off。呼び出し側はフォールバック）
function FormsDrive_ensureFolderForPath_(path) {
  var normalized = Forms_normalizeFolderPath_(path);
  var base = FormsDrive_baseFolderOrNull_();
  if (!base) return null;
  if (!normalized) return base;

  var map = FormsDrive_getPathMap_();
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
  if (dirty) FormsDrive_savePathMap_(map);
  return parent;
}

// 仮想パスに対応する物理フォルダを「探すだけ」（作成しない）。無ければ null。
function FormsDrive_lookupFolderForPath_(path) {
  var normalized = Forms_normalizeFolderPath_(path);
  var base = FormsDrive_baseFolderOrNull_();
  if (!base) return null;
  if (!normalized) return base;

  var map = FormsDrive_getPathMap_();
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

// drivemap の key を old → next の prefix 置換で振り直す（純関数）。
// "a/b" → "a/x" のとき "a/b" と "a/b/*" の key だけ置換し、folderId は据え置く。
function FormsDrive_rekeyMapForRelocate_(map, oldPath, newPath) {
  var out = {};
  var prefix = oldPath + "/";
  for (var key in map) {
    if (!map.hasOwnProperty(key)) continue;
    if (key === oldPath) {
      out[newPath] = map[key];
    } else if (key.indexOf(prefix) === 0) {
      out[newPath + key.slice(oldPath.length)] = map[key];
    } else {
      out[key] = map[key];
    }
  }
  return out;
}

// パスの親（最後の segment を除いた部分）を返す。トップレベルは ""。
function FormsDrive_parentPath_(path) {
  var segs = String(path || "").split("/");
  segs.pop();
  return segs.join("/");
}

// 物理フォルダの移動 + リネーム（mv 相当。リネーム=親同一・leaf 変更、移動=親変更）。
// サブツリーは Drive 上で一体移動されるため、配下フォームファイルの個別移動は不要。
function FormsDrive_movePathFolder_(oldPath, newPath) {
  var oldN = Forms_normalizeFolderPath_(oldPath);
  var newN = Forms_normalizeFolderPath_(newPath);
  if (!oldN || !newN || oldN === newN) return false;
  var base = FormsDrive_baseFolderOrNull_();
  if (!base) return false;

  try {
    var folder = FormsDrive_lookupFolderForPath_(oldN);
    if (!folder) {
      // 物理フォルダが未作成 → 移動対象なし。将来のファイル配置のため新パスだけ用意。
      FormsDrive_ensureFolderForPath_(newN);
      return false;
    }
    var oldParent = FormsDrive_parentPath_(oldN);
    var newParent = FormsDrive_parentPath_(newN);
    var oldLeaf = oldN.split("/").pop();
    var newLeaf = newN.split("/").pop();

    if (newParent !== oldParent) {
      var dest = FormsDrive_ensureFolderForPath_(newParent); // "" → base
      if (dest) folder.moveTo(dest);
    }
    if (newLeaf !== oldLeaf) {
      folder.setName(newLeaf);
    }

    var map = FormsDrive_rekeyMapForRelocate_(FormsDrive_getPathMap_(), oldN, newN);
    map[newN] = folder.getId();
    FormsDrive_savePathMap_(map);
    return true;
  } catch (err) {
    Logger.log("[FormsDrive_movePathFolder_] failed " + oldN + " -> " + newN + ": " + err);
    return false;
  }
}

// 物理フォルダをゴミ箱へ（配下も一括 trash）。drivemap から path + 子孫を除去。
function FormsDrive_trashPathFolder_(path) {
  var normalized = Forms_normalizeFolderPath_(path);
  if (!normalized) return false;
  var base = FormsDrive_baseFolderOrNull_();
  if (!base) return false;

  try {
    var folder = FormsDrive_lookupFolderForPath_(normalized);
    if (folder) folder.setTrashed(true);

    var map = FormsDrive_getPathMap_();
    var prefix = normalized + "/";
    var next = {};
    for (var key in map) {
      if (!map.hasOwnProperty(key)) continue;
      if (key === normalized || key.indexOf(prefix) === 0) continue;
      next[key] = map[key];
    }
    FormsDrive_savePathMap_(next);
    return !!folder;
  } catch (err) {
    Logger.log("[FormsDrive_trashPathFolder_] failed " + normalized + ": " + err);
    return false;
  }
}

// fileId のファイルが base (01_forms) 配下のどの相対フォルダパスにあるかを返す。base 直下なら ""。
// base 配下に無い / 解決不能なら null（= 構成外）。整合エンジンの「物理パス P」算出に使う。
// analyticsDriveFolders.gs の AnalyticsDrive_relativeFolderOfFile_ と対称（base が forms 固定なだけ）。
function FormsDrive_relativeFolderOfFile_(fileId) {
  if (!fileId) return null;
  var base = FormsDrive_baseFolderOrNull_();
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
    Logger.log("[FormsDrive_relativeFolderOfFile_] " + fileId + ": " + err);
  }
  return null;
}

// フォームファイルを path に対応する物理フォルダへ移動する（既に正しい親なら no-op）。
function FormsDrive_moveFormFileToPath_(fileId, path) {
  if (!fileId) return false;
  var base = FormsDrive_baseFolderOrNull_();
  if (!base) return false;

  try {
    var target = FormsDrive_ensureFolderForPath_(path);
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
    Logger.log("[FormsDrive_moveFormFileToPath_] failed " + fileId + " -> " + path + ": " + err);
    return false;
  }
}

// 既存の仮想フォルダ/フォームを物理 Drive 構造へ一括反映する（手動・冪等）。
// auto-organize off では skip。
function FormsDrive_backfillPhysicalFolders_() {
  return WithScriptLock_("物理フォルダのバックフィル", function() {
    var base = FormsDrive_baseFolderOrNull_();
    if (!base) return { ok: true, skipped: true, reason: "標準フォルダが無効です" };

    // 1) 既知フォルダ（登録簿 ∪ form 由来。親→子順）を物理化。
    var paths = Forms_collectFolders_();
    for (var i = 0; i < paths.length; i++) {
      FormsDrive_ensureFolderForPath_(paths[i]);
    }

    // 2) 各フォームファイルを form.folder に対応する物理フォルダへ移動。
    var mapping = Forms_getMapping_();
    var movedFiles = 0;
    for (var id in mapping) {
      if (!mapping.hasOwnProperty(id)) continue;
      var fileId = Nfb_resolveFileIdFromEntry_(mapping[id]);
      if (!fileId) continue;
      var form = Forms_getForm_(id);
      var folder = form ? Forms_normalizeFolderPath_(form.folder) : "";
      if (FormsDrive_moveFormFileToPath_(fileId, folder)) movedFiles++;
    }
    return { ok: true, folders: paths.length, movedFiles: movedFiles };
  });
}
