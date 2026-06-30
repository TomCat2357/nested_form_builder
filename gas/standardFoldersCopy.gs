// =============================================
// 標準フォルダ構成: 構成コピー（システムごとコピー）
// standardFolders.gs から分離。バンドル時に連結されるため関数はグローバル。
// 共有ヘルパー walkFields_ は standardFolders.gs 側（リンク診断と共用）。
// =============================================

// Drive ファイル URL/ID を idMap（oldFileId → { newFileId, newUrl }）で置換する。
// 戻り値: { value, status } status は "remapped" | "cleared" | "unchanged"。
function StdFolders_remapFileUrl_(url, idMap) {
  var raw = Nfb_trimStr_(url);
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
  var raw = Nfb_trimStr_(url);
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
    var folderIdMap = {};   // srcFolderId → destFolderUrl（標準サブフォルダ＋ネスト配下）
    var summary = {};
    // コピー全体で共有するガード（暴走バックストップ）と訪問済み集合（多親/循環保護）。
    // maxNodes はあくまで保険で、実際の主制約は GAS の 6 分実行制限。truncated は戻り値で通知する。
    var copyGuard = { count: 0, maxNodes: 5000, maxDepth: 20, truncated: false };
    var copyVisited = {};

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

      // 直下ファイルだけでなくサブフォルダ配下（06_upload_files/<レコード>/… 等）も再帰複製する。
      var copied = [];
      StdFolders_copyFolderTree_(srcSub, destSub, {
        key: key, copyData: copyData, idMap: idMap, folderIdMap: folderIdMap,
        copied: copied, visited: copyVisited, guard: copyGuard
      }, 0);
      copiedFilesByKey[key] = copied;
      summary[key] = copied.length;
    }

    // --- 第2パス: コピー先ファイルのリンク（childFormId / formId / questionId / 各種 URL）を idMap で再配線 ---
    // id は埋め込まない（id ＝ fileId）。コピー先では新 fileId が新 id になり、リンクも新 fileId を指す。
    // エンティティ間参照は保存時整合と同じ正準ビジター（StdFolders_forEachRef_ 経由）で巡回するため、
    // フォーム同士・Q→フォーム・ダッシュボード→Q の全種別が漏れなく再配線される。コピー対象に
    // 含まれない参照は id を空にし（コピー元へは残さない）、論理パスを保持して未解決として数える。
    var clearedLinks = 0;     // URL 系（spreadsheet / 印刷様式 / アップロード先 / 外部アクション）でクリアした数
    var unresolvedLinks = 0;  // エンティティ参照（3 種合算）でコピー対象外を指していたため空にした数

    // forms (01_forms): spreadsheet / フォルダ / 外部アクション URL + 子フォームリンク（childFormId）を再マップ
    var formCopied = copiedFilesByKey["forms"] || [];
    for (var fi = 0; fi < formCopied.length; fi++) {
      var formRes = StdFolders_rewireFormFile_(formCopied[fi].newFileId, idMap, folderIdMap, selectedKeys.externalActions);
      clearedLinks += formRes.cleared;
      unresolvedLinks += formRes.unresolved;
    }

    // questions (02_questions): query.gui.formId / query.formSources[].formId を新 fileId へ再マップ
    var qCopied = copiedFilesByKey["questions"] || [];
    for (var qj = 0; qj < qCopied.length; qj++) {
      unresolvedLinks += StdFolders_rewireQuestionFile_(qCopied[qj].newFileId, idMap);
    }

    // dashboards (03_dashboards): cards[].questionId を新 fileId へ再マップ。
    // unresolvedQuestionLinks は後方互換のためダッシュボード→Question の未解決数を別途保持する。
    var unresolvedQuestionLinks = 0;
    var dCopied = copiedFilesByKey["dashboards"] || [];
    for (var dj = 0; dj < dCopied.length; dj++) {
      unresolvedQuestionLinks += StdFolders_rewireDashboardFile_(dCopied[dj].newFileId, idMap);
    }
    unresolvedLinks += unresolvedQuestionLinks;

    // 再構築 ON のときはコピー先ルートへ _nfb_mapping.json を書き出す（論理パスのみ・源の物理 ID は残さない）。
    // 復元はコピー先で手動：設定 > 管理 の「インポート」（URL 空欄でルートの最新 .json を読込）。
    if (rebuildMapping) {
      StdFolders_writeMappingFile_(destRoot, StdFolders_buildCopiedMappingDoc_(idMap));
    }

    return {
      ok: true,
      destRootUrl: destRoot.getUrl(),
      summary: summary,
      clearedLinks: clearedLinks,
      unresolvedLinks: unresolvedLinks,
      unresolvedQuestionLinks: unresolvedQuestionLinks,
      copyData: copyData,
      copyExternalActions: selectedKeys.externalActions,
      categories: selectedKeys,
      rebuildMapping: rebuildMapping,
      appsScriptCopied: appsScriptCopied,
      appsScriptCopyError: appsScriptCopied ? "" : (appsScriptCopyResult.reason || ""),
      truncated: copyGuard.truncated,
      message: (rebuildMapping
        ? "コピーが完了しました。コピー先ルートに _nfb_mapping.json を保存しました。コピー先の 設定 > 管理 から「インポート」（URL 空欄でルートの最新を読込）を実行してマッピングを復元してください。コピー先スクリプトの Web アプリは手動で再デプロイしてください。"
        : "コピーが完了しました。コピー先の 設定 > 管理 から「インポート」を実行してマッピングを復元してください。コピー先スクリプトの Web アプリは手動で再デプロイしてください。")
        + (unresolvedLinks > 0
          ? "\n※ コピー対象に含まれない参照（フォーム同士 / Question→フォーム / ダッシュボード→Question）が " + unresolvedLinks + " 件あります。コピー元へは繋がず論理パス（folder/名前）を保持しているので、編集画面のリンク差し替え、またはコピー先で対象を取り込んで保存した際の再リンクで復旧してください。"
          : "")
        + (copyGuard.truncated
          ? "\n※ コピーするファイル数が上限（" + copyGuard.maxNodes + " 件）に達したため一部が未複製です。コピー先を確認し、不足分は再実行してください。"
          : "")
    };
  });
}

