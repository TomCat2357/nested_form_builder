/**
 * driveBrowser.gs
 * ユーザー自身の Google Drive をブラウズして file/folder を選ぶピッカー用の読み取り専用 API。
 * Web アプリは executeAs=USER_ACCESSING のため、すべて「アクセス中ユーザー自身の Drive」を対象とする。
 *
 * 設計方針:
 * - ブラウズは 1 クリック＝1 階層のみ（非再帰）。大量フォルダ保護のため列挙には上限を設ける。
 * - URL/ID 解析は formsParsing.gs（Forms_parseGoogleDriveUrl_）を流用。
 * - 公開 API（nfbDriveBrowser*）はすべて nfbSafeCall_ で { ok, ... } / { ok:false, error } を返す。
 * - 共有ドライブ（Shared Drives）は Drive 拡張サービス（advanced service "Drive" v3）が有効なときのみ。
 *   未有効でも他機能（マイドライブ / 検索 / スター付き）はそのまま動く（タブはフロントで隠す）。
 * - ショートカット（application/vnd.google-apps.shortcut）は DriveApp の getTargetId/getTargetMimeType で
 *   実体へ解決し、解決できないものは列挙から除外する。
 */

// 1 フォルダ階層あたり / 検索結果あたりの列挙上限（超過時は truncated:true）。
var DRIVE_BROWSER_MAX_ITEMS = 800;
var DRIVE_BROWSER_MAX_SEARCH = 100;
// パンくず（祖先）を辿る上限（多親・循環保護）。
var DRIVE_BROWSER_MAX_BREADCRUMB = 50;

var DRIVE_BROWSER_FOLDER_MIME = "application/vnd.google-apps.folder";
var DRIVE_BROWSER_SHORTCUT_MIME = "application/vnd.google-apps.shortcut";

// ---------------------------------------------
// 公開 API
// ---------------------------------------------

/**
 * 1 フォルダの直下（フォルダ＋ファイル）を列挙する。folderId が空 / "root" ならマイドライブ直下。
 * mode はファイルのみに適用（フォルダは常にナビ用に返す）。
 * @param {{ folderId?: string, mode?: string }} payload
 * @return {{ ok, folderId, folderName, parentId, breadcrumb, items, truncated }}
 */
function nfbDriveBrowserList(payload) {
  return nfbSafeCall_(function() {
    payload = payload || {};
    var mode = DriveBrowser_normalizeMode_(payload.mode);
    var folderId = payload.folderId ? String(payload.folderId) : "";

    // マイドライブのルート
    if (!folderId || folderId === "root") {
      return DriveBrowser_listFolderViaDriveApp_(DriveApp.getRootFolder(), mode, true);
    }

    // 通常フォルダ / 共有ドライブの配下フォルダ（DriveApp は共有ドライブも辿れる）
    var folder = null;
    try {
      folder = DriveApp.getFolderById(folderId);
    } catch (e) {
      folder = null;
    }
    if (folder) {
      return DriveBrowser_listFolderViaDriveApp_(folder, mode, false);
    }

    // getFolderById で取れない＝共有ドライブのルート（driveId）の可能性。拡張サービスでフォールバック。
    if (DriveBrowser_isDriveAdvancedAvailable_()) {
      return DriveBrowser_listSharedDriveRoot_(folderId, mode);
    }
    throw new Error("フォルダにアクセスできません");
  });
}

/**
 * ファイル名・フォルダ名の部分一致検索（マイドライブ＋共有ドライブを横断）。
 * @param {{ query?: string, mode?: string }} payload
 * @return {{ ok, items, truncated }}
 */
