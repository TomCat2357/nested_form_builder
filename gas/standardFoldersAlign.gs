// =============================================
// 標準フォルダ構成: 論理↔物理 整合同期エンジン（6ケース）
// standardFolders.gs から分離。バンドル時に連結されるため関数はグローバル。
// =============================================

// =============================================
// (2.6) 論理↔物理 整合（⓪①②③・エントリ単位）
// 登録エンティティごとに (論理パス, 物理位置 P, fileId 解決) を比較する。修復方向は「物理が今どこに
// あるか」で決める（ハイブリッド: ホーム内は物理優先 / ホーム外は論理優先）。手動の「同期（フォルダ
// 走査）」は廃止され、現在は保存時の参照整合（alignReferencesOnSave_）と、フォルダのリネーム/移動後の
// 自己修復（verify パス）から呼ばれる。
//
//   生存 fileId:
//     ⓪/① 物理がホーム標準フォルダ配下 → 物理優先。json.folder / entry.folder / 名前を物理に合わせる
//                                          （フォルダ移動・改名いずれも物理を採用、move/copy しない）
//     ②   物理がプロジェクト内の別標準フォルダ → 論理優先。ホームの元論理パス位置へ move（id 保持）
//     ③   物理がプロジェクト外                 → 論理優先。ホームへ copy 取り込み + コピー先新 id 採用
//   死亡 fileId:
//     ・論理パスに同名別 id → その物理 id を再採用（mapping 振替え rekey）
//     ・物理も未発見        → 削除せずエラー報告
//
// 論理フォルダのリネーム/移動は影響エンティティに ⓪①②③（verify パス）を適用する。
// base（標準フォルダ）が解決できない kind は no-op に degrade する。
// =============================================

// kind ("forms"|"questions"|"dashboards") のストア/物理操作/検証を束ねたアダプタを返す。
// 型分岐をここ 1 箇所に閉じ込め、エンジン本体は adapter 経由で型汎用に動く。
function StdFolders_entityAdapter_(kind) {
  if (kind === "forms") {
    return {
      kind: "forms",
      stdKey: "forms",
      nameField: "title",
      getMapping: function() { return Forms_getMapping_(); },
      saveMapping: function(m) { Forms_saveMapping_(m); },
      getFolders: function() { return Forms_getFolders_(); },
      saveFolders: function(paths) { Forms_saveFolders_(paths); },
      baseFolderOrNull: function() { return FormsDrive_baseFolderOrNull_(); },
      lookupFolderForPath: function(p) { return FormsDrive_lookupFolderForPath_(p); },
      ensureFolderForPath: function(p) { return FormsDrive_ensureFolderForPath_(p); },
      moveFileToPath: function(fileId, p) { return FormsDrive_moveFormFileToPath_(fileId, p); },
      relativeFolderOfFile: function(fileId) { return FormsDrive_relativeFolderOfFile_(fileId); },
      isValidEntityJson: function(json) { return !!(json && Array.isArray(json.schema)); }
    };
  }
  var type = (kind === "questions") ? "questions" : "dashboards";
  return {
    kind: type,
    stdKey: type,
    nameField: "name",
    getMapping: function() { return Analytics_getMapping_(type); },
    saveMapping: function(m) { Analytics_saveMapping_(type, m); },
    getFolders: function() { return Analytics_getFolders_(type); },
    saveFolders: function(paths) { Analytics_saveFoldersRegistry_(type, paths); },
    baseFolderOrNull: function() { return AnalyticsDrive_baseFolderOrNull_(type); },
    lookupFolderForPath: function(p) { return AnalyticsDrive_lookupFolderForPath_(type, p); },
    ensureFolderForPath: function(p) { return AnalyticsDrive_ensureFolderForPath_(type, p); },
    moveFileToPath: function(fileId, p) { return AnalyticsDrive_moveItemFileToPath_(type, fileId, p); },
    relativeFolderOfFile: function(fileId) { return AnalyticsDrive_relativeFolderOfFile_(type, fileId); },
    isValidEntityJson: function(json) { return !!(json && typeof json === "object"); }
  };
}