// srcFolder の中身（直下ファイル＋サブフォルダ配下）を destFolder へ再帰的に複製する。
// - 各ファイルを makeCopy し ctx.idMap（旧fileId→{newFileId,newUrl}）/ ctx.copied に登録。
//   key==="spreadsheets" かつ !copyData のときはコピー先スプレッドシートの 12 行目以降を消去。
// - 各サブフォルダは destFolder 配下に get-or-create で再現し ctx.folderIdMap（srcFolderId→destFolderUrl）
//   へ登録してから再帰（ネストした upload フォルダ等の driveRootFolderUrl 再マップに使う）。
// ctx.guard（count/maxNodes/maxDepth/truncated）と ctx.visited で暴走・多親/循環を保護する。
function StdFolders_copyFolderTree_(srcFolder, destFolder, ctx, depth) {
  var guard = ctx.guard;
  if (guard.truncated || depth > guard.maxDepth) return;
  var files = srcFolder.getFiles();
  while (files.hasNext()) {
    if (guard.count >= guard.maxNodes) { guard.truncated = true; return; }
    var srcFile = files.next();
    if (typeof srcFile.isTrashed === "function" && srcFile.isTrashed()) continue;
    var srcFileId = srcFile.getId();
    var newFile = srcFile.makeCopy(srcFile.getName(), destFolder);
    var newFileId = newFile.getId();
    ctx.idMap[srcFileId] = { newFileId: newFileId, newUrl: newFile.getUrl() };
    ctx.copied.push({ newFileId: newFileId, srcFileId: srcFileId });
    guard.count++;

    // スプレッドシートかつ「データを含めない」場合は 12 行目以降を消去
    if (ctx.key === "spreadsheets" && !ctx.copyData) {
      StdFolders_clearSpreadsheetData_(newFileId);
    }
    // データごとコピーのときは、アップロードセルの物理（fileId/url/folderUrl）を空にして
    // 論理パス（folderName + ファイル名）だけ残す。コピー先で読取/出力時に論理解決が発火し、
    // 自プロジェクトの 06_upload_files 内の複製ファイルへ自動バインドする（コピー元を指さない）。
    if (ctx.key === "spreadsheets" && ctx.copyData) {
      StdFolders_clearUploadPhysicalInSpreadsheet_(newFileId);
    }
  }
  var subIt = srcFolder.getFolders();
  while (subIt.hasNext()) {
    if (guard.truncated) return;
    var srcChild = subIt.next();
    if (typeof srcChild.isTrashed === "function" && srcChild.isTrashed()) continue;
    var cid = srcChild.getId();
    if (ctx.visited[cid]) continue;        // 多親/循環保護
    ctx.visited[cid] = true;
    var destChild = StdFolders_getOrCreateChildFolder_(destFolder, srcChild.getName());
    ctx.folderIdMap[cid] = destChild.getUrl();
    StdFolders_copyFolderTree_(srcChild, destChild, ctx, depth + 1);
  }
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

// コピー先スプレッドシートのデータ行（12 行目以降）を走査し、fileUpload 形のセル
// （`{files:[…],folderUrl,folderName}` または `[{driveFileId…}]`）の物理（driveFileId /
// driveFileUrl / folderUrl）だけを空にして書き戻す。name / folderName（論理パス）は保持する。
// フォーム schema に依存せず JSON 形状で判定するため自己完結（どのシート/列でも検出可能）。
// 物理を空にすることで、コピー先での読取/出力時に論理パス解決が発火し、自プロジェクトの
// 06_upload_files 内の複製へ再リンクされる（コピー元への参照残留を防ぐ）。
function StdFolders_clearUploadPhysicalInSpreadsheet_(spreadsheetId) {
  try {
    var ss = SpreadsheetApp.openById(spreadsheetId);
    var sheets = ss.getSheets();
    for (var s = 0; s < sheets.length; s++) {
      var sheet = sheets[s];
      var lastRow = sheet.getLastRow();
      var lastCol = sheet.getLastColumn();
      if (lastRow < NFB_DATA_START_ROW || lastCol < 1) continue;
      var range = sheet.getRange(NFB_DATA_START_ROW, 1, lastRow - NFB_DATA_START_ROW + 1, lastCol);
      var values = range.getValues();
      var changed = false;
      for (var r = 0; r < values.length; r++) {
        for (var c = 0; c < values[r].length; c++) {
          var cleared = StdFolders_clearUploadPhysicalInCell_(values[r][c]);
          if (cleared.changed) {
            values[r][c] = cleared.value;
            changed = true;
          }
        }
      }
      if (changed) range.setValues(values);
    }
  } catch (err) {
    Logger.log("[StdFolders_clearUploadPhysicalInSpreadsheet_] " + spreadsheetId + ": " + nfbErrorToString_(err));
  }
}

// 1 セル分の fileUpload JSON から物理（driveFileId / driveFileUrl / folderUrl）を空にする純変換。
// fileUpload 形でなければ { changed:false } を返す（他の列を壊さない）。
// 戻り値: { changed: boolean, value: string }（value は変更時のみ再シリアライズした文字列）。
function StdFolders_clearUploadPhysicalInCell_(raw) {
  if (typeof raw !== "string") return { changed: false };
  var trimmed = raw.trim();
  if (!trimmed || (trimmed.charAt(0) !== "{" && trimmed.charAt(0) !== "[")) return { changed: false };
  var parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch (e) {
    return { changed: false };
  }

  var files = null;
  var isObjectForm = false;
  if (Object.prototype.toString.call(parsed) === "[object Array]") {
    files = parsed;
  } else if (parsed && typeof parsed === "object" && Object.prototype.toString.call(parsed.files) === "[object Array]") {
    files = parsed.files;
    isObjectForm = true;
  } else {
    return { changed: false };
  }

  // fileUpload 形の確証（各エントリが driveFileId / driveFileUrl / name のいずれかを持つ）。
  var looksLikeUpload = false;
  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    if (f && typeof f === "object" && ("driveFileId" in f || "driveFileUrl" in f || "name" in f)) {
      looksLikeUpload = true;
      break;
    }
  }
  if (!looksLikeUpload && !(isObjectForm && ("folderUrl" in parsed || "folderName" in parsed))) {
    return { changed: false };
  }

  for (var j = 0; j < files.length; j++) {
    var entry = files[j];
    if (entry && typeof entry === "object") {
      entry.driveFileId = "";
      entry.driveFileUrl = "";
    }
  }
  if (isObjectForm) parsed.folderUrl = "";

  return { changed: true, value: JSON.stringify(parsed) };
}

