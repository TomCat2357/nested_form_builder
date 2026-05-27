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

var NFB_STD_ROOT_PROPERTY_KEY = "nfb.stdfolders.root";       // ルートフォルダ ID

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

// ルートフォルダを解決する。
//   1) manualRootUrl が与えられればそれを採用し Script Property へ保存
//   2) Script Property にキャッシュ済みのルート ID
//   3) appsscript 本体の親フォルダを自動検出し保存
// いずれも解決できなければ日本語例外を投げる。
function StdFolders_resolveRootFolder_(manualRootUrl) {
  var props = Nfb_getScriptProperties_();

  var manual = manualRootUrl ? String(manualRootUrl).trim() : "";
  if (manual) {
    var picked = nfbResolveFolderFromInput_(manual); // 無効 URL は例外
    props.setProperty(NFB_STD_ROOT_PROPERTY_KEY, picked.getId());
    return picked;
  }

  var savedId = props.getProperty(NFB_STD_ROOT_PROPERTY_KEY);
  if (savedId) {
    try {
      var cached = DriveApp.getFolderById(savedId);
      if (!(typeof cached.isTrashed === "function" && cached.isTrashed())) {
        return cached;
      }
    } catch (e) {
      // キャッシュが無効 → 自動検出へフォールバック
    }
  }

  var detected = StdFolders_detectRootFromScript_();
  if (detected) {
    props.setProperty(NFB_STD_ROOT_PROPERTY_KEY, detected.getId());
    return detected;
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
// 標準フォルダ解決（常に有効 = 標準フォルダ構成が唯一の前提）
// ---------------------------------------------

// 標準サブフォルダを取得（無ければ作成）。ルートも未作成なら自動検出・作成する。
// 作成系フローから呼ばれるため、ルート解決失敗（dev 等）でのみ例外を握って null を返し、
// 呼び出し側が従来配置（マイドライブ直下）へフォールバックできるようにする。
function StdFolders_autoFileFolderOrNull_(key) {
  try {
    var root = StdFolders_resolveRootFolder_(null);
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
    var appsScriptCopied = StdFolders_copyAppsScriptBody_(destRoot);

    // ソース mapping から fileId → id 逆引き（コピーファイルへ元 id を埋め込むため）
    var formsRev = StdFolders_buildFileIdToId_(Forms_getMapping_());
    var questionsRev = StdFolders_buildFileIdToId_(Analytics_getMapping_("questions"));
    var dashboardsRev = StdFolders_buildFileIdToId_(Analytics_getMapping_("dashboards"));

    var idMap = {};         // oldFileId → { newFileId, newUrl }
    var folderIdMap = {};   // srcSubfolderId → destSubfolderUrl
    var copiedQuestionIds = {}; // 新環境に存在する questionId の集合
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

    // questions の id 集合（dashboard→question の存在チェック用）
    var qCopied = copiedFilesByKey["questions"] || [];
    for (var qi = 0; qi < qCopied.length; qi++) {
      var qid = questionsRev[qCopied[qi].srcFileId];
      if (qid) copiedQuestionIds[qid] = true;
    }

    // --- 第2パス: 定義ファイルへ元 id を埋め込み、リンクを再配線 ---
    var clearedLinks = 0;

    // forms (01_forms)
    var formCopied = copiedFilesByKey["forms"] || [];
    for (var fi = 0; fi < formCopied.length; fi++) {
      var fEntry = formCopied[fi];
      clearedLinks += StdFolders_rewireFormFile_(fEntry.newFileId, formsRev[fEntry.srcFileId] || null, idMap, folderIdMap, copyWebhooks);
    }

    // questions (02_questions): id 埋め込みのみ
    for (var qj = 0; qj < qCopied.length; qj++) {
      StdFolders_embedIdInFile_(qCopied[qj].newFileId, questionsRev[qCopied[qj].srcFileId] || null);
    }

    // dashboards (03_dashboards): id 埋め込み + questionId 存在チェック
    var dCopied = copiedFilesByKey["dashboards"] || [];
    for (var dj = 0; dj < dCopied.length; dj++) {
      var dEntry = dCopied[dj];
      clearedLinks += StdFolders_rewireDashboardFile_(dEntry.newFileId, dashboardsRev[dEntry.srcFileId] || null, copiedQuestionIds);
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
      copyData: copyData,
      copyWebhooks: copyWebhooks,
      rebuildMapping: rebuildMapping,
      appsScriptCopied: appsScriptCopied,
      message: rebuildMapping
        ? "コピーが完了しました。コピー先ルートに _nfb_mapping.json を保存しました。コピー先の 設定 > 管理 から「インポート」（URL 空欄でルートの最新を読込）または「同期」を実行してマッピングを復元してください。コピー先スクリプトの Web アプリは手動で再デプロイしてください。"
        : "コピーが完了しました。コピー先の 設定 > 管理 から「同期」を実行してマッピングを復元してください。コピー先スクリプトの Web アプリは手動で再デプロイしてください。"
    };
  });
}

// appsscript 本体（バインドされたスクリプトプロジェクトの Drive ファイル）を destRoot へ複製する。
// 成功で true。種別・権限の都合で複製できない場合は握りつぶして false を返す（コピー全体は継続）。
function StdFolders_copyAppsScriptBody_(destRoot) {
  try {
    var scriptId = ScriptApp.getScriptId();
    if (!scriptId) return false;
    var scriptFile = DriveApp.getFileById(scriptId);
    scriptFile.makeCopy(scriptFile.getName(), destRoot);
    return true;
  } catch (err) {
    Logger.log("[StdFolders_copyAppsScriptBody_] appsscript 本体の複製に失敗: " + nfbErrorToString_(err));
    return false;
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

// ファイル JSON に id を埋め込む（無ければスキップ）。
function StdFolders_embedIdInFile_(fileId, id) {
  if (!id) return;
  try {
    var file = DriveApp.getFileById(fileId);
    var json = JSON.parse(file.getBlob().getDataAsString());
    json.id = id;
    file.setContent(JSON.stringify(json, null, 2));
  } catch (err) {
    Logger.log("[StdFolders_embedIdInFile_] " + fileId + ": " + nfbErrorToString_(err));
  }
}

// フォーム定義ファイルの id 埋め込み + リンク再配線。クリアしたリンク数を返す。
function StdFolders_rewireFormFile_(fileId, formId, idMap, folderIdMap, copyWebhooks) {
  var cleared = 0;
  try {
    var file = DriveApp.getFileById(fileId);
    var json = JSON.parse(file.getBlob().getDataAsString());
    if (formId) json.id = formId;

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

// ダッシュボード定義ファイルの id 埋め込み + questionId 存在チェック。クリア数を返す。
function StdFolders_rewireDashboardFile_(fileId, dashboardId, copiedQuestionIds) {
  var cleared = 0;
  try {
    var file = DriveApp.getFileById(fileId);
    var json = JSON.parse(file.getBlob().getDataAsString());
    if (dashboardId) json.id = dashboardId;

    if (Array.isArray(json.cards)) {
      for (var i = 0; i < json.cards.length; i++) {
        var card = json.cards[i];
        if (card && typeof card.questionId === "string" && card.questionId) {
          if (!copiedQuestionIds[card.questionId]) {
            card.questionId = "";
            cleared++;
          }
        }
      }
    }

    file.setContent(JSON.stringify(json, null, 2));
  } catch (err) {
    Logger.log("[StdFolders_rewireDashboardFile_] " + fileId + ": " + nfbErrorToString_(err));
  }
  return cleared;
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

    return {
      ok: true,
      forms: formsResult,
      questions: questionsResult,
      dashboards: dashboardsResult
    };
  });
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
  var count = 0;
  var files = folder.getFiles();
  while (files.hasNext()) {
    var file = files.next();
    if (typeof file.isTrashed === "function" && file.isTrashed()) continue;
    if (!StdFolders_isJsonFile_(file)) continue;
    var fileId = file.getId();
    if (mappedFileIds[fileId]) continue; // 既に登録済みのファイルは再採番しない
    var json;
    try {
      json = JSON.parse(file.getBlob().getDataAsString());
    } catch (err) {
      Logger.log("[StdFolders_rebuildFormsMapping_] parse failed: " + file.getName());
      continue;
    }
    if (!json || !Array.isArray(json.schema)) continue;
    var id = (typeof json.id === "string" && json.id) ? json.id : Nfb_generateFormId_();
    var title = (json.settings && json.settings.formTitle) || json.description || id;
    mapping[id] = { fileId: fileId, driveFileUrl: file.getUrl(), title: title };
    mappedFileIds[fileId] = true;
    if (typeof json.folder === "string" && json.folder) folderPaths.push(json.folder);
    // 認証用 URL マップにも登録（?form=xxx で開けるように）
    try { AddFormUrl_(id, file.getUrl()); } catch (e) { /* non-critical */ }
    count++;
  }
  Forms_saveMapping_(mapping);
  Forms_saveFolders_(folderPaths);
  return { count: count };
}

function StdFolders_rebuildAnalyticsMapping_(root, type) {
  var key = type === "questions" ? NFB_STD_FOLDER_NAMES.questions : NFB_STD_FOLDER_NAMES.dashboards;
  var sub = root.getFoldersByName(key);
  if (!sub.hasNext()) return { count: 0 };
  var folder = sub.next();
  var prefix = type === "questions" ? "q" : "d";
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
    var id = (typeof json.id === "string" && json.id) ? json.id : (prefix + "_" + Nfb_generateUlid_());
    mapping[id] = { fileId: fileId, driveFileUrl: file.getUrl(), name: json.name || id };
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
// 公開 API（google.script.run 用）— executeAction_ 経由で adminOnly ゲートを通す。
// ---------------------------------------------

function nfbCopyStandardFolders(payload)     { return Nfb_runScriptAction_("std_folders_copy", payload || {}); }
function nfbRebuildMappingsFromFolders(payload) { return Nfb_runScriptAction_("std_folders_rebuild_map", payload || {}); }
function nfbExportMapping(payload)           { return Nfb_runScriptAction_("std_folders_export_map", payload || {}); }
function nfbImportMapping(payload)           { return Nfb_runScriptAction_("std_folders_import_map", payload || {}); }