// fileId の JSON を読みパースして返す（取得不能・ゴミ箱・parse 失敗は null）。
function StdFolders_readJsonByFileId_(fileId) {
  if (!fileId) return null;
  try {
    var f = DriveApp.getFileById(fileId);
    if (typeof f.isTrashed === "function" && f.isTrashed()) return null;
    return JSON.parse(f.getBlob().getDataAsString());
  } catch (e) {
    return null;
  }
}

// folder の直下から fileName と一致する非 trashed ファイル（最初の 1 件）。無ければ null。
// （mock 差異を避けるため getFilesByName ではなく getFiles 走査で照合する。）
function StdFolders_findFileByNameInFolder_(folder, fileName) {
  if (!folder) return null;
  var files = folder.getFiles();
  while (files.hasNext()) {
    var f = files.next();
    if (typeof f.isTrashed === "function" && f.isTrashed()) continue;
    if (f.getName() === fileName) return f;
  }
  return null;
}

// 外部（プロジェクト外）ファイルを L の物理フォルダへコピー取り込みする（元ファイルは残す）。
// 戻り: { newFileId, newUrl } / 失敗 null。
function StdFolders_copyEntryIntoProject_(adapter, srcFileId, L, N) {
  try {
    var dest = adapter.ensureFolderForPath(L);
    if (!dest) return null;
    var src = DriveApp.getFileById(srcFileId);
    var copied = src.makeCopy(src.getName(), dest);
    return { newFileId: copied.getId(), newUrl: copied.getUrl() };
  } catch (err) {
    Logger.log("[StdFolders_copyEntryIntoProject_] " + srcFileId + " -> " + L + ": " + nfbErrorToString_(err));
    return null;
  }
}

