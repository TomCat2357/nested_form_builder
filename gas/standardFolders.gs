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
// import 用: 構成内判定 + 構成外ならコピー
// ---------------------------------------------

// fileId のファイルが、解決済みルートの key サブフォルダ直下に在るか判定する。
// ルート未解決時は false（= 構成外扱い）。
function StdFolders_isFileInStdSubfolder_(fileId, key) {
  try {
    var root = StdFolders_resolveRootFolder_(null);
    var sub = StdFolders_getOrCreateSubfolder_(root, key);
    var subId = sub.getId();
    var parents = DriveApp.getFileById(fileId).getParents();
    while (parents.hasNext()) {
      if (parents.next().getId() === subId) return true;
    }
  } catch (err) {
    Logger.log("[StdFolders_isFileInStdSubfolder_] " + fileId + " (" + key + "): " + nfbErrorToString_(err));
  }
  return false;
}

// import 時に、構成内ファイルはそのまま、構成外ファイルは key サブフォルダへコピーして
// コピー先の { fileId, fileUrl } を返す。ルート未解決時は元のまま（従来の参照取り込み）。
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
  try {
    var root = StdFolders_resolveRootFolder_(null);
    var sub = StdFolders_getOrCreateSubfolder_(root, key);
    var src = DriveApp.getFileById(fileId);
    var copied = src.makeCopy(src.getName(), sub);
    return { fileId: copied.getId(), fileUrl: copied.getUrl() };
  } catch (err) {
    // ルート未解決などでコピーできない場合は元ファイル参照のまま登録（従来挙動）。
    Logger.log("[StdFolders_ensureFileInStdFolder_] コピー不可、参照のまま (" + key + "): " + nfbErrorToString_(err));
    return fallback;
  }
}

// ---------------------------------------------
// 既リンク資産の標準フォルダ正規化スイープ
// インポート / 同期の実行時に、既にマッピング登録済み（= 既リンク）の
// フォーム・Question・Dashboard を走査し、ファイル本体が標準フォルダ構成の外に
// あるものは該当サブフォルダへ「コピー」（元ファイルは残す）して、マッピングの
// リンクをコピー先へ張り替える。Dashboard をコピーしたときは、その cards[].questionId
// が指す Question も構成内か確認し、構成外なら同様にコピーする（連動コピー）。
// ---------------------------------------------