// エンティティ間参照（Q→Form / D→Q / Form→子Form）の物理 ID を「全消去」し、論理パス（*Path）を
// 復旧アンカーとして温存する。保存時整合と同じ正準ビジター StdFolders_forEachRef_ で巡回し、種別の
// 取りこぼしを防ぐ。物理＝消去可能なキャッシュ／論理＝耐久的な正本、の方針に従い、コピー時は物理を
// 一切引き継がず、コピー先で *Path から再解決させる（Admin_rebuildRegistryFromLogical_ ゲート →
// Admin_reresolveAllRefsFromLogical_）。コピー元 fileId を残すとコピー先がコピー元を指す事故になるため
// 必ずクリアする。idMap は「コピー対象に含まれたか」の判定だけに使う（含まれない＝コピー先で再解決
// 不能なので未解決として数える）。戻り値: 未解決（コピー対象外を指していた）参照の件数。
function StdFolders_rewireEntityRefsInJson_(json, kind, idMap) {
  var unresolved = 0;
  StdFolders_forEachRef_(json, kind, function(ref) {
    var oldId = ref.holder[ref.idKey];
    if (!oldId) return;
    ref.holder[ref.idKey] = "";                 // 物理全消去・*Path は温存（コピー先で論理再解決）
    if (!idMap[oldId]) unresolved++;            // コピー対象外＝コピー先に実体が無く再解決できない
  });
  return unresolved;
}