// 登録エントリ 1 件を ①〜④ に従って整合する。戻り:
//   "aligned" | "moved" | "copiedExternal" | "rekeyed" | "error" | "none"。
// 変更したら ctx.dirty=true（呼び出し側で mapping を保存）。②外部コピーの旧→新 id は ctx.remap に記録。
// dryRun=true のときは判定のみで mutate しない（プレビュー用。orchestrator/verify は false）。
function StdFolders_alignEntry_(adapter, mapping, id, dryRun, ctx) {
  var entry = mapping[id];
  if (!entry) return "none";
  var F = Nfb_resolveFileIdFromEntry_(entry);
  var N = entry[adapter.nameField] || "";

  if (F && StdFolders_isFileIdAlive_(F)) {
    var liveFile = null;
    try { liveFile = DriveApp.getFileById(F); } catch (eF) { liveFile = null; }
    var json = StdFolders_readJsonByFileId_(F);
    var P = adapter.relativeFolderOfFile(F);   // 自分のホーム標準フォルダ配下の相対パス / null=ホーム外

    if (P !== null) {
      // ⓪/① 物理がホーム標準フォルダ配下 → 物理を正として論理（json.folder / entry.folder / 名前）を
      //     物理に合わせる。フォルダ移動・ファイル名変更は外部 Drive 操作でも物理側を採用する。
      //     アプリ側のリネームは物理ファイル名も同時に変えるため双方向で整合する前提。
      if (!dryRun) {
        var Lj = Forms_normalizeFolderPath_(json && json.folder);
        if (json && liveFile && Lj !== P) {
          json.folder = P;
          try { liveFile.setContent(JSON.stringify(json, null, 2)); }
          catch (eW) { Logger.log("[StdFolders_alignEntry_] json.folder 書戻し失敗 " + F + ": " + nfbErrorToString_(eW)); }
        }
        if (entry.folder !== P) { entry.folder = P; ctx.dirty = true; if (ctx.pathChanged) ctx.pathChanged[F] = true; }
        var fname = liveFile ? Nfb_nameFromFile_(liveFile) : "";
        // 名前（葉名）も論理パス "folder/名前" の一部。フォルダ不変でも名前変化は論理パス変化なので
        // pathChanged に積み、参照元の *Path アンカーを逆方向再リンクで再 stamp させる。
        if (fname && entry[adapter.nameField] !== fname) { entry[adapter.nameField] = fname; ctx.dirty = true; if (ctx.pathChanged) ctx.pathChanged[F] = true; }
      }
      return "aligned";
    }

    // P===null：物理がホーム標準フォルダ外。論理パス（生存ファイルの json.folder）を正として戻す。
    var L = Forms_normalizeFolderPath_(json && json.folder);
    if (StdFolders_isFileUnderProjectRoot_(F)) {
      // ② プロジェクト内の別標準フォルダ（例: form が 02_questions 内）→ ホームの L へ移動（id 保持）。
      if (!dryRun) {
        adapter.moveFileToPath(F, L);
        if (entry.folder !== L) { entry.folder = L; ctx.dirty = true; if (ctx.pathChanged) ctx.pathChanged[F] = true; }
      }
      return "moved";
    }
    // ③ プロジェクト外 → ホームの L へコピー取り込み + コピー先 id を正本採用（rekey）。
    if (!dryRun) {
      var copied = StdFolders_copyEntryIntoProject_(adapter, F, L, N);
      if (copied && copied.newFileId && copied.newFileId !== id) {
        delete mapping[id];
        entry.fileId = copied.newFileId;
        entry.driveFileUrl = copied.newUrl;
        entry.folder = L;
        mapping[copied.newFileId] = entry;
        ctx.remap[id] = copied.newFileId;
        ctx.dirty = true;
        return "copiedExternal";
      }
      // コピー不可は ④ 同様にエラー報告（黙って捨てない）。
      ctx.errors.push({ kind: adapter.kind, id: id, name: N, folder: L, reason: "プロジェクト外ファイルの取り込み（コピー）に失敗" });
      return "error";
    }
    return "copiedExternal";
  }

  // F 死亡（解決不能）。L は entry.folder（中央辞書の第一級フィールド＝論理パスの正本）から。
  // 各参照は formName/questionName を持たないため、この folder + 名前が唯一の復旧アンカーになる。
  var Ld = Forms_normalizeFolderPath_(entry.folder);
  var folderAtL = adapter.lookupFolderForPath(Ld);
  var found = folderAtL ? StdFolders_findFileByNameInFolder_(folderAtL, N + ".json") : null;
  if (found && found.getId() !== id) {
    // ③ L に同名別 id → その物理 id を再採用。旧→新 id を remap に記録し、
    //    参照（Q→Form / D→Q）が旧 id を指している場合の追従に使う。
    if (!dryRun) {
      delete mapping[id];
      entry.fileId = found.getId();
      entry.driveFileUrl = found.getUrl();
      entry.folder = Ld;
      mapping[found.getId()] = entry;
      if (ctx.remap) ctx.remap[id] = found.getId();
      ctx.dirty = true;
    }
    return "rekeyed";
  }
  // ④ fileId でも 名前@L でも発見できず → 削除せずエラー報告。
  ctx.errors.push({ kind: adapter.kind, id: id, name: N, folder: Ld, reason: "fileId未解決かつ物理ファイル未検出" });
  return "error";
}

// 論理フォルダのリネーム/移動後、影響エンティティ（affectedIds）に ①〜④ を適用する自己修復パス。
// 物理サブツリー移動の後段で呼ぶ。戻り件数 + errorList（④の詳細）。
function StdFolders_verifyEntriesAfterRelocate_(adapter, affectedIds) {
  var counts = { aligned: 0, moved: 0, copiedExternal: 0, rekeyed: 0, errors: 0, errorList: [] };
  if (!adapter.baseFolderOrNull()) return counts;
  if (!affectedIds || !affectedIds.length) return counts;
  var mapping = adapter.getMapping();
  var ctx = { errors: [], invalidCandidates: [], remap: {}, dirty: false, guard: null };
  for (var i = 0; i < affectedIds.length; i++) {
    if (!mapping[affectedIds[i]]) continue;
    var outcome = StdFolders_alignEntry_(adapter, mapping, affectedIds[i], false, ctx);
    if (counts.hasOwnProperty(outcome)) counts[outcome]++;
    else if (outcome === "error") counts.errors++;
  }
  if (ctx.dirty) adapter.saveMapping(mapping);
  counts.errorList = ctx.errors;
  return counts;
}

