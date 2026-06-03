// =============================================
// Standard Folders — 標準フォルダ構成（作成 / 自動整理 / 構成コピー）
//
// root/
//   ├── [appsscript 本体]   ← マーカー兼エントリポイント（残置）
//   ├── 01_forms/
//   ├── 02_questions/
//   ├── 03_dashboards/
//   ├── 04_spreadsheets/
//   ├── 05_report_templates/
//   ├── 06_upload_files/
//   ├── 07_webhooks/
//   └── 08_documents/
//
// ルートの目印は appsscript 本体（バインドされたスクリプトプロジェクト）が置かれた親フォルダ。
// 自動検出（ScriptApp.getScriptId → DriveApp.getFileById → getParents）に失敗した場合は
// 管理者が指定したルート URL をフォールバックとして使う。両者とも Script Property に保存する。
// =============================================

var NFB_STD_ROOT_PROPERTY_KEY = "nfb.stdfolders.root";          // 自動検出キャッシュ（最終フォールバック用）
var NFB_STD_ROOT_MANUAL_KEY   = "nfb.stdfolders.root.manual";   // 管理者が明示指定した手動ルート（sticky）

// コピー時にコピー先ルートへ書き出すマッピングファイル名。
// 復元は手動（設定 > 管理 の「インポート」/「同期」）で行う（自動再構築は廃止）。
var NFB_STD_MAPPING_FILE_NAME = "_nfb_mapping.json";

// 論理キー → フォルダ名。
var NFB_STD_FOLDER_NAMES = {
  forms: "01_forms",
  questions: "02_questions",
  dashboards: "03_dashboards",
  spreadsheets: "04_spreadsheets",
  report_templates: "05_report_templates",
  upload: "06_upload_files",
  webhooks: "07_webhooks",
  documents: "08_documents"
};

// 作成・コピー時の処理順。
var NFB_STD_FOLDER_ORDER = [
  "forms", "questions", "dashboards", "spreadsheets",
  "report_templates", "upload", "webhooks", "documents"
];

// ---------------------------------------------
// ルート解決
// ---------------------------------------------

// appsscript 本体（スクリプトプロジェクトの Drive ファイル）の親フォルダを返す。検出不能なら null。
function StdFolders_detectRootFromScript_() {
  try {
    var scriptId = ScriptApp.getScriptId();
    if (!scriptId) return null;
    var file = DriveApp.getFileById(scriptId);
    var parents = file.getParents();
    if (parents.hasNext()) return parents.next();
  } catch (err) {
    Logger.log("[StdFolders_detectRootFromScript_] " + nfbErrorToString_(err));
  }
  return null;
}

// ルートフォルダを解決する。自動検出（appsscript 本体の親フォルダ）を権威とする。
//   1) manualRootUrl が与えられればそれを採用し手動キーへ保存（以後 sticky）
//   2) 手動キーに保存済みのルート ID（管理者が明示指定した場合のみ）
//   3) appsscript 本体の親フォルダを自動検出し、キャッシュキーを最新 ID で上書き
//   4) 検出不能時のみ、自動検出キャッシュキーを最終フォールバックとして読む
// いずれも解決できなければ日本語例外を投げる。
function StdFolders_resolveRootFolder_(manualRootUrl) {
  var props = Nfb_getScriptProperties_();

  var manual = manualRootUrl ? String(manualRootUrl).trim() : "";
  if (manual) {
    var picked = nfbResolveFolderFromInput_(manual); // 無効 URL は例外
    props.setProperty(NFB_STD_ROOT_MANUAL_KEY, picked.getId());
    return picked;
  }

  // 管理者が明示指定した手動ルートは自動検出より優先（sticky）。無効なら削除してフォールバック。
  var manualId = props.getProperty(NFB_STD_ROOT_MANUAL_KEY);
  if (manualId) {
    try {
      var manualFolder = DriveApp.getFolderById(manualId);
      if (!(typeof manualFolder.isTrashed === "function" && manualFolder.isTrashed())) {
        return manualFolder;
      }
    } catch (e) {
      // 手動ルートが無効 → 削除して自動検出へ
    }
    props.deleteProperty(NFB_STD_ROOT_MANUAL_KEY);
  }

  // 自動検出が権威。成功したら陳腐化し得るキャッシュを最新 ID で上書きする。
  var detected = StdFolders_detectRootFromScript_();
  if (detected) {
    props.setProperty(NFB_STD_ROOT_PROPERTY_KEY, detected.getId());
    return detected;
  }

  // 検出不能時のみキャッシュをフォールバックとして使う。
  var savedId = props.getProperty(NFB_STD_ROOT_PROPERTY_KEY);
  if (savedId) {
    try {
      var cached = DriveApp.getFolderById(savedId);
      if (!(typeof cached.isTrashed === "function" && cached.isTrashed())) {
        return cached;
      }
    } catch (e) {
      // キャッシュも無効
    }
  }

  throw new Error("ルートフォルダを自動検出できませんでした。ルートフォルダの URL を手動で指定してください。");
}

