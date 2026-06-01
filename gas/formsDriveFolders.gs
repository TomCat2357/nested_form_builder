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
//
// ロジック本体は sharedDriveFolders.gs（SharedDrive_*）に集約済み。本ファイルは forms 用の
// descriptor を渡す薄いラッパーと、analytics 版も流用する純粋ヘルパ、forms 固有の backfill のみ。
// =============================================

// 物理ツリーの基点 = 標準フォルダ 01_forms。標準フォルダ無効/ルート未解決なら null。
function FormsDrive_baseFolderOrNull_() {
  return StdFolders_autoFileFolderOrNull_("forms");
}

// SharedDrive_* に渡す forms 用 descriptor。
function FormsDrive_descriptor_() {
  return {
    stdKey: "forms",
    drivemapKey: NFB_FOLDER_DRIVE_MAP_PROPERTY_KEY,
    label: "forms",
    getProps: function() { return Forms_getActiveProps_(); }
  };
}

// ---- SharedDrive_* への薄いラッパー（既存の公開シグネチャを維持） ----

function FormsDrive_getPathMap_() { return SharedDrive_getPathMap_(FormsDrive_descriptor_()); }
function FormsDrive_savePathMap_(map) { return SharedDrive_savePathMap_(FormsDrive_descriptor_(), map); }
function FormsDrive_ensureFolderForPath_(path) { return SharedDrive_ensureFolderForPath_(FormsDrive_descriptor_(), path); }
function FormsDrive_lookupFolderForPath_(path) { return SharedDrive_lookupFolderForPath_(FormsDrive_descriptor_(), path); }
function FormsDrive_movePathFolder_(oldPath, newPath) { return SharedDrive_movePathFolder_(FormsDrive_descriptor_(), oldPath, newPath); }
function FormsDrive_trashPathFolder_(path) { return SharedDrive_trashPathFolder_(FormsDrive_descriptor_(), path); }
function FormsDrive_relativeFolderOfFile_(fileId) { return SharedDrive_relativeFolderOfFile_(FormsDrive_descriptor_(), fileId); }
function FormsDrive_moveFormFileToPath_(fileId, path) { return SharedDrive_moveFileToPath_(FormsDrive_descriptor_(), fileId, path); }

// ---- 純粋・汎用な小ヘルパ（analyticsDriveFolders.gs / sharedDriveFolders.gs から流用される） ----

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