// =============================================
// (2.7) 全件整列オーケストレータ（手動・冪等）
// 設定「① 標準フォルダ構成を作成・整理」ボタンから呼ばれる。
// 登録済みのフォーム・Question・Dashboard を全件 ①〜④ にかけ、
//   ・物理位置が論理パスとずれていれば: プロジェクト内 move / プロジェクト外 copy（fileId 付け替え）
//   ・コピー/再採用で id が変わったら、参照（Q→Form / D→Question）を remap で張り替え（Phase B）
//   ・さらにフォーム保存時と同じ「論理パス ↔ 物理」の参照復旧を全エンティティへ適用する:
//       Phase C-1（case ①）: 死/空になった参照（エンティティ参照 + forms の spreadsheet / 印刷様式）を
//                            冗長保存した *Path から再解決して貼り直す
//       Phase C-2（case ②）: forms の spreadsheet / 印刷様式 が「生存だが設定論理パスと不一致」なら
//                            プロジェクト内=move / 外=copy で設定論理パスへ寄せて物理URLを更新する
// を一括で行う。base（標準フォルダ）未解決の kind は skipped で no-op に degrade する。
// =============================================

// 1 kind の全 id を alignEntry_ にかけ、共有 ctx に積む（remap/errors を集約）。
// alignEntry_ が反復中に mapping を mutate（外部コピー/③再採用で delete + 新キー追加）するため、
// キーを先にスナップショットして回し、新キー再処理を ctx.remap / !mapping[id] ガードで防ぐ。
function StdFolders_sweepAlignKind_(adapter, ctx) {
  var counts = { aligned: 0, moved: 0, copiedExternal: 0, rekeyed: 0, errors: 0 };
  var mapping = adapter.getMapping();
  ctx.dirty = false;
  var ids = [];
  for (var id in mapping) { if (mapping.hasOwnProperty(id)) ids.push(id); }   // snapshot
  for (var i = 0; i < ids.length; i++) {
    var curId = ids[i];
    if (ctx.remap[curId]) continue;   // 別経路で既に振替済みの旧 id
    if (!mapping[curId]) continue;     // 振替で消えた旧キー
    var outcome = StdFolders_alignEntry_(adapter, mapping, curId, false, ctx);
    if (counts.hasOwnProperty(outcome)) counts[outcome]++;
    else if (outcome === "error") counts.errors++;
  }
  if (ctx.dirty) adapter.saveMapping(mapping);
  return counts;
}

// 論理パス変更時の「逆方向・完全再リンク」。再配置された（id 振替 or 論理パス変化した）ファイルを指す
// 全参照元（登録済み forms/questions/dashboards）を追従させる。remap（旧id→新id）の振替と、
// 中央辞書からの path 再 stamp（move で id 保持・パスのみ変化したケースのアンカー更新）を 1 パスで適用する。
// remap も pathChanged も空なら no-op（呼び出し側でゲートし、論理パス不変の保存では呼ばない想定）。
// skipFileId は呼び出し側で個別処理済みのファイル（保存本体）を二重走査しないため。戻り: 書き換え件数。
function StdFolders_propagateRelinkToAllRefs_(remap, pathChangedSet, skipFileId) {
  var hasRemap = nfbHasOwnKeys_(remap);
  var doRefresh = nfbHasOwnKeys_(pathChangedSet);
  if (!hasRemap && !doRefresh) return 0;
  var relinked = 0;
  var kinds = ["forms", "questions", "dashboards"];
  for (var k = 0; k < kinds.length; k++) {
    var kind = kinds[k];
    var adapter = StdFolders_entityAdapter_(kind);
    if (!adapter.baseFolderOrNull()) continue;   // base 未解決 kind は degrade（no-op）
    var mapping = adapter.getMapping();
    for (var id in mapping) {
      if (!mapping.hasOwnProperty(id)) continue;
      var fileId = Nfb_resolveFileIdFromEntry_(mapping[id]);
      if (!fileId || fileId === skipFileId) continue;
      if (StdFolders_relinkRefsInFile_(fileId, kind, remap, doRefresh)) relinked++;
    }
  }
  return relinked;
}