// rootFolder 配下の標準サブフォルダを取得（無ければ作成）。
function StdFolders_getOrCreateSubfolder_(rootFolder, key) {
  var name = NFB_STD_FOLDER_NAMES[key];
  if (!name) throw new Error("未知の標準フォルダキーです: " + key);
  var existing = rootFolder.getFoldersByName(name);
  return existing.hasNext() ? existing.next() : rootFolder.createFolder(name);
}

// root 配下に標準サブフォルダを全て ensure する（既存はそのまま、無いものだけ作成）。
function StdFolders_ensureAllSubfolders_(rootFolder) {
  for (var i = 0; i < NFB_STD_FOLDER_ORDER.length; i++) {
    StdFolders_getOrCreateSubfolder_(rootFolder, NFB_STD_FOLDER_ORDER[i]);
  }
}

// ---------------------------------------------
// import 用: 構成内判定 + 構成外なら移動（不可ならコピー）
// ---------------------------------------------

// fileId が folderId フォルダの「子孫」かどうか（親チェーンを遡って判定）。
// 01_forms/ヒグマ/ のようなサブフォルダ配下も構成内とみなすため再帰的に判定する。
// 親チェーンは多親・循環があり得るので visited と深さ上限で保護する。
function StdFolders_isFileUnderFolder_(fileId, folderId) {
  if (!fileId || !folderId) return false;
  try {
    var seen = {};
    var queue = [];
    var p0 = DriveApp.getFileById(fileId).getParents();
    while (p0.hasNext()) queue.push(p0.next());
    var steps = 0;
    while (queue.length && steps < 200) {
      steps++;
      var f = queue.shift();
      var id = f.getId();
      if (id === folderId) return true;
      if (seen[id]) continue;
      seen[id] = true;
      var ps = f.getParents();
      while (ps.hasNext()) queue.push(ps.next());
    }
  } catch (err) {
    Logger.log("[StdFolders_isFileUnderFolder_] " + fileId + " under " + folderId + ": " + nfbErrorToString_(err));
  }
  return false;
}

// fileId のファイルが、解決済みルートの key サブフォルダ配下（直下・ネスト問わず）に在るか判定する。
// ルート未解決時は false（= 構成外扱い）。
function StdFolders_isFileInStdSubfolder_(fileId, key) {
  try {
    var root = StdFolders_resolveRootFolder_(null);
    var sub = StdFolders_getOrCreateSubfolder_(root, key);
    return StdFolders_isFileUnderFolder_(fileId, sub.getId());
  } catch (err) {
    Logger.log("[StdFolders_isFileInStdSubfolder_] " + fileId + " (" + key + "): " + nfbErrorToString_(err));
  }
  return false;
}