// mapping entry の参照ファイルを key サブフォルダ内へ揃える。
// 構成内ならそのまま { changed:false }。構成外でコピーが成立したときだけ
// { changed:true, newFileId, newUrl } を返す（呼び出し側で entry を更新する）。
// ルート未解決等で実際にコピーできなかった場合は changed:false（安全側）。
function StdFolders_ensureMappingEntryInStd_(entry, key) {
  var oldFileId = Nfb_resolveFileIdFromEntry_(entry);
  if (!oldFileId) return { changed: false };
  if (StdFolders_isFileInStdSubfolder_(oldFileId, key)) return { changed: false };
  var placed = StdFolders_ensureFileInStdFolder_(oldFileId, key);
  if (!placed || !placed.fileId || placed.fileId === oldFileId) {
    return { changed: false };
  }
  return { changed: true, newFileId: placed.fileId, newUrl: placed.fileUrl };
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

// key サブフォルダ（例 01_forms）配下の JSON を（サブフォルダ含め再帰的に）走査し、
// 各ファイルのファイル名（.json 除去）をキーに { name: { fileId, fileUrl } } のインデックスを返す。
// id ＝ fileId / 名前 ＝ ファイル名 へ統一したため、壊れたリンク（参照 fileId 消失）の
// 再リンク先はキャッシュ名で名前解決する。同名が複数あれば先勝ち。ルート未解決時は空。
function StdFolders_indexStdFolderByName_(key) {
  var index = {};
  try {
    var root = StdFolders_resolveRootFolder_(null);
    var sub = StdFolders_getOrCreateSubfolder_(root, key);
    StdFolders_indexFolderByNameRecursive_(sub, index);
  } catch (err) {
    Logger.log("[StdFolders_indexStdFolderByName_] " + key + ": " + nfbErrorToString_(err));
  }
  return index;
}

function StdFolders_indexFolderByNameRecursive_(folder, index) {
  var files = folder.getFiles();
  while (files.hasNext()) {
    var file = files.next();
    if (typeof file.isTrashed === "function" && file.isTrashed()) continue;
    if (!StdFolders_isJsonFile_(file)) continue;
    var name = Nfb_nameFromFileName_(file.getName());
    if (name && !index[name]) index[name] = { fileId: file.getId(), fileUrl: file.getUrl() };
  }
  var subs = folder.getFolders();
  while (subs.hasNext()) {
    var sub = subs.next();
    if (typeof sub.isTrashed === "function" && sub.isTrashed()) continue;
    StdFolders_indexFolderByNameRecursive_(sub, index);
  }
}

// mapping[id] の 1 エントリを修復する。戻り値: "normalized" | "relinked" | "removed" | "none"。
//   - 参照ファイルが生存: 従来どおり構成外なら std サブフォルダへコピーして張替え（"normalized"）。
//   - 壊れたリンク: 埋め込み id インデックス（indexProvider() で遅延取得）に同 id があれば
//     そのファイルへ再リンク（"relinked"）、無ければ mapping から削除（"removed"）。
// 変更が成立したら onChange(id, entry) を呼ぶ（削除時は呼ばない）。
function StdFolders_repairMappingEntry_(mapping, id, key, indexProvider, onChange) {
  var entry = mapping[id];
  if (!entry) return "none";
  var oldFileId = Nfb_resolveFileIdFromEntry_(entry);
  if (oldFileId && StdFolders_isFileIdAlive_(oldFileId)) {
    var r = StdFolders_ensureMappingEntryInStd_(entry, key);
    if (r.changed) {
      entry.fileId = r.newFileId;
      entry.driveFileUrl = r.newUrl;
      if (onChange) onChange(id, entry);
      return "normalized";
    }
    return "none";
  }
  // ここから壊れたリンク（参照ファイルが取得不能 / ゴミ箱）。
  // id ＝ fileId なので、キャッシュした名前（title/name）で標準フォルダを名前解決し、
  // 生きているファイルが見つかれば その fileId をキーに張り替える（id を再採用）。
  var cachedName = entry.title || entry.name || "";
  var hit = cachedName ? indexProvider()[cachedName] : null;
  if (hit) {
    delete mapping[id];
    entry.fileId = hit.fileId;
    entry.driveFileUrl = hit.fileUrl;
    mapping[hit.fileId] = entry;
    if (onChange) onChange(hit.fileId, entry);
    return "relinked";
  }
  delete mapping[id];
  return "removed";
}

// mapping 全体を走査して修復・正規化する。戻り: { normalized, relinked, removed, removedIds }。
// インデックスは壊れたリンクが出たときだけ一度だけ生成する（無駄な Drive 走査を避ける）。
function StdFolders_repairAndNormalizeMapping_(mapping, key, onChange) {
  var counts = { normalized: 0, relinked: 0, removed: 0, removedIds: [] };
  var cachedIndex = null;
  var provider = function() {
    if (cachedIndex === null) cachedIndex = StdFolders_indexStdFolderByName_(key);
    return cachedIndex;
  };
  for (var id in mapping) {
    if (!mapping.hasOwnProperty(id)) continue;
    var outcome = StdFolders_repairMappingEntry_(mapping, id, key, provider, onChange);
    if (outcome === "normalized") counts.normalized++;
    else if (outcome === "relinked") counts.relinked++;
    else if (outcome === "removed") { counts.removed++; counts.removedIds.push(id); }
  }
  return counts;
}

// Dashboard ファイル JSON から cards[].questionId を集めて out（id の集合）へ追加する。
function StdFolders_collectDashboardQuestionIds_(fileId, out) {
  try {
    var file = DriveApp.getFileById(fileId);
    var json = JSON.parse(file.getBlob().getDataAsString());
    if (json && Array.isArray(json.cards)) {
      for (var i = 0; i < json.cards.length; i++) {
        var card = json.cards[i];
        if (card && typeof card.questionId === "string" && card.questionId) {
          out[card.questionId] = true;
        }
      }
    }
  } catch (err) {
    Logger.log("[StdFolders_collectDashboardQuestionIds_] " + fileId + ": " + nfbErrorToString_(err));
  }
}

// 既リンクのフォームを 01_forms へ揃え、壊れたリンクは再リンク／削除する。
// 変更時は AddFormUrl_ も新 URL で更新（forms はマッピングが URL 登録簿を兼ねる）。
function StdFolders_normalizeFormsToStd_() {
  var mapping = Forms_getMapping_();
  var res = StdFolders_repairAndNormalizeMapping_(mapping, "forms", function(id, entry) {
    try { if (entry.driveFileUrl) AddFormUrl_(id, entry.driveFileUrl); } catch (e) { /* non-critical */ }
  });
  if (res.normalized > 0 || res.relinked > 0 || res.removed > 0) Forms_saveMapping_(mapping);
  return { count: res.normalized, relinked: res.relinked, removed: res.removed };
}

// 既リンクの Question / Dashboard を 02_questions / 03_dashboards へ揃え、壊れたリンクは再リンク／削除する。
// Dashboard を揃え／再リンクしたときは、そのコピー先 JSON から linkedQuestionIds を収集して返す。
function StdFolders_normalizeAnalyticsToStd_(type) {
  var key = type === "questions" ? "questions" : "dashboards";
  var mapping = Analytics_getMapping_(type);
  var linkedQuestionIds = {};
  var onChange = type === "dashboards"
    ? function(id, entry) { StdFolders_collectDashboardQuestionIds_(entry.fileId, linkedQuestionIds); }
    : null;
  var res = StdFolders_repairAndNormalizeMapping_(mapping, key, onChange);
  if (res.normalized > 0 || res.relinked > 0 || res.removed > 0) Analytics_saveMapping_(type, mapping);
  return { count: res.normalized, relinked: res.relinked, removed: res.removed, linkedQuestionIds: linkedQuestionIds };
}

// 既リンク資産（forms / questions / dashboards）を標準フォルダ構成へ正規化する。
// 戻り値: { forms:{count}, questions:{count}, dashboards:{count}, cascadedQuestions, total }
function StdFolders_normalizeLinkedToStd_() {
  var forms = StdFolders_normalizeFormsToStd_();
  var questions = StdFolders_normalizeAnalyticsToStd_("questions");
  var dashboards = StdFolders_normalizeAnalyticsToStd_("dashboards");

  // ダッシュボード連動: コピーされた Dashboard のリンク先 Question を取りこぼし救済する。
  // （Question 単体のスイープで大半は揃うため、ここは保険。重複コピーは isFileInStdSubfolder で防止。）
  var cascadedQuestions = 0;
  var cascadeRelinked = 0;
  var cascadeRemoved = 0;
  var linked = dashboards.linkedQuestionIds || {};
  var hasLinked = false;
  for (var probeId in linked) { if (linked.hasOwnProperty(probeId)) { hasLinked = true; break; } }
  if (hasLinked) {
    var qMapping = Analytics_getMapping_("questions");
    var cachedQIndex = null;
    var qProvider = function() {
      if (cachedQIndex === null) cachedQIndex = StdFolders_indexStdFolderByName_("questions");
      return cachedQIndex;
    };
    var touched = false;
    for (var questionId in linked) {
      if (!linked.hasOwnProperty(questionId)) continue;
      if (!qMapping[questionId]) continue;
      var outcome = StdFolders_repairMappingEntry_(qMapping, questionId, "questions", qProvider, null);
      if (outcome === "normalized") { cascadedQuestions++; touched = true; }
      else if (outcome === "relinked") { cascadeRelinked++; touched = true; }
      else if (outcome === "removed") { cascadeRemoved++; touched = true; }
    }
    if (touched) Analytics_saveMapping_("questions", qMapping);
  }

  var relinked = (forms.relinked || 0) + (questions.relinked || 0) + (dashboards.relinked || 0) + cascadeRelinked;
  var removed = (forms.removed || 0) + (questions.removed || 0) + (dashboards.removed || 0) + cascadeRemoved;

  return {
    forms: { count: forms.count },
    questions: { count: questions.count },
    dashboards: { count: dashboards.count },
    cascadedQuestions: cascadedQuestions,
    relinked: relinked,
    removed: removed,
    total: forms.count + questions.count + dashboards.count + cascadedQuestions
  };
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

// Drive ファイル URL/ID を idMap（oldFileId → { newFileId, newUrl }）で置換する。
// 戻り値: { value, status } status は "remapped" | "cleared" | "unchanged"。
function StdFolders_remapFileUrl_(url, idMap) {
  var raw = String(url || "").trim();
  if (!raw) return { value: "", status: "unchanged" };
  var parsed = Forms_parseGoogleDriveUrl_(raw);
  var oldId = parsed && parsed.type === "file" ? parsed.id : null;
  if (!oldId) {
    // スプレッドシート URL/ID 形式も試す
    oldId = Model_normalizeSpreadsheetId_(raw) || null;
    if (oldId === raw && !/^[a-zA-Z0-9_-]{15,}$/.test(raw)) oldId = null;
  }
  if (oldId && idMap[oldId]) {
    return { value: idMap[oldId].newUrl, status: "remapped" };
  }
  // 標準フォルダ構成外（コピー対象外）のリンク → クリア
  return { value: "", status: "cleared" };
}

// フォルダ URL を folderIdMap（srcFolderId → destFolderUrl）で置換。対象外はクリア。
function StdFolders_remapFolderUrl_(url, folderIdMap) {
  var raw = String(url || "").trim();
  if (!raw) return { value: "", status: "unchanged" };
  var parsed = Forms_parseGoogleDriveUrl_(raw);
  var oldId = parsed && parsed.type === "folder" ? parsed.id : null;
  if (oldId && folderIdMap[oldId]) {
    return { value: folderIdMap[oldId], status: "remapped" };
  }
  return { value: "", status: "cleared" };
}

// ---------------------------------------------
// (2.3) 構成コピー
// ---------------------------------------------

// ソース mapping から fileId → id の逆引き表を作る。
function StdFolders_buildFileIdToId_(mapping) {
  var rev = {};
  for (var id in mapping) {
    if (!mapping.hasOwnProperty(id)) continue;
    var fileId = Nfb_resolveFileIdFromEntry_(mapping[id]);
    if (fileId) rev[fileId] = id;
  }
  return rev;
}

function StdFolders_copy_(payload) {
  return nfbSafeCall_(function() {
    var destRootUrl = payload && payload.destRootUrl ? String(payload.destRootUrl).trim() : "";
    if (!destRootUrl) throw new Error("コピー先ルートフォルダの URL を指定してください");
    var copyData = !!(payload && (payload.copyData === true || payload.copyData === "true"));
    var copyWebhooks = !!(payload && (payload.copyWebhooks === true || payload.copyWebhooks === "true"));
    // マッピング再構築は既定 ON（明示 false / "false" のときだけ OFF）。
    var rebuildMapping = !(payload && (payload.rebuildMapping === false || payload.rebuildMapping === "false"));

    var srcRoot = StdFolders_resolveRootFolder_(null);
    var destRoot = nfbResolveFolderFromInput_(destRootUrl);
    if (destRoot.getId() === srcRoot.getId()) {
      throw new Error("コピー先がコピー元のルートと同じフォルダです");
    }

    // appsscript 本体をコピー先ルートへ複製する（システムごとコピー）。
    // 複製したスクリプトは Web アプリのデプロイ・Script Properties を引き継がない点に注意
    // （デプロイは手動、マッピングは再構築マーカーで復元、ルートは初回アクセス時に自動検出）。
    var appsScriptCopyResult = StdFolders_copyAppsScriptBody_(destRoot);
    var appsScriptCopied = appsScriptCopyResult.ok;

    // id ＝ Drive fileId へ統一したため、コピー先では全ファイルが新 fileId（＝新 id）になる。
    // リンク（formId / questionId）はコピー時に idMap（旧fileId→新fileId）で再マップする。
    var idMap = {};         // oldFileId → { newFileId, newUrl }
    var folderIdMap = {};   // srcSubfolderId → destSubfolderUrl
    var summary = {};

    // どのキーをコピーするか（07_webhooks はオプション）
    var keys = [];
    for (var i = 0; i < NFB_STD_FOLDER_ORDER.length; i++) {
      var k = NFB_STD_FOLDER_ORDER[i];
      if (k === "webhooks" && !copyWebhooks) continue;
      keys.push(k);
    }

    // --- 第1パス: 全フォルダのファイルを複製し idMap / folderIdMap を構築 ---
    var srcSubByKey = {};
    var destSubByKey = {};
    var copiedFilesByKey = {}; // key → [{ newFileId, srcFileId }]
    for (var ki = 0; ki < keys.length; ki++) {
      var key = keys[ki];
      var name = NFB_STD_FOLDER_NAMES[key];
      var srcSubIt = srcRoot.getFoldersByName(name);
      if (!srcSubIt.hasNext()) {
        summary[key] = 0;
        continue;
      }
      var srcSub = srcSubIt.next();
      var destSub = StdFolders_getOrCreateSubfolder_(destRoot, key);
      srcSubByKey[key] = srcSub;
      destSubByKey[key] = destSub;
      folderIdMap[srcSub.getId()] = destSub.getUrl();

      var copied = [];
      var files = srcSub.getFiles();
      while (files.hasNext()) {
        var srcFile = files.next();
        if (typeof srcFile.isTrashed === "function" && srcFile.isTrashed()) continue;
        var srcFileId = srcFile.getId();
        var newFile = srcFile.makeCopy(srcFile.getName(), destSub);
        var newFileId = newFile.getId();
        idMap[srcFileId] = { newFileId: newFileId, newUrl: newFile.getUrl() };
        copied.push({ newFileId: newFileId, srcFileId: srcFileId });

        // スプレッドシートかつ「データを含めない」場合は 12 行目以降を消去
        if (key === "spreadsheets" && !copyData) {
          StdFolders_clearSpreadsheetData_(newFileId);
        }
      }
      copiedFilesByKey[key] = copied;
      summary[key] = copied.length;
    }

    // --- 第2パス: コピー先ファイルのリンク（formId / questionId / 各種 URL）を idMap で再配線 ---
    // id は埋め込まない（id ＝ fileId）。コピー先では新 fileId が新 id になり、リンクも新 fileId を指す。
    var clearedLinks = 0;

    // forms (01_forms): spreadsheet / フォルダ / webhook URL を再マップ
    var formCopied = copiedFilesByKey["forms"] || [];
    for (var fi = 0; fi < formCopied.length; fi++) {
      clearedLinks += StdFolders_rewireFormFile_(formCopied[fi].newFileId, idMap, folderIdMap, copyWebhooks);
    }

    // questions (02_questions): query.gui.formId / query.formSources[].formId を新 fileId へ再マップ
    var qCopied = copiedFilesByKey["questions"] || [];
    for (var qj = 0; qj < qCopied.length; qj++) {
      StdFolders_rewireQuestionFile_(qCopied[qj].newFileId, idMap);
    }

    // dashboards (03_dashboards): cards[].questionId を新 fileId へ再マップ。idMap に無い参照は
    // questionName を残したまま未解決として数える（コピー先の同期で名前フォールバック復旧）。
    var unresolvedQuestionLinks = 0;
    var dCopied = copiedFilesByKey["dashboards"] || [];
    for (var dj = 0; dj < dCopied.length; dj++) {
      unresolvedQuestionLinks += StdFolders_rewireDashboardFile_(dCopied[dj].newFileId, idMap);
    }

    // 再構築 ON のときはコピー先ルートへ _nfb_mapping.json を書き出す（新 fileId に振り直し済み）。
    // 復元はコピー先で手動：設定 > 管理 の「インポート」（URL 空欄でルートの最新 .json を読込）または「同期」。
    if (rebuildMapping) {
      StdFolders_writeMappingFile_(destRoot, StdFolders_buildCopiedMappingDoc_(idMap, srcRoot.getId()));
    }

    return {
      ok: true,
      destRootUrl: destRoot.getUrl(),
      summary: summary,
      clearedLinks: clearedLinks,
      unresolvedQuestionLinks: unresolvedQuestionLinks,
      copyData: copyData,
      copyWebhooks: copyWebhooks,
      rebuildMapping: rebuildMapping,
      appsScriptCopied: appsScriptCopied,
      appsScriptCopyError: appsScriptCopied ? "" : (appsScriptCopyResult.reason || ""),
      message: (rebuildMapping
        ? "コピーが完了しました。コピー先ルートに _nfb_mapping.json を保存しました。コピー先の 設定 > 管理 から「インポート」（URL 空欄でルートの最新を読込）または「同期」を実行してマッピングを復元してください。コピー先スクリプトの Web アプリは手動で再デプロイしてください。"
        : "コピーが完了しました。コピー先の 設定 > 管理 から「同期」を実行してマッピングを復元してください。コピー先スクリプトの Web アプリは手動で再デプロイしてください。")
        + (unresolvedQuestionLinks > 0
          ? "\n※ ダッシュボードからコピー対象外の Question を参照しているカードが " + unresolvedQuestionLinks + " 件あります。参照は保持しているので、コピー先で「同期」後に自動再リンクされるか、編集画面のリンク差し替えで復旧できます。"
          : "")
    };
  });
}

// appsscript 本体（スクリプトプロジェクト）を destRoot へ複製する。
// スタンドアロンプロジェクトは scriptId === Drive fileId なので、DriveApp.makeCopy で複製し
// moveTo で destRoot へ移動する（makeCopy は保存先を指定しても My Drive 直下に作られるため）。
// Apps Script API（script.googleapis.com）や usersettings の「Google Apps Script API」トグルは不要。
// 戻り値: { ok: boolean, reason: string }。失敗してもコピー全体は継続する（reason はログ＆UI 用）。
function StdFolders_copyAppsScriptBody_(destRoot) {
  try {
    var scriptId = ScriptApp.getScriptId();
    if (!scriptId) return { ok: false, reason: "スクリプト ID を取得できませんでした" };
    var selfFile;
    try {
      selfFile = DriveApp.getFileById(scriptId);
    } catch (e) {
      return { ok: false, reason: "スクリプト本体ファイルを取得できませんでした: " + nfbErrorToString_(e) };
    }

    // makeCopy はコピー先を指定しても My Drive 直下に作られるため、後で moveTo で移動する。
    var copied = selfFile.makeCopy(selfFile.getName());
    try {
      copied.moveTo(destRoot);
    } catch (moveErr) {
      Logger.log("[StdFolders_copyAppsScriptBody_] 移動に失敗（My Drive 直下に残ります）: " + nfbErrorToString_(moveErr));
      return { ok: true, reason: "コピーは成功しましたが、コピー先フォルダへの移動に失敗しました（My Drive 直下を確認してください）" };
    }
    return { ok: true, reason: "" };
  } catch (err) {
    Logger.log("[StdFolders_copyAppsScriptBody_] appsscript 本体の複製に失敗: " + nfbErrorToString_(err));
    return { ok: false, reason: nfbErrorToString_(err) };
  }
}

// コピーした Google スプレッドシートの 12 行目以降（ヘッダ 1〜11 行は保持）を全シートで消去する。
function StdFolders_clearSpreadsheetData_(spreadsheetId) {
  try {
    var ss = SpreadsheetApp.openById(spreadsheetId);
    var sheets = ss.getSheets();
    for (var i = 0; i < sheets.length; i++) {
      var sheet = sheets[i];
      var lastRow = sheet.getLastRow();
      var lastCol = sheet.getLastColumn();
      if (lastRow >= NFB_DATA_START_ROW && lastCol >= 1) {
        sheet.getRange(NFB_DATA_START_ROW, 1, lastRow - NFB_DATA_START_ROW + 1, lastCol).clearContent();
      }
    }
  } catch (err) {
    Logger.log("[StdFolders_clearSpreadsheetData_] " + spreadsheetId + ": " + nfbErrorToString_(err));
  }
}

// idMap（旧fileId→{newFileId,newUrl}）を使い、リンク id（旧 fileId）を新 fileId へ写像する。
// idMap に無い（コピー対象外）の参照はそのまま返し、呼び出し側で名前フォールバックに委ねる。
// 戻り: { value, status } status は "remapped" | "unchanged"。
function StdFolders_remapLinkId_(id, idMap) {
  var raw = String(id || "").trim();
  if (!raw) return { value: "", status: "unchanged" };
  if (idMap[raw]) return { value: idMap[raw].newFileId, status: "remapped" };
  return { value: raw, status: "unchanged" };
}

// フォーム定義ファイルのリンク再配線（id は埋め込まない＝id ＝ fileId）。クリアしたリンク数を返す。
function StdFolders_rewireFormFile_(fileId, idMap, folderIdMap, copyWebhooks) {
  var cleared = 0;
  try {
    var file = DriveApp.getFileById(fileId);
    var json = JSON.parse(file.getBlob().getDataAsString());

    // form → spreadsheet
    if (json.settings && json.settings.spreadsheetId) {
      var ss = StdFolders_remapFileUrl_(json.settings.spreadsheetId, idMap);
      json.settings.spreadsheetId = ss.value;
      if (ss.status === "cleared") cleared++;
    }

    // schema フィールド内のリンク
    StdFolders_walkFields_(json.schema, function(field) {
      // 印刷様式テンプレート
      if (field.printTemplateAction && field.printTemplateAction.templateUrl) {
        var t = StdFolders_remapFileUrl_(field.printTemplateAction.templateUrl, idMap);
        field.printTemplateAction.templateUrl = t.value;
        if (t.status === "cleared") cleared++;
      }
      // アップロード先ルートフォルダ
      if (typeof field.driveRootFolderUrl === "string" && field.driveRootFolderUrl) {
        var u = StdFolders_remapFolderUrl_(field.driveRootFolderUrl, folderIdMap);
        field.driveRootFolderUrl = u.value;
        if (u.status === "cleared") cleared++;
      }
      // webhook 送信先（copyWebhooks OFF のときはクリア。ON のときは外部 /exec をそのまま温存）
      if (field.webhookAction && typeof field.webhookAction.url === "string" && field.webhookAction.url) {
        if (!copyWebhooks) {
          field.webhookAction.url = "";
          cleared++;
        }
      }
    });

    file.setContent(JSON.stringify(json, null, 2));
  } catch (err) {
    Logger.log("[StdFolders_rewireFormFile_] " + fileId + ": " + nfbErrorToString_(err));
  }
  return cleared;
}

// クエスチョン定義ファイルの formId 再配線（id は埋め込まない＝id ＝ fileId）。
// query.gui.formId と query.formSources[].formId を idMap で新 fileId へ写像する。
// idMap に無い（コピー対象外）の formId は保持し、formName による名前フォールバックに委ねる。
function StdFolders_rewireQuestionFile_(fileId, idMap) {
  try {
    var file = DriveApp.getFileById(fileId);
    var json = JSON.parse(file.getBlob().getDataAsString());
    var query = json && json.query;
    if (query && typeof query === "object") {
      if (query.gui && typeof query.gui === "object" && query.gui.formId) {
        query.gui.formId = StdFolders_remapLinkId_(query.gui.formId, idMap).value;
      }
      if (Array.isArray(query.formSources)) {
        for (var i = 0; i < query.formSources.length; i++) {
          var src = query.formSources[i];
          if (src && src.formId) src.formId = StdFolders_remapLinkId_(src.formId, idMap).value;
        }
      }
    }
    file.setContent(JSON.stringify(json, null, 2));
  } catch (err) {
    Logger.log("[StdFolders_rewireQuestionFile_] " + fileId + ": " + nfbErrorToString_(err));
  }
}

// ダッシュボード定義ファイルの questionId 再配線（id は埋め込まない＝id ＝ fileId）。
// cards[].questionId を idMap で新 fileId へ写像する。idMap に無い（コピー対象外）の参照は
// questionId / questionName を保持したまま未解決として数える（コピー先の同期で名前フォールバック復旧）。
// 戻り値: 未解決リンク数。
function StdFolders_rewireDashboardFile_(fileId, idMap) {
  var unresolved = 0;
  try {
    var file = DriveApp.getFileById(fileId);
    var json = JSON.parse(file.getBlob().getDataAsString());

    if (Array.isArray(json.cards)) {
      for (var i = 0; i < json.cards.length; i++) {
        var card = json.cards[i];
        if (card && typeof card.questionId === "string" && card.questionId) {
          var r = StdFolders_remapLinkId_(card.questionId, idMap);
          if (r.status === "remapped") {
            card.questionId = r.value;
          } else {
            // コピー対象外 → 参照は保持し、未解決として数える。
            unresolved++;
          }
        }
      }
    }

    file.setContent(JSON.stringify(json, null, 2));
  } catch (err) {
    Logger.log("[StdFolders_rewireDashboardFile_] " + fileId + ": " + nfbErrorToString_(err));
  }
  return unresolved;
}

// ---------------------------------------------
// (2.3 補助) 標準フォルダをスキャンしてマッピングを再構築
// コピー先クローンが 1 回実行する。01_forms / 02_questions / 03_dashboards 配下の定義ファイルを
// 走査し、各 JSON の id（コピー時に埋め込み済み）と Drive fileId/URL から自分自身のマッピングと
// フォルダ登録簿を再構築する。id が無いファイルは新規 id を採番する。
// ---------------------------------------------

function StdFolders_rebuildMappings_(payload) {
  return nfbSafeCall_(function() {
    var manualRootUrl = payload && payload.rootUrl ? String(payload.rootUrl).trim() : "";
    var root = StdFolders_resolveRootFolder_(manualRootUrl);

    var formsResult = StdFolders_rebuildFormsMapping_(root);
    var questionsResult = StdFolders_rebuildAnalyticsMapping_(root, "questions");
    var dashboardsResult = StdFolders_rebuildAnalyticsMapping_(root, "dashboards");

    // 物理 Drive フォルダ（01_forms 配下）がずれていたら、物理を正として仮想（登録簿・form.folder・
    // drivemap）を合わせる。手動 Drive リネーム/移動への追従。
    var folderReconcile = StdFolders_reconcileFormFoldersToPhysical_(root);

    // 既リンク資産のうち構成外のものを標準フォルダへコピーして揃える。
    var normalized = StdFolders_normalizeLinkedToStd_();

    return {
      ok: true,
      forms: formsResult,
      questions: questionsResult,
      dashboards: dashboardsResult,
      folderReconcile: folderReconcile,
      normalized: normalized
    };
  });
}

// ---------------------------------------------
// (2.4) 物理 Drive フォルダ → 仮想フォルダの逆方向リコンサイル
// 設定＞管理者の「同期（フォルダ走査）」時、物理 Drive フォルダ（01_forms 配下）の実構造を正として
// 仮想（登録簿・form.folder・drivemap）を合わせる。Drive 上で手動リネーム/移動されたケースを吸収する。
//
// 2 フェーズ:
//   1) 移行: 01_forms 直下にあり form.folder が非空のフォーム = 未移行レガシー。その folder に対応する
//            物理フォルダを作成しファイルを移動する（json.folder を尊重）。
//   2) リコンサイル: 01_forms サブツリーを再帰走査し、ネストされた各フォームの json.folder を物理パス
//            に合わせて書き換える。drivemap と仮想登録簿を物理フォルダ構造から再構築する。
//
// 注意: 物理を正とするため、物理フォルダを持たない空の仮想フォルダは登録簿から落ちる。導入時は先に
//       FormsDrive_backfillPhysicalFolders_() で物理化してから走査することを推奨。
// auto-organize off（base=01_forms が解決できない）では何もしない。
// ---------------------------------------------
function StdFolders_reconcileFormFoldersToPhysical_(root) {
  var base = FormsDrive_baseFolderOrNull_();
  if (!base) return { ok: true, skipped: true };

  var result = { migrated: 0, reconciled: 0, folders: 0 };

  // フェーズ1: 01_forms 直下のレガシー（folder 非空）を物理フォルダへ移行。
  var rootFiles = base.getFiles();
  while (rootFiles.hasNext()) {
    var rf = rootFiles.next();
    if (typeof rf.isTrashed === "function" && rf.isTrashed()) continue;
    if (!StdFolders_isJsonFile_(rf)) continue;
    var rjson;
    try { rjson = JSON.parse(rf.getBlob().getDataAsString()); } catch (e) { continue; }
    if (!rjson || !Array.isArray(rjson.schema)) continue;
    var rfolder = Forms_normalizeFolderPath_(rjson.folder);
    if (rfolder && FormsDrive_moveFormFileToPath_(rf.getId(), rfolder)) result.migrated++;
  }

  // フェーズ2: サブツリーを再帰走査し、物理パスを正に json.folder / drivemap / 登録簿を再構築。
  var map = {};            // 物理パス -> folderId
  var physicalPaths = {};  // 物理フォルダパス集合（空フォルダも保持）
  StdFolders_walkPhysicalFormFolders_(base, "", map, physicalPaths, result);

  FormsDrive_savePathMap_(map);
  Forms_saveFolders_(Object.keys(physicalPaths));
  return { ok: true, migrated: result.migrated, reconciled: result.reconciled, folders: result.folders };
}

// 物理サブツリーを歩き、フォルダパス→ID（map）と物理パス集合（physicalPaths）を集めつつ、
// 各フォーム .json の json.folder を物理パスに合わせて書き換える。
function StdFolders_walkPhysicalFormFolders_(folder, pathPrefix, map, physicalPaths, result) {
  var subs = folder.getFolders();
  while (subs.hasNext()) {
    var sub = subs.next();
    if (typeof sub.isTrashed === "function" && sub.isTrashed()) continue;
    var p = pathPrefix ? pathPrefix + "/" + sub.getName() : sub.getName();
    physicalPaths[p] = true;
    map[p] = sub.getId();
    result.folders++;

    var files = sub.getFiles();
    while (files.hasNext()) {
      var file = files.next();
      if (typeof file.isTrashed === "function" && file.isTrashed()) continue;
      if (!StdFolders_isJsonFile_(file)) continue;
      var json;
      try { json = JSON.parse(file.getBlob().getDataAsString()); } catch (e) { continue; }
      if (!json || !Array.isArray(json.schema)) continue;
      if (Forms_normalizeFolderPath_(json.folder) !== p) {
        json.folder = p;
        var nowSerial = Sheets_dateToSerial_(new Date());
        json.modifiedAt = Sheets_formatJstString_(nowSerial);
        json.modifiedAtUnixMs = nowSerial;
        try { file.setContent(JSON.stringify(json, null, 2)); result.reconciled++; } catch (e) { /* non-critical */ }
      }
    }
    StdFolders_walkPhysicalFormFolders_(sub, p, map, physicalPaths, result);
  }
}

// ---------------------------------------------
// マッピングのエクスポート / インポート（手動）
// ---------------------------------------------

// idMap（旧fileId→{newFileId,newUrl}）でソースの 3 マッピングをコピー先 ID に振り直し、
// _nfb_mapping.json 形のドキュメントを組み立てる。idMap 未収載のエントリ（コピー対象外）は除外。
function StdFolders_buildCopiedMappingDoc_(idMap, sourceRootId) {
  function remapSection(mapping, nameKey) {
    var out = {};
    for (var id in mapping) {
      if (!mapping.hasOwnProperty(id)) continue;
      var entry = mapping[id] || {};
      var srcFileId = Nfb_resolveFileIdFromEntry_(entry);
      if (!srcFileId || !idMap[srcFileId]) continue;
      var mapped = idMap[srcFileId];
      var next = { fileId: mapped.newFileId, driveFileUrl: mapped.newUrl };
      if (nameKey && typeof entry[nameKey] === "string") next[nameKey] = entry[nameKey];
      out[id] = next;
    }
    return out;
  }
  return {
    type: "nfb-mapping",
    version: 1,
    exportedAt: new Date().toISOString(),
    sourceRootId: sourceRootId || "",
    forms: remapSection(Forms_getMapping_(), "title"),
    questions: remapSection(Analytics_getMapping_("questions"), "name"),
    dashboards: remapSection(Analytics_getMapping_("dashboards"), "name"),
    folders: {
      forms: Forms_getFolders_(),
      questions: Analytics_getFolders_("questions"),
      dashboards: Analytics_getFolders_("dashboards")
    }
  };
}

// コピー先ルートへ _nfb_mapping.json を書き出す。
function StdFolders_writeMappingFile_(destRoot, doc) {
  destRoot.createFile(NFB_STD_MAPPING_FILE_NAME, JSON.stringify(doc, null, 2), "application/json");
}

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
    function(e) { return { fileId: e.fileId || null, driveFileUrl: e.driveFileUrl || null, title: e.title || null }; },
    function(id, entry) { try { if (entry.driveFileUrl) AddFormUrl_(id, entry.driveFileUrl); } catch (e) { /* non-critical */ } }
  );
  Forms_saveMapping_(formsMapping);
  imported.forms = formsRes.imported; skipped += formsRes.skipped; errors = errors.concat(formsRes.errors);

  // questions / dashboards
  ["questions", "dashboards"].forEach(function(type) {
    var mapping = Analytics_getMapping_(type);
    var res = StdFolders_mergeMappingSection_(
      type, doc[type], mapping,
      function(e) { return { fileId: e.fileId || null, driveFileUrl: e.driveFileUrl || null, name: e.name || null }; },
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

  // 既リンク資産のうち構成外のものを標準フォルダへコピーして揃える。
  var normalized = StdFolders_normalizeLinkedToStd_();

  return { ok: true, imported: imported, skipped: skipped, errors: errors, normalized: normalized };
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
    ctx.mapping[id] = { fileId: fileId, driveFileUrl: file.getUrl(), title: title };
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
    mapping[id] = { fileId: fileId, driveFileUrl: file.getUrl(), name: name };
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

// エンティティ相互参照（formId / questionId）の状態を構成内照合のみで判定する。
function StdFolders_reportRefStatus_(id, presentSet, mapSet) {
  if (!id) return "未設定";
  if (presentSet[id]) return "OK（構成内）";
  if (mapSet && mapSet[id]) return "要確認（マッピング有・構成内に実体なし）";
  return "未解決（リンク切れの可能性）";
}

// Drive ファイル/フォルダ参照（スプレッドシート等）の状態を構成内照合のみで判定する。
function StdFolders_reportFileLinkStatus_(id, presentSet) {
  if (!id) return "未設定";
  if (presentSet[id]) return "構成内";
  return "構成外/外部（未検査）";
}

// その状態がリンク切れ候補かどうか。
function StdFolders_isBrokenStatus_(status) {
  return status === "未解決（リンク切れの可能性）"
    || status === "要確認（マッピング有・構成内に実体なし）"
    || status === "構成外/外部（未検査）";
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

    // 構成内に実体のあるフォーム / Question の fileId 集合（JSON ファイルのみ）。
    var presentFormIds = {};
    var presentQuestionIds = {};
    (inventory.forms || []).forEach(function(rec) { if (StdFolders_isJsonFile_(rec.file)) presentFormIds[rec.fileId] = true; });
    (inventory.questions || []).forEach(function(rec) { if (StdFolders_isJsonFile_(rec.file)) presentQuestionIds[rec.fileId] = true; });

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
        if (StdFolders_isBrokenStatus_(ssStatus)) broken.push({ kind: "Form", owner: displayName, detail: "スプレッドシート " + ssId, status: ssStatus });
      }

      StdFolders_walkFields_(json.schema, function(field) {
        var fieldLabel = field && field.label ? field.label : (field && field.id ? field.id : "(無題)");
        if (field.printTemplateAction && field.printTemplateAction.templateUrl) {
          var t = StdFolders_extractDriveIdNoFetch_(field.printTemplateAction.templateUrl);
          var ts = StdFolders_reportFileLinkStatus_(t.id, presentFileIds);
          links.push({ label: "印刷テンプレート [" + fieldLabel + "]", raw: field.printTemplateAction.templateUrl, id: t.id, status: ts });
          if (StdFolders_isBrokenStatus_(ts)) broken.push({ kind: "Form", owner: displayName, detail: "印刷テンプレート [" + fieldLabel + "]", status: ts });
        }
        if (typeof field.driveRootFolderUrl === "string" && field.driveRootFolderUrl) {
          var u = StdFolders_extractDriveIdNoFetch_(field.driveRootFolderUrl);
          var us = StdFolders_reportFileLinkStatus_(u.id, presentFolderIds);
          links.push({ label: "アップロード先フォルダ [" + fieldLabel + "]", raw: field.driveRootFolderUrl, id: u.id, status: us });
          if (StdFolders_isBrokenStatus_(us)) broken.push({ kind: "Form", owner: displayName, detail: "アップロード先フォルダ [" + fieldLabel + "]", status: us });
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
          var st1 = StdFolders_reportRefStatus_(query.gui.formId, presentFormIds, formMapSet);
          refs.push({ label: "query.gui.formId", id: query.gui.formId, status: st1 });
          if (StdFolders_isBrokenStatus_(st1)) broken.push({ kind: "Question", owner: displayName, detail: "formId " + query.gui.formId, status: st1 });
        }
        if (Array.isArray(query.formSources)) {
          for (var s = 0; s < query.formSources.length; s++) {
            var src = query.formSources[s];
            if (src && src.formId) {
              var st2 = StdFolders_reportRefStatus_(src.formId, presentFormIds, formMapSet);
              refs.push({ label: "formSources[" + s + "].formId", id: src.formId, status: st2 });
              if (StdFolders_isBrokenStatus_(st2)) broken.push({ kind: "Question", owner: displayName, detail: "formSources[" + s + "].formId " + src.formId, status: st2 });
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
            var st3 = StdFolders_reportRefStatus_(card.questionId, presentQuestionIds, qMapSet);
            refs.push({ label: "cards[" + c + "].questionId", id: card.questionId, qname: card.questionName || "", status: st3 });
            if (StdFolders_isBrokenStatus_(st3)) broken.push({ kind: "Dashboard", owner: displayName, detail: "cards[" + c + "].questionId " + card.questionId + (card.questionName ? " (name: " + card.questionName + ")" : ""), status: st3 });
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
    return {
      ok: true,
      markdown: md,
      stats: {
        files: totalFiles,
        forms: forms.length,
        questions: questions.length,
        dashboards: dashboards.length,
        brokenCandidates: broken.length,
        truncated: guard.truncated
      }
    };
  });
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
  md.push("- リンク切れ候補: " + ctx.broken.length + " 件");
  md.push("- リンク切れ判定: 標準フォルダ構成内の照合のみ（外部リンクの生死は未検査）");
  md.push("- 実行打ち切り: " + (ctx.truncated ? "あり（実行時間の安全弁により一部のファイルを未処理。再実行してください）" : "なし"));
  md.push("");

  md.push("## ⚠ リンク切れ候補");
  if (!ctx.broken.length) {
    md.push("");
    md.push("構成内の照合では検出されませんでした。");
  } else {
    md.push("");
    ctx.broken.forEach(function(b) {
      md.push("- [" + b.kind + "] " + b.owner + " → " + b.detail + " : **" + b.status + "**");
    });
  }
  md.push("");

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
    md.push("#### " + f.name + "（fileId: " + f.fileId + "）");
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
    md.push("#### " + q.name + "（fileId: " + q.fileId + "）");
    if (q.parseError) { md.push("- ⚠ JSON 解析に失敗しました: " + StdFolders_mdCode_(q.relPath)); return; }
    if (!q.refs.length) { md.push("- (参照なし)"); return; }
    q.refs.forEach(function(r) {
      md.push("- " + r.label + ": " + StdFolders_mdCode_(r.id) + " → " + r.status);
    });
  });
  md.push("");
  md.push("### Dashboard");
  if (!ctx.dashboards.length) md.push("- (なし)");
  ctx.dashboards.forEach(function(d) {
    md.push("");
    md.push("#### " + d.name + "（fileId: " + d.fileId + "）");
    if (d.parseError) { md.push("- ⚠ JSON 解析に失敗しました: " + StdFolders_mdCode_(d.relPath)); return; }
    if (!d.refs.length) { md.push("- (参照なし)"); return; }
    d.refs.forEach(function(r) {
      md.push("- " + r.label + ": " + StdFolders_mdCode_(r.id) + (r.qname ? "（name: " + r.qname + "）" : "") + " → " + r.status);
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
      md.push("#### " + f.name + "（fileId: " + f.fileId + "）");
      md.push("```json");
      md.push(f.json);
      md.push("```");
    });
    md.push("");
    md.push("### Question");
    ctx.questions.forEach(function(q) {
      if (!q.json) return;
      md.push("");
      md.push("#### " + q.name + "（fileId: " + q.fileId + "）");
      md.push("```json");
      md.push(q.json);
      md.push("```");
    });
    md.push("");
    md.push("### Dashboard");
    ctx.dashboards.forEach(function(d) {
      if (!d.json) return;
      md.push("");
      md.push("#### " + d.name + "（fileId: " + d.fileId + "）");
      md.push("```json");
      md.push(d.json);
      md.push("```");
    });
    md.push("");
  }

  return md.join("\n");
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
