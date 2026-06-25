/**
 * driveBrowser.gs
 * ユーザー自身の Google Drive をブラウズして file/folder を選ぶピッカー用の読み取り専用 API。
 * Web アプリは executeAs=USER_ACCESSING のため、すべて「アクセス中ユーザー自身の Drive」を対象とする。
 *
 * パフォーマンス方針:
 * - Drive 拡張サービス（advanced service "Drive" v3）が有効なら Drive.Files.list を最優先で使う。
 *   fields 射影（id/name/mimeType/modifiedTime/shortcutDetails のみ）を 1 リクエストで取得するため、
 *   DriveApp の「1 件ごとの getter 往復」が無くなり、特に検索が大幅に速い。共有ドライブも横断できる。
 * - 拡張サービスが無い環境では DriveApp にフォールバック（My ドライブのみ・低速）。
 * - パンくず（祖先チェーン）はクライアント側で保持するため、サーバはフォルダの中身だけを返す
 *   （フォルダを開くたびの getParents() 往復を排除）。各 API は { ok, items, truncated } のみ返す。
 *
 * 設計方針:
 * - ブラウズは 1 クリック＝1 階層のみ（非再帰）。pageSize で上限。
 * - 公開 API（nfbDriveBrowser*）はすべて nfbSafeCall_ で { ok, ... } / { ok:false, error } を返す。
 * - ショートカット（application/vnd.google-apps.shortcut）は実体（targetId/targetMimeType）へ解決する。
 * - mode はファイルのみに適用（フォルダは常にナビ用に返す）。"all" | "json" | "css" | "folders"。
 */

var DRIVE_BROWSER_MAX_ITEMS = 1000;
var DRIVE_BROWSER_MAX_SEARCH = 100;

var DRIVE_BROWSER_FOLDER_MIME = "application/vnd.google-apps.folder";
var DRIVE_BROWSER_SHORTCUT_MIME = "application/vnd.google-apps.shortcut";
var DRIVE_BROWSER_FIELDS = "files(id,name,mimeType,modifiedTime,shortcutDetails)";

// ---------------------------------------------
// 公開 API
// ---------------------------------------------

/**
 * 1 フォルダの直下（フォルダ＋ファイル）を列挙する。folderId が空 / "root" ならマイドライブ直下。
 * driveId 指定時はその共有ドライブ内として列挙する（corpora=drive）。
 * @param {{ folderId?: string, mode?: string, driveId?: string }} payload
 * @return {{ ok, items, truncated }}
 */
function nfbDriveBrowserList(payload) {
  return nfbSafeCall_(function() {
    payload = payload || {};
    var mode = DriveBrowser_normalizeMode_(payload.mode);
    var folderId = payload.folderId ? String(payload.folderId) : "";
    var driveId = payload.driveId ? String(payload.driveId) : "";
    var parentRef = (!folderId || folderId === "root") ? "root" : folderId;

    if (DriveBrowser_isDriveAdvancedAvailable_()) {
      var params = {
        q: "'" + parentRef + "' in parents and trashed = false",
        pageSize: DRIVE_BROWSER_MAX_ITEMS,
        fields: DRIVE_BROWSER_FIELDS,
        includeItemsFromAllDrives: true,
        supportsAllDrives: true
      };
      if (driveId) {
        params.corpora = "drive";
        params.driveId = driveId;
      }
      return DriveBrowser_v3Run_(params, mode);
    }

    // フォールバック（DriveApp・My ドライブのみ）
    var folder = (parentRef === "root") ? DriveApp.getRootFolder() : DriveApp.getFolderById(folderId);
    return DriveBrowser_driveAppList_(folder, mode);
  });
}

/**
 * 名前の部分一致検索（拡張サービスがあればマイドライブ＋共有ドライブを横断）。
 * @param {{ query?: string, mode?: string }} payload
 * @return {{ ok, items, truncated }}
 */
function nfbDriveBrowserSearch(payload) {
  return nfbSafeCall_(function() {
    payload = payload || {};
    var mode = DriveBrowser_normalizeMode_(payload.mode);
    var query = payload.query ? String(payload.query).trim() : "";
    if (!query) return { ok: true, items: [], truncated: false };
    var escaped = query.replace(/'/g, "\\'");

    if (DriveBrowser_isDriveAdvancedAvailable_()) {
      return DriveBrowser_v3Run_({
        q: "name contains '" + escaped + "' and trashed = false",
        pageSize: DRIVE_BROWSER_MAX_SEARCH,
        fields: DRIVE_BROWSER_FIELDS,
        corpora: "allDrives",
        includeItemsFromAllDrives: true,
        supportsAllDrives: true
      }, mode);
    }
    return DriveBrowser_driveAppSearch_(escaped, mode);
  });
}

/**
 * スター付きの file/folder を列挙。
 * @param {{ mode?: string }} payload
 * @return {{ ok, items, truncated }}
 */
function nfbDriveBrowserListStarred(payload) {
  return nfbSafeCall_(function() {
    payload = payload || {};
    var mode = DriveBrowser_normalizeMode_(payload.mode);
    if (DriveBrowser_isDriveAdvancedAvailable_()) {
      return DriveBrowser_v3Run_({
        q: "starred = true and trashed = false",
        pageSize: DRIVE_BROWSER_MAX_SEARCH,
        fields: DRIVE_BROWSER_FIELDS,
        corpora: "allDrives",
        includeItemsFromAllDrives: true,
        supportsAllDrives: true
      }, mode);
    }
    return DriveBrowser_driveAppStarred_(mode);
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
      Logger.log("[driveBrowser] 共有ドライブ取得失敗: " + nfbErrorToString_(e));
      return { ok: true, available: true, drives: [] };
    }
    return { ok: true, available: true, drives: drives };
  });
}