// import / 正規化時に、構成内ファイルはそのまま、構成外ファイルは key サブフォルダへ取り込む。
// id ＝ fileId 統一下では makeCopy は同一性を壊し参照を孤立させるため、
// まず file.moveTo（fileId 保持）で移動し、移動できない（他者所有・共有ドライブ制約等）
// ときだけ makeCopy（新 fileId）にフォールバックする。ルート未解決時は元のまま（従来の参照取り込み）。
// 戻り: { fileId, fileUrl }（moveTo 成功時は fileId 不変）。
function StdFolders_ensureFileInStdFolder_(fileId, key) {
  var fallback = { fileId: fileId, fileUrl: "https://drive.google.com/file/d/" + fileId + "/view" };
  if (StdFolders_isFileInStdSubfolder_(fileId, key)) {
    try {
      var f = DriveApp.getFileById(fileId);
      return { fileId: fileId, fileUrl: f.getUrl() };
    } catch (e) {
      return fallback;
    }
  }
  var sub, src;
  try {
    var root = StdFolders_resolveRootFolder_(null);
    sub = StdFolders_getOrCreateSubfolder_(root, key);
    src = DriveApp.getFileById(fileId);
  } catch (err) {
    // ルート未解決などで取り込めない場合は元ファイル参照のまま登録（従来挙動）。
    Logger.log("[StdFolders_ensureFileInStdFolder_] ルート/対象解決不可、参照のまま (" + key + "): " + nfbErrorToString_(err));
    return fallback;
  }
  // 1) fileId を保持したまま移動（同一性・参照を維持）。
  try {
    src.moveTo(sub);
    return { fileId: fileId, fileUrl: src.getUrl() };
  } catch (moveErr) {
    Logger.log("[StdFolders_ensureFileInStdFolder_] moveTo 不可、コピーにフォールバック (" + key + "): " + nfbErrorToString_(moveErr));
  }
  // 2) 移動できないときのみコピー（新 fileId。元ファイルは残る）。
  try {
    var copied = src.makeCopy(src.getName(), sub);
    return { fileId: copied.getId(), fileUrl: copied.getUrl() };
  } catch (copyErr) {
    Logger.log("[StdFolders_ensureFileInStdFolder_] コピーも不可、参照のまま (" + key + "): " + nfbErrorToString_(copyErr));
    return fallback;
  }
}

// fileId の Drive ファイルが生存しているか（存在しゴミ箱でない）を返す。
// 取得不能（削除済み・権限喪失など）は false。マッピングの壊れたリンク判定に使う。
function StdFolders_isFileIdAlive_(fileId) {
  if (!fileId) return false;
  try {
    var f = DriveApp.getFileById(fileId);
    return !(typeof f.isTrashed === "function" && f.isTrashed());
  } catch (e) {
    return false;
  }
}

// ---------------------------------------------
// 標準フォルダ解決（常に有効 = 標準フォルダ構成が唯一の前提）
// ---------------------------------------------

// 標準サブフォルダを取得（無ければ作成）。ルートも未作成なら自動検出・作成する。
// 作成系フローから呼ばれるため、ルート解決失敗（dev 等）でのみ例外を握って null を返し、
// 呼び出し側が従来配置（マイドライブ直下）へフォールバックできるようにする。
function StdFolders_autoFileFolderOrNull_(key) {
  try {
    var root = StdFolders_resolveRootFolder_(null);
    StdFolders_ensureAllSubfolders_(root);   // 不足している全フォルダを一括作成
    return StdFolders_getOrCreateSubfolder_(root, key);
  } catch (err) {
    Logger.log("[StdFolders_autoFileFolderOrNull_] 標準フォルダ解決に失敗 (" + key + "): " + nfbErrorToString_(err));
    return null;
  }
}

function StdFolders_autoFileFolderIdOrNull_(key) {
  var folder = StdFolders_autoFileFolderOrNull_(key);
  return folder ? folder.getId() : null;
}

// ---------------------------------------------
// 標準サブフォルダ内ファイルの列挙（読み取り専用・論理パス選択 UI 用）
// ---------------------------------------------

