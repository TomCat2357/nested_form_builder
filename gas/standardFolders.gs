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
//   ├── 07_external_actions/
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
  externalActions: "07_external_actions",
  documents: "08_documents",
  // 串刺しフォーム検索の保存先。NFB_STD_FOLDER_ORDER には入れない（構成コピー対象外。
  // autoFileFolderOrNull_ は ensureAll 後にキー指定で on-demand 作成するため解決可能）。
  crossSearches: "09_cross_searches"
};

// 作成・コピー時の処理順。
var NFB_STD_FOLDER_ORDER = [
  "forms", "questions", "dashboards", "spreadsheets",
  "report_templates", "upload", "externalActions", "documents"
];

// 構成コピー（StdFolders_copy_）のカテゴリ選択を 8 キー全件の bool マップへ正規化する。
// rawCategories（payload.categories の { forms:bool, questions:bool, ... } 想定）の未指定キーは
// true へ寄せる（後方互換 = カテゴリ未指定なら従来どおり全カテゴリをコピー）。
// 旧クライアント互換: rawCategories を渡さず copyExternalActions だけ来た場合は、その値で
// externalActions の選択を決める（copyExternalActions===false → externalActions のみ false）。
// rawCategories を明示指定する新クライアントでは categories.externalActions を唯一の真実とし、
// copyExternalActions 引数は無視する。
function StdFolders_normalizeCategorySelection_(rawCategories, copyExternalActions) {
  var hasObj = rawCategories && typeof rawCategories === "object";
  var out = {};
  for (var i = 0; i < NFB_STD_FOLDER_ORDER.length; i++) {
    var k = NFB_STD_FOLDER_ORDER[i];
    if (!hasObj) {
      out[k] = true;
      continue;
    }
    var v = rawCategories[k];
    out[k] = (v === undefined || v === null) ? true : (v === true || v === "true");
  }
  if (!hasObj) {
    if (copyExternalActions === false || copyExternalActions === "false") {
      out.externalActions = false;
    } else if (copyExternalActions === true || copyExternalActions === "true") {
      out.externalActions = true;
    }
  }
  return out;
}

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

  var manual = Nfb_trimStr_(manualRootUrl);
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

// parentFolder 配下に name の子フォルダを取得（無ければ作成）。
// 任意名版（標準キーに縛られない）。構成コピーのネスト階層再現に使う。
function StdFolders_getOrCreateChildFolder_(parentFolder, name) {
  var existing = parentFolder.getFoldersByName(name);
  return existing.hasNext() ? existing.next() : parentFolder.createFolder(name);
}

