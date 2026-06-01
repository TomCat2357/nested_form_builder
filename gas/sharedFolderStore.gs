// =============================================
// Shared Folder Store — Forms / Analytics の「空フォルダも永続化する登録簿」ロジックの型汎用コア。
//
// formsFolderStore.gs（フォーム）と analyticsFolderStore.gs（Question / Dashboard）は
// ほぼ同一の登録簿 CRUD だったため、本ファイルに StdFolderStore_* コアを集約し、各 public 関数
// （Forms_* / Analytics_*）は adapter を組んで委譲する薄いラッパーになる。
//
// 文字列操作ヘルパ（Forms_normalizeFolderPath_ / Forms_addPathWithAncestors_ /
// Forms_sortFolderPaths_）は formsFolderStore.gs で定義済みのものを流用する。
//
// adapter 形（型ごとの差分をここ 1 箇所に閉じ込める）:
//   {
//     kind:               "forms" | "questions" | "dashboards"（verify アダプタ解決・ログ用）
//     foldersPropertyKey: 登録簿を保存する Script Property キー
//     getMapping()        -> mapping
//     saveMapping(m)
//     listItems()         -> アイテム配列（includeArchived。folder / id を持つ）
//     getItemFolder(id)   -> 現在の論理フォルダ（正規化済み）/ 取得不能なら null
//     stampFolderModified(json) -> json に modifiedAt 等を刻む（型で形式が異なる）
//     driveEnsureForPath(path) / driveMoveFileToPath(fileId, path) /
//     driveMovePathFolder(old, next) / driveTrashPathFolder(path)
//     deleteItems(ids)    -> { deleted: n }
//     movedIdsKey / deletedCountKey: 結果ペイロードのキー名（フロント互換のため型ごとに異なる）
//     itemNoun:           エラーメッセージ用（"フォーム" | "アイテム"）
//     lockPrefix:         ScriptLock ラベルの接頭辞（"" | "アナリティクス "）
//   }
// =============================================

// 登録簿（永続化済みフォルダパス）を取得する。正規化・重複除去・ソート済み配列。
function StdFolderStore_getFolders_(propertyKey) {
  var props = Nfb_getActiveProperties_();
  var rawJson = props.getProperty(propertyKey);
  var folders = [];
  if (rawJson) {
    try {
      var parsed = JSON.parse(rawJson);
      if (parsed && parsed.version === NFB_FOLDERS_PROPERTY_VERSION && Array.isArray(parsed.folders)) {
        folders = parsed.folders;
      }
    } catch (err) {
      Logger.log("[StdFolderStore_getFolders_] Failed to parse folders (" + propertyKey + "): " + err);
    }
  }
  var set = {};
  for (var i = 0; i < folders.length; i++) {
    Forms_addPathWithAncestors_(set, folders[i]);
  }
  return Forms_sortFolderPaths_(Object.keys(set));
}

// 登録簿を保存する（正規化・dedupe・祖先補完）。
function StdFolderStore_saveFolders_(propertyKey, paths) {
  var set = {};
  var list = Array.isArray(paths) ? paths : [];
  for (var i = 0; i < list.length; i++) {
    Forms_addPathWithAncestors_(set, list[i]);
  }
  var normalized = Forms_sortFolderPaths_(Object.keys(set));
  var props = Nfb_getActiveProperties_();
  props.setProperty(
    propertyKey,
    JSON.stringify({ version: NFB_FOLDERS_PROPERTY_VERSION, folders: normalized })
  );
  return normalized;
}

// 登録簿 ∪ アイテム由来のフォルダを返す。itemsArray があればそれから派生し、無ければ adapter.listItems()。
function StdFolderStore_collectFolders_(adapter, itemsArray) {
  var set = {};
  var registry = StdFolderStore_getFolders_(adapter.foldersPropertyKey);
  for (var i = 0; i < registry.length; i++) {
    Forms_addPathWithAncestors_(set, registry[i]);
  }
  var items = Array.isArray(itemsArray) ? itemsArray : adapter.listItems();
  for (var j = 0; j < items.length; j++) {
    var item = items[j];
    if (item && typeof item.folder === "string") {
      Forms_addPathWithAncestors_(set, item.folder);
    }
  }
  return Forms_sortFolderPaths_(Object.keys(set));
}

// 既知フォルダ一覧（登録簿 ∪ アイテム由来）。
function StdFolderStore_listFolders_(adapter, itemsArray) {
  return { ok: true, folders: StdFolderStore_collectFolders_(adapter, itemsArray) };
}