// folderKey サブフォルダ配下（サブフォルダ含む再帰）のファイルを列挙する。
// mimeType を指定するとその MIME のみ返す（例: Google ドキュメント）。
// path は folderKey 直下からの相対パス（サブフォルダ名を "/" 連結 + ファイル名）。
// ノード数上限・深さ上限・多親/循環保護を入れ、超過時は Logger.log（サイレント打切回避）。
// 戻り: { ok:true, files:[{ fileId, name, path, url }], truncated } / 失敗は nfbSafeCall_。
function StdFolders_listFiles_(folderKey, mimeType) {
  return nfbSafeCall_(function() {
    var root = StdFolders_resolveRootFolder_(null);
    var sub = StdFolders_getOrCreateSubfolder_(root, folderKey);
    var wantMime = mimeType ? String(mimeType) : "";
    var MAX_NODES = 2000;
    var MAX_DEPTH = 20;
    var files = [];
    var visited = {};
    var truncated = false;

    function walk(folder, prefix, depth) {
      if (truncated || depth > MAX_DEPTH) return;
      var fileIter = folder.getFiles();
      while (fileIter.hasNext()) {
        if (files.length >= MAX_NODES) { truncated = true; return; }
        var f = fileIter.next();
        if (typeof f.isTrashed === "function" && f.isTrashed()) continue;
        if (wantMime && f.getMimeType() !== wantMime) continue;
        var name = f.getName();
        files.push({
          fileId: f.getId(),
          name: name,
          path: prefix ? (prefix + "/" + name) : name,
          url: f.getUrl()
        });
      }
      var folderIter = folder.getFolders();
      while (folderIter.hasNext()) {
        if (truncated) return;
        var sf = folderIter.next();
        if (typeof sf.isTrashed === "function" && sf.isTrashed()) continue;
        var sid = sf.getId();
        if (visited[sid]) continue;   // 多親/循環保護
        visited[sid] = true;
        walk(sf, prefix ? (prefix + "/" + sf.getName()) : sf.getName(), depth + 1);
      }
    }

    walk(sub, "", 0);
    if (truncated) {
      Logger.log("[StdFolders_listFiles_] 上限 " + MAX_NODES + " 件で打ち切りました (" + folderKey + ")");
    }
    return { ok: true, files: files, truncated: truncated };
  });
}

// ---------------------------------------------
// 内部: スキーマ走査ユーティリティ（フォーム定義のリンク再配線用）
// ---------------------------------------------

// schema 配列の全フィールド（子孫含む）に対し fn(field) を呼ぶ。
function StdFolders_walkFields_(schema, fn) {
  if (!Array.isArray(schema)) return;
  for (var i = 0; i < schema.length; i++) {
    var field = schema[i];
    if (!field || typeof field !== "object") continue;
    fn(field);
    if (Array.isArray(field.children)) {
      StdFolders_walkFields_(field.children, fn);
    }
  }
}


// ---------------------------------------------
// マッピングのエクスポート / インポート（手動）
// ---------------------------------------------


// 現在のマッピング（3 マッピング ＋ フォルダ登録簿）を _nfb_mapping.json 形で返す。
// ルート未解決でも例外にせず sourceRootId を空で返す。
function StdFolders_exportMapping_() {
  return nfbSafeCall_(function() {
    var sourceRootId = "";
    try {
      sourceRootId = StdFolders_resolveRootFolder_(null).getId();
    } catch (err) {
      Logger.log("[StdFolders_exportMapping_] ルート未解決: " + nfbErrorToString_(err));
    }
    var doc = {
      type: "nfb-mapping",
      version: 1,
      exportedAt: new Date().toISOString(),
      sourceRootId: sourceRootId,
      forms: Forms_getMapping_(),
      questions: Analytics_getMapping_("questions"),
      dashboards: Analytics_getMapping_("dashboards"),
      folders: {
        forms: Forms_getFolders_(),
        questions: Analytics_getFolders_("questions"),
        dashboards: Analytics_getFolders_("dashboards")
      }
    };
    return { ok: true, mapping: doc };
  });
}