// 全エンティティ（forms→questions→dashboards）を共有 ctx でスイープし、remap を参照グラフ全体へ
// 伝播（Phase B）、続けて論理↔物理の参照復旧（Phase C-1 case①, C-2 case②）を適用する。
// 戻り: { ok, forms, questions, dashboards, relinkedFiles, reresolved, formPhysicalAligned, errors }。
function StdFolders_alignAllEntries_() {
  return nfbSafeCall_(function () {
    return WithScriptLock_("標準フォルダ整列（全体）", function () {
      var ctx = { errors: [], invalidCandidates: [], remap: {}, pathChanged: {}, dirty: false, guard: null };
      var kinds = ["forms", "questions", "dashboards"];
      var perKind = {};

      // Phase A: フォルダ確保（空フォルダ含む既知パス）+ 全件 alignEntry_。
      for (var k = 0; k < kinds.length; k++) {
        var kind = kinds[k];
        var adapter = StdFolders_entityAdapter_(kind);
        if (!adapter.baseFolderOrNull()) {
          perKind[kind] = { aligned: 0, moved: 0, copiedExternal: 0, rekeyed: 0, errors: 0, skipped: true };
          continue;
        }
        var paths = (kind === "forms") ? Forms_collectFolders_() : Analytics_collectFolders_(kind);
        for (var p = 0; p < paths.length; p++) adapter.ensureFolderForPath(paths[p]);
        perKind[kind] = StdFolders_sweepAlignKind_(adapter, ctx);
      }

      // Phase B: id 変化（コピー/再採用）・論理パス変化（move/物理追従）を参照グラフ全体へ逆方向伝播。
      // remap も pathChanged も空なら丸ごとスキップ（冪等時に軽い）。
      var relinked = StdFolders_propagateRelinkToAllRefs_(ctx.remap, ctx.pathChanged, null);

      // Phase C-1: 「論理パス → 物理」の case ① 復旧（物理が空/死 → *Path から再解決）を全エンティティへ。
      // Q→Form / D→Q / formLink のエンティティ参照、および forms の spreadsheet / 印刷様式 の物理 URL を
      // 冗長保存した *Path から貼り直す（物理生存は据置・冪等・非致命）。Phase A で本体をホームへ寄せた
      // 後に走らせるのでパス探索が正しい物理位置に当たる。汎用 Admin_reresolveAllRefsFromLogical_ を流用。
      var reresolved = { forms: 0, questions: 0, dashboards: 0 };
      try { reresolved = Admin_reresolveAllRefsFromLogical_(); }
      catch (errRe) { Logger.log("[StdFolders_alignAllEntries_] reresolveAllRefsFromLogical failed: " + nfbErrorToString_(errRe)); }

      // Phase C-2: forms の非エンティティ参照（spreadsheet / 印刷様式）に case ②（物理は生存だが設定論理
      // パスと不一致 → プロジェクト内=move / 外=copy で設定論理パスへ寄せ、物理URLを更新）も適用する。
      // エンティティ参照（Q→Form / D→Q）の case ② は Phase A が参照先エンティティ自身を移動/コピーして
      // 担うが、spreadsheet / 印刷様式 は登録エンティティではないため Phase A が触れない。保存時と同じ
      // ①② フル整合（新規作成はしない）をフォーム保存時の部品で適用する。非致命。
      var formPhysicalAligned = 0;
      try { formPhysicalAligned = StdFolders_alignAllFormPhysicalRefs_(); }
      catch (errFp) { Logger.log("[StdFolders_alignAllEntries_] alignAllFormPhysicalRefs failed: " + nfbErrorToString_(errFp)); }

      return {
        ok: true,
        forms: perKind.forms,
        questions: perKind.questions,
        dashboards: perKind.dashboards,
        relinkedFiles: relinked,
        reresolved: reresolved,
        formPhysicalAligned: formPhysicalAligned,
        errors: ctx.errors
      };
    });
  });
}