// 指定パス配下（自身 or "path/" 前方一致）のアイテム ID を集める。
function StdFolderStore_collectItemIdsUnder_(adapter, path) {
  var normalized = Forms_normalizeFolderPath_(path);
  var prefix = normalized + "/";
  var ids = [];
  var items = adapter.listItems();
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
// 保存系（saveForm/saveTemplate）を通さないことで余計な副作用を避ける。modifiedAt の形式は
// adapter.stampFolderModified に委譲する（forms=JST 文字列+serial / analytics=ms）。
function StdFolderStore_setItemFolder_(adapter, id, folderPath) {
  if (!id) return false;
  var mapping = adapter.getMapping();
  var entry = mapping[id];
  var fileId = Nfb_resolveFileIdFromEntry_(entry);
  if (!fileId) return false;
  try {
    var read = Nfb_readJsonFileById_(fileId);
    var json = read.json;
    json.folder = Forms_normalizeFolderPath_(folderPath);
    adapter.stampFolderModified(json);
    Nfb_writeJsonToFile_(read.file, json);
    // 物理 Drive 上でもファイルを folder に対応するフォルダへ移動（既に正しい親なら no-op）。
    adapter.driveMoveFileToPath(fileId, json.folder);
    // 中央辞書（マッピング）の論理パス folder も追従させる（第一級フィールド）。
    if (entry && typeof entry === "object") {
      entry.folder = json.folder;
      mapping[id] = entry;
      adapter.saveMapping(mapping);
    }
    return true;
  } catch (err) {
    Logger.log("[StdFolderStore_setItemFolder_:" + adapter.kind + "] Failed for " + id + ": " + err);
    return false;
  }
}

// 新規フォルダ作成。空パスはエラー。既存と同名でも dedupe される。
function StdFolderStore_createFolder_(adapter, path) {
  var normalized = Forms_normalizeFolderPath_(path);
  if (!normalized) {
    return { ok: false, error: "フォルダ名を入力してください" };
  }
  return WithScriptLock_(adapter.lockPrefix + "フォルダ作成", function() {
    var current = StdFolderStore_getFolders_(adapter.foldersPropertyKey);
    current.push(normalized);
    var folders = StdFolderStore_saveFolders_(adapter.foldersPropertyKey, current);
    // 物理 Drive フォルダ（祖先含む）も作成。auto-organize off では no-op。
    adapter.driveEnsureForPath(normalized);
    return { ok: true, folders: folders };
  });
}

// 単一フォルダの old → next 付け替えコア（移動・リネーム共通）。
//   - 登録簿の old とその子孫パスを prefix 置換し、next を追加する。
//   - 配下アイテムの folder フィールドも同じ prefix 置換で Drive 上で書き換える。
// 更新後の registry を返し、書き換えたアイテム ID を movedIds に push する。
function StdFolderStore_relocateFolderPaths_(adapter, registry, old, next, movedIds) {
  // 物理 Drive フォルダをサブツリーごと移動/リネーム（1 回の Drive 操作）。配下ファイルは
  // フォルダごと一緒に動くため、後段の個別移動は no-op になる（残存ファイルの保険）。
  adapter.driveMovePathFolder(old, next);

  var updated = registry.map(function(p) {
    if (p === old) return next;
    if (p.indexOf(old + "/") === 0) return next + p.slice(old.length);
    return p;
  });
  updated.push(next);

  var underIds = StdFolderStore_collectItemIdsUnder_(adapter, old);
  for (var u = 0; u < underIds.length; u++) {
    var id = underIds[u];
    var folder = adapter.getItemFolder(id);
    if (folder === null || folder === undefined) continue;
    var newFolder = (folder === old) ? next : (next + folder.slice(old.length));
    if (StdFolderStore_setItemFolder_(adapter, id, newFolder)) movedIds.push(id);
  }
  return updated;
}

// フォルダ/アイテムの移動。
//   payload.itemIds    : 移動するアイテム ID 配列（folder を destPath に揃える）
//   payload.folderPaths: 移動するフォルダパス配列（leaf 名を保持して destPath 配下へ）
//   payload.destPath   : 移動先フォルダ（"" = 最上位）。空でなければ既知フォルダであること。
function StdFolderStore_moveItems_(adapter, payload) {
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
    return { ok: false, error: "移動する" + adapter.itemNoun + "またはフォルダを選択してください" };
  }

  // 移動先の存在チェック（空 = 最上位は常に許可）。
  if (destPath) {
    var known = StdFolderStore_collectFolders_(adapter);
    if (known.indexOf(destPath) === -1) {
      return { ok: false, error: "移動先フォルダ「" + destPath + "」が存在しません" };
    }
  }

  // フォルダ自身/子孫への移動を禁止。
  for (var k = 0; k < folderPaths.length; k++) {
    var oldChk = folderPaths[k];
    if (destPath === oldChk || destPath.indexOf(oldChk + "/") === 0) {
      return { ok: false, error: "フォルダ「" + oldChk + "」を自身またはその配下へは移動できません" };
    }
  }

  return WithScriptLock_(adapter.lockPrefix + "フォルダ/" + adapter.itemNoun + "移動", function() {
    var movedIds = [];

    // 1) フォルダ移動（leaf 名を保持して destPath 配下へ。prefix 置換は relocate コアへ集約）
    var registry = StdFolderStore_getFolders_(adapter.foldersPropertyKey);
    for (var i = 0; i < folderPaths.length; i++) {
      var old = folderPaths[i];
      var leaf = old.split("/").pop();
      var next = destPath ? destPath + "/" + leaf : leaf;
      if (next === old) continue;
      registry = StdFolderStore_relocateFolderPaths_(adapter, registry, old, next, movedIds);
    }
    if (folderPaths.length) StdFolderStore_saveFolders_(adapter.foldersPropertyKey, registry);

    // 2) アイテム単体移動
    for (var f = 0; f < itemIds.length; f++) {
      if (StdFolderStore_setItemFolder_(adapter, itemIds[f], destPath)) movedIds.push(itemIds[f]);
    }

    // 3) 影響アイテムに ①〜④ の整合（物理移動の自己修復 + ④ エラー検出）。
    var verify = StdFolders_verifyEntriesAfterRelocate_(StdFolders_entityAdapter_(adapter.kind), movedIds);
    var result = { ok: true, folders: StdFolderStore_collectFolders_(adapter), verify: verify };
    result[adapter.movedIdsKey] = movedIds;
    return result;
  });
}