// 1 セクションを既存ストアへマージする共通処理。fileId 重複はスキップ。
//   doc       : インポート元セクション（id → entry）
//   getMapping: () => 既存 mapping
//   onEntry   : (id, entry) => true で imported カウント（false でスキップ扱い）。保存は呼び出し側。
// 戻り: { imported, skipped, errors }（errors は { section, id, reason }）。
function StdFolders_mergeMappingSection_(section, doc, existingMapping, normalizeEntry, onNew) {
  var result = { imported: 0, skipped: 0, errors: [] };
  if (!doc || typeof doc !== "object") return result;
  var mappedFileIds = StdFolders_mappedFileIdSet_(existingMapping);
  for (var id in doc) {
    if (!doc.hasOwnProperty(id)) continue;
    try {
      var entry = normalizeEntry(doc[id] || {});
      var fileId = Nfb_resolveFileIdFromEntry_(entry);
      if (!fileId) {
        result.errors.push({ section: section, id: id, reason: "fileId を解決できません" });
        continue;
      }
      if (mappedFileIds[fileId]) { result.skipped++; continue; }
      existingMapping[id] = entry;
      mappedFileIds[fileId] = true;
      if (onNew) onNew(id, entry);
      result.imported++;
    } catch (err) {
      result.errors.push({ section: section, id: id, reason: nfbErrorToString_(err) });
    }
  }
  return result;
}

// パース済みドキュメントを既存マッピングへマージする（純マージ。Drive 走査はしない）。
// type/version 不一致は throw せず { ok:false, error } を返す。
function StdFolders_importMapping_(doc) {
  if (!doc || typeof doc !== "object" || doc.type !== "nfb-mapping" || doc.version !== 1) {
    return { ok: false, error: "対応していないマッピング形式です（type/version 不一致）" };
  }

  var imported = { forms: 0, questions: 0, dashboards: 0 };
  var skipped = 0;
  var errors = [];

  // forms
  var formsMapping = Forms_getMapping_();
  var formsRes = StdFolders_mergeMappingSection_(
    "forms", doc.forms, formsMapping,
    function(e) { return { fileId: e.fileId || null, driveFileUrl: e.driveFileUrl || null, title: e.title || null, folder: (typeof e.folder === "string") ? e.folder : null }; },
    function(id, entry) { try { if (entry.driveFileUrl) AddFormUrl_(id, entry.driveFileUrl); } catch (e) { /* non-critical */ } }
  );
  Forms_saveMapping_(formsMapping);
  imported.forms = formsRes.imported; skipped += formsRes.skipped; errors = errors.concat(formsRes.errors);

  // questions / dashboards
  ["questions", "dashboards"].forEach(function(type) {
    var mapping = Analytics_getMapping_(type);
    var res = StdFolders_mergeMappingSection_(
      type, doc[type], mapping,
      function(e) { return { fileId: e.fileId || null, driveFileUrl: e.driveFileUrl || null, name: e.name || null, folder: (typeof e.folder === "string") ? e.folder : null }; },
      null
    );
    Analytics_saveMapping_(type, mapping);
    imported[type] = res.imported; skipped += res.skipped; errors = errors.concat(res.errors);
  });

  // フォルダ登録簿（既存と union）
  var folders = doc.folders || {};
  if (Array.isArray(folders.forms)) Forms_saveFolders_(Forms_getFolders_().concat(folders.forms));
  if (Array.isArray(folders.questions)) Analytics_saveFoldersRegistry_("questions", Analytics_getFolders_("questions").concat(folders.questions));
  if (Array.isArray(folders.dashboards)) Analytics_saveFoldersRegistry_("dashboards", Analytics_getFolders_("dashboards").concat(folders.dashboards));

  // インポートは「マッピング JSON のマージ」のみを行う純粋な操作。
  // 取り込んだエントリの物理配置（標準フォルダへの整列）や壊れたリンクの修復は、
  // 各エンティティを次に保存した際のサーバ側自動リンク補完（alignReferencesOnSave_）が担う。
  return { ok: true, imported: imported, skipped: skipped, errors: errors };
}