// エンティティ自身の物理 URL（driveFileUrl）を消す。コピー元のファイルを指すため温存禁止。
// 読取時にコピー先の実体の file.getUrl() から復元される（forms/questions/dashboards 共通）。
// 既に無い json（questions/dashboards は通常 driveFileUrl 非永続）には空キーを足さない。
function StdFolders_clearSelfPhysicalUrlInJson_(json) {
  if (json && json.driveFileUrl) json.driveFileUrl = "";
}

// フォーム定義ファイルのリンク再配線（id は埋め込まない＝id ＝ fileId）。
// 物理＝キャッシュ／論理＝正本の方針に従い、コピー時はエンティティ参照・spreadsheet・印刷様式の
// 物理（id/URL）を「全消去」し、各 *Path（spreadsheetPath / standardPrintTemplatePath / templatePath /
// childFormPath）を温存する。コピー先で Admin_rebuildRegistryFromLogical_ ゲート → 再解決で物理を貼り直す。
// コピー元 fileId を残すとコピー先がコピー元（別プロジェクト・生存 fileId）を指す事故になるため必ずクリアする。
// 外部アクション送信先（externalAction.url）だけは論理パスを持たない外部 /exec なので、従来どおり
// copyExternalActions OFF のときに限りクリアする（cleared に計上）。folderIdMap は現状未使用（後方互換で受ける）。
// 戻り: { cleared, unresolved }。cleared=外部アクション URL を空にした数（論理復旧不能で真に失われる）。
//        unresolved=コピー対象外（idMap 未収載）を指していた子フォーム参照数（*Path は保持）。
function StdFolders_rewireFormFile_(fileId, idMap, folderIdMap, copyExternalActions) {
  var cleared = 0;
  var unresolved = 0;
  try {
    var read = Nfb_readJsonFileById_(fileId);
    var file = read.file;
    var json = read.json;

    // フォーム自身の物理 URL（driveFileUrl）を消去（leaf json に永続化される＝コピー元を指す）。
    // 読取時にコピー先の実体の file.getUrl() から復元される（消さないと復元が発火せず元を指し続ける）。
    StdFolders_clearSelfPhysicalUrlInJson_(json);

    // form → spreadsheet: 物理（spreadsheetId）を消去し論理（spreadsheetPath）を温存。
    // コピー先で spreadsheetPath が 04_spreadsheets の同構造へ再解決される（読取/保存時の物理優先→論理）。
    if (json.settings && json.settings.spreadsheetId) {
      json.settings.spreadsheetId = "";
    }

    // form → 標準印刷様式 Doc（フォームレベル）: 物理 id を消去し論理（standardPrintTemplatePath）を温存。
    //   新 *Id キー（素 fileId）と旧 *Url キー（後方互換データ）の両方をクリアする。
    if (json.settings && json.settings.standardPrintTemplateId) {
      json.settings.standardPrintTemplateId = "";
    }
    if (json.settings && json.settings.standardPrintTemplateUrl) {
      json.settings.standardPrintTemplateUrl = "";
    }

    // schema フィールド内の URL/フォルダ系リンク
    StdFolders_walkFields_(json.schema, function(field) {
      // 印刷様式テンプレート（field 個別）: 物理 id を消去し論理（templatePath）を温存（新 *Id ＋ 旧 *Url）。
      if (field.printTemplateAction && field.printTemplateAction.templateId) {
        field.printTemplateAction.templateId = "";
      }
      if (field.printTemplateAction && field.printTemplateAction.templateUrl) {
        field.printTemplateAction.templateUrl = "";
      }
      // アップロード先は常に自プロジェクトの 06_upload_files 直下（ユーザー指定不可）になったため、
      // フォーム定義に driveRootFolderUrl は持たない（旧フォームに残っていても無視・次回保存で除去）。
      // 外部アクション 送信先（copyExternalActions OFF のときはクリア。ON のときは外部 /exec をそのまま温存）
      if (field.externalAction && typeof field.externalAction.url === "string" && field.externalAction.url) {
        if (!copyExternalActions) {
          field.externalAction.url = "";
          cleared++;
        }
      }
    });

    // 設定レベルの外部アクション 送信先（settings.externalActions.search[].url 等）も、フィールド個別の
    // externalAction.url と同様 copyExternalActions OFF のときクリアする（外部 /exec で論理パスを持たない）。
    // 旧 record[] など search 以外の配列も拾うため externalActions 配下の全 array 値プロパティを走査する。
    if (!copyExternalActions && json.settings && json.settings.externalActions && typeof json.settings.externalActions === "object") {
      var extActs = json.settings.externalActions;
      for (var listKey in extActs) {
        if (!extActs.hasOwnProperty(listKey)) continue;
        var list = extActs[listKey];
        if (Object.prototype.toString.call(list) !== "[object Array]") continue;
        for (var ei = 0; ei < list.length; ei++) {
          var act = list[ei];
          if (act && typeof act === "object" && typeof act.url === "string" && act.url) {
            act.url = "";
            cleared++;
          }
        }
      }
    }

    // エンティティ参照（formLink の childFormId）を物理全消去（*Path 温存・コピー先で再解決）。
    unresolved += StdFolders_rewireEntityRefsInJson_(json, "forms", idMap);

    Nfb_writeJsonToFile_(file, json);
  } catch (err) {
    Logger.log("[StdFolders_rewireFormFile_] " + fileId + ": " + nfbErrorToString_(err));
  }
  return { cleared: cleared, unresolved: unresolved };
}

