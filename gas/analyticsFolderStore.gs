// =============================================
// Analytics Folder Store — Question / Dashboard の空フォルダも永続化するためのフォルダ登録簿。
// PropertiesService に { version, folders: ["a", "a/b", ...] } 形で保存する。
// 画面に出すフォルダ = 登録簿のパス ∪ アイテム由来 (item.folder) のパス。
//
// type: "questions" | "dashboards" でパラメータ化する。
// 文字列操作ヘルパ (Forms_normalizeFolderPath_ / Forms_addPathWithAncestors_ /
// Forms_sortFolderPaths_) は formsFolderStore.gs で定義済みのものをそのまま流用する。
// =============================================

var ANALYTICS_QUESTIONS_FOLDERS_PROPERTY_KEY = "nfb.analytics.questions.folders";
var ANALYTICS_DASHBOARDS_FOLDERS_PROPERTY_KEY = "nfb.analytics.dashboards.folders";

// ---- property key ヘルパー ----

function Analytics_getFoldersPropertyKey_(type) {
  return type === "questions"
    ? ANALYTICS_QUESTIONS_FOLDERS_PROPERTY_KEY
    : ANALYTICS_DASHBOARDS_FOLDERS_PROPERTY_KEY;
}

// ---- フォルダ登録簿 読み取り ----

// 登録簿（永続化済みフォルダパス）を取得する。正規化・重複除去・ソート済み配列。
function Analytics_getFolders_(type) {
  var props = Nfb_getActiveProperties_();
  var rawJson = props.getProperty(Analytics_getFoldersPropertyKey_(type));
  var folders = [];
  if (rawJson) {
    try {
      var parsed = JSON.parse(rawJson);
      if (parsed && parsed.version === NFB_FOLDERS_PROPERTY_VERSION && Array.isArray(parsed.folders)) {
        folders = parsed.folders;
      }
    } catch (err) {
      Logger.log("[Analytics_getFolders_] Failed to parse folders (" + type + "): " + err);
    }
  }
  var set = {};
  for (var i = 0; i < folders.length; i++) {
    Forms_addPathWithAncestors_(set, folders[i]);
  }
  return Forms_sortFolderPaths_(Object.keys(set));
}

// ---- フォルダ登録簿 書き込み ----

// 登録簿を保存する（正規化・dedupe・祖先補完）。
function Analytics_saveFoldersRegistry_(type, paths) {
  var set = {};
  var list = Array.isArray(paths) ? paths : [];
  for (var i = 0; i < list.length; i++) {
    Forms_addPathWithAncestors_(set, list[i]);
  }
  var normalized = Forms_sortFolderPaths_(Object.keys(set));
  var props = Nfb_getActiveProperties_();
  props.setProperty(
    Analytics_getFoldersPropertyKey_(type),
    JSON.stringify({ version: NFB_FOLDERS_PROPERTY_VERSION, folders: normalized })
  );
  return normalized;
}

// ---- フォルダ収集 ----

// 登録簿 ∪ アイテム由来のフォルダを返す。
// itemsArray があればそれから派生し、無ければ Analytics_listTemplates_ を呼ぶ。
function Analytics_collectFolders_(type, itemsArray) {
  var set = {};
  // 登録簿
  var registry = Analytics_getFolders_(type);
  for (var i = 0; i < registry.length; i++) {
    Forms_addPathWithAncestors_(set, registry[i]);
  }
  // アイテム由来
  var items;
  if (Array.isArray(itemsArray)) {
    items = itemsArray;
  } else {
    var listRes = Analytics_listTemplates_(type, { includeArchived: true });
    items = (listRes && listRes[Analytics_getResultListKey_(type)]) || [];
  }
  for (var j = 0; j < items.length; j++) {
    var item = items[j];
    if (item && typeof item.folder === "string") {
      Forms_addPathWithAncestors_(set, item.folder);
    }
  }
  return Forms_sortFolderPaths_(Object.keys(set));
}

// ---- 公開操作 ----

// 既知フォルダ一覧（登録簿 ∪ アイテム由来）。
function Analytics_listFolders_(type) {
  return { ok: true, folders: Analytics_collectFolders_(type) };
}

// 新規フォルダ作成。空パスはエラー。既存と同名でも dedupe される。
function Analytics_createFolder_(type, path) {
  var normalized = Forms_normalizeFolderPath_(path);
  if (!normalized) {
    return { ok: false, error: "フォルダ名を入力してください" };
  }
  return WithScriptLock_("アナリティクス フォルダ作成", function() {
    var current = Analytics_getFolders_(type);
    current.push(normalized);
    var folders = Analytics_saveFoldersRegistry_(type, current);
    return { ok: true, folders: folders };
  });
}

