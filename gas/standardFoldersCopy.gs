// =============================================
// 標準フォルダ構成: 構成コピー（システムごとコピー）
// standardFolders.gs から分離。バンドル時に連結されるため関数はグローバル。
// 共有ヘルパー walkFields_ は standardFolders.gs 側（リンク診断と共用）。
// =============================================

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

function StdFolders_copy_(payload) {
  return nfbSafeCall_(function() {
    var destRootUrl = payload ? Nfb_trimStr_(payload.destRootUrl) : "";
    if (!destRootUrl) throw new Error("コピー先ルートフォルダの URL を指定してください");
    var copyData = !!(payload && (payload.copyData === true || payload.copyData === "true"));
    var copyExternalActions = !!(payload && (payload.copyExternalActions === true || payload.copyExternalActions === "true"));
    // マッピング再構築は既定 ON（明示 false / "false" のときだけ OFF）。
    var rebuildMapping = !(payload && (payload.rebuildMapping === false || payload.rebuildMapping === "false"));
    // カテゴリ単位の選択（payload.categories）を 8 キー全件の bool マップへ正規化する。
    // 未指定なら全カテゴリ ON（＝従来の一括コピー）。以降は selectedKeys を唯一の真実とし、
    // externalActions も selectedKeys.externalActions に一本化する（フォーム内の外部アクション
    // URL クリア判定も同値で行う）。旧クライアント互換のため copyExternalActions は coerce 前の
    // 生値を渡す（undefined と明示 false を区別する必要があるため）。
    var selectedKeys = StdFolders_normalizeCategorySelection_(payload && payload.categories, payload && payload.copyExternalActions);

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

    // フォルダ（標準 8 階層）は選択に関わらずコピー先へ常に作成する（中身は選択次第で空になる）。
    StdFolders_ensureAllSubfolders_(destRoot);

    // id ＝ Drive fileId へ統一したため、コピー先では全ファイルが新 fileId（＝新 id）になる。
    // リンク（formId / questionId）はコピー時に idMap（旧fileId→新fileId）で再マップする。
    var idMap = {};         // oldFileId → { newFileId, newUrl }
    var folderIdMap = {};   // srcSubfolderId → destSubfolderUrl
    var summary = {};

    // --- 第1パス: 8 キー全件を回す。フォルダ URL（folderIdMap）は選択に関わらず登録し、
    // 未選択カテゴリはファイル複製のみスキップする（フォルダは上で作成済み）。 ---
    var srcSubByKey = {};
    var destSubByKey = {};
    var copiedFilesByKey = {}; // key → [{ newFileId, srcFileId }]
    for (var ki = 0; ki < NFB_STD_FOLDER_ORDER.length; ki++) {
      var key = NFB_STD_FOLDER_ORDER[ki];
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
      // フォルダ URL の張替は選択に関わらず効かせる（例: upload 未選択でもフォームの
      // driveRootFolderUrl をコピー先の同名フォルダ URL へ向け直せるようにする）。
      folderIdMap[srcSub.getId()] = destSub.getUrl();

      // 未選択カテゴリはファイルを複製しない（フォルダだけ作成して空にする）。
      if (!selectedKeys[key]) {
        summary[key] = 0;
        continue;
      }

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

    // forms (01_forms): spreadsheet / フォルダ / 外部アクション URL を再マップ
    var formCopied = copiedFilesByKey["forms"] || [];
    for (var fi = 0; fi < formCopied.length; fi++) {
      clearedLinks += StdFolders_rewireFormFile_(formCopied[fi].newFileId, idMap, folderIdMap, selectedKeys.externalActions);
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
    // 復元はコピー先で手動：設定 > 管理 の「インポート」（URL 空欄でルートの最新 .json を読込）。
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
      copyExternalActions: selectedKeys.externalActions,
      categories: selectedKeys,
      rebuildMapping: rebuildMapping,
      appsScriptCopied: appsScriptCopied,
      appsScriptCopyError: appsScriptCopied ? "" : (appsScriptCopyResult.reason || ""),
      message: (rebuildMapping
        ? "コピーが完了しました。コピー先ルートに _nfb_mapping.json を保存しました。コピー先の 設定 > 管理 から「インポート」（URL 空欄でルートの最新を読込）を実行してマッピングを復元してください。コピー先スクリプトの Web アプリは手動で再デプロイしてください。"
        : "コピーが完了しました。コピー先の 設定 > 管理 から「インポート」を実行してマッピングを復元してください。コピー先スクリプトの Web アプリは手動で再デプロイしてください。")
        + (unresolvedQuestionLinks > 0
          ? "\n※ ダッシュボードからコピー対象外の Question を参照しているカードが " + unresolvedQuestionLinks + " 件あります。参照は保持しているので、コピー先で各エンティティを保存した際に自動再リンクされるか、編集画面のリンク差し替えで復旧できます。"
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
function StdFolders_rewireFormFile_(fileId, idMap, folderIdMap, copyExternalActions) {
  var cleared = 0;
  try {
    var read = Nfb_readJsonFileById_(fileId);
    var file = read.file;
    var json = read.json;

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
      // 外部アクション 送信先（copyExternalActions OFF のときはクリア。ON のときは外部 /exec をそのまま温存）
      if (field.externalAction && typeof field.externalAction.url === "string" && field.externalAction.url) {
        if (!copyExternalActions) {
          field.externalAction.url = "";
          cleared++;
        }
      }
    });

    Nfb_writeJsonToFile_(file, json);
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
    var read = Nfb_readJsonFileById_(fileId);
    var file = read.file;
    var json = read.json;
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
    Nfb_writeJsonToFile_(file, json);
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
    var read = Nfb_readJsonFileById_(fileId);
    var file = read.file;
    var json = read.json;

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

    Nfb_writeJsonToFile_(file, json);
  } catch (err) {
    Logger.log("[StdFolders_rewireDashboardFile_] " + fileId + ": " + nfbErrorToString_(err));
  }
  return unresolved;
}

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
      if (typeof entry.folder === "string") next.folder = entry.folder; // 論理パス L を引き回す（dead-F 解決の保険）。
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