// クエスチョン定義ファイルの formId 再配線（id は埋め込まない＝id ＝ fileId）。
// query.gui.formId と query.formSources[].formId を idMap で新 fileId へ写像する。
// idMap に無い（コピー対象外）の formId は空にし（コピー元へは残さない＝論理パス優先）、
// formPath を復旧アンカーとして保持して未解決として数える。戻り値: 未解決リンク数。
function StdFolders_rewireQuestionFile_(fileId, idMap) {
  var unresolved = 0;
  try {
    var read = Nfb_readJsonFileById_(fileId);
    var file = read.file;
    var json = read.json;
    StdFolders_clearSelfPhysicalUrlInJson_(json);   // 自身の物理 URL を消去（通常 no-op・旧データ救済）
    unresolved = StdFolders_rewireEntityRefsInJson_(json, "questions", idMap);
    Nfb_writeJsonToFile_(file, json);
  } catch (err) {
    Logger.log("[StdFolders_rewireQuestionFile_] " + fileId + ": " + nfbErrorToString_(err));
  }
  return unresolved;
}

// ダッシュボード定義ファイルの questionId 再配線（id は埋め込まない＝id ＝ fileId）。
// cards[].questionId を idMap で新 fileId へ写像する。idMap に無い（コピー対象外）の参照は
// questionId を空にし（コピー元へは残さない＝論理パス優先）、questionPath を復旧アンカーとして
// 保持したまま未解決として数える。戻り値: 未解決リンク数。
function StdFolders_rewireDashboardFile_(fileId, idMap) {
  var unresolved = 0;
  try {
    var read = Nfb_readJsonFileById_(fileId);
    var file = read.file;
    var json = read.json;
    StdFolders_clearSelfPhysicalUrlInJson_(json);   // 自身の物理 URL を消去（通常 no-op・旧データ救済）
    unresolved = StdFolders_rewireEntityRefsInJson_(json, "dashboards", idMap);
    Nfb_writeJsonToFile_(file, json);
  } catch (err) {
    Logger.log("[StdFolders_rewireDashboardFile_] " + fileId + ": " + nfbErrorToString_(err));
  }
  return unresolved;
}