// 指定パス配下（自身 or "path/" 前方一致）のアイテム ID を集める。
function Analytics_collectItemIdsUnderFolder_(type, path) {
  var normalized = Forms_normalizeFolderPath_(path);
  var prefix = normalized + "/";
  var ids = [];
  var listRes = Analytics_listTemplates_(type, { includeArchived: true });
  var items = (listRes && listRes[Analytics_getResultListKey_(type)]) || [];
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    var folder = Forms_normalizeFolderPath_(item && item.folder);
    if (folder === normalized || (normalized && folder.indexOf(prefix) === 0)) {
      ids.push(item.id);
    }
  }
  return ids;
}

// アイテム JSON の folder フィールドだけを Drive 上で書き換える軽量更新。
// Analytics_saveTemplate_ を通さないことで modifiedAt の全面更新などの副作用を避ける。
// ただし folder 変更を示す modifiedAt は ms で更新する（analytics は ms 形式）。
function Analytics_setItemFolder_(type, id, folderPath) {
  if (!id) return false;
  var mapping = Analytics_getMapping_(type);
  var entry = mapping[id];
  var fileId = Nfb_resolveFileIdFromEntry_(entry);
  if (!fileId) return false;
  try {
    var file = DriveApp.getFileById(fileId);
    var json = JSON.parse(file.getBlob().getDataAsString());
    json.folder = Forms_normalizeFolderPath_(folderPath);
    json.modifiedAt = Date.now();
    file.setContent(JSON.stringify(json, null, 2));
    return true;
  } catch (err) {
    Logger.log("[Analytics_setItemFolder_] Failed for " + type + "/" + id + ": " + err);
    return false;
  }
}

// フォルダ/アイテムの移動。
//   itemIds    : 移動するアイテム ID 配列（folder を destPath に揃える）
//   folderPaths: 移動するフォルダパス配列（leaf 名を保持して destPath 配下へ）
//   destPath   : 移動先フォルダ（"" = 最上位）。空でなければ既知フォルダであること。
function Analytics_moveItems_(type, payload) {
  var raw = payload || {};
  var itemIds = Nfb_normalizeIdList_(raw.itemIds || []);
  var folderPaths = [];
  var rawFolders = Array.isArray(raw.folderPaths) ? raw.folderPaths : [];
  for (var i = 0; i < rawFolders.length; i++) {
    var fp = Forms_normalizeFolderPath_(rawFolders[i]);
    if (fp) folderPaths.push(fp);
  }
  var destPath = Forms_normalizeFolderPath_(raw.destPath);

  if (!itemIds.length && !folderPaths.length) {
    return { ok: false, error: "移動するアイテムまたはフォルダを選択してください" };
  }

  // 移動先の存在チェック（空 = 最上位は常に許可）。
  if (destPath) {
    var known = Analytics_collectFolders_(type);
    if (known.indexOf(destPath) === -1) {
      return { ok: false, error: "移動先フォルダ「" + destPath + "」が存在しません" };
    }
  }

  // フォルダ自身/子孫への移動を禁止。
  for (var k = 0; k < folderPaths.length; k++) {
    var old = folderPaths[k];
    if (destPath === old || destPath.indexOf(old + "/") === 0) {
      return { ok: false, error: "フォルダ「" + old + "」を自身またはその配下へは移動できません" };
    }
  }

  return WithScriptLock_("アナリティクス フォルダ/アイテム移動", function() {
    var movedIds = [];

    // 1) フォルダ移動（leaf 名を保持して destPath 配下へ。prefix 置換は relocate コアへ集約）
    var registry = Analytics_getFolders_(type);
    for (var i = 0; i < folderPaths.length; i++) {
      var old = folderPaths[i];
      var leaf = old.split("/").pop();
      var next = destPath ? destPath + "/" + leaf : leaf;
      if (next === old) continue;
      registry = Analytics_relocateFolderPaths_(type, registry, old, next, movedIds);
    }
    if (folderPaths.length) Analytics_saveFoldersRegistry_(type, registry);

    // 2) アイテム単体移動
    for (var f = 0; f < itemIds.length; f++) {
      if (Analytics_setItemFolder_(type, itemIds[f], destPath)) movedIds.push(itemIds[f]);
    }

    return { ok: true, folders: Analytics_collectFolders_(type), movedIds: movedIds };
  });
}