// フォルダのリネーム（mv の rename 相当）。親パスは保持し leaf 名だけを newName に変える。
// 同名フォルダが既に存在する場合はマージせずエラーにする。
function StdFolderStore_renameFolder_(adapter, payload) {
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
    var same = { ok: true, folders: StdFolderStore_collectFolders_(adapter) };
    same[adapter.movedIdsKey] = [];
    return same;
  }
  var known = StdFolderStore_collectFolders_(adapter);
  if (known.indexOf(next) !== -1) {
    return { ok: false, error: "同名のフォルダ「" + next + "」が既に存在します" };
  }
  return WithScriptLock_(adapter.lockPrefix + "フォルダ名変更", function() {
    var movedIds = [];
    var registry = StdFolderStore_relocateFolderPaths_(
      adapter, StdFolderStore_getFolders_(adapter.foldersPropertyKey), old, next, movedIds
    );
    StdFolderStore_saveFolders_(adapter.foldersPropertyKey, registry);
    var verify = StdFolders_verifyEntriesAfterRelocate_(StdFolders_entityAdapter_(adapter.kind), movedIds);
    var result = { ok: true, folders: StdFolderStore_collectFolders_(adapter), verify: verify };
    result[adapter.movedIdsKey] = movedIds;
    return result;
  });
}

// フォルダ削除。配下アイテムを併せて削除（マッピング解除）し、登録簿から path と子孫を除去する。
function StdFolderStore_deleteFolder_(adapter, path) {
  var normalized = Forms_normalizeFolderPath_(path);
  if (!normalized) {
    return { ok: false, error: "削除するフォルダを指定してください" };
  }
  return WithScriptLock_(adapter.lockPrefix + "フォルダ削除", function() {
    var ids = StdFolderStore_collectItemIdsUnder_(adapter, normalized);
    var deletedCount = 0;
    if (ids.length) {
      var res = adapter.deleteItems(ids);
      deletedCount = (res && res.deleted) || 0;
    }
    // 物理 Drive フォルダ（配下のファイル含む）をゴミ箱へ。auto-organize off では no-op。
    adapter.driveTrashPathFolder(normalized);
    // 登録簿から path と子孫を除去
    var prefix = normalized + "/";
    var registry = StdFolderStore_getFolders_(adapter.foldersPropertyKey).filter(function(p) {
      return p !== normalized && p.indexOf(prefix) !== 0;
    });
    var folders = StdFolderStore_saveFolders_(adapter.foldersPropertyKey, registry);
    var result = { ok: true, folders: folders };
    result[adapter.deletedCountKey] = deletedCount;
    return result;
  });
}