// コピーされたエンティティ（idMap 収載）の _nfb_mapping.json（version 2・論理パスのみ）を組み立てる。
// idMap は「コピー対象に含まれたか」の判定だけに使い、コピー元/コピー先いずれの fileId も書き出さない。
// 各エントリは folder ＋ 名前（nameKey）だけを持ち、出力のキーも論理パス（本番 registry の fileId キーを
// 引き回さない）。取り込み時はコピー先ツリーを走査して論理パス→ローカル fileId を解決するため、源の
// 物理 ID は一切残さない（＝コピー後にコピー元を指す事故を防ぐ）。コピー復元ゲートは isCopy:true で発火する。
function StdFolders_buildCopiedMappingDoc_(idMap) {
  function remapSection(mapping, nameKey) {
    var out = {};
    var usedKeys = {};
    for (var id in mapping) {
      if (!mapping.hasOwnProperty(id)) continue;
      var entry = mapping[id] || {};
      var srcFileId = Nfb_resolveFileIdFromEntry_(entry);
      if (!srcFileId || !idMap[srcFileId]) continue;   // コピー対象に含まれたものだけ
      var name = entry[nameKey];
      if (typeof name !== "string" || !name) continue; // 名前無しは論理パスを作れない
      var next = {};
      next[nameKey] = name;
      next.folder = (typeof entry.folder === "string") ? entry.folder : ""; // 論理パス（folder/名前）のみ
      out[StdFolders_logicalExportKey_(next.folder, name, usedKeys)] = next;
    }
    return out;
  }
  return {
    type: "nfb-mapping",
    version: 2,
    exportedAt: new Date().toISOString(),
    isCopy: true,
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