// インポートのソースを解決して取り込む。
//   payload.url 非空 : その Drive ファイル（マッピング JSON）を読む。
//   payload.url 空   : ルート直下の非ゴミ箱 .json から getLastUpdated() が最新の 1 件を読む。
function StdFolders_importMappingFromSource_(payload) {
  return nfbSafeCall_(function() {
    var url = payload && payload.url ? String(payload.url).trim() : "";
    var file;
    if (url) {
      var fileId = ExtractFileIdFromUrl_(url);
      if (!fileId) return { ok: false, error: "有効な Google Drive ファイル URL を指定してください" };
      try {
        file = DriveApp.getFileById(fileId);
      } catch (err) {
        return { ok: false, error: "ファイルへアクセスできません: " + nfbErrorToString_(err) };
      }
    } else {
      var root;
      try {
        root = StdFolders_resolveRootFolder_(null);
      } catch (err) {
        return { ok: false, error: "ルートフォルダを解決できません。URL を指定してください: " + nfbErrorToString_(err) };
      }
      file = StdFolders_findLatestJsonInRoot_(root);
      if (!file) return { ok: false, error: "ルートにマッピング JSON が見つかりません" };
    }

    var doc;
    try {
      doc = JSON.parse(file.getBlob().getDataAsString());
    } catch (err) {
      return { ok: false, error: "JSON の解析に失敗しました: " + nfbErrorToString_(err) };
    }
    return StdFolders_importMapping_(doc);
  });
}

// ルート直下の非ゴミ箱 .json ファイルのうち getLastUpdated() が最新の 1 件を返す（無ければ null）。
function StdFolders_findLatestJsonInRoot_(root) {
  var latest = null;
  var latestTime = -1;
  var files = root.getFiles();
  while (files.hasNext()) {
    var f = files.next();
    if (typeof f.isTrashed === "function" && f.isTrashed()) continue;
    if (!StdFolders_isJsonFile_(f)) continue;
    var t = 0;
    try { t = f.getLastUpdated().getTime(); } catch (e) { t = 0; }
    if (t >= latestTime) { latestTime = t; latest = f; }
  }
  return latest;
}

// 既存 mapping から fileId の集合を作る（重複登録防止用）。
function StdFolders_mappedFileIdSet_(mapping) {
  var set = {};
  for (var id in mapping) {
    if (!mapping.hasOwnProperty(id)) continue;
    var fid = Nfb_resolveFileIdFromEntry_(mapping[id]);
    if (fid) set[fid] = true;
  }
  return set;
}

function StdFolders_isJsonFile_(file) {
  var name = String(file.getName() || "").toLowerCase();
  if (name.endsWith(".json")) return true;
  var mime = file.getMimeType();
  return mime === "application/json" || mime === "text/plain";
}

// ---------------------------------------------
// 公開 API（google.script.run 用）— executeAction_ 経由で adminOnly ゲートを通す。
// ---------------------------------------------

function nfbCopyStandardFolders(payload)     { return Nfb_runScriptAction_("std_folders_copy", payload || {}); }
function nfbExportMapping(payload)           { return Nfb_runScriptAction_("std_folders_export_map", payload || {}); }
function nfbImportMapping(payload)           { return Nfb_runScriptAction_("std_folders_import_map", payload || {}); }
function nfbGetStdFolderRoot(payload)        { return Nfb_runScriptAction_("std_folders_get_root", payload || {}); }
function nfbEnsureStdFolders(payload)        { return Nfb_runScriptAction_("std_folders_ensure", payload || {}); }
function nfbListReportTemplates(payload)     { return Nfb_runScriptAction_("report_templates_list", payload || {}); }

// 現在のルートフォルダ情報を返す（診断用）。未解決でも例外にせず resolved:false を返す。
function StdFolders_getRootInfo_() {
  return nfbSafeCall_(function() {
    try {
      var root = StdFolders_resolveRootFolder_(null);
      return { ok: true, resolved: true, rootId: root.getId(), rootUrl: root.getUrl(), rootName: root.getName() };
    } catch (err) {
      return { ok: true, resolved: false, error: nfbErrorToString_(err) };
    }
  });
}

// 全標準サブフォルダを今すぐ作成し、作成後のルート情報を返す（任意で manual rootUrl 指定可）。
function StdFolders_ensureFolders_(payload) {
  return nfbSafeCall_(function() {
    var manualRootUrl = payload && payload.rootUrl ? String(payload.rootUrl).trim() : "";
    var root = StdFolders_resolveRootFolder_(manualRootUrl);
    StdFolders_ensureAllSubfolders_(root);
    return { ok: true, rootId: root.getId(), rootUrl: root.getUrl(), rootName: root.getName() };
  });
}
