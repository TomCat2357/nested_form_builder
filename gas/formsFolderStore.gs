// =============================================
// Forms Folder Store — 空フォルダも永続化するためのフォルダ登録簿。
// PropertiesService に { version, folders: ["a", "a/b", ...] } 形で保存する。
// 画面に出すフォルダ = 登録簿のパス ∪ フォーム由来 (form.folder) のパス。
// =============================================

// フロント normalizeFolderPath (builder/src/utils/folderTree.js) と同一規則。
// "/a//b/ " → "a/b"、未指定や非文字列は ""。
function Forms_normalizeFolderPath_(raw) {
  if (typeof raw !== "string") return "";
  return raw
    .split("/")
    .map(function(seg) { return String(seg).trim(); })
    .filter(function(seg) { return seg.length > 0; })
    .join("/");
}

// path とその全祖先を out (Object set) に登録する。"a/b/c" → "a","a/b","a/b/c"。
function Forms_addPathWithAncestors_(out, path) {
  var normalized = Forms_normalizeFolderPath_(path);
  if (!normalized) return;
  var segs = normalized.split("/");
  var acc = "";
  for (var i = 0; i < segs.length; i++) {
    acc = acc ? acc + "/" + segs[i] : segs[i];
    out[acc] = true;
  }
}

// 登録簿（永続化済みフォルダパス）を取得する。正規化・重複除去・ソート済み配列。
function Forms_getFolders_() {
  var props = Forms_getActiveProps_();
  var rawJson = props.getProperty(NFB_FOLDERS_PROPERTY_KEY);
  var folders = [];
  if (rawJson) {
    try {
      var parsed = JSON.parse(rawJson);
      if (parsed && parsed.version === NFB_FOLDERS_PROPERTY_VERSION && Array.isArray(parsed.folders)) {
        folders = parsed.folders;
      }
    } catch (err) {
      Logger.log("[Forms_getFolders_] Failed to parse folders: " + err);
    }
  }
  var set = {};
  for (var i = 0; i < folders.length; i++) {
    Forms_addPathWithAncestors_(set, folders[i]);
  }
  return Forms_sortFolderPaths_(Object.keys(set));
}

// 登録簿を保存する（正規化・dedupe・祖先補完）。
function Forms_saveFolders_(paths) {
  var set = {};
  var list = Array.isArray(paths) ? paths : [];
  for (var i = 0; i < list.length; i++) {
    Forms_addPathWithAncestors_(set, list[i]);
  }
  var normalized = Forms_sortFolderPaths_(Object.keys(set));
  var props = Forms_getActiveProps_();
  props.setProperty(
    NFB_FOLDERS_PROPERTY_KEY,
    JSON.stringify({ version: NFB_FOLDERS_PROPERTY_VERSION, folders: normalized })
  );
  return normalized;
}

// 日本語ロケールで親→子の順に安定ソートする。
function Forms_sortFolderPaths_(paths) {
  var arr = (paths || []).slice();
  arr.sort(function(a, b) { return String(a).localeCompare(String(b), "ja"); });
  return arr;
}

// 登録簿 ∪ フォーム由来のフォルダを返す。formsArray があればそれから派生し、
// 無ければ Forms_listForms_ を呼ぶ（アーカイブ済みフォルダも保持するため includeArchived）。
function Forms_collectFolders_(formsArray) {
  var set = {};
  // 登録簿
  var registry = Forms_getFolders_();
  for (var i = 0; i < registry.length; i++) {
    Forms_addPathWithAncestors_(set, registry[i]);
  }
  // フォーム由来
  var forms = Array.isArray(formsArray)
    ? formsArray
    : (Forms_listForms_({ includeArchived: true }).forms || []);
  for (var j = 0; j < forms.length; j++) {
    var form = forms[j];
    if (form && typeof form.folder === "string") {
      Forms_addPathWithAncestors_(set, form.folder);
    }
  }
  return Forms_sortFolderPaths_(Object.keys(set));
}

// 公開: 既知フォルダ一覧（登録簿 ∪ フォーム由来）。
function Forms_listFolders_(formsArray) {
  return { ok: true, folders: Forms_collectFolders_(formsArray) };
}

// 新規フォルダ作成。空パスはエラー。既存と同名でも害は無いが dedupe される。
function Forms_createFolder_(path) {
  var normalized = Forms_normalizeFolderPath_(path);
  if (!normalized) {
    return { ok: false, error: "フォルダ名を入力してください" };
  }
  return WithScriptLock_("フォルダ作成", function() {
    var current = Forms_getFolders_();
    current.push(normalized);
    var folders = Forms_saveFolders_(current);
    return { ok: true, folders: folders };
  });
}

// 指定パス配下（自身 or "path/" 前方一致）のフォーム ID を集める。
function Forms_collectFormIdsUnderFolder_(path) {
  var normalized = Forms_normalizeFolderPath_(path);
  var prefix = normalized + "/";
  var ids = [];
  var forms = Forms_listForms_({ includeArchived: true }).forms || [];
  for (var i = 0; i < forms.length; i++) {
    var form = forms[i];
    var folder = Forms_normalizeFolderPath_(form && form.folder);
    if (folder === normalized || (normalized && folder.indexOf(prefix) === 0)) {
      ids.push(form.id);
    }
  }
  return ids;
}