// =============================================
// (2.8) organize(①) 用: forms の非エンティティ物理参照（spreadsheet / 印刷様式）の ①② フル整合
// フォーム保存時の resolveSpreadsheetSetting_ / normalizePrintTemplateRefsOnSave_ と同じ判定を、
// 全登録フォームへ一括適用する（ただし新規スプレッドシート作成のような保存固有の副作用は行わない）。
// =============================================

// form.settings.spreadsheetId（物理 URL）/ spreadsheetPath（論理）に ①② 整合を適用する（新規作成なし）。
//   ① 物理が空/死 → spreadsheetPath（04_spreadsheets 配下）から復旧
//   ② 物理は生存だが配置が論理とずれ → プロジェクト内=move / 外=copy で寄せ、URL/path を更新
// 参照が無ければ（path も id も空）no-op。書き換えたら true。
function StdFolders_alignFormSpreadsheetRefInJson_(json) {
  var s = (json && json.settings && typeof json.settings === "object" && !Array.isArray(json.settings)) ? json.settings : null;
  if (!s) return false;
  var path = (typeof s.spreadsheetPath === "string") ? s.spreadsheetPath.trim() : "";
  var rawId = String(s.spreadsheetId || "").trim();
  if (!path && !rawId) return false;   // 参照が無ければ no-op（organize では新規作成しない）
  var aligned = StdFolders_alignFileRefIntoStdFolder_("spreadsheets", rawId, path);
  if (!aligned.fileId || aligned.status === "unresolved" || aligned.status === "noop") return false;
  var changed = false;
  if (s.spreadsheetId !== aligned.url) { s.spreadsheetId = aligned.url; changed = true; }   // 物理は URL 形で永続化
  if (s.spreadsheetPath !== aligned.path) { s.spreadsheetPath = aligned.path; changed = true; }
  return changed;
}

// 1 フォーム json を読み、spreadsheet + 印刷様式（フォーム + カード）に ①② 整合を適用して書き戻す。
// 戻り: { changed, relocations }（relocations ＝ 再配置した印刷様式 Doc の {oldFileId,newUrl,newPath}）。
function StdFolders_alignFormPhysicalRefsInFile_(fileId) {
  var out = { changed: false, relocations: [] };
  var read = Nfb_readJsonFileById_(fileId);
  if (!read || !read.file || !read.json || typeof read.json !== "object") return out;
  var json = read.json;
  var before = JSON.stringify(json);
  StdFolders_alignFormSpreadsheetRefInJson_(json);                       // spreadsheet ①②
  out.relocations = StdFolders_normalizePrintTemplateRefsOnSave_(json) || [];  // 印刷様式 ①②（form を mutate）
  if (JSON.stringify(json) !== before) {
    Nfb_writeJsonToFile_(read.file, json);
    out.changed = true;
  }
  return out;
}

// 登録済み全フォームの非エンティティ物理参照（spreadsheet / 印刷様式）に ①② 整合を適用する。
// 印刷様式の再配置（move/外部コピー）は、保存時と同じく旧 id で同じ Doc を指す他フォームへ即伝播して
// 共有外部様式の重複コピーを防ぐ。base 未解決は no-op。戻り: 書き換えたフォーム件数。
function StdFolders_alignAllFormPhysicalRefs_() {
  var adapter = StdFolders_entityAdapter_("forms");
  if (!adapter.baseFolderOrNull()) return 0;
  var mapping = adapter.getMapping();
  var ids = [];
  for (var id in mapping) { if (mapping.hasOwnProperty(id)) ids.push(id); }
  var n = 0;
  for (var i = 0; i < ids.length; i++) {
    var fileId = Nfb_resolveFileIdFromEntry_(mapping[ids[i]]);
    if (!fileId) continue;
    try {
      var res = StdFolders_alignFormPhysicalRefsInFile_(fileId);
      if (res.changed) n++;
      if (res.relocations && res.relocations.length) {
        // 自分自身は skip（既に整合済み）。他フォームの旧 id 参照を新位置へ張り替え。
        StdFolders_propagateTemplateRelinkToForms_(res.relocations, fileId);
      }
    } catch (e) {
      Logger.log("[StdFolders_alignAllFormPhysicalRefs_] " + fileId + ": " + nfbErrorToString_(e));
    }
  }
  return n;
}