/**
 * 貼り付けられた URL / 素 ID を file or folder へ解決する（URL 入力欄のプリセット用・ホットパス外）。
 * @param {{ idOrUrl?: string }} payload
 * @return {{ ok, item:{id,name,type,mimeType,url}|null }}
 */
function nfbDriveBrowserResolve(payload) {
  return nfbSafeCall_(function() {
    payload = payload || {};
    var idOrUrl = payload.idOrUrl ? String(payload.idOrUrl).trim() : "";
    if (!idOrUrl) return { ok: true, item: null };
    var parsed = Forms_parseGoogleDriveUrl_(idOrUrl);
    if (!parsed.type || !parsed.id) return { ok: true, item: null };
    if (parsed.type === "folder") {
      var folder = DriveApp.getFolderById(parsed.id);
      return { ok: true, item: { id: folder.getId(), name: folder.getName(), type: "folder", mimeType: DRIVE_BROWSER_FOLDER_MIME, url: folder.getUrl() } };
    }
    var file = DriveApp.getFileById(parsed.id);
    return { ok: true, item: { id: file.getId(), name: file.getName(), type: "file", mimeType: file.getMimeType(), url: file.getUrl() } };
  });
}

// ---------------------------------------------
// 共通ヘルパー
// ---------------------------------------------

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
    return mimeType === "text/css" || lower.lastIndexOf(".css") === lower.length - 4;
  }
  return true; // "all"
}

function DriveBrowser_isTrashed_(item) {
  try { return typeof item.isTrashed === "function" && item.isTrashed(); } catch (e) { return false; }
}

function DriveBrowser_dateToMs_(d) {
  try { return d ? d.getTime() : null; } catch (e) { return null; }
}

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

// ---------------------------------------------
// Drive API v3（advanced service）パス
// ---------------------------------------------

// Drive.Files.list を実行し、items 化して標準レスポンスを返す。
function DriveBrowser_v3Run_(params, mode) {
  var resp = Drive.Files.list(params);
  var files = (resp && resp.files) ? resp.files : [];
  var items = [];
  for (var i = 0; i < files.length; i++) {
    var item = DriveBrowser_advancedFileToItemOrNull_(files[i], mode);
    if (item) items.push(item);
  }
  var pageSize = params.pageSize || DRIVE_BROWSER_MAX_ITEMS;
  return { ok: true, items: DriveBrowser_sortItems_(items), truncated: files.length >= pageSize };
}

// Drive API v3 の files() 要素を mode に従って item 化（不一致は null）。
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

// ---------------------------------------------
// DriveApp フォールバック（拡張サービス未有効時のみ）
// ---------------------------------------------

function DriveBrowser_driveAppList_(folder, mode) {
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
      var item = DriveBrowser_driveAppFileToItemOrNull_(f, mode);
      if (item) items.push(item);
    }
  }
  return { ok: true, items: DriveBrowser_sortItems_(items), truncated: truncated };
}

function DriveBrowser_driveAppSearch_(escaped, mode) {
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
      var item = DriveBrowser_driveAppFileToItemOrNull_(f, mode);
      if (item) items.push(item);
    }
  }
  return { ok: true, items: DriveBrowser_sortItems_(items), truncated: truncated };
}

function DriveBrowser_driveAppStarred_(mode) {
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
      var item = DriveBrowser_driveAppFileToItemOrNull_(f, mode);
      if (item) items.push(item);
    }
  }
  return { ok: true, items: DriveBrowser_sortItems_(items), truncated: truncated };
}

// DriveApp の File を mode に従って item 化（不一致は null）。ショートカットは実体へ解決。
function DriveBrowser_driveAppFileToItemOrNull_(f, mode) {
  var mime = f.getMimeType();
  if (mime === DRIVE_BROWSER_SHORTCUT_MIME) {
    var targetMime = "";
    var targetId = "";
    try { targetMime = f.getTargetMimeType(); } catch (e) {}
    try { targetId = f.getTargetId(); } catch (e2) {}
    if (!targetId) return null;
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