// rootFolder 配下の標準サブフォルダを取得（無ければ作成）。
function StdFolders_getOrCreateSubfolder_(rootFolder, key) {
  var name = NFB_STD_FOLDER_NAMES[key];
  if (!name) throw new Error("未知の標準フォルダキーです: " + key);
  return StdFolders_getOrCreateChildFolder_(rootFolder, name);
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

// ---------------------------------------------
// File / Folder 共通の述語コア。
// DriveApp の File と Folder は取得 API（getFileById / getFolderById）だけが異なり、
// 親チェーン走査・生存判定・構成内判定のロジックは同一なので kind ∈ {"file","folder"} で
// 一本化する。公開名（StdFolders_isFileUnderFolder_ 等）は従来どおりの薄いデリゲート。
// 読み取り専用の述語のみ統合し、move / copy / align 系は File と Folder で
// セマンティクスが異なるため統合しない。
// ---------------------------------------------

function StdFolders_getNodeById_(kind, id) {
  return kind === "folder" ? DriveApp.getFolderById(id) : DriveApp.getFileById(id);
}

// id のノードが ancestorId フォルダの「子孫」かどうか（親チェーンを遡って判定）。
// 01_forms/ヒグマ/ のようなサブフォルダ配下も構成内とみなすため再帰的に判定する。
// 親チェーンは多親・循環があり得るので visited と深さ上限で保護する。
// kind === "folder" のときのみ自身一致（id === ancestorId）も子孫扱いにする（従来挙動）。
function StdFolders_isNodeUnderFolder_(kind, id, ancestorId) {
  if (!id || !ancestorId) return false;
  if (kind === "folder" && id === ancestorId) return true;
  try {
    var seen = {};
    var queue = [];
    var p0 = StdFolders_getNodeById_(kind, id).getParents();
    while (p0.hasNext()) queue.push(p0.next());
    var steps = 0;
    while (queue.length && steps < 200) {
      steps++;
      var f = queue.shift();
      var fid = f.getId();
      if (fid === ancestorId) return true;
      if (seen[fid]) continue;
      seen[fid] = true;
      var ps = f.getParents();
      while (ps.hasNext()) queue.push(ps.next());
    }
  } catch (err) {
    Logger.log("[StdFolders_isNodeUnderFolder_:" + kind + "] " + id + " under " + ancestorId + ": " + nfbErrorToString_(err));
  }
  return false;
}

// id のノードが、解決済みプロジェクトルート配下（どの標準サブフォルダでもよい）に在るか判定する。
// 整合エンジンの ②（プロジェクト内・別標準フォルダ → move）/ ③（プロジェクト外 → copy）分離に使う。
// relativeFolderOfFile は「自分のホーム標準フォルダ配下か」しか分からないため、これで補う。ルート未解決時は false。
function StdFolders_isNodeUnderProjectRoot_(kind, id) {
  if (!id) return false;
  try {
    var root = StdFolders_resolveRootFolder_(null);
    return StdFolders_isNodeUnderFolder_(kind, id, root.getId());
  } catch (err) {
    Logger.log("[StdFolders_isNodeUnderProjectRoot_:" + kind + "] " + id + ": " + nfbErrorToString_(err));
  }
  return false;
}

// id のノードが、解決済みルートの key サブフォルダ配下（直下・ネスト問わず）に在るか判定する。
// ルート未解決時は false（= 構成外扱い）。
function StdFolders_isNodeInStdSubfolder_(kind, id, key) {
  try {
    var root = StdFolders_resolveRootFolder_(null);
    var sub = StdFolders_getOrCreateSubfolder_(root, key);
    return StdFolders_isNodeUnderFolder_(kind, id, sub.getId());
  } catch (err) {
    Logger.log("[StdFolders_isNodeInStdSubfolder_:" + kind + "] " + id + " (" + key + "): " + nfbErrorToString_(err));
  }
  return false;
}

// id のノードが生存しているか（存在しゴミ箱でない）。取得不能（削除済み・権限喪失など）は false。
function StdFolders_isNodeIdAlive_(kind, id) {
  if (!id) return false;
  try {
    var f = StdFolders_getNodeById_(kind, id);
    return !(typeof f.isTrashed === "function" && f.isTrashed());
  } catch (e) {
    return false;
  }
}

function StdFolders_isFileUnderFolder_(fileId, folderId) {
  return StdFolders_isNodeUnderFolder_("file", fileId, folderId);
}

function StdFolders_isFileUnderProjectRoot_(fileId) {
  return StdFolders_isNodeUnderProjectRoot_("file", fileId);
}

function StdFolders_isFileInStdSubfolder_(fileId, key) {
  return StdFolders_isNodeInStdSubfolder_("file", fileId, key);
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
// マッピングの壊れたリンク判定に使う。
function StdFolders_isFileIdAlive_(fileId) {
  return StdFolders_isNodeIdAlive_("file", fileId);
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
// 04_spreadsheets 配下の論理パス → fileId 解決（フォーム→スプレッドシートリンクの論理パス化用）
// スプレッドシートはレジストリ（中央辞書）に無く、葉名に ".json" が付かない点が forms/questions と異なる。
// 読み取り解決のみのため drivemap キャッシュ（SharedDrive descriptor）は設けず、毎回 base から walk する。
// 解決不能はすべて "" を返す（＝論理パスを導けない/見つからない→空。コピー元へは繋がない）。
// ---------------------------------------------

// 04_spreadsheets サブフォルダ（無ければ作成）を返す。ルート未解決なら null。
function StdFolders_spreadsheetsBaseFolderOrNull_() {
  return StdFolders_autoFileFolderOrNull_("spreadsheets");
}

// パス文字列を空でないセグメント配列へ分解する（"/" 区切り。前後空白・空セグメントは捨てる）。
// listFiles_ が path を素の "/" 連結で組み立てるのに合わせ、エスケープなしで分割する。
function StdFolders_splitPathSegments_(path) {
  var s = String(path == null ? "" : path).trim().replace(/\\/g, "/");
  var raw = s.split("/");
  var segs = [];
  for (var i = 0; i < raw.length; i++) {
    var seg = raw[i].trim();
    if (seg) segs.push(seg);
  }
  return segs;
}

// ---------------------------------------------
// 汎用: 標準サブフォルダ配下の論理パス↔fileId（非エンティティ参照のプロジェクト内取り込み用）
// 印刷様式（05）・スプレッドシート（04）・アップロード（06）など、中央辞書も .json 葉も持たない
// 「フォーム/レコードが URL で指す素のファイル」を、保存時にプロジェクト内へ寄せて論理パスを併設する。
// drivemap キャッシュは持たず（スプレッドシート前例に倣う）毎回 base から walk する。
// 取り込み方針はエンティティ整合エンジン（StdFolders_alignEntry_ の ②③）と同一:
//   ホーム（key 配下）= 据置 / プロジェクト内の別フォルダ = move（fileId 保持） / プロジェクト外 = copy（新 fileId）。
// ---------------------------------------------

// 論理パス（"フォルダ/.../葉名"）→ key サブフォルダ配下の fileId。葉は拡張子なしの完全一致。未解決は ""。
function StdFolders_resolvePathToFileId_(key, path) {
  var segs = StdFolders_splitPathSegments_(path);
  if (!segs.length) return "";
  var base = StdFolders_autoFileFolderOrNull_(key);
  if (!base) return "";
  var leaf = segs.pop();
  var parent = base;
  for (var i = 0; i < segs.length; i++) {
    var child = FormsDrive_childFolderByName_(parent, segs[i]);
    if (!child) return "";
    parent = child;
  }
  var file = StdFolders_findFileByNameInFolder_(parent, leaf); // 葉は拡張子なし完全一致
  return file ? file.getId() : "";
}

// 後方互換: 04_spreadsheets 専用ラッパー（汎用版へ委譲）。
function StdFolders_resolveSpreadsheetPathToFileId_(path) {
  return StdFolders_resolvePathToFileId_("spreadsheets", path);
}

// node（File/Folder）の親チェーンを baseId まで遡り、base 配下の相対フォルダ名配列を返す。
// base 直下なら []、base 配下に無ければ null。多親・循環は visited とノード上限で保護。
function StdFolders_relFolderSegsUnderBase_(node, baseId) {
  var stack = [];
  var parents = node.getParents();
  while (parents.hasNext()) {
    var p = parents.next();
    stack.push({ folder: p, path: [p.getName()] });
  }
  var seen = {};
  var steps = 0;
  while (stack.length && steps < 200) {
    steps++;
    var item = stack.pop();
    var fid = item.folder.getId();
    if (fid === baseId) return item.path.slice(1);  // base 名を除いた相対フォルダ列
    if (seen[fid]) continue;
    seen[fid] = true;
    var ps = item.folder.getParents();
    while (ps.hasNext()) {
      var pp = ps.next();
      stack.push({ folder: pp, path: [pp.getName()].concat(item.path) });
    }
  }
  return null;
}

// key サブフォルダ配下にある fileId の論理パス（"フォルダ/.../葉名"、葉＝ファイル名）。配下外は null。
function StdFolders_relativePathOfFile_(key, fileId) {
  if (!fileId) return null;
  var base = StdFolders_autoFileFolderOrNull_(key);
  if (!base) return null;
  try {
    var file = DriveApp.getFileById(fileId);
    var segs = StdFolders_relFolderSegsUnderBase_(file, base.getId());
    if (segs === null) return null;
    var name = file.getName();
    return segs.length ? (segs.join("/") + "/" + name) : name;
  } catch (e) {
    Logger.log("[StdFolders_relativePathOfFile_] " + fileId + " (" + key + "): " + nfbErrorToString_(e));
    return null;
  }
}

// 取り込み先フォルダ（key base 配下・logicalPath の親ディレクトリ部分）を ensure。空パスなら base 直下。base 未解決は null。
function StdFolders_ensureRefTargetFolder_(key, logicalPath) {
  var base = StdFolders_autoFileFolderOrNull_(key);
  if (!base) return null;
  var segs = StdFolders_splitPathSegments_(logicalPath);
  if (segs.length) segs.pop();  // 葉（ファイル名）を除いた親フォルダ列のみ
  var folder = base;
  for (var i = 0; i < segs.length; i++) {
    folder = StdFolders_getOrCreateChildFolder_(folder, segs[i]);
  }
  return folder;
}

// 内部別フォルダのファイルを key base 配下（logicalPath の親）へ move（fileId 保持）。成否を返す。
function StdFolders_moveFileIntoStdPath_(key, fileId, logicalPath) {
  try {
    var target = StdFolders_ensureRefTargetFolder_(key, logicalPath);
    if (!target) return false;
    DriveApp.getFileById(fileId).moveTo(target);
    return true;
  } catch (err) {
    Logger.log("[StdFolders_moveFileIntoStdPath_] " + fileId + " -> " + key + ": " + nfbErrorToString_(err));
    return false;
  }
}

// プロジェクト外のファイルを key base 配下（logicalPath の親）へ copy 取り込み（新 fileId・元は残す）。新 fileId / 失敗 ""。
function StdFolders_copyFileIntoStdPath_(key, fileId, logicalPath) {
  try {
    var target = StdFolders_ensureRefTargetFolder_(key, logicalPath);
    if (!target) return "";
    var src = DriveApp.getFileById(fileId);
    var copied = src.makeCopy(src.getName(), target);
    return copied.getId();
  } catch (err) {
    Logger.log("[StdFolders_copyFileIntoStdPath_] " + fileId + " -> " + key + ": " + nfbErrorToString_(err));
    return "";
  }
}

// 統一正規化器（ファイル参照）。物理優先→論理フォールバックで fileId を引き、配置を整える:
//   ホーム（key 配下）= 据置 / プロジェクト内の別フォルダ = move / プロジェクト外 = copy。
// 物理 URL と論理パスの両方を返す。戻り: { fileId, url, path, status }。
//   status: "aligned" | "moved" | "copiedExternal" | "recoveredByPath" | "unresolved" | "noop"
// unresolved/noop のとき呼出側は既存値を据え置く（throw しない・root 未解決でも安全に degrade）。
function StdFolders_alignFileRefIntoStdFolder_(key, physicalUrlOrId, logicalPath) {
  var lp = (typeof logicalPath === "string") ? logicalPath.trim() : "";
  var out = { fileId: "", url: "", path: lp, status: "unresolved" };

  // 1) 物理優先で解決（URL / 素の fileId 双方を受ける）。死亡/空なら論理パスで再解決。
  var fileId = "";
  var parsed = Forms_parseGoogleDriveUrl_(physicalUrlOrId);
  if (parsed && parsed.type === "file" && parsed.id) fileId = parsed.id;
  if ((!fileId || !StdFolders_isFileIdAlive_(fileId)) && lp) {
    var byPath = StdFolders_resolvePathToFileId_(key, lp);
    if (byPath && StdFolders_isFileIdAlive_(byPath)) {
      fileId = byPath;
      out.status = "recoveredByPath";
    }
  }
  if (!fileId || !StdFolders_isFileIdAlive_(fileId)) return out;  // unresolved（呼出側は据え置き）

  // 2) 配置（外部=copy / 内部別フォルダ=move / ホーム=据置）。
  var resultFileId = fileId;
  if (StdFolders_isFileInStdSubfolder_(fileId, key)) {
    if (out.status !== "recoveredByPath") out.status = "aligned";
  } else if (StdFolders_isFileUnderProjectRoot_(fileId)) {
    out.status = StdFolders_moveFileIntoStdPath_(key, fileId, lp) ? "moved" : "noop";
  } else {
    var copiedId = StdFolders_copyFileIntoStdPath_(key, fileId, lp);
    if (copiedId) { resultFileId = copiedId; out.status = "copiedExternal"; }
    else out.status = "noop";
  }

  // 3) url / path を導出して両方を返す。
  var f = null;
  try { f = DriveApp.getFileById(resultFileId); } catch (e) { f = null; }
  out.fileId = resultFileId;
  out.url = f ? f.getUrl() : ("https://drive.google.com/file/d/" + resultFileId + "/view");
  var derived = StdFolders_relativePathOfFile_(key, resultFileId);
  out.path = (derived !== null) ? derived : lp;
  return out;
}

// ---------------------------------------------
// 汎用（フォルダ版）: アップロード保存先フォルダ（06_upload_files）の論理パス↔folderId。
// 物理 folderUrl 優先 → 論理 folderPath フォールバック。外部=再帰copy（ファイル id を remap）/内部別=move。
// ---------------------------------------------

// folderId のフォルダが生存しているか（存在しゴミ箱でない）。
function StdFolders_isFolderIdAlive_(folderId) {
  return StdFolders_isNodeIdAlive_("folder", folderId);
}

// folderId（フォルダ）が ancestorId フォルダの子孫（自身含む）か。親チェーンを遡って判定（多親/循環保護）。
function StdFolders_isFolderUnderFolder_(folderId, ancestorId) {
  return StdFolders_isNodeUnderFolder_("folder", folderId, ancestorId);
}

function StdFolders_isFolderInStdSubfolder_(folderId, key) {
  return StdFolders_isNodeInStdSubfolder_("folder", folderId, key);
}

function StdFolders_isFolderUnderProjectRoot_(folderId) {
  return StdFolders_isNodeUnderProjectRoot_("folder", folderId);
}

// 論理パス（"フォルダ/.../葉フォルダ"）→ key サブフォルダ配下の folderId。葉もフォルダ。未解決は ""。
function StdFolders_resolveFolderPathToId_(key, path) {
  var segs = StdFolders_splitPathSegments_(path);
  if (!segs.length) return "";
  var base = StdFolders_autoFileFolderOrNull_(key);
  if (!base) return "";
  var parent = base;
  for (var i = 0; i < segs.length; i++) {
    var child = FormsDrive_childFolderByName_(parent, segs[i]);
    if (!child) return "";
    parent = child;
  }
  return parent.getId();
}

// key サブフォルダ配下にある folderId の論理パス（"フォルダ/.../葉フォルダ"、葉＝フォルダ名）。配下外は null。base 自身は ""。
function StdFolders_relativeFolderPathOf_(key, folderId) {
  if (!folderId) return null;
  var base = StdFolders_autoFileFolderOrNull_(key);
  if (!base) return null;
  try {
    var folder = DriveApp.getFolderById(folderId);
    if (folder.getId() === base.getId()) return "";
    var segs = StdFolders_relFolderSegsUnderBase_(folder, base.getId());
    if (segs === null) return null;
    var name = folder.getName();
    return segs.length ? (segs.join("/") + "/" + name) : name;
  } catch (e) {
    Logger.log("[StdFolders_relativeFolderPathOf_] " + folderId + " (" + key + "): " + nfbErrorToString_(e));
    return null;
  }
}

// 内部別フォルダのフォルダを key base 配下（logicalPath の親）へ move（folderId 保持）。成否を返す。
function StdFolders_moveFolderIntoStdPath_(key, folderId, logicalPath) {
  try {
    var target = StdFolders_ensureRefTargetFolder_(key, logicalPath);
    if (!target) return false;
    DriveApp.getFolderById(folderId).moveTo(target);
    return true;
  } catch (err) {
    Logger.log("[StdFolders_moveFolderIntoStdPath_] " + folderId + " -> " + key + ": " + nfbErrorToString_(err));
    return false;
  }
}

// src フォルダを destParent 配下へ再帰コピーし、ファイルの old→new fileId を idMap に積む。ノード/深さ上限で保護。
function StdFolders_copyFolderTreeShallow_(srcFolder, destParent, idMap, guard) {
  if (guard.count >= guard.max || guard.depth > guard.maxDepth) return null;
  var dest = destParent.createFolder(srcFolder.getName());
  var files = srcFolder.getFiles();
  while (files.hasNext()) {
    if (guard.count >= guard.max) break;
    var f = files.next();
    if (typeof f.isTrashed === "function" && f.isTrashed()) continue;
    var copied = f.makeCopy(f.getName(), dest);
    idMap[f.getId()] = copied.getId();
    guard.count++;
  }
  var subs = srcFolder.getFolders();
  while (subs.hasNext()) {
    if (guard.count >= guard.max) break;
    var sf = subs.next();
    if (typeof sf.isTrashed === "function" && sf.isTrashed()) continue;
    guard.depth++;
    StdFolders_copyFolderTreeShallow_(sf, dest, idMap, guard);
    guard.depth--;
  }
  return dest;
}

// プロジェクト外のフォルダを key base 配下（logicalPath の親）へ再帰 copy 取り込み（新 folderId・元は残す）。
// 戻り: { folderId, idMap } / 失敗 null。
function StdFolders_copyFolderIntoStdPath_(key, folderId, logicalPath) {
  try {
    var targetParent = StdFolders_ensureRefTargetFolder_(key, logicalPath);
    if (!targetParent) return null;
    var src = DriveApp.getFolderById(folderId);
    var idMap = {};
    var guard = { count: 0, max: 1000, depth: 0, maxDepth: 20 };
    var newFolder = StdFolders_copyFolderTreeShallow_(src, targetParent, idMap, guard);
    if (!newFolder) return null;
    return { folderId: newFolder.getId(), idMap: idMap };
  } catch (err) {
    Logger.log("[StdFolders_copyFolderIntoStdPath_] " + folderId + " -> " + key + ": " + nfbErrorToString_(err));
    return null;
  }
}

// key 標準フォルダの base フォルダ fileId をリクエストスコープでメモ化して返す（未解決は ""）。
// 1 レコード保存で複数 fileUpload セルを処理する際の base 解決を 1 回に集約する。
// リクエストキャッシュ（formsCrud.gs で宣言）が無い文脈（限定ロードの単体テスト等）では
// メモ化せず直接解決する（typeof ガードで未宣言参照の例外を避ける）。
function StdFolders_baseFolderIdCached_(key) {
  var hasCache = (typeof __NFB_STD_BASE_ID_CACHE__ !== "undefined") && __NFB_STD_BASE_ID_CACHE__;
  if (hasCache && Object.prototype.hasOwnProperty.call(__NFB_STD_BASE_ID_CACHE__, key)) {
    return __NFB_STD_BASE_ID_CACHE__[key];
  }
  var base = StdFolders_autoFileFolderOrNull_(key);
  var id = base ? base.getId() : "";
  if (hasCache) __NFB_STD_BASE_ID_CACHE__[key] = id;
  return id;
}

// 物理優先 fast-path 用のプローブ。folderUrl が key 標準フォルダ base「直下」の生存フォルダを指すなら
// その Folder を返す（＝ move/copy/祖先判定/相対パス再走査が不要な正常系）。それ以外は null（フル align へ）。
// Drive 往復は最小（getFolderById 1 + getParents 1）。base id はリクエストキャッシュで償却する。
// 解決過程の例外（死亡/権限喪失/環境不備）はすべて null に倒し、フル align へ安全に degrade する。
function StdFolders_uploadCellInPlaceFolderOrNull_(folderUrl, key) {
  try {
    var parsed = Forms_parseGoogleDriveUrl_(folderUrl);
    if (!parsed || parsed.type !== "folder" || !parsed.id) return null;
    var baseId = StdFolders_baseFolderIdCached_(key);
    if (!baseId) return null;                          // base 未解決 → フル align に degrade
    var folder = DriveApp.getFolderById(parsed.id);    // 死亡なら throw
    if (typeof folder.isTrashed === "function" && folder.isTrashed()) return null;
    var parents = folder.getParents();
    if (!parents.hasNext()) return null;
    var first = parents.next();
    if (parents.hasNext()) return null;                // 多親は fast-path 対象外
    if (first.getId() !== baseId) return null;         // base 直下でない → move/copy が要る
    return folder;
  } catch (e) {
    return null;
  }
}

// 統一正規化器（フォルダ参照）。物理優先→論理フォールバックで folderId を引き、配置を整える:
//   ホーム（key 配下）= 据置 / プロジェクト内の別フォルダ = move / プロジェクト外 = 再帰copy。
// 物理 URL と論理パスの両方を返す。戻り: { folderId, url, path, status, idMap }。
//   status: "aligned" | "moved" | "copiedExternal" | "recoveredByPath" | "unresolved" | "noop"
function StdFolders_alignFolderRefIntoStdFolder_(key, folderUrlOrId, logicalPath) {
  var lp = (typeof logicalPath === "string") ? logicalPath.trim() : "";
  var out = { folderId: "", url: "", path: lp, status: "unresolved", idMap: null };

  var folderId = "";
  var parsed = Forms_parseGoogleDriveUrl_(folderUrlOrId);
  if (parsed && parsed.type === "folder" && parsed.id) folderId = parsed.id;
  // 物理生存判定は 1 回だけ（旧コードは同一 folderId に対し isFolderIdAlive_ を二重・三重呼びしていた）。
  var alive = folderId ? StdFolders_isFolderIdAlive_(folderId) : false;
  if (!alive && lp) {
    var byPath = StdFolders_resolveFolderPathToId_(key, lp);
    if (byPath && StdFolders_isFolderIdAlive_(byPath)) {
      folderId = byPath;
      alive = true;
      out.status = "recoveredByPath";
    }
  }
  if (!alive) return out;

  var resultFolderId = folderId;
  if (StdFolders_isFolderInStdSubfolder_(folderId, key)) {
    if (out.status !== "recoveredByPath") out.status = "aligned";
  } else if (StdFolders_isFolderUnderProjectRoot_(folderId)) {
    out.status = StdFolders_moveFolderIntoStdPath_(key, folderId, lp) ? "moved" : "noop";
  } else {
    var copied = StdFolders_copyFolderIntoStdPath_(key, folderId, lp);
    if (copied && copied.folderId) {
      resultFolderId = copied.folderId;
      out.idMap = copied.idMap;
      out.status = "copiedExternal";
    } else {
      out.status = "noop";
    }
  }

  var fo = null;
  try { fo = DriveApp.getFolderById(resultFolderId); } catch (e) { fo = null; }
  out.folderId = resultFolderId;
  out.url = fo ? fo.getUrl() : ("https://drive.google.com/drive/folders/" + resultFolderId);
  var derived = StdFolders_relativeFolderPathOf_(key, resultFolderId);
  out.path = (derived !== null) ? derived : lp;
  return out;
}

// レコード保存時: fileUpload セル（{files, folderUrl, folderName}）のフォルダを 06_upload_files へ寄せ、
// 物理 folderUrl と論理 folderName を両方更新する（フォルダはフォルダの二重持ち）。外部コピー時は
// files[].driveFileId/Url を新 id へ remap（ファイルはファイルの二重持ち・論理は name の葉のみ＝
// フォルダ名をファイル論理パスに混ぜない）。folderPath は旧 normalize が書いた残骸で、読みフォール
// バックのみ（新規書き込みせず再保存時に除去）。対象でない値（非 JSON / フォルダ参照なし）や解決不能はそのまま返す。
function StdFolders_normalizeUploadCellValue_(rawValue) {
  if (typeof rawValue !== "string" || !rawValue) return rawValue;
  var trimmed = rawValue.trim();
  if (trimmed.charAt(0) !== "{") return rawValue;  // object 形のみ（素配列 / マーカーは対象外）
  var obj;
  try { obj = JSON.parse(trimmed); } catch (e) { return rawValue; }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return rawValue;
  if (!Array.isArray(obj.files)) return rawValue;  // fileUpload セルは必ず files 配列を持つ（誤検出防止）
  var folderUrl = (typeof obj.folderUrl === "string") ? obj.folderUrl : "";
  // 論理パスは folderName（フロント serializeFileUploadValue / resolver / コピー時クリアと統一）。
  // folderPath フォールバック前に「元から folderName を持っていたか」を捕捉する（fast-path の gate）。
  var hadFolderName = (typeof obj.folderName === "string" && obj.folderName.trim() !== "");
  // 旧 normalize が書いた folderPath があれば読みフォールバックに使う（新規には書かない）。
  var folderName = (typeof obj.folderName === "string") ? obj.folderName : "";
  if (!folderName && typeof obj.folderPath === "string") folderName = obj.folderPath;
  if (!folderUrl && !folderName) return rawValue;

  // 物理優先 fast-path: folderUrl が 06 直下の生存フォルダを指し、folderName が既にあるなら、
  // move/copy/祖先判定/相対パス再走査（Drive 往復 ~8-12 回）を省略して据え置く。論理パスは既にセルに
  // あるので「スプレッドシート書込時に必ず保存」も満たす。変化があるとき（URL 正準化 / folderPath 残骸）
  // のみ再直列化し、無変化なら元文字列を返す（冪等・書き戻し churn 回避）。
  if (folderUrl && hadFolderName) {
    var inPlace = StdFolders_uploadCellInPlaceFolderOrNull_(folderUrl, "upload");
    if (inPlace) {
      var canonicalUrl = inPlace.getUrl();
      var changed = false;
      if (obj.folderUrl !== canonicalUrl) { obj.folderUrl = canonicalUrl; changed = true; }
      if ("folderPath" in obj) { delete obj.folderPath; changed = true; }
      return changed ? JSON.stringify(obj) : rawValue;
    }
  }

  var aligned = StdFolders_alignFolderRefIntoStdFolder_("upload", folderUrl, folderName);
  if (aligned.status === "unresolved" || aligned.status === "noop") return rawValue;

  obj.folderUrl = aligned.url;
  obj.folderName = aligned.path;                    // 06 直下のフラットなフォルダ名（＝folderName）
  if ("folderPath" in obj) delete obj.folderPath;   // 旧残骸を除去し folderName へ一本化（冗長性削減）
  if (aligned.idMap && Array.isArray(obj.files)) {
    for (var i = 0; i < obj.files.length; i++) {
      var fe = obj.files[i];
      if (fe && typeof fe === "object" && fe.driveFileId && aligned.idMap[fe.driveFileId]) {
        var newId = aligned.idMap[fe.driveFileId];
        fe.driveFileId = newId;
        fe.driveFileUrl = "https://drive.google.com/file/d/" + newId + "/view";
      }
    }
  }
  return JSON.stringify(obj);
}

// ctx.responses の各セルから fileUpload セルを検出し、アップロードフォルダを 06 へ正規化する。
function StdFolders_normalizeUploadCellsInResponses_(responses) {
  if (!responses || typeof responses !== "object") return;
  for (var k in responses) {
    if (!Object.prototype.hasOwnProperty.call(responses, k)) continue;
    var v = responses[k];
    if (typeof v !== "string") continue;
    if (v.indexOf("folderUrl") === -1 && v.indexOf("folderName") === -1 && v.indexOf("folderPath") === -1) continue;  // 安いプリフィルタ
    responses[k] = StdFolders_normalizeUploadCellValue_(v);
  }
}

// 保存時: フォーム全体（settings.standardPrintTemplate*）+ カード個別（printTemplateAction）の
// 印刷様式 Doc 参照を 05_report_templates へ寄せ、物理 fileId と論理パスを両方更新する（外部=copy/内部=move）。
// 物理は素の fileId（*Id）で永続化し、旧 *Url キーは保存時に剥がす（前進移行）。
// 解決不能（unresolved/noop）の参照は据え置く。form を直接 mutate する。base 未解決なら全 no-op。
function StdFolders_normalizePrintTemplateRefsOnSave_(form) {
  var relocations = [];   // 逆方向再リンク用: 再配置した様式 Doc の {oldFileId, newId, newPath}
  if (!form || typeof form !== "object") return relocations;

  var settings = (form.settings && typeof form.settings === "object" && !Array.isArray(form.settings)) ? form.settings : null;
  if (settings) {
    var su = Nfb_resolveTemplateRefId_(settings, "standardPrintTemplateId", "standardPrintTemplateUrl");
    var sp = Nfb_trimStr_(settings.standardPrintTemplatePath);
    if (su || sp) {
      var sr = StdFolders_alignFileRefIntoStdFolder_("report_templates", su, sp);
      if (sr.status !== "unresolved" && sr.status !== "noop") {
        StdFolders_recordTemplateRelocation_(relocations, su, sr);
        settings.standardPrintTemplateId = sr.fileId;   // 物理は素の fileId
        settings.standardPrintTemplatePath = sr.path;
        delete settings.standardPrintTemplateUrl;        // 旧 URL キーを剥がす（前進移行）
      }
    }
  }

  StdFolders_walkFields_(form.schema, function(fld) {
    if (!fld || typeof fld !== "object") return;
    var act = fld.printTemplateAction;
    if (!act || typeof act !== "object" || !act.useCustomTemplate) return;
    var cu = Nfb_resolveTemplateRefId_(act, "templateId", "templateUrl");
    var cp = Nfb_trimStr_(act.templatePath);
    if (!cu && !cp) return;
    var cr = StdFolders_alignFileRefIntoStdFolder_("report_templates", cu, cp);
    if (cr.status !== "unresolved" && cr.status !== "noop") {
      StdFolders_recordTemplateRelocation_(relocations, cu, cr);
      act.templateId = cr.fileId;                        // 物理は素の fileId
      act.templatePath = cr.path;
      delete act.templateUrl;                            // 旧 URL キーを剥がす（前進移行）
    }
  });
  return relocations;
}

// 印刷様式参照の整合結果が「再配置（move/外部コピー）」のとき、旧 fileId→新 id/path を relocations に記録する。
// 旧参照（素 id / URL）から fileId を解けないものはスキップ（path のみ指定など＝外部の旧 id を持たない）。
function StdFolders_recordTemplateRelocation_(relocations, oldIdOrUrl, result) {
  if (!result || (result.status !== "moved" && result.status !== "copiedExternal")) return;
  var oldId = Nfb_extractTemplateFileId_(oldIdOrUrl);
  if (!oldId) return;
  relocations.push({ oldFileId: oldId, newId: result.fileId, newPath: result.path });
}

// 印刷様式（05）参照の逆方向再リンク。あるフォームの保存で様式 Doc が再配置されたとき、同じ Doc を
// 旧 fileId で指す「他フォーム」の templateUrl/templatePath を新しい位置へ張り替える。
// forms マッピング限定の有界走査（重い全レコード走査はしない）。冪等（一致しない/既に新値なら書かない）。
// 戻り: 書き換えたフォーム件数。
function StdFolders_propagateTemplateRelinkToForms_(relocations, skipFileId) {
  if (!relocations || !relocations.length) return 0;
  var byOldId = {};
  for (var i = 0; i < relocations.length; i++) {
    if (relocations[i] && relocations[i].oldFileId) byOldId[relocations[i].oldFileId] = relocations[i];
  }
  if (!nfbHasOwnKeys_(byOldId)) return 0;
  var adapter = StdFolders_entityAdapter_("forms");
  if (!adapter.baseFolderOrNull()) return 0;
  var mapping = adapter.getMapping();
  var relinked = 0;
  for (var id in mapping) {
    if (!mapping.hasOwnProperty(id)) continue;
    var fileId = Nfb_resolveFileIdFromEntry_(mapping[id]);
    if (!fileId || fileId === skipFileId) continue;
    if (StdFolders_rewriteTemplateRefsInForm_(fileId, byOldId)) relinked++;
  }
  return relinked;
}

// byOldId（旧 fileId→{newId,newPath}）で、fileId のフォーム json 内の様式参照（settings + カード）を張り替える。
function StdFolders_rewriteTemplateRefsInForm_(fileId, byOldId) {
  try {
    var file = DriveApp.getFileById(fileId);
    if (typeof file.isTrashed === "function" && file.isTrashed()) return false;
    var json = JSON.parse(file.getBlob().getDataAsString());
    var changed = false;
    var settings = (json.settings && typeof json.settings === "object" && !Array.isArray(json.settings)) ? json.settings : null;
    if (settings) {
      var hit = StdFolders_matchTemplateReloc_(byOldId, Nfb_resolveTemplateRefId_(settings, "standardPrintTemplateId", "standardPrintTemplateUrl"));
      if (hit && (settings.standardPrintTemplateId !== hit.newId || settings.standardPrintTemplatePath !== hit.newPath)) {
        settings.standardPrintTemplateId = hit.newId;
        settings.standardPrintTemplatePath = hit.newPath;
        delete settings.standardPrintTemplateUrl;
        changed = true;
      }
    }
    StdFolders_walkFields_(json.schema, function(fld) {
      if (!fld || typeof fld !== "object") return;
      var act = fld.printTemplateAction;
      if (!act || typeof act !== "object") return;
      var h = StdFolders_matchTemplateReloc_(byOldId, Nfb_resolveTemplateRefId_(act, "templateId", "templateUrl"));
      if (h && (act.templateId !== h.newId || act.templatePath !== h.newPath)) {
        act.templateId = h.newId;
        act.templatePath = h.newPath;
        delete act.templateUrl;
        changed = true;
      }
    });
    if (changed) { file.setContent(JSON.stringify(json, null, 2)); return true; }
  } catch (e) {
    Logger.log("[StdFolders_rewriteTemplateRefsInForm_] " + fileId + ": " + nfbErrorToString_(e));
  }
  return false;
}

// 様式参照（素 id / URL）の fileId を解いて byOldId に一致する relocation を返す。一致なし/解決不能は null。
function StdFolders_matchTemplateReloc_(byOldId, idOrUrl) {
  var id = Nfb_extractTemplateFileId_(idOrUrl);
  if (!id) return null;
  return byOldId[id] || null;
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


// 論理パス（folder + 名前）から、物理 fileId を含まない一意なエクスポートキーを作る。
// 同一 folder+名前 が衝突したら連番サフィックス（#2, #3…）で一意化し、JSON 上書きによる
// エントリ欠落を防ぐ（インポート時は値の folder+名前 で再解決するためキー自体は識別子ではない）。
function StdFolders_logicalExportKey_(folder, name, usedKeys) {
  var base = (folder ? folder + "/" : "") + name;
  var key = base, n = 2;
  while (usedKeys[key]) { key = base + "#" + n; n++; }
  usedKeys[key] = true;
  return key;
}

// マッピング（id → entry）を「論理パスのみ」（fileId / driveFileUrl を含まない）の転送形へ変換する。
// version 2 のエクスポート/コピー一覧は物理 fileId を持たせず、folder ＋ 名前（nameKey）だけを運ぶ。
// 出力のキーも論理パス（StdFolders_logicalExportKey_）にして、本番 registry の fileId キーを引き回さない。
// 別プロジェクトへ取り込んだときにコピー先ツリーを走査して論理パス→ローカル fileId を解決するため、
// コピー元の fileId を一切引き回さない（＝コピー後にコピー元ファイルを指す事故を防ぐ）。
// 名前（nameKey）が空のエントリは論理パスを作れないため除外する。
function StdFolders_toPathOnlySection_(mapping, nameKey) {
  var out = {};
  var usedKeys = {};
  if (!mapping || typeof mapping !== "object") return out;
  for (var id in mapping) {
    if (!mapping.hasOwnProperty(id)) continue;
    var entry = mapping[id] || {};
    var name = entry[nameKey];
    if (typeof name !== "string" || !name) continue;
    var next = {};
    next[nameKey] = name;
    next.folder = (typeof entry.folder === "string") ? entry.folder : "";
    out[StdFolders_logicalExportKey_(next.folder, name, usedKeys)] = next;
  }
  return out;
}

// 現在のマッピング（3 マッピング ＋ フォルダ登録簿）を _nfb_mapping.json 形（version 2・論理パスのみ）で返す。
// 取り込み時にコピー復元ゲートを発火させるため isCopy:true を付すが、源の物理 ID（ルート/ fileId）は一切含めない。
function StdFolders_exportMapping_() {
  return nfbSafeCall_(function() {
    var doc = {
      type: "nfb-mapping",
      version: 2,
      exportedAt: new Date().toISOString(),
      isCopy: true,
      forms: StdFolders_toPathOnlySection_(Forms_getMapping_(), "title"),
      questions: StdFolders_toPathOnlySection_(Analytics_getMapping_("questions"), "name"),
      dashboards: StdFolders_toPathOnlySection_(Analytics_getMapping_("dashboards"), "name"),
      folders: {
        forms: Forms_getFolders_(),
        questions: Analytics_getFolders_("questions"),
        dashboards: Analytics_getFolders_("dashboards")
      }
    };
    return { ok: true, mapping: doc };
  });
}

// version 2（fileId を持たない論理パスのみ）のエントリを、コピー先ツリーを走査して
// ローカル fileId へ解決する。entry.folder ＋ 名前（nameField）で物理ファイル（"名前.json"）を探す。
// 解決できなければ null（呼び出し側は未取込としてスキップ）。adapter は StdFolders_entityAdapter_(kind)。
// 戻り: 見つかった Drive File（呼び出し側が getId()/getUrl() を読む）。
function StdFolders_resolveEntryFileByPath_(adapter, entry, nameField) {
  if (!adapter || !entry) return null;
  var name = entry[nameField];
  if (typeof name !== "string" || !name) return null;
  // folder は SharedDrive 側で正規化されるためここでは生のまま渡す（null は "" 扱い）。
  var folder = (typeof entry.folder === "string") ? entry.folder : "";
  var folderObj = adapter.lookupFolderForPath(folder);
  if (!folderObj) return null;
  return StdFolders_findFileByNameInFolder_(folderObj, name + ".json");
}

// 1 セクションを既存ストアへマージする共通処理。fileId 重複はスキップ。
//   doc          : インポート元セクション（id → entry）
//   existingMapping: 既存 mapping（破壊的に追記する）
//   normalizeEntry : (rawEntry) => 正規化済み { fileId|null, driveFileUrl|null, <nameField>, folder }
//   onNew          : (keyId, driveFileUrl) => 取り込み時の副作用（forms の URL マップ登録など）。任意。
//   adapter        : 論理パス解決用 StdFolders_entityAdapter_(kind)。version 2（fileId 無し）で使う。任意。
//   nameField      : "title"（forms）/ "name"（questions/dashboards）。
// version 1（fileId/driveFileUrl 同梱）はそのまま id キーで登録。version 2（論理パスのみ）は
// folder ＋ 名前からローカル fileId を解決し、解決後 fileId をキー兼 fileId 値として登録する
// （id ＝ fileId 統一。コピー元 id は捨てる）。解決不能は登録せず errors に積む（未取込＝空）。
// 戻り: { imported, skipped, errors }（errors は { section, id, reason }）。
function StdFolders_mergeMappingSection_(section, doc, existingMapping, normalizeEntry, onNew, adapter, nameField) {
  var result = { imported: 0, skipped: 0, errors: [] };
  if (!doc || typeof doc !== "object") return result;
  var mappedFileIds = StdFolders_mappedFileIdSet_(existingMapping);
  for (var id in doc) {
    if (!doc.hasOwnProperty(id)) continue;
    try {
      var entry = normalizeEntry(doc[id] || {});
      var fileId = Nfb_resolveFileIdFromEntry_(entry);
      var keyId = id;
      var urlForMap = entry.driveFileUrl || null;
      if (!fileId && adapter) {
        // version 2: 論理パス（folder + 名前）からローカル fileId を解決。解決後 fileId をキーにする。
        var file = StdFolders_resolveEntryFileByPath_(adapter, entry, nameField);
        if (file) {
          fileId = file.getId();
          keyId = fileId;
          entry.fileId = fileId;
          try { urlForMap = file.getUrl(); } catch (eUrl) { urlForMap = urlForMap || null; }
          if (urlForMap) entry.driveFileUrl = urlForMap;
        }
      }
      if (!fileId) {
        // version 2 で論理パスが解決できない（コピー先に該当ファイルが無い）→ 未取込（空）。
        result.errors.push({ section: section, id: id, reason: "論理パスを解決できません（未取込）" });
        continue;
      }
      if (mappedFileIds[fileId]) { result.skipped++; continue; }
      existingMapping[keyId] = entry;
      mappedFileIds[fileId] = true;
      if (onNew) onNew(keyId, urlForMap);
      result.imported++;
    } catch (err) {
      result.errors.push({ section: section, id: id, reason: nfbErrorToString_(err) });
    }
  }
  return result;
}

// パース済みドキュメントを既存マッピングへマージする。
// version 1（fileId 同梱）は純マージ。version 2（論理パスのみ）はコピー先ツリーを走査して
// 論理パス→ローカル fileId を解決してから登録する（解決不能は未取込＝空）。
// type/version 不一致は throw せず { ok:false, error } を返す。
function StdFolders_importMapping_(doc) {
  if (!doc || typeof doc !== "object" || doc.type !== "nfb-mapping" || (doc.version !== 1 && doc.version !== 2)) {
    return { ok: false, error: "対応していないマッピング形式です（type/version 不一致）" };
  }

  // コピー先 初回解決ゲート: コピー由来のドキュメント（isCopy フラグ／旧形式の sourceRootId）を取り込むときは、
  // 個別リンク解決の前に registry を物理フォルダ走査で充填する（type はフォルダ位置で確定）。
  // プロジェクトコピーは物理を全消去するため、これで論理→物理の一括再解決の土台を作る。
  var isCopyRestore = !!((doc.isCopy || doc.sourceRootId) && typeof Admin_rebuildRegistryFromLogical_ === "function");
  if (isCopyRestore) {
    try { Admin_rebuildRegistryFromLogical_(); }
    catch (eRebuild) { Logger.log("[StdFolders_importMapping_] rebuild gate failed: " + nfbErrorToString_(eRebuild)); }
  }

  var imported = { forms: 0, questions: 0, dashboards: 0 };
  var skipped = 0;
  var errors = [];

  // forms
  var formsMapping = Forms_getMapping_();
  var formsRes = StdFolders_mergeMappingSection_(
    "forms", doc.forms, formsMapping,
    function(e) { return { fileId: e.fileId || null, driveFileUrl: e.driveFileUrl || null, title: e.title || null, folder: (typeof e.folder === "string") ? e.folder : null }; },
    function(keyId, url) { try { if (url) AddFormUrl_(keyId, url); } catch (e) { /* non-critical */ } },
    StdFolders_entityAdapter_("forms"), "title"
  );
  Forms_saveMapping_(formsMapping);
  imported.forms = formsRes.imported; skipped += formsRes.skipped; errors = errors.concat(formsRes.errors);

  // questions / dashboards
  ["questions", "dashboards"].forEach(function(type) {
    var mapping = Analytics_getMapping_(type);
    var res = StdFolders_mergeMappingSection_(
      type, doc[type], mapping,
      function(e) { return { fileId: e.fileId || null, driveFileUrl: e.driveFileUrl || null, name: e.name || null, folder: (typeof e.folder === "string") ? e.folder : null }; },
      null,
      StdFolders_entityAdapter_(type), "name"
    );
    Analytics_saveMapping_(type, mapping);
    imported[type] = res.imported; skipped += res.skipped; errors = errors.concat(res.errors);
  });

  // フォルダ登録簿（既存と union）
  var folders = doc.folders || {};
  if (Array.isArray(folders.forms)) Forms_saveFolders_(Forms_getFolders_().concat(folders.forms));
  if (Array.isArray(folders.questions)) Analytics_saveFoldersRegistry_("questions", Analytics_getFolders_("questions").concat(folders.questions));
  if (Array.isArray(folders.dashboards)) Analytics_saveFoldersRegistry_("dashboards", Analytics_getFolders_("dashboards").concat(folders.dashboards));

  // コピー先 初回解決ゲート（後段）: コピー由来の取り込みでは、物理を全消去された参照
  // （エンティティ id / spreadsheet / 印刷様式）を *Path から一括再解決して物理を貼り直す。
  // registry は上の rebuild で充填済みなので論理パスがローカル fileId へ解決できる。
  var reresolved = null;
  if (isCopyRestore && typeof Admin_reresolveAllRefsFromLogical_ === "function") {
    try { reresolved = Admin_reresolveAllRefsFromLogical_(); }
    catch (eRe) { Logger.log("[StdFolders_importMapping_] reresolve gate failed: " + nfbErrorToString_(eRe)); }
  }

  // インポートは「マッピング JSON のマージ」と、コピー復元時の論理→物理 再解決を行う。
  // 通常インポートで取り込んだエントリの物理配置や壊れたリンクの修復は、各エンティティを次に保存した
  // 際のサーバ側自動リンク補完（alignReferencesOnSave_）が担う。
  var out = { ok: true, imported: imported, skipped: skipped, errors: errors };
  if (reresolved) out.reresolved = reresolved;
  return out;
}

// インポートのソースを解決して取り込む。
//   payload.url 非空 : その Drive ファイル（マッピング JSON）を読む。
//   payload.url 空   : ルート直下の非ゴミ箱 .json から getLastUpdated() が最新の 1 件を読む。
function StdFolders_importMappingFromSource_(payload) {
  return nfbSafeCall_(function() {
    var url = payload ? Nfb_trimStr_(payload.url) : "";
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
function nfbAlignAllStdFolders(payload)      { return Nfb_runScriptAction_("std_folders_align_all", payload || {}); }
function nfbListReportTemplates(payload)     { return Nfb_runScriptAction_("report_templates_list", payload || {}); }
function nfbListSpreadsheets(payload)         { return Nfb_runScriptAction_("spreadsheets_list", payload || {}); }

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
    var manualRootUrl = payload ? Nfb_trimStr_(payload.rootUrl) : "";
    var root = StdFolders_resolveRootFolder_(manualRootUrl);
    StdFolders_ensureAllSubfolders_(root);
    return { ok: true, rootId: root.getId(), rootUrl: root.getUrl(), rootName: root.getName() };
  });
}
