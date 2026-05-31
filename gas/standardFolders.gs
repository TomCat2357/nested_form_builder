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
// (2.3 補助) 標準フォルダをスキャンしてマッピングを再構築
// コピー先クローンが 1 回実行する。01_forms / 02_questions / 03_dashboards 配下の定義ファイルを
// 走査し、各 JSON の id（コピー時に埋め込み済み）と Drive fileId/URL から自分自身のマッピングと
// フォルダ登録簿を再構築する。id が無いファイルは新規 id を採番する。
// ---------------------------------------------

// 「同期（フォルダ走査）」の実体。論理 L を正とする 6 ケース整合エンジン（StdFolders_alignFolders_）の
// 薄いエイリアス。action 名・公開ラッパ名・他からの呼び出し（relinkReferences の rebuild）を不変に保つ。
function StdFolders_rebuildMappings_(payload) {
  return StdFolders_alignFolders_(payload || {});
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
  // 整合エンジン（同期＝std_folders_rebuild_map / alignFolders_）の責務に一本化したため
  // ここでは行わない。インポート後に「同期（フォルダ走査）」を実行して揃える。
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

function StdFolders_rebuildFormsMapping_(root) {
  var sub = root.getFoldersByName(NFB_STD_FOLDER_NAMES.forms);
  if (!sub.hasNext()) return { count: 0 };
  var folder = sub.next();
  // 既存マッピング/登録簿へマージする（クローンでは空。既存環境でのデータ消失を防ぐ）。
  var mapping = Forms_getMapping_();
  var mappedFileIds = StdFolders_mappedFileIdSet_(mapping);
  var folderPaths = Forms_getFolders_();
  var ctx = { mapping: mapping, mappedFileIds: mappedFileIds, folderPaths: folderPaths, count: 0 };

  // 01_forms 配下を再帰走査する（物理フォルダ階層に対応するため直下だけでなくサブフォルダも対象）。
  StdFolders_scanFormsFolder_(folder, ctx);

  Forms_saveMapping_(mapping);
  Forms_saveFolders_(folderPaths);
  return { count: ctx.count };
}

// 01_forms 配下のフォーム .json を再帰的に走査し、未登録ファイルのマッピングを構築する。
function StdFolders_scanFormsFolder_(folder, ctx) {
  var files = folder.getFiles();
  while (files.hasNext()) {
    var file = files.next();
    if (typeof file.isTrashed === "function" && file.isTrashed()) continue;
    if (!StdFolders_isJsonFile_(file)) continue;
    var fileId = file.getId();
    if (ctx.mappedFileIds[fileId]) continue; // 既に登録済みのファイルは再採番しない
    var json;
    try {
      json = JSON.parse(file.getBlob().getDataAsString());
    } catch (err) {
      Logger.log("[StdFolders_scanFormsFolder_] parse failed: " + file.getName());
      continue;
    }
    if (!json || !Array.isArray(json.schema)) continue;
    // id ＝ Drive fileId / 名前 ＝ ファイル名（.json 除去）。走査・同期はファイル名で行う。
    var id = fileId;
    var title = Nfb_nameFromFile_(file);
    ctx.mapping[id] = { fileId: fileId, driveFileUrl: file.getUrl(), title: title, folder: Forms_normalizeFolderPath_(json.folder) };
    ctx.mappedFileIds[fileId] = true;
    if (typeof json.folder === "string" && json.folder) ctx.folderPaths.push(json.folder);
    // 認証用 URL マップにも登録（?form=xxx で開けるように）
    try { AddFormUrl_(id, file.getUrl()); } catch (e) { /* non-critical */ }
    ctx.count++;
  }
  var subs = folder.getFolders();
  while (subs.hasNext()) {
    var child = subs.next();
    if (typeof child.isTrashed === "function" && child.isTrashed()) continue;
    StdFolders_scanFormsFolder_(child, ctx);
  }
}

function StdFolders_rebuildAnalyticsMapping_(root, type) {
  var key = type === "questions" ? NFB_STD_FOLDER_NAMES.questions : NFB_STD_FOLDER_NAMES.dashboards;
  var sub = root.getFoldersByName(key);
  if (!sub.hasNext()) return { count: 0 };
  var folder = sub.next();
  var mapping = Analytics_getMapping_(type);
  var mappedFileIds = StdFolders_mappedFileIdSet_(mapping);
  var folderPaths = Analytics_getFolders_(type);
  var count = 0;
  var files = folder.getFiles();
  while (files.hasNext()) {
    var file = files.next();
    if (typeof file.isTrashed === "function" && file.isTrashed()) continue;
    if (!StdFolders_isJsonFile_(file)) continue;
    var fileId = file.getId();
    if (mappedFileIds[fileId]) continue;
    var json;
    try {
      json = JSON.parse(file.getBlob().getDataAsString());
    } catch (err) {
      Logger.log("[StdFolders_rebuildAnalyticsMapping_] parse failed: " + file.getName());
      continue;
    }
    if (!json || typeof json !== "object") continue;
    // id ＝ Drive fileId / 名前 ＝ ファイル名（.json 除去）。走査・同期はファイル名で行う。
    var id = fileId;
    var name = Nfb_nameFromFile_(file);
    mapping[id] = { fileId: fileId, driveFileUrl: file.getUrl(), name: name, folder: Forms_normalizeFolderPath_(json.folder) };
    mappedFileIds[fileId] = true;
    if (typeof json.folder === "string" && json.folder) folderPaths.push(json.folder);
    count++;
  }
  Analytics_saveMapping_(type, mapping);
  Analytics_saveFoldersRegistry_(type, folderPaths);
  return { count: count };
}

function StdFolders_isJsonFile_(file) {
  var name = String(file.getName() || "").toLowerCase();
  if (name.endsWith(".json")) return true;
  var mime = file.getMimeType();
  return mime === "application/json" || mime === "text/plain";
}

// ---------------------------------------------
// (2.4) 構成リンク診断レポート
// 標準フォルダ構成内（子フォルダ含む）のファイル目録とリンク関係を Markdown で書き出す。
// LLM にリンク切れ（フォーム→スプレッドシート / Question→フォーム / Dashboard→Question 等）
// を診断してもらう用途。リンク切れ判定は「構成内の照合のみ」（getFileById での実在検査はしない）。
// ---------------------------------------------

// URL/ID 文字列から Drive の id を Drive へ問い合わせずに（正規表現のみで）抽出する。
// 戻り: { id, kind } kind は "file" | "folder" | "unknown" | "none"。
function StdFolders_extractDriveIdNoFetch_(raw) {
  var s = String(raw || "").trim();
  if (!s) return { id: "", kind: "none" };
  var m;
  if ((m = s.match(/\/folders\/([a-zA-Z0-9_-]+)/))) return { id: m[1], kind: "folder" };
  if ((m = s.match(/\/file\/d\/([a-zA-Z0-9_-]+)/))) return { id: m[1], kind: "file" };
  if ((m = s.match(/docs\.google\.com\/[^/]+\/(?:u\/\d+\/)?d\/([a-zA-Z0-9_-]+)/))) return { id: m[1], kind: "file" };
  if ((m = s.match(/[?&]id=([a-zA-Z0-9_-]+)/))) return { id: m[1], kind: "unknown" };
  if (/^[a-zA-Z0-9_-]{10,}$/.test(s)) return { id: s, kind: "unknown" };
  return { id: "", kind: "none" };
}

// フォルダ配下の全ファイルを（サブフォルダ含め）再帰収集する。Drive ファイルの実在検査はしない。
// out へ { relPath, name, fileId, mimeType, url, file } を push し、fileIdSet/folderIdSet を埋める。
// guard.checkTime() が真になったら guard.truncated を立てて打ち切る（GAS 6 分制限の安全弁）。
function StdFolders_collectFilesRecursive_(folder, relPrefix, out, fileIdSet, folderIdSet, guard) {
  if (guard && guard.truncated) return;
  var files = folder.getFiles();
  while (files.hasNext()) {
    if (guard && guard.checkTime()) { guard.truncated = true; return; }
    var file = files.next();
    if (typeof file.isTrashed === "function" && file.isTrashed()) continue;
    var rec = {
      relPath: relPrefix + file.getName(),
      name: file.getName(),
      fileId: file.getId(),
      mimeType: file.getMimeType(),
      url: file.getUrl(),
      file: file
    };
    out.push(rec);
    fileIdSet[rec.fileId] = true;
  }
  var subs = folder.getFolders();
  while (subs.hasNext()) {
    if (guard && guard.checkTime()) { guard.truncated = true; return; }
    var sub = subs.next();
    if (typeof sub.isTrashed === "function" && sub.isTrashed()) continue;
    if (folderIdSet) folderIdSet[sub.getId()] = true;
    StdFolders_collectFilesRecursive_(sub, relPrefix + sub.getName() + "/", out, fileIdSet, folderIdSet, guard);
  }
}

// name → [fileId,...] の索引に 1 件追加する（同名は配列に積む = 重複検知用）。
function StdFolders_indexNameToIds_(index, name, fileId) {
  if (!index || !name || !fileId) return;
  if (!index[name]) index[name] = [];
  if (index[name].indexOf(fileId) === -1) index[name].push(fileId);
}

// 参照（id / 保持名）を present 実体のファイル名索引で名前解決する。
// 実行時リゾルバ（Forms_resolveFormRef_ / Analytics_resolveQuestionRef_）に倣い、
//   - 保持名（formName / questionName）
//   - id 自体（旧 ULID をそのままファイル名にしているエンティティの救済）
// の双方をファイル名候補とし、正規化名でも引く。戻り: { count, fileId }。
function StdFolders_resolveRefByName_(id, name, nameToIds) {
  if (!nameToIds) return { count: 0, fileId: null };
  var ids = {};
  var candidates = [];
  if (name) candidates.push(String(name));
  if (id) candidates.push(String(id));
  for (var c = 0; c < candidates.length; c++) {
    var keys = [candidates[c]];
    if (typeof Forms_normalizeFormTitle_ === "function") {
      var norm = Forms_normalizeFormTitle_(candidates[c]);
      if (norm && norm !== candidates[c]) keys.push(norm);
    }
    for (var k = 0; k < keys.length; k++) {
      var arr = nameToIds[keys[k]];
      if (arr) { for (var a = 0; a < arr.length; a++) ids[arr[a]] = true; }
    }
  }
  var list = Object.keys(ids);
  return { count: list.length, fileId: list.length === 1 ? list[0] : null, ids: list };
}

// エンティティ相互参照（formId / questionId）の状態を判定する。
// 実行時リゾルバと同じ階層で評価する:
//   1) id（fileId）が構成内に実在 → OK（構成内）
//   2) 保持名 or id をファイル名として名前解決 → 一意なら「名前一致・要再リンク」/ 複数なら「名前重複・曖昧」
//   3) マッピングキーのみ存在 → 要確認
//   4) いずれも該当せず → 真のリンク切れ
// nameToIds は present 実体の { name: [fileId,...] } 索引。
function StdFolders_reportRefStatus_(id, name, presentSet, mapSet, nameToIds) {
  if (!id && !name) return "未設定";
  if (id && presentSet && presentSet[id]) return "OK（構成内）";
  var matched = StdFolders_resolveRefByName_(id, name, nameToIds);
  if (matched.count === 1) return "名前一致・要再リンク（実行時は解決）";
  if (matched.count > 1) return "名前重複・要手動再リンク（曖昧）";
  if (id && mapSet && mapSet[id]) return "要確認（マッピング有・構成内に実体なし）";
  return "未解決（真のリンク切れ）";
}

// Drive ファイル/フォルダ参照（スプレッドシート等）の状態を構成内照合のみで判定する。
function StdFolders_reportFileLinkStatus_(id, presentSet) {
  if (!id) return "未設定";
  if (presentSet[id]) return "構成内";
  return "構成外/外部（未検査）";
}

// 判定文字列の重大度を返す。
//   "manual"   = 要手動対応（真のリンク切れ / 同名曖昧 / 要確認）
//   "auto"     = 自動再リンク可（名前一致・実行時は解決）
//   "external" = 外部参照（未検査・対象外）
//   "ok"       = 問題なし（構成内 / 未設定）
function StdFolders_statusSeverity_(status) {
  switch (status) {
    case "未解決（真のリンク切れ）":
    case "名前重複・要手動再リンク（曖昧）":
    case "要確認（マッピング有・構成内に実体なし）":
      return "manual";
    case "名前一致・要再リンク（実行時は解決）":
      return "auto";
    case "構成外/外部（未検査）":
      return "external";
    default:
      return "ok";
  }
}

// その状態をリンク切れ候補セクションに載せるか（ok 以外は載せる）。
function StdFolders_isBrokenStatus_(status) {
  return StdFolders_statusSeverity_(status) !== "ok";
}

// 表示用の安全なコードスパン文字列（バッククォートのみ無害化）。
function StdFolders_mdCode_(s) {
  return "`" + String(s == null ? "" : s).replace(/`/g, "'") + "`";
}

// 標準フォルダ構成内のファイル目録・リンク関係を Markdown レポートにして返す。
function StdFolders_buildLinkReport_(payload) {
  return nfbSafeCall_(function() {
    var includeJson = !!(payload && (payload.includeEntityJson === true || payload.includeEntityJson === "true"));
    var includeWebhook = !!(payload && (payload.includeWebhookText === true || payload.includeWebhookText === "true"));

    var root = StdFolders_resolveRootFolder_(null);
    var startMs = (new Date()).getTime();
    var guard = { truncated: false, checkTime: function() { return ((new Date()).getTime() - startMs) > 300000; } };

    // 1) 8 標準フォルダを再帰走査してファイル目録と存在 id 集合を構築。
    var presentFileIds = {};
    var presentFolderIds = {};
    var inventory = {};   // key -> [rec] または null（未作成）
    var i;
    for (i = 0; i < NFB_STD_FOLDER_ORDER.length; i++) {
      var key = NFB_STD_FOLDER_ORDER[i];
      var name = NFB_STD_FOLDER_NAMES[key];
      var iter = root.getFoldersByName(name);
      if (!iter.hasNext()) { inventory[key] = null; continue; }
      var sub = iter.next();
      presentFolderIds[sub.getId()] = true;
      var list = [];
      StdFolders_collectFilesRecursive_(sub, "", list, presentFileIds, presentFolderIds, guard);
      inventory[key] = list;
    }

    // 2) マッピング読込（id ＝ fileId）。
    var formMap = Forms_getMapping_();
    var qMap = Analytics_getMapping_("questions");
    var dMap = Analytics_getMapping_("dashboards");
    var formMapSet = {}; for (var fk in formMap) { if (formMap.hasOwnProperty(fk)) formMapSet[fk] = true; }
    var qMapSet = {};    for (var qk in qMap)    { if (qMap.hasOwnProperty(qk))    qMapSet[qk]    = true; }
    var dMapSet = {};    for (var dk in dMap)    { if (dMap.hasOwnProperty(dk))    dMapSet[dk]    = true; }

    // 構成内に実体のあるフォーム / Question の fileId 集合と、名前→fileId 索引（JSON ファイルのみ）。
    // 名前索引は実行時リゾルバの名前フォールバック相当の判定と、同名重複の検知に使う。
    var presentFormIds = {};
    var presentQuestionIds = {};
    var presentFormNameToIds = {};
    var presentQuestionNameToIds = {};
    (inventory.forms || []).forEach(function(rec) {
      if (!StdFolders_isJsonFile_(rec.file)) return;
      presentFormIds[rec.fileId] = true;
      StdFolders_indexNameToIds_(presentFormNameToIds, Nfb_nameFromFile_(rec.file) || rec.name, rec.fileId);
    });
    (inventory.questions || []).forEach(function(rec) {
      if (!StdFolders_isJsonFile_(rec.file)) return;
      presentQuestionIds[rec.fileId] = true;
      StdFolders_indexNameToIds_(presentQuestionNameToIds, Nfb_nameFromFile_(rec.file) || rec.name, rec.fileId);
    });

    var broken = [];   // { kind, owner, detail, status }

    // 3) フォーム JSON を解析してリンク抽出。
    var forms = [];
    var webhookSettings = [];   // { formName, fieldLabel, url, adminOnly }
    (inventory.forms || []).forEach(function(rec) {
      if (!StdFolders_isJsonFile_(rec.file)) return;
      if (guard.checkTime()) { guard.truncated = true; return; }
      var json;
      try { json = JSON.parse(rec.file.getBlob().getDataAsString()); }
      catch (e) { forms.push({ name: rec.relPath, fileId: rec.fileId, relPath: rec.relPath, links: [], parseError: true }); return; }
      var displayName = Nfb_nameFromFile_(rec.file) || rec.name;
      var links = [];

      var ssRaw = json.settings && json.settings.spreadsheetId ? json.settings.spreadsheetId : "";
      if (ssRaw) {
        var ssId = Model_normalizeSpreadsheetId_(ssRaw) || ssRaw;
        var ssStatus = StdFolders_reportFileLinkStatus_(ssId, presentFileIds);
        links.push({ label: "スプレッドシート", raw: ssRaw, id: ssId, status: ssStatus });
        if (StdFolders_isBrokenStatus_(ssStatus)) broken.push({ kind: "Form", owner: displayName, detail: "スプレッドシート " + ssId, status: ssStatus, severity: StdFolders_statusSeverity_(ssStatus) });
      }

      StdFolders_walkFields_(json.schema, function(field) {
        var fieldLabel = field && field.label ? field.label : (field && field.id ? field.id : "(無題)");
        if (field.printTemplateAction && field.printTemplateAction.templateUrl) {
          var t = StdFolders_extractDriveIdNoFetch_(field.printTemplateAction.templateUrl);
          var ts = StdFolders_reportFileLinkStatus_(t.id, presentFileIds);
          links.push({ label: "印刷テンプレート [" + fieldLabel + "]", raw: field.printTemplateAction.templateUrl, id: t.id, status: ts });
          if (StdFolders_isBrokenStatus_(ts)) broken.push({ kind: "Form", owner: displayName, detail: "印刷テンプレート [" + fieldLabel + "]", status: ts, severity: StdFolders_statusSeverity_(ts) });
        }
        if (typeof field.driveRootFolderUrl === "string" && field.driveRootFolderUrl) {
          var u = StdFolders_extractDriveIdNoFetch_(field.driveRootFolderUrl);
          var us = StdFolders_reportFileLinkStatus_(u.id, presentFolderIds);
          links.push({ label: "アップロード先フォルダ [" + fieldLabel + "]", raw: field.driveRootFolderUrl, id: u.id, status: us });
          if (StdFolders_isBrokenStatus_(us)) broken.push({ kind: "Form", owner: displayName, detail: "アップロード先フォルダ [" + fieldLabel + "]", status: us, severity: StdFolders_statusSeverity_(us) });
        }
        if (field.webhookAction && typeof field.webhookAction.url === "string" && field.webhookAction.url) {
          links.push({ label: "webhook [" + fieldLabel + "]", raw: field.webhookAction.url, id: "", status: "外部 webhook（未検査）" });
          webhookSettings.push({ formName: displayName, fieldLabel: fieldLabel, url: field.webhookAction.url, adminOnly: !!field.webhookAction.adminOnly });
        }
      });

      forms.push({ name: displayName, fileId: rec.fileId, relPath: rec.relPath, links: links, json: includeJson ? JSON.stringify(json, null, 2) : null });
    });

    // 4) Question JSON を解析して formId 参照を抽出。
    var questions = [];
    (inventory.questions || []).forEach(function(rec) {
      if (!StdFolders_isJsonFile_(rec.file)) return;
      if (guard.checkTime()) { guard.truncated = true; return; }
      var json;
      try { json = JSON.parse(rec.file.getBlob().getDataAsString()); }
      catch (e) { questions.push({ name: rec.relPath, fileId: rec.fileId, relPath: rec.relPath, refs: [], parseError: true }); return; }
      var displayName = Nfb_nameFromFile_(rec.file) || rec.name;
      var refs = [];
      var query = json && json.query;
      if (query && typeof query === "object") {
        if (query.gui && query.gui.formId) {
          var gName = query.gui.formName || "";
          var st1 = StdFolders_reportRefStatus_(query.gui.formId, gName, presentFormIds, formMapSet, presentFormNameToIds);
          var r1 = StdFolders_resolveRefByName_(query.gui.formId, gName, presentFormNameToIds);
          refs.push({ label: "query.gui.formId", id: query.gui.formId, refName: gName, resolvedFileId: r1.fileId, status: st1 });
          if (StdFolders_isBrokenStatus_(st1)) broken.push({ kind: "Question", owner: displayName, detail: "formId " + query.gui.formId + (gName ? " (name: " + gName + ")" : ""), status: st1, severity: StdFolders_statusSeverity_(st1) });
        }
        if (Array.isArray(query.formSources)) {
          for (var s = 0; s < query.formSources.length; s++) {
            var src = query.formSources[s];
            if (src && src.formId) {
              var sName = src.formName || "";
              var st2 = StdFolders_reportRefStatus_(src.formId, sName, presentFormIds, formMapSet, presentFormNameToIds);
              var r2 = StdFolders_resolveRefByName_(src.formId, sName, presentFormNameToIds);
              refs.push({ label: "formSources[" + s + "].formId", id: src.formId, refName: sName, resolvedFileId: r2.fileId, status: st2 });
              if (StdFolders_isBrokenStatus_(st2)) broken.push({ kind: "Question", owner: displayName, detail: "formSources[" + s + "].formId " + src.formId + (sName ? " (name: " + sName + ")" : ""), status: st2, severity: StdFolders_statusSeverity_(st2) });
            }
          }
        }
      }
      questions.push({ name: displayName, fileId: rec.fileId, relPath: rec.relPath, refs: refs, json: includeJson ? JSON.stringify(json, null, 2) : null });
    });

    // 5) Dashboard JSON を解析して questionId 参照を抽出。
    var dashboards = [];
    (inventory.dashboards || []).forEach(function(rec) {
      if (!StdFolders_isJsonFile_(rec.file)) return;
      if (guard.checkTime()) { guard.truncated = true; return; }
      var json;
      try { json = JSON.parse(rec.file.getBlob().getDataAsString()); }
      catch (e) { dashboards.push({ name: rec.relPath, fileId: rec.fileId, relPath: rec.relPath, refs: [], parseError: true }); return; }
      var displayName = Nfb_nameFromFile_(rec.file) || rec.name;
      var refs = [];
      if (Array.isArray(json.cards)) {
        for (var c = 0; c < json.cards.length; c++) {
          var card = json.cards[c];
          if (card && card.questionId) {
            var qName = card.questionName || "";
            var st3 = StdFolders_reportRefStatus_(card.questionId, qName, presentQuestionIds, qMapSet, presentQuestionNameToIds);
            var r3 = StdFolders_resolveRefByName_(card.questionId, qName, presentQuestionNameToIds);
            refs.push({ label: "cards[" + c + "].questionId", id: card.questionId, qname: qName, resolvedFileId: r3.fileId, status: st3 });
            if (StdFolders_isBrokenStatus_(st3)) broken.push({ kind: "Dashboard", owner: displayName, detail: "cards[" + c + "].questionId " + card.questionId + (qName ? " (name: " + qName + ")" : ""), status: st3, severity: StdFolders_statusSeverity_(st3) });
          }
        }
      }
      dashboards.push({ name: displayName, fileId: rec.fileId, relPath: rec.relPath, refs: refs, json: includeJson ? JSON.stringify(json, null, 2) : null });
    });

    // 6) Markdown 組み立て。
    var md = StdFolders_renderLinkReportMarkdown_({
      root: root, inventory: inventory, forms: forms, questions: questions, dashboards: dashboards,
      broken: broken, webhookSettings: webhookSettings, includeJson: includeJson, includeWebhook: includeWebhook,
      truncated: guard.truncated
    });

    var totalFiles = 0;
    for (var ik in inventory) { if (inventory.hasOwnProperty(ik) && inventory[ik]) totalFiles += inventory[ik].length; }
    var sevCounts = StdFolders_countBySeverity_(broken);
    return {
      ok: true,
      markdown: md,
      stats: {
        files: totalFiles,
        forms: forms.length,
        questions: questions.length,
        dashboards: dashboards.length,
        brokenCandidates: sevCounts.manual,        // 要手動対応（真のリンク切れ / 曖昧 / 要確認）
        autoRelinkable: sevCounts.auto,            // 名前一致で自動再リンク可
        externalRefs: sevCounts.external,          // 外部参照（未検査・対象外）
        surfacedTotal: broken.length,              // 候補セクションに載った総数
        truncated: guard.truncated
      }
    };
  });
}

// broken 配列を重大度別に集計する。
function StdFolders_countBySeverity_(broken) {
  var counts = { manual: 0, auto: 0, external: 0 };
  for (var i = 0; i < broken.length; i++) {
    var sev = broken[i].severity || StdFolders_statusSeverity_(broken[i].status);
    if (counts[sev] === undefined) counts[sev] = 0;
    counts[sev]++;
  }
  return counts;
}

// レポート用のフォルダ込み表示名（"相対フォルダ/葉名"）。relPath から .json を外して得る。
function StdFolders_reportQualName_(e) {
  if (e && e.relPath) return String(e.relPath).replace(/\.json$/i, "");
  return (e && e.name) || "";
}

// レポート Markdown を組み立てる（純粋な文字列整形）。
function StdFolders_renderLinkReportMarkdown_(ctx) {
  var md = [];
  var totalFiles = 0;
  for (var ik in ctx.inventory) { if (ctx.inventory.hasOwnProperty(ik) && ctx.inventory[ik]) totalFiles += ctx.inventory[ik].length; }

  md.push("# Nested Form Builder 構成レポート");
  md.push("");
  md.push("- ルートフォルダ: " + ctx.root.getName() + "（" + ctx.root.getUrl() + "）");
  md.push("- 生成時刻: " + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss"));
  md.push("- 集計: ファイル " + totalFiles + " 件 / フォーム " + ctx.forms.length + " / Question " + ctx.questions.length + " / Dashboard " + ctx.dashboards.length);
  var sev = StdFolders_countBySeverity_(ctx.broken);
  md.push("- 要手動対応（真のリンク切れ / 同名曖昧 / 要確認）: " + sev.manual + " 件");
  md.push("- 自動再リンク可（名前一致・実行時は解決）: " + sev.auto + " 件 — 「同期（フォルダ走査）」で恒久修復可");
  md.push("- 外部参照（未検査・対象外）: " + sev.external + " 件");
  md.push("- リンク切れ判定: 構成内照合＋実行時リゾルバ相当の名前フォールバック（外部リンクの生死は未検査）");
  md.push("- 実行打ち切り: " + (ctx.truncated ? "あり（実行時間の安全弁により一部のファイルを未処理。再実行してください）" : "なし"));
  md.push("");

  // 重大度ごとにグルーピングして列挙する。
  var groups = [
    { sevKey: "manual",   title: "## ⚠ 要手動対応（真のリンク切れ / 同名曖昧 / 要確認）" },
    { sevKey: "auto",     title: "## 🔧 自動再リンク可（名前一致・実行時は解決）" },
    { sevKey: "external", title: "## ℹ 外部参照（未検査・対象外）" }
  ];
  var anySurfaced = false;
  groups.forEach(function(g) {
    var items = ctx.broken.filter(function(b) { return (b.severity || StdFolders_statusSeverity_(b.status)) === g.sevKey; });
    if (!items.length) return;
    anySurfaced = true;
    md.push(g.title);
    md.push("");
    items.forEach(function(b) {
      md.push("- [" + b.kind + "] " + b.owner + " → " + b.detail + " : **" + b.status + "**");
    });
    md.push("");
  });
  if (!anySurfaced) {
    md.push("## ⚠ リンク切れ候補");
    md.push("");
    md.push("構成内照合＋名前フォールバックでは検出されませんでした。");
    md.push("");
  }

  md.push("## フォルダ別ファイル目録");
  for (var i = 0; i < NFB_STD_FOLDER_ORDER.length; i++) {
    var key = NFB_STD_FOLDER_ORDER[i];
    var fname = NFB_STD_FOLDER_NAMES[key];
    var list = ctx.inventory[key];
    md.push("");
    if (list === null) {
      md.push("### " + fname + "（未作成）");
      continue;
    }
    md.push("### " + fname + "（" + list.length + " 件）");
    if (!list.length) { md.push("- (空)"); continue; }
    list.forEach(function(rec) {
      md.push("- " + StdFolders_mdCode_(rec.relPath) + " | type: " + rec.mimeType + " | fileId: " + StdFolders_mdCode_(rec.fileId) + " | " + rec.url);
    });
  }
  md.push("");

  md.push("## リンク関係");
  md.push("");
  md.push("### フォーム");
  if (!ctx.forms.length) md.push("- (なし)");
  ctx.forms.forEach(function(f) {
    md.push("");
    md.push("#### " + StdFolders_reportQualName_(f) + "（fileId: " + f.fileId + "）");
    if (f.parseError) { md.push("- ⚠ JSON 解析に失敗しました: " + StdFolders_mdCode_(f.relPath)); return; }
    if (!f.links.length) { md.push("- (リンクなし)"); return; }
    f.links.forEach(function(l) {
      md.push("- " + l.label + ": " + StdFolders_mdCode_(l.raw) + (l.id ? "（id: " + l.id + "）" : "") + " → " + l.status);
    });
  });
  md.push("");
  md.push("### Question");
  if (!ctx.questions.length) md.push("- (なし)");
  ctx.questions.forEach(function(q) {
    md.push("");
    md.push("#### " + StdFolders_reportQualName_(q) + "（fileId: " + q.fileId + "）");
    if (q.parseError) { md.push("- ⚠ JSON 解析に失敗しました: " + StdFolders_mdCode_(q.relPath)); return; }
    if (!q.refs.length) { md.push("- (参照なし)"); return; }
    q.refs.forEach(function(r) {
      md.push("- " + r.label + ": " + StdFolders_mdCode_(r.id) + (r.refName ? "（name: " + r.refName + "）" : "") + " → " + r.status + (r.resolvedFileId ? "（解決先 fileId: " + r.resolvedFileId + "）" : ""));
    });
  });
  md.push("");
  md.push("### Dashboard");
  if (!ctx.dashboards.length) md.push("- (なし)");
  ctx.dashboards.forEach(function(d) {
    md.push("");
    md.push("#### " + StdFolders_reportQualName_(d) + "（fileId: " + d.fileId + "）");
    if (d.parseError) { md.push("- ⚠ JSON 解析に失敗しました: " + StdFolders_mdCode_(d.relPath)); return; }
    if (!d.refs.length) { md.push("- (参照なし)"); return; }
    d.refs.forEach(function(r) {
      md.push("- " + r.label + ": " + StdFolders_mdCode_(r.id) + (r.qname ? "（name: " + r.qname + "）" : "") + " → " + r.status + (r.resolvedFileId ? "（解決先 fileId: " + r.resolvedFileId + "）" : ""));
    });
  });
  md.push("");

  if (ctx.includeWebhook) {
    md.push("## Webhook");
    md.push("");
    md.push("### フォーム埋め込み設定（webhookAction）");
    if (!ctx.webhookSettings.length) {
      md.push("- (なし)");
    } else {
      ctx.webhookSettings.forEach(function(w) {
        md.push("- Form " + w.formName + " / field \"" + w.fieldLabel + "\": url=" + StdFolders_mdCode_(w.url) + " / adminOnly=" + w.adminOnly);
      });
    }
    md.push("");
    md.push("### 07_webhooks フォルダのファイル");
    var whList = ctx.inventory.webhooks;
    if (whList === null) {
      md.push("- (07_webhooks 未作成)");
    } else if (!whList.length) {
      md.push("- (ファイルなし)");
    } else {
      whList.forEach(function(rec) {
        md.push("");
        md.push("#### " + StdFolders_mdCode_(rec.relPath) + "（fileId: " + rec.fileId + " / type: " + rec.mimeType + "）");
        var text = null;
        var mime = String(rec.mimeType || "");
        var textual = /^text\//.test(mime) || mime === "application/json" || mime === "application/javascript" || mime === "application/xml";
        if (textual) {
          try { text = rec.file.getBlob().getDataAsString(); } catch (e) { text = null; }
        }
        if (text === null) {
          md.push("（テキスト化非対応のファイル形式のため本文は省略。URL: " + rec.url + "）");
        } else {
          md.push("```");
          md.push(text);
          md.push("```");
        }
      });
    }
    md.push("");
  }

  if (ctx.includeJson) {
    md.push("## エンティティ JSON");
    md.push("");
    md.push("### フォーム");
    ctx.forms.forEach(function(f) {
      if (!f.json) return;
      md.push("");
      md.push("#### " + StdFolders_reportQualName_(f) + "（fileId: " + f.fileId + "）");
      md.push("```json");
      md.push(f.json);
      md.push("```");
    });
    md.push("");
    md.push("### Question");
    ctx.questions.forEach(function(q) {
      if (!q.json) return;
      md.push("");
      md.push("#### " + StdFolders_reportQualName_(q) + "（fileId: " + q.fileId + "）");
      md.push("```json");
      md.push(q.json);
      md.push("```");
    });
    md.push("");
    md.push("### Dashboard");
    ctx.dashboards.forEach(function(d) {
      if (!d.json) return;
      md.push("");
      md.push("#### " + StdFolders_reportQualName_(d) + "（fileId: " + d.fileId + "）");
      md.push("```json");
      md.push(d.json);
      md.push("```");
    });
    md.push("");
  }

  return md.join("\n");
}

// ---------------------------------------------
// 参照の恒久再リンク（旧 id 参照 → 現 fileId へ JSON を書換える）
// 実行時リゾルバ（id→名前フォールバック）と同じ解決を行い、結果を定義 JSON に永続化することで
// リンク診断レポートを恒久的にクリーンにする。dryRun（既定）は変更予定のみ返す。
// ---------------------------------------------

// key サブフォルダ配下（再帰）の JSON を走査し、名前索引を構築する。
// 戻り: {
//   nameToIds:{name:[fileId,...]},  // 葉名キーに加え「フォルダ込み名（相対フォルダ/葉名）」キーも積む
//   idToName:{fileId:name}, idSet:{fileId:true},
//   idToFolder:{fileId:relFolder}, idToUpdated:{fileId:ms}  // 同フォルダ重複の最新採用判定用
// }。
function StdFolders_buildNameIndexForKey_(root, key) {
  var out = { nameToIds: {}, idToName: {}, idSet: {}, idToFolder: {}, idToUpdated: {} };
  try {
    var sub = StdFolders_getOrCreateSubfolder_(root, key);
    StdFolders_walkNameIndex_(sub, out, "");
  } catch (err) {
    Logger.log("[StdFolders_buildNameIndexForKey_] " + key + ": " + nfbErrorToString_(err));
  }
  return out;
}

function StdFolders_walkNameIndex_(folder, out, prefix) {
  var files = folder.getFiles();
  while (files.hasNext()) {
    var file = files.next();
    if (typeof file.isTrashed === "function" && file.isTrashed()) continue;
    if (!StdFolders_isJsonFile_(file)) continue;
    var id = file.getId();
    var name = Nfb_nameFromFile_(file);
    out.idSet[id] = true;
    out.idToName[id] = name;
    out.idToFolder[id] = prefix || "";
    var updated = 0;
    try { updated = file.getLastUpdated().getTime(); } catch (e) { updated = 0; }
    out.idToUpdated[id] = updated;
    StdFolders_indexNameToIds_(out.nameToIds, name, id);
    // フォルダ込み名キー（"相対フォルダ/葉名"）。フォルダ込みで保持された参照名を一意解決するため。
    if (prefix) StdFolders_indexNameToIds_(out.nameToIds, prefix + "/" + name, id);
  }
  var subs = folder.getFolders();
  while (subs.hasNext()) {
    var sub = subs.next();
    if (typeof sub.isTrashed === "function" && sub.isTrashed()) continue;
    StdFolders_walkNameIndex_(sub, out, prefix ? prefix + "/" + sub.getName() : sub.getName());
  }
}

// 同名複数の候補 ids が「全て同一フォルダ」なら最新（idToUpdated 最大）を返す。
// 別フォルダが混在するなら null（真の曖昧）。同フォルダ重複の救済に使う。
function StdFolders_pickNewestSameFolder_(ids, index) {
  if (!ids || ids.length < 2 || !index.idToFolder) return null;
  var folder = index.idToFolder[ids[0]];
  for (var i = 1; i < ids.length; i++) {
    if (index.idToFolder[ids[i]] !== folder) return null;
  }
  var best = ids[0];
  for (var j = 1; j < ids.length; j++) {
    if ((index.idToUpdated[ids[j]] || 0) > (index.idToUpdated[best] || 0)) best = ids[j];
  }
  return best;
}

// 1 件の参照 { id, name } を index で解決し、再リンク判断を返す（純粋）。
//   { action: "ok"|"relink"|"ambiguous"|"unresolved", toId, toName }
function StdFolders_planRefRelink_(id, name, index) {
  // 明示 remap（旧id→新id）が与えられていれば最優先で従う（②外部コピーの id 採用に追従）。
  if (index.remap && id && index.remap[id]) {
    var to = index.remap[id];
    return { action: "relink", toId: to, toName: index.idToName[to] || name || "" };
  }
  if (id && index.idSet[id]) return { action: "ok" };
  var m = StdFolders_resolveRefByName_(id, name, index.nameToIds);
  if (m.count === 1) return { action: "relink", toId: m.fileId, toName: index.idToName[m.fileId] || name || "" };
  if (m.count > 1) {
    // 同名複数。物理フォルダが同一なら最新を採用（同フォルダ重複の救済）。別フォルダ混在は曖昧。
    var picked = StdFolders_pickNewestSameFolder_(m.ids, index);
    if (picked) return { action: "relink", toId: picked, toName: index.idToName[picked] || name || "" };
    return { action: "ambiguous" };
  }
  return { action: "unresolved" };
}

// obj[idKey] の参照を index で解決し、relink 可能なら obj を書換える（永続化は呼び出し側）。
// 戻り: 書換えたら true。ok / ambiguous / unresolved は false（ambiguous・unresolved は res に記録）。
function StdFolders_applyRefRelink_(obj, idKey, nameKey, label, owner, ownerFileId, index, res) {
  var oldId = obj[idKey];
  var name = (nameKey && obj[nameKey]) ? obj[nameKey] : "";
  var plan = StdFolders_planRefRelink_(oldId, name, index);
  if (plan.action === "relink") {
    res.refsRelinked++;
    res.changes.push({ entity: owner, entityFileId: ownerFileId, ref: label, from: oldId, to: plan.toId, name: plan.toName });
    obj[idKey] = plan.toId;
    // 参照は fileId のみで保持する方針のため name は書き戻さない（formName/questionName を再付与しない）。
    // 旧ファイルに残る nameKey は relink 判定の読取（上の name）にのみ用い、復旧は remap/中央辞書に集約。
    return true;
  }
  if (plan.action === "ambiguous") {
    res.ambiguous.push({ entity: owner, entityFileId: ownerFileId, ref: label, id: oldId, name: name });
  } else if (plan.action === "unresolved") {
    res.unresolved.push({ entity: owner, entityFileId: ownerFileId, ref: label, id: oldId, name: name });
  }
  return false;
}

function StdFolders_newRelinkResult_() {
  return { scanned: 0, filesChanged: 0, refsRelinked: 0, ambiguous: [], unresolved: [], changes: [] };
}

// 全 Question / Dashboard の参照を解決して現 fileId へ書き戻す（dryRun 既定）。
function StdFolders_relinkReferences_(payload) {
  return nfbSafeCall_(function() {
    var apply = !!(payload && (payload.mode === "apply" || payload.apply === true));
    var rebuild = !(payload && payload.rebuildMapping === false);
    var manualRootUrl = payload && payload.rootUrl ? String(payload.rootUrl).trim() : "";
    var root = StdFolders_resolveRootFolder_(manualRootUrl);

    var startMs = (new Date()).getTime();
    var guard = { truncated: false, checkTime: function() { return ((new Date()).getTime() - startMs) > 300000; } };

    // apply 時のみ先にマッピングを再構築して stale エントリを掃除する（dryRun は読み取りのみ）。
    var rebuilt = null;
    if (apply && rebuild) rebuilt = StdFolders_rebuildMappings_({ rootUrl: manualRootUrl });

    var formIndex = StdFolders_buildNameIndexForKey_(root, "forms");
    var qIndex = StdFolders_buildNameIndexForKey_(root, "questions");

    // 明示 remap（旧id→新id）があれば索引へ添付し、名前フォールバックより優先して解決する。
    var remap = (payload && payload.remap && typeof payload.remap === "object") ? payload.remap : null;
    if (remap) { formIndex.remap = remap; qIndex.remap = remap; }

    var qRes = StdFolders_newRelinkResult_();
    var dRes = StdFolders_newRelinkResult_();
    try { StdFolders_walkRelink_(StdFolders_getOrCreateSubfolder_(root, "questions"), "questions", formIndex, apply, guard, qRes); }
    catch (e) { Logger.log("[StdFolders_relinkReferences_] questions: " + nfbErrorToString_(e)); }
    try { StdFolders_walkRelink_(StdFolders_getOrCreateSubfolder_(root, "dashboards"), "dashboards", qIndex, apply, guard, dRes); }
    catch (e) { Logger.log("[StdFolders_relinkReferences_] dashboards: " + nfbErrorToString_(e)); }

    return {
      ok: true,
      mode: apply ? "apply" : "dryRun",
      rebuilt: rebuilt,
      questions: qRes,
      dashboards: dRes,
      truncated: guard.truncated
    };
  });
}

// kind = "questions"（formSources/gui.formId）または "dashboards"（cards[].questionId）を走査して再リンク。
function StdFolders_walkRelink_(folder, kind, index, apply, guard, res) {
  if (guard.truncated) return;
  var files = folder.getFiles();
  while (files.hasNext()) {
    if (guard.checkTime()) { guard.truncated = true; return; }
    var file = files.next();
    if (typeof file.isTrashed === "function" && file.isTrashed()) continue;
    if (!StdFolders_isJsonFile_(file)) continue;
    res.scanned++;
    var fileId = file.getId();
    var owner = Nfb_nameFromFile_(file);
    var json;
    try { json = JSON.parse(file.getBlob().getDataAsString()); } catch (e) { continue; }
    var changed = false;

    if (kind === "questions") {
      var query = json && json.query;
      if (query && typeof query === "object") {
        if (query.gui && typeof query.gui === "object" && query.gui.formId) {
          if (StdFolders_applyRefRelink_(query.gui, "formId", "formName", "query.gui.formId", owner, fileId, index, res)) changed = true;
        }
        if (Array.isArray(query.formSources)) {
          for (var i = 0; i < query.formSources.length; i++) {
            var src = query.formSources[i];
            if (src && src.formId) {
              if (StdFolders_applyRefRelink_(src, "formId", "formName", "formSources[" + i + "].formId", owner, fileId, index, res)) changed = true;
            }
          }
        }
      }
    } else {
      if (Array.isArray(json.cards)) {
        for (var c = 0; c < json.cards.length; c++) {
          var card = json.cards[c];
          if (card && card.questionId) {
            if (StdFolders_applyRefRelink_(card, "questionId", "questionName", "cards[" + c + "].questionId", owner, fileId, index, res)) changed = true;
          }
        }
      }
    }

    if (changed) {
      res.filesChanged++;
      if (apply) {
        try { file.setContent(JSON.stringify(json, null, 2)); }
        catch (e) { Logger.log("[StdFolders_walkRelink_] setContent " + fileId + ": " + nfbErrorToString_(e)); }
      }
    }
  }
  var subs = folder.getFolders();
  while (subs.hasNext()) {
    if (guard.checkTime()) { guard.truncated = true; return; }
    var s = subs.next();
    if (typeof s.isTrashed === "function" && s.isTrashed()) continue;
    StdFolders_walkRelink_(s, kind, index, apply, guard, res);
  }
}

// ---------------------------------------------
// 公開 API（google.script.run 用）— executeAction_ 経由で adminOnly ゲートを通す。
// ---------------------------------------------

function nfbCopyStandardFolders(payload)     { return Nfb_runScriptAction_("std_folders_copy", payload || {}); }
function nfbRebuildMappingsFromFolders(payload) { return Nfb_runScriptAction_("std_folders_rebuild_map", payload || {}); }
function nfbExportMapping(payload)           { return Nfb_runScriptAction_("std_folders_export_map", payload || {}); }
function nfbImportMapping(payload)           { return Nfb_runScriptAction_("std_folders_import_map", payload || {}); }
function nfbGetStdFolderRoot(payload)        { return Nfb_runScriptAction_("std_folders_get_root", payload || {}); }
function nfbEnsureStdFolders(payload)        { return Nfb_runScriptAction_("std_folders_ensure", payload || {}); }
function nfbBuildLinkReport(payload)         { return Nfb_runScriptAction_("std_folders_link_report", payload || {}); }

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