// フォーム JSON の folder フィールドだけを Drive 上で書き換える軽量更新。
// Forms_saveForm_ を通さないことでスプレッドシート再解決などの副作用を避ける。
function Forms_setFormFolder_(formId, folderPath) {
  if (!formId) return false;
  var mapping = Forms_getMapping_();
  var entry = mapping[formId];
  var fileId = Nfb_resolveFileIdFromEntry_(entry);
  if (!fileId) return false;
  try {
    var file = DriveApp.getFileById(fileId);
    var json = JSON.parse(file.getBlob().getDataAsString());
    json.folder = Forms_normalizeFolderPath_(folderPath);
    var nowSerial = Sheets_dateToSerial_(new Date());
    json.modifiedAt = Sheets_formatJstString_(nowSerial);
    json.modifiedAtUnixMs = nowSerial;
    file.setContent(JSON.stringify(json, null, 2));
    return true;
  } catch (err) {
    Logger.log("[Forms_setFormFolder_] Failed for " + formId + ": " + err);
    return false;
  }
}

// フォーム/フォルダの移動。
//   formIds    : 移動するフォーム ID 配列（folder を destPath に揃える）
//   folderPaths: 移動するフォルダパス配列（leaf 名を保持して destPath 配下へ）
//   destPath   : 移動先フォルダ（"" = 最上位）。空でなければ既知フォルダであること。
function Forms_moveItems_(payload) {
  var raw = payload || {};
  var formIds = Nfb_normalizeIdList_(raw.formIds || []);
  var folderPaths = [];
  var rawFolders = Array.isArray(raw.folderPaths) ? raw.folderPaths : [];
  for (var i = 0; i < rawFolders.length; i++) {
    var fp = Forms_normalizeFolderPath_(rawFolders[i]);
    if (fp) folderPaths.push(fp);
  }
  var destPath = Forms_normalizeFolderPath_(raw.destPath);

  if (!formIds.length && !folderPaths.length) {
    return { ok: false, error: "移動するフォームまたはフォルダを選択してください" };
  }

  // 移動先の存在チェック（空 = 最上位は常に許可）。
  if (destPath) {
    var known = Forms_collectFolders_();
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

  return WithScriptLock_("フォルダ/フォーム移動", function() {
    var movedFormIds = [];

    // 1) フォルダ移動（leaf 名を保持して destPath 配下へ。prefix 置換は relocate コアへ集約）
    var registry = Forms_getFolders_();
    for (var i = 0; i < folderPaths.length; i++) {
      var old = folderPaths[i];
      var leaf = old.split("/").pop();
      var next = destPath ? destPath + "/" + leaf : leaf;
      if (next === old) continue;
      registry = Forms_relocateFolderPaths_(registry, old, next, movedFormIds);
    }
    if (folderPaths.length) Forms_saveFolders_(registry);

    // 2) フォーム単体移動
    for (var f = 0; f < formIds.length; f++) {
      if (Forms_setFormFolder_(formIds[f], destPath)) movedFormIds.push(formIds[f]);
    }

    return { ok: true, folders: Forms_collectFolders_(), movedFormIds: movedFormIds };
  });
}

// 単一フォルダの old → next 付け替えコア（移動・リネーム共通）。
//   - 登録簿の old とその子孫パスを prefix 置換し、next を追加する。
//   - 配下フォームの folder フィールドも同じ prefix 置換で書き換える。
// 更新後の registry を返し、書き換えたフォーム ID を movedFormIds に push する。
function Forms_relocateFolderPaths_(registry, old, next, movedFormIds) {
  var updated = registry.map(function(p) {
    if (p === old) return next;
    if (p.indexOf(old + "/") === 0) return next + p.slice(old.length);
    return p;
  });
  updated.push(next);

  var underIds = Forms_collectFormIdsUnderFolder_(old);
  for (var u = 0; u < underIds.length; u++) {
    var fId = underIds[u];
    var form = Forms_getForm_(fId);
    if (!form) continue;
    var folder = Forms_normalizeFolderPath_(form.folder);
    var newFolder = (folder === old) ? next : (next + folder.slice(old.length));
    if (Forms_setFormFolder_(fId, newFolder)) movedFormIds.push(fId);
  }
  return updated;
}

// フォルダのリネーム（mv の rename 相当）。親パスは保持し leaf 名だけを newName に変える。
//   path   : リネーム対象フォルダパス
//   newName: 新しい leaf 名（単一セグメント。"/" は不可）
// 同名フォルダが既に存在する場合はマージせずエラーにする。
function Forms_renameFolder_(payload) {
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
    return { ok: true, folders: Forms_collectFolders_(), movedFormIds: [] };
  }
  var known = Forms_collectFolders_();
  if (known.indexOf(next) !== -1) {
    return { ok: false, error: "同名のフォルダ「" + next + "」が既に存在します" };
  }
  return WithScriptLock_("フォルダ名変更", function() {
    var movedFormIds = [];
    var registry = Forms_relocateFolderPaths_(Forms_getFolders_(), old, next, movedFormIds);
    Forms_saveFolders_(registry);
    return { ok: true, folders: Forms_collectFolders_(), movedFormIds: movedFormIds };
  });
}

// フォルダ削除。配下フォームを併せて削除（既存 Forms_deleteForms_ = 紐付け解除）し、
// 登録簿から path と子孫を除去する。
function Forms_deleteFolder_(path) {
  var normalized = Forms_normalizeFolderPath_(path);
  if (!normalized) {
    return { ok: false, error: "削除するフォルダを指定してください" };
  }
  return WithScriptLock_("フォルダ削除", function() {
    var ids = Forms_collectFormIdsUnderFolder_(normalized);
    var deletedFormCount = 0;
    if (ids.length) {
      var res = Forms_deleteForms_(ids);
      deletedFormCount = (res && res.deleted) || 0;
    }
    // 登録簿から path と子孫を除去
    var prefix = normalized + "/";
    var registry = Forms_getFolders_().filter(function(p) {
      return p !== normalized && p.indexOf(prefix) !== 0;
    });
    var folders = Forms_saveFolders_(registry);
    return { ok: true, deletedFormCount: deletedFormCount, folders: folders };
  });
}
