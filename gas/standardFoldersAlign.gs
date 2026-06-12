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
        if (entry.folder !== P) { entry.folder = P; ctx.dirty = true; }
        var fname = liveFile ? Nfb_nameFromFile_(liveFile) : "";
        if (fname && entry[adapter.nameField] !== fname) { entry[adapter.nameField] = fname; ctx.dirty = true; }
      }
      return "aligned";
    }

    // P===null：物理がホーム標準フォルダ外。論理パス（生存ファイルの json.folder）を正として戻す。
    var L = Forms_normalizeFolderPath_(json && json.folder);
    if (StdFolders_isFileUnderProjectRoot_(F)) {
      // ② プロジェクト内の別標準フォルダ（例: form が 02_questions 内）→ ホームの L へ移動（id 保持）。
      if (!dryRun) {
        adapter.moveFileToPath(F, L);
        if (entry.folder !== L) { entry.folder = L; ctx.dirty = true; }
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
//   ・コピー/再採用で id が変わったら、参照（Q→Form / D→Question）を remap で張り替え
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

// 全エンティティ（forms→questions→dashboards）を共有 ctx でスイープし、最後に remap を
// 参照グラフ全体へ伝播する。戻り: { ok, forms, questions, dashboards, relinkedFiles, errors }。
function StdFolders_alignAllEntries_() {
  return nfbSafeCall_(function () {
    return WithScriptLock_("標準フォルダ整列（全体）", function () {
      var ctx = { errors: [], invalidCandidates: [], remap: {}, dirty: false, guard: null };
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

      // Phase B: id 変化（コピー/再採用）を参照グラフ全体へ伝播。remap が空なら丸ごとスキップ（冪等時に軽い）。
      var relinked = 0;
      if (nfbHasOwnKeys_(ctx.remap)) {
        // form→childForm（formLink）リンクを追従。
        var fMap = StdFolders_entityAdapter_("forms").getMapping();
        for (var fid in fMap) {
          if (!fMap.hasOwnProperty(fid)) continue;
          var fFileId = Nfb_resolveFileIdFromEntry_(fMap[fid]);
          if (fFileId && StdFolders_rewriteRefsInFile_(fFileId, "forms", ctx.remap)) relinked++;
        }
        var qMap = StdFolders_entityAdapter_("questions").getMapping();   // Phase A 後の現行キー
        for (var qid in qMap) {
          if (!qMap.hasOwnProperty(qid)) continue;
          var qFileId = Nfb_resolveFileIdFromEntry_(qMap[qid]);
          if (qFileId && StdFolders_rewriteRefsInFile_(qFileId, "questions", ctx.remap)) relinked++;
        }
        var dMap = StdFolders_entityAdapter_("dashboards").getMapping();
        for (var did in dMap) {
          if (!dMap.hasOwnProperty(did)) continue;
          var dFileId = Nfb_resolveFileIdFromEntry_(dMap[did]);
          if (dFileId && StdFolders_rewriteRefsInFile_(dFileId, "dashboards", ctx.remap)) relinked++;
        }
      }

      return {
        ok: true,
        forms: perKind.forms,
        questions: perKind.questions,
        dashboards: perKind.dashboards,
        relinkedFiles: relinked,
        errors: ctx.errors
      };
    });
  });
}