// 単一フォルダの old → next 付け替えコア（移動・リネーム共通）。
//   - 登録簿の old とその子孫パスを prefix 置換し、next を追加する。
//   - 配下アイテムの folder フィールドも同じ prefix 置換で Drive 上で書き換える。
// 更新後の registry を返し、書き換えたアイテム ID を movedIds に push する。
function Analytics_relocateFolderPaths_(type, registry, old, next, movedIds) {
  var updated = registry.map(function(p) {
    if (p === old) return next;
    if (p.indexOf(old + "/") === 0) return next + p.slice(old.length);
    return p;
  });
  updated.push(next);

  var underIds = Analytics_collectItemIdsUnderFolder_(type, old);
  for (var u = 0; u < underIds.length; u++) {
    var aId = underIds[u];
    var mapping = Analytics_getMapping_(type);
    var entry = mapping[aId];
    var fileId = Nfb_resolveFileIdFromEntry_(entry);
    if (!fileId) continue;
    try {
      var file = DriveApp.getFileById(fileId);
      var json = JSON.parse(file.getBlob().getDataAsString());
      var folder = Forms_normalizeFolderPath_(json.folder);
      var newFolder = (folder === old) ? next : (next + folder.slice(old.length));
      json.folder = newFolder;
      json.modifiedAt = Date.now();
      file.setContent(JSON.stringify(json, null, 2));
      movedIds.push(aId);
    } catch (err) {
      Logger.log("[Analytics_relocateFolderPaths_] Failed to update folder for " + type + "/" + aId + ": " + err);
    }
  }
  return updated;
}

// フォルダのリネーム（mv の rename 相当）。親パスは保持し leaf 名だけを newName に変える。
//   path   : リネーム対象フォルダパス
//   newName: 新しい leaf 名（単一セグメント。"/" は不可）
// 同名フォルダが既に存在する場合はマージせずエラーにする。
function Analytics_renameFolder_(type, payload) {
  var raw = payload || {};
  var old = Forms_normalizeFolderPath_(raw.path);
  if (!old) {
    return { ok: false, error: "リネームするフォルダを指定してください" };
  }
  var newName = (typeof raw.newName === "string") ? raw.newName.trim() : "";
  if (!newName) {
    return { ok: false, error: "新しいフォルダ名を入力してください" };
  }
  if (newName.indexOf("/") !== -1) {
    return { ok: false, error: "フォルダ名に「/」は使用できません" };
  }
  var segs = old.split("/");
  segs.pop();
  var parent = segs.join("/");
  var next = parent ? parent + "/" + newName : newName;
  if (next === old) {
    return { ok: true, folders: Analytics_collectFolders_(type), movedIds: [] };
  }
  var known = Analytics_collectFolders_(type);
  if (known.indexOf(next) !== -1) {
    return { ok: false, error: "同名のフォルダ「" + next + "」が既に存在します" };
  }
  return WithScriptLock_("アナリティクス フォルダ名変更", function() {
    var movedIds = [];
    var registry = Analytics_relocateFolderPaths_(type, Analytics_getFolders_(type), old, next, movedIds);
    Analytics_saveFoldersRegistry_(type, registry);
    return { ok: true, folders: Analytics_collectFolders_(type), movedIds: movedIds };
  });
}

// フォルダ削除。配下アイテムを併せて削除（マッピング解除）し、
// 登録簿から path と子孫を除去する。
function Analytics_deleteFolder_(type, path) {
  var normalized = Forms_normalizeFolderPath_(path);
  if (!normalized) {
    return { ok: false, error: "削除するフォルダを指定してください" };
  }
  return WithScriptLock_("アナリティクス フォルダ削除", function() {
    var ids = Analytics_collectItemIdsUnderFolder_(type, normalized);
    var deletedCount = 0;
    if (ids.length) {
      var res = Analytics_deleteTemplates_(type, ids);
      deletedCount = (res && res.deleted) || 0;
    }
    // 登録簿から path と子孫を除去
    var prefix = normalized + "/";
    var registry = Analytics_getFolders_(type).filter(function(p) {
      return p !== normalized && p.indexOf(prefix) !== 0;
    });
    var folders = Analytics_saveFoldersRegistry_(type, registry);
    return { ok: true, deletedCount: deletedCount, folders: folders };
  });
}