function nfbDriveBrowserSearch(payload) {
  return nfbSafeCall_(function() {
    payload = payload || {};
    var mode = DriveBrowser_normalizeMode_(payload.mode);
    var query = payload.query ? String(payload.query).trim() : "";
    if (!query) {
      return { ok: true, items: [], truncated: false };
    }
    var escaped = query.replace(/'/g, "\\'");
    var items = [];
    var truncated = false;

    var folderIter = DriveApp.searchFolders("title contains '" + escaped + "' and trashed = false");
    while (folderIter.hasNext()) {
      if (items.length >= DRIVE_BROWSER_MAX_SEARCH) { truncated = true; break; }
      var fo = folderIter.next();
      if (DriveBrowser_isTrashed_(fo)) continue;
      items.push(DriveBrowser_makeItem_(fo.getId(), fo.getName(), "folder", DRIVE_BROWSER_FOLDER_MIME, DriveBrowser_dateToMs_(fo.getLastUpdated()), false, ""));
    }

    if (!truncated && mode !== "folders") {
      var fileIter = DriveApp.searchFiles("title contains '" + escaped + "' and trashed = false");
      while (fileIter.hasNext()) {
        if (items.length >= DRIVE_BROWSER_MAX_SEARCH) { truncated = true; break; }
        var f = fileIter.next();
        if (DriveBrowser_isTrashed_(f)) continue;
        var item = DriveBrowser_fileToItemOrNull_(f, mode);
        if (item) items.push(item);
      }
    }
    return { ok: true, items: DriveBrowser_sortItems_(items), truncated: truncated };
  });
}

/**
 * 共有ドライブの一覧。Drive 拡張サービスが未有効なら available:false で空配列を返す。
 * @return {{ ok, available, drives:[{id,name}] }}
 */
function nfbDriveBrowserListSharedDrives() {
  return nfbSafeCall_(function() {
    if (!DriveBrowser_isDriveAdvancedAvailable_()) {
      return { ok: true, available: false, drives: [] };
    }
    var drives = [];
    try {
      var response = Drive.Drives.list({ pageSize: 100, fields: "drives(id,name)" });
      var list = (response && response.drives) ? response.drives : [];
      for (var i = 0; i < list.length; i++) {
        drives.push({ id: list[i].id, name: list[i].name });
      }
    } catch (e) {
      // 拡張サービスは有効だが共有ドライブ未所属 / 権限不足など → 空で返す（致命扱いしない）
      Logger.log("[driveBrowser] 共有ドライブ取得失敗: " + nfbErrorToString_(e));
      return { ok: true, available: true, drives: [] };
    }
    return { ok: true, available: true, drives: drives };
  });
}

/**
 * スター付きの file/folder を列挙。拡張サービス不要（DriveApp.searchFiles）。
 * @param {{ mode?: string }} payload
 * @return {{ ok, items, truncated }}
 */
function nfbDriveBrowserListStarred(payload) {
  return nfbSafeCall_(function() {
    payload = payload || {};
    var mode = DriveBrowser_normalizeMode_(payload.mode);
    var items = [];
    var truncated = false;

    var folderIter = DriveApp.searchFolders("starred = true and trashed = false");
    while (folderIter.hasNext()) {
      if (items.length >= DRIVE_BROWSER_MAX_SEARCH) { truncated = true; break; }
      var fo = folderIter.next();
      if (DriveBrowser_isTrashed_(fo)) continue;
      items.push(DriveBrowser_makeItem_(fo.getId(), fo.getName(), "folder", DRIVE_BROWSER_FOLDER_MIME, DriveBrowser_dateToMs_(fo.getLastUpdated()), false, ""));
    }

    if (!truncated && mode !== "folders") {
      var fileIter = DriveApp.searchFiles("starred = true and trashed = false");
      while (fileIter.hasNext()) {
        if (items.length >= DRIVE_BROWSER_MAX_SEARCH) { truncated = true; break; }
        var f = fileIter.next();
        if (DriveBrowser_isTrashed_(f)) continue;
        var item = DriveBrowser_fileToItemOrNull_(f, mode);
        if (item) items.push(item);
      }
    }
    return { ok: true, items: DriveBrowser_sortItems_(items), truncated: truncated };
  });
}

/**
 * 貼り付けられた URL / 素 ID を file or folder へ解決する（プリセット / バリデーション用）。
 * @param {{ idOrUrl?: string }} payload
 * @return {{ ok, item:{id,name,type,mimeType,url}|null }}
 */
function nfbDriveBrowserResolve(payload) {
  return nfbSafeCall_(function() {
    payload = payload || {};
    var idOrUrl = payload.idOrUrl ? String(payload.idOrUrl).trim() : "";
    if (!idOrUrl) {
      return { ok: true, item: null };
    }
    var parsed = Forms_parseGoogleDriveUrl_(idOrUrl);
    if (!parsed.type || !parsed.id) {
      return { ok: true, item: null };
    }
    if (parsed.type === "folder") {
      var folder = DriveApp.getFolderById(parsed.id);
      return {
        ok: true,
        item: {
          id: folder.getId(),
          name: folder.getName(),
          type: "folder",
          mimeType: DRIVE_BROWSER_FOLDER_MIME,
          url: folder.getUrl()
        }
      };
    }
    var file = DriveApp.getFileById(parsed.id);
    return {
      ok: true,
      item: {
        id: file.getId(),
        name: file.getName(),
        type: "file",
        mimeType: file.getMimeType(),
        url: file.getUrl()
      }
    };
  });
}

// ---------------------------------------------
// 内部ヘルパー
// ---------------------------------------------

// Drive 拡張サービス（advanced service "Drive"）が利用可能か。
function DriveBrowser_isDriveAdvancedAvailable_() {
  return typeof Drive !== "undefined";
}

// mode を正規化（既定 "all"）。"all" | "json" | "css" | "folders"。
function DriveBrowser_normalizeMode_(mode) {
  var m = mode ? String(mode) : "";
  if (m === "json" || m === "css" || m === "folders" || m === "all") return m;
  return "all";
}

// mode に対するファイル MIME / 拡張子の許可判定。folders はファイルを一切通さない。
// json は Nfb_scanDriveJsonImports_ と同一述語（.json 拡張子 or application/json / text/plain）。
function DriveBrowser_fileMatchesMode_(mimeType, name, mode) {
  if (mode === "folders") return false;
  var lower = String(name || "").toLowerCase();
  if (mode === "json") {
    return mimeType === "application/json"
      || mimeType === "text/plain"
      || lower.lastIndexOf(".json") === lower.length - 5;
  }
  if (mode === "css") {
    return mimeType === "text/css"
      || lower.lastIndexOf(".css") === lower.length - 4;
  }
  return true; // "all"
}

// trashed 判定（メソッド非対応でも安全に false）。
function DriveBrowser_isTrashed_(item) {
  try { return typeof item.isTrashed === "function" && item.isTrashed(); } catch (e) { return false; }
}

// Date → epoch ms（null セーフ）。フロントでロケール整形する前提。
function DriveBrowser_dateToMs_(d) {
  try { return d ? d.getTime() : null; } catch (e) { return null; }
}

// 列挙アイテムの共通形。
function DriveBrowser_makeItem_(id, name, type, mimeType, updatedMs, isShortcut, targetId) {
  return {
    id: id,
    name: name,
    type: type,
    mimeType: mimeType || "",
    updated: (typeof updatedMs === "number") ? updatedMs : null,
    isShortcut: !!isShortcut,
    targetId: targetId || ""
  };
}

// フォルダ先頭・名前昇順でソート。
function DriveBrowser_sortItems_(items) {
  items.sort(function(a, b) {
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    var an = String(a.name || "").toLowerCase();
    var bn = String(b.name || "").toLowerCase();
    if (an < bn) return -1;
    if (an > bn) return 1;
    return 0;
  });
  return items;
}

// DriveApp の File を mode に従って item 化（不一致は null）。ショートカットは実体へ解決。
function DriveBrowser_fileToItemOrNull_(f, mode) {
  var mime = f.getMimeType();
  if (mime === DRIVE_BROWSER_SHORTCUT_MIME) {
    var targetMime = "";
    var targetId = "";
    try { targetMime = f.getTargetMimeType(); } catch (e) {}
    try { targetId = f.getTargetId(); } catch (e2) {}
    if (!targetId) {
      Logger.log("[driveBrowser] ショートカット解決不可（除外）: " + f.getName());
      return null;
    }
    if (targetMime === DRIVE_BROWSER_FOLDER_MIME) {
      return DriveBrowser_makeItem_(targetId, f.getName(), "folder", targetMime, DriveBrowser_dateToMs_(f.getLastUpdated()), true, targetId);
    }
    if (DriveBrowser_fileMatchesMode_(targetMime, f.getName(), mode)) {
      return DriveBrowser_makeItem_(targetId, f.getName(), "file", targetMime, DriveBrowser_dateToMs_(f.getLastUpdated()), true, targetId);
    }
    return null;
  }
  if (DriveBrowser_fileMatchesMode_(mime, f.getName(), mode)) {
    return DriveBrowser_makeItem_(f.getId(), f.getName(), "file", mime, DriveBrowser_dateToMs_(f.getLastUpdated()), false, "");
  }
  return null;
}

// DriveApp の 1 フォルダを列挙して標準レスポンスを返す。
function DriveBrowser_listFolderViaDriveApp_(folder, mode, isRoot) {
  var items = [];
  var truncated = false;

  var folderIter = folder.getFolders();
  while (folderIter.hasNext()) {
    if (items.length >= DRIVE_BROWSER_MAX_ITEMS) { truncated = true; break; }
    var sf = folderIter.next();
    if (DriveBrowser_isTrashed_(sf)) continue;
    items.push(DriveBrowser_makeItem_(sf.getId(), sf.getName(), "folder", DRIVE_BROWSER_FOLDER_MIME, DriveBrowser_dateToMs_(sf.getLastUpdated()), false, ""));
  }

  if (!truncated) {
    var fileIter = folder.getFiles();
    while (fileIter.hasNext()) {
      if (items.length >= DRIVE_BROWSER_MAX_ITEMS) { truncated = true; break; }
      var f = fileIter.next();
      if (DriveBrowser_isTrashed_(f)) continue;
      var item = DriveBrowser_fileToItemOrNull_(f, mode);
      if (item) items.push(item);
    }
  }

  var parentId = null;
  if (!isRoot) {
    try {
      var parents = folder.getParents();
      if (parents.hasNext()) parentId = parents.next().getId();
    } catch (e) {
      parentId = null;
    }
  }

  return {
    ok: true,
    folderId: isRoot ? "" : folder.getId(),
    folderName: isRoot ? "マイドライブ" : folder.getName(),
    parentId: parentId,
    breadcrumb: DriveBrowser_buildBreadcrumb_(folder, isRoot),
    items: DriveBrowser_sortItems_(items),
    truncated: truncated
  };
}

// 祖先チェーン（root→current）を多親/循環保護付きで構築。
function DriveBrowser_buildBreadcrumb_(folder, isRoot) {
  if (isRoot) {
    return [{ id: "", name: "マイドライブ" }];
  }
  var chain = [];
  var current = folder;
  var seen = {};
  var steps = 0;
  while (current && steps < DRIVE_BROWSER_MAX_BREADCRUMB) {
    var cid = current.getId();
    if (seen[cid]) break;
    seen[cid] = true;
    chain.push({ id: cid, name: current.getName() });
    var parents;
    try { parents = current.getParents(); } catch (e) { break; }
    if (!parents || !parents.hasNext()) break; // ルート直下 or 共有ドライブ境界
    current = parents.next();
    steps++;
  }
  chain.reverse();
  return chain;
}

// 共有ドライブのルート（driveId）を Drive 拡張サービス（v3）で列挙する。
// DriveApp.getFolderById(driveId) が取れないケースのフォールバック。
function DriveBrowser_listSharedDriveRoot_(driveId, mode) {
  var driveName = "";
  try {
    var d = Drive.Drives.get(driveId, { fields: "id,name" });
    if (d && d.name) driveName = d.name;
  } catch (e) {
    // 名前は取れなくても列挙は試みる
  }

  var clauses = ["'" + driveId + "' in parents", "trashed = false"];
  if (mode === "folders") {
    clauses.push("mimeType = '" + DRIVE_BROWSER_FOLDER_MIME + "'");
  }
  var resp = Drive.Files.list({
    q: clauses.join(" and "),
    pageSize: DRIVE_BROWSER_MAX_ITEMS,
    fields: "files(id,name,mimeType,modifiedTime,shortcutDetails)",
    corpora: "drive",
    driveId: driveId,
    includeItemsFromAllDrives: true,
    supportsAllDrives: true
  });
  var files = (resp && resp.files) ? resp.files : [];
  var items = [];
  for (var i = 0; i < files.length; i++) {
    var item = DriveBrowser_advancedFileToItemOrNull_(files[i], mode);
    if (item) items.push(item);
  }
  return {
    ok: true,
    folderId: driveId,
    folderName: driveName || "共有ドライブ",
    parentId: "shared-root",
    breadcrumb: [
      { id: "shared-root", name: "共有ドライブ" },
      { id: driveId, name: driveName || "共有ドライブ" }
    ],
    items: DriveBrowser_sortItems_(items),
    truncated: files.length >= DRIVE_BROWSER_MAX_ITEMS
  };
}

// Drive 拡張サービス（v3）の files() 要素を mode に従って item 化（不一致は null）。
function DriveBrowser_advancedFileToItemOrNull_(f, mode) {
  var mime = f.mimeType;
  var updatedMs = null;
  try { if (f.modifiedTime) updatedMs = new Date(f.modifiedTime).getTime(); } catch (e) { updatedMs = null; }

  if (mime === DRIVE_BROWSER_SHORTCUT_MIME) {
    var sd = f.shortcutDetails || {};
    var targetId = sd.targetId || "";
    var targetMime = sd.targetMimeType || "";
    if (!targetId) return null;
    if (targetMime === DRIVE_BROWSER_FOLDER_MIME) {
      return DriveBrowser_makeItem_(targetId, f.name, "folder", targetMime, updatedMs, true, targetId);
    }
    if (DriveBrowser_fileMatchesMode_(targetMime, f.name, mode)) {
      return DriveBrowser_makeItem_(targetId, f.name, "file", targetMime, updatedMs, true, targetId);
    }
    return null;
  }
  if (mime === DRIVE_BROWSER_FOLDER_MIME) {
    return DriveBrowser_makeItem_(f.id, f.name, "folder", mime, updatedMs, false, "");
  }
  if (DriveBrowser_fileMatchesMode_(mime, f.name, mode)) {
    return DriveBrowser_makeItem_(f.id, f.name, "file", mime, updatedMs, false, "");
  }
  return null;
}
