// =============================================
// 標準フォルダ構成: 論理↔物理 整合同期エンジン（6ケース）
// standardFolders.gs から分離。バンドル時に連結されるため関数はグローバル。
// =============================================

// 登録簿の fileId 集合（同期対象）を作る。整合エンジン classifyOrphans_ が
// 「登録済みファイル」を判定するために使う。
function StdFolders_trackedFileIdSet_(mapping) {
  var set = {};
  for (var id in mapping) {
    if (!mapping.hasOwnProperty(id)) continue;
    var fid = Nfb_resolveFileIdFromEntry_(mapping[id]);
    if (fid) set[fid] = true;
  }
  return set;
}

// =============================================
// (2.6) 論理↔物理 整合同期エンジン（6ケース）
// 登録エンティティごとに (論理パス L, 物理パス P, fileId 解決) を比較し、論理 L を正として
// 物理/マッピングを揃える。「同期（フォルダ走査）」(std_folders_rebuild_map) の実体。
//
//   ① L==P かつ fileId 一致         → 何もしない
//   ② fileId 解決・P≠L              → 物理を L へ。プロジェクト内 move / 外 copy（コピー先新 id 採用）
//   ③ fileId 未解決・L に同名別id    → その物理 id を論理に再採用（mapping 振替え）
//   ④ fileId 未解決・物理も未発見     → 削除せずエラー報告
//   ⑤ 正しい場所の有効ファイル・未登録 → 新規登録（folder=物理パス）
//   ⑥ 不正ファイル・未登録            → 候補化（applyDelete のときだけゴミ箱へ）
//
// フルスキャンは ①〜⑥、論理フォルダのリネーム/移動は影響エンティティに ①〜④（verify パス）。
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
    // L = 生存ファイルの json.folder（システム全体の規約に一致）。
    var json = StdFolders_readJsonByFileId_(F);
    var L = Forms_normalizeFolderPath_(json && json.folder);
    var P = adapter.relativeFolderOfFile(F);   // base 配下の相対パス / null=構成外

    if (P === L) {
      // ① 一致。entry.folder を最新化（dead-F 時の L 解決の保険）。
      if (entry.folder !== L) { entry.folder = L; ctx.dirty = true; }
      return "aligned";
    }
    if (P !== null) {
      // ② プロジェクト内・P≠L → L へ移動（json.folder は既に L）。
      if (!dryRun) {
        adapter.moveFileToPath(F, L);
        entry.folder = L; ctx.dirty = true;
      }
      return "moved";
    }
    // ② プロジェクト外 → L へコピー取り込み + コピー先 id を正本採用。
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

// mapping 全エントリに ①〜④ を適用する。戻り件数 { aligned, moved, copiedExternal, rekeyed, errors }。
// base 未解決の kind は skipped:true で no-op。ctx.guard で 6 分制限を打ち切り（truncated）。
function StdFolders_alignAllEntries_(adapter, dryRun, ctx) {
  var counts = { aligned: 0, moved: 0, copiedExternal: 0, rekeyed: 0, errors: 0 };
  if (!adapter.baseFolderOrNull()) { counts.skipped = true; return counts; }
  var mapping = adapter.getMapping();
  ctx.dirty = false;
  var ids = [];
  for (var id in mapping) { if (mapping.hasOwnProperty(id)) ids.push(id); }
  for (var i = 0; i < ids.length; i++) {
    if (ctx.guard && ctx.guard.checkTime()) { ctx.guard.truncated = true; break; }
    var outcome = StdFolders_alignEntry_(adapter, mapping, ids[i], dryRun, ctx);
    if (counts.hasOwnProperty(outcome)) counts[outcome]++;
    else if (outcome === "error") counts.errors++;
  }
  if (!dryRun && ctx.dirty) adapter.saveMapping(mapping);
  return counts;
}

// std サブツリーを走査して未登録ファイルを ⑤（有効→登録）/ ⑥（無効→候補, applyDelete で trash）に分類。
// ①〜④ の後に呼ぶこと（rekey/copy 済み id が trackedIds に入った状態で判定するため）。
function StdFolders_classifyOrphans_(adapter, applyDelete, ctx, skipIds) {
  var res = { scanned: 0, registered: 0, invalid: 0 };
  var base = adapter.baseFolderOrNull();
  if (!base) { res.skipped = true; return res; }
  var mapping = adapter.getMapping();
  var folders = adapter.getFolders();
  var c = {
    adapter: adapter,
    mapping: mapping,
    trackedIds: StdFolders_trackedFileIdSet_(mapping),
    folders: folders,
    applyDelete: applyDelete,
    skipIds: skipIds || {},
    res: res,
    ctx: ctx
  };
  StdFolders_walkOrphans_(base, "", c);
  if (res.registered > 0) {
    adapter.saveMapping(mapping);
    adapter.saveFolders(folders);
  }
  return res;
}

function StdFolders_walkOrphans_(folder, prefix, c) {
  var guard = c.ctx.guard;
  if (guard && guard.truncated) return;
  var files = folder.getFiles();
  while (files.hasNext()) {
    if (guard && guard.checkTime()) { guard.truncated = true; return; }
    var file = files.next();
    if (typeof file.isTrashed === "function" && file.isTrashed()) continue;
    c.res.scanned++;
    var fileId = file.getId();
    if (c.trackedIds[fileId]) continue; // 既登録（同期対象）はスキップ
    if (c.skipIds[fileId]) continue;    // 同フォルダ重複の loser は重複整理側で処理（⑤化けさせない）
    var fileName = file.getName();
    var json = null;
    if (StdFolders_isJsonFile_(file)) {
      try { json = JSON.parse(file.getBlob().getDataAsString()); } catch (e) { json = null; }
    }
    if (json && c.adapter.isValidEntityJson(json)) {
      // ⑤ 有効オーファン → 登録（物理位置 prefix を論理パスに採用）。
      var name = Nfb_nameFromFile_(file);
      var entry = { fileId: fileId, driveFileUrl: file.getUrl(), folder: prefix };
      entry[c.adapter.nameField] = name;
      c.mapping[fileId] = entry;
      c.trackedIds[fileId] = true;
      if (prefix && c.folders.indexOf(prefix) === -1) c.folders.push(prefix);
      // json.folder を物理に合わせる（冪等性: 次回 ① になる）。
      if (Forms_normalizeFolderPath_(json.folder) !== prefix) {
        try { json.folder = prefix; file.setContent(JSON.stringify(json, null, 2)); }
        catch (e) { /* non-critical */ }
      }
      c.res.registered++;
    } else {
      // ⑥ 不正ファイル（非json / parse不能 / 種別不一致） → 候補。applyDelete のときだけ trash。
      c.ctx.invalidCandidates.push({
        kind: c.adapter.kind,
        fileId: fileId,
        name: Nfb_nameFromFileName_(fileName),
        relPath: prefix ? (prefix + "/" + fileName) : fileName
      });
      c.res.invalid++;
      if (c.applyDelete) {
        try { file.setTrashed(true); }
        catch (e) { Logger.log("[StdFolders_walkOrphans_] trash " + fileId + ": " + nfbErrorToString_(e)); }
      }
    }
  }
  var subs = folder.getFolders();
  while (subs.hasNext()) {
    if (guard && guard.checkTime()) { guard.truncated = true; return; }
    var sub = subs.next();
    if (typeof sub.isTrashed === "function" && sub.isTrashed()) continue;
    StdFolders_walkOrphans_(sub, prefix ? (prefix + "/" + sub.getName()) : sub.getName(), c);
  }
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

// 「同期（フォルダ走査）」本体。①〜⑥ ＋ 同フォルダ同名の重複整理 ＋ 毎回の参照再リンクを
// forms/questions/dashboards に適用する。
//   payload.rootUrl              : 手動ルート指定（任意）
//   payload.applyDeleteInvalid   : true で ⑥ 不正ファイルをゴミ箱へ（旧 payload.applyDelete も可・後方互換）
//   payload.applyDeleteDuplicates: true で 同フォルダ同名の余り（loser）をゴミ箱へ
// 削除フラグは既定 false（候補収集のみ）。フロントがカテゴリ別ダイアログで確認してから apply する。
function StdFolders_alignFolders_(payload) {
  return nfbSafeCall_(function() {
    var manualRootUrl = payload && payload.rootUrl ? String(payload.rootUrl).trim() : "";
    var applyDeleteInvalid = !!(payload && (payload.applyDeleteInvalid === true || payload.applyDelete === true));
    var applyDeleteDuplicates = !!(payload && payload.applyDeleteDuplicates === true);
    var root = StdFolders_resolveRootFolder_(manualRootUrl);
    StdFolders_ensureAllSubfolders_(root);

    var startMs = (new Date()).getTime();
    var guard = { truncated: false, checkTime: function() { return ((new Date()).getTime() - startMs) > 300000; } };
    var ctx = { errors: [], invalidCandidates: [], duplicateCandidates: [], remap: {}, guard: guard, dirty: false };

    var kinds = ["forms", "questions", "dashboards"];
    var align = {};
    var orphans = {};
    var dedup = {};
    for (var i = 0; i < kinds.length; i++) {
      var adapter = StdFolders_entityAdapter_(kinds[i]);
      align[kinds[i]] = StdFolders_alignAllEntries_(adapter, false, ctx);                  // ①〜④
      var consolidated = StdFolders_consolidateSameFolderDuplicates_(adapter, ctx);        // 同フォルダ同名 → 最新を残す
      dedup[kinds[i]] = { groups: consolidated.groups, survivors: consolidated.survivors, losers: consolidated.losers };
      orphans[kinds[i]] = StdFolders_classifyOrphans_(adapter, applyDeleteInvalid, ctx, consolidated.loserIds); // ⑤登録 / ⑥候補(or削除)
    }

    // 参照（Q→Form / D→Q）を毎回再リンク。②③の id 変化と同フォルダ重複の survivor へ寄せる
    // （remap 優先 + フォルダ込み名/同フォルダ最新で名前解決）。
    var relink = StdFolders_relinkReferences_({ mode: "apply", rebuildMapping: false, rootUrl: manualRootUrl, remap: ctx.remap });

    // 同フォルダ重複の余り（loser）は、参照を寄せ終えた後・確認済みのときだけゴミ箱へ。
    var trashedDuplicates = [];
    if (applyDeleteDuplicates) {
      for (var c = 0; c < ctx.duplicateCandidates.length; c++) {
        try { DriveApp.getFileById(ctx.duplicateCandidates[c].fileId).setTrashed(true); trashedDuplicates.push(ctx.duplicateCandidates[c].fileId); }
        catch (e) { Logger.log("[StdFolders_alignFolders_] trash dup " + ctx.duplicateCandidates[c].fileId + ": " + nfbErrorToString_(e)); }
      }
    }

    return {
      ok: true,
      mode: (applyDeleteInvalid || applyDeleteDuplicates) ? "apply" : "dryRun",
      align: align,
      orphans: orphans,
      dedup: dedup,
      errors: ctx.errors,
      invalidCandidates: ctx.invalidCandidates,
      duplicateCandidates: ctx.duplicateCandidates,
      trashedDuplicates: trashedDuplicates,
      appliedDeleteInvalid: applyDeleteInvalid,
      appliedDeleteDuplicates: applyDeleteDuplicates,
      relink: relink,
      truncated: guard.truncated
    };
  });
}

// 同フォルダ同名の重複を整理する。base 配下の有効エンティティ JSON を (相対フォルダ, 葉名) で
// グルーピングし、2件以上のグループは最終更新が最新の 1 件（survivor）を残す。
//   - 残り（loser）は ctx.duplicateCandidates へ記録（trash は呼び出し側がフラグ付きで実施）。
//   - ctx.remap[loserId]=survivorId を積み、毎回の再リンクで参照を survivor へ寄せる。
//   - mapping に loser が登録されていれば survivor へ振替える（②③相当の id 追従）。
// 戻り: { groups, survivors, losers, loserIds:{fileId:true} }。loserIds は ⑤⑥ のスキップに使う。
function StdFolders_consolidateSameFolderDuplicates_(adapter, ctx) {
  var res = { groups: 0, survivors: 0, losers: 0, loserIds: {} };
  var base = adapter.baseFolderOrNull();
  if (!base) { res.skipped = true; return res; }

  var groups = {};
  StdFolders_walkDupGroups_(adapter, base, "", groups, ctx.guard);

  var mapping = adapter.getMapping();
  var dirty = false;
  for (var key in groups) {
    if (!groups.hasOwnProperty(key)) continue;
    var members = groups[key];
    if (members.length < 2) continue;
    res.groups++;
    res.survivors++;
    var survivor = members[0];
    for (var s = 1; s < members.length; s++) {
      if (members[s].updated > survivor.updated) survivor = members[s];
    }
    for (var j = 0; j < members.length; j++) {
      var m = members[j];
      if (m.fileId === survivor.fileId) continue;
      res.losers++;
      res.loserIds[m.fileId] = true;
      ctx.remap[m.fileId] = survivor.fileId;
      ctx.duplicateCandidates.push({
        kind: adapter.kind,
        fileId: m.fileId,
        name: m.name,
        relPath: m.relFolder ? (m.relFolder + "/" + m.name + ".json") : (m.name + ".json"),
        survivorId: survivor.fileId
      });
      if (mapping[m.fileId]) {
        var entry = mapping[m.fileId];
        delete mapping[m.fileId];
        if (!mapping[survivor.fileId]) {
          entry.fileId = survivor.fileId;
          entry.driveFileUrl = survivor.url;
          entry.folder = survivor.relFolder;
          mapping[survivor.fileId] = entry;
        }
        dirty = true;
      }
    }
  }
  if (dirty) { adapter.saveMapping(mapping); ctx.dirty = true; }
  return res;
}

// base 配下を再帰走査し、有効エンティティ JSON を (相対フォルダ, 葉名) でグルーピングする。
//   groups["相対フォルダ/葉名"] = [ { file, fileId, updated, url, relFolder, name } ]
function StdFolders_walkDupGroups_(adapter, folder, prefix, groups, guard) {
  if (guard && guard.truncated) return;
  var files = folder.getFiles();
  while (files.hasNext()) {
    if (guard && guard.checkTime()) { guard.truncated = true; return; }
    var file = files.next();
    if (typeof file.isTrashed === "function" && file.isTrashed()) continue;
    if (!StdFolders_isJsonFile_(file)) continue;
    var json = null;
    try { json = JSON.parse(file.getBlob().getDataAsString()); } catch (e) { json = null; }
    if (!json || !adapter.isValidEntityJson(json)) continue;
    var name = Nfb_nameFromFile_(file);
    if (!name) continue;
    var updated = 0;
    try { updated = file.getLastUpdated().getTime(); } catch (e2) { updated = 0; }
    // 葉名に "/" は使えない（Drive 制約）ため "相対フォルダ/葉名" は (フォルダ,名前) の一意キー。
    var key = prefix ? (prefix + "/" + name) : name;
    if (!groups[key]) groups[key] = [];
    groups[key].push({ file: file, fileId: file.getId(), updated: updated, url: file.getUrl(), relFolder: prefix || "", name: name });
  }
  var subs = folder.getFolders();
  while (subs.hasNext()) {
    if (guard && guard.checkTime()) { guard.truncated = true; return; }
    var sub = subs.next();
    if (typeof sub.isTrashed === "function" && sub.isTrashed()) continue;
    StdFolders_walkDupGroups_(adapter, sub, prefix ? prefix + "/" + sub.getName() : sub.getName(), groups, guard);
  }
}

// =============================================
// (2.7) 保存時の参照整合（①〜④）
// クエスチョン保存 → 参照先フォームに ①〜④。
// ダッシュボード保存 → 参照先クエスチョン、およびそのクエスチョンが参照するフォームに ①〜④。
// ②外部コピー / ③再採用で参照先 id が変わったら、保存済みファイル（と中間クエスチョン）の
// リンク（formId / questionId）も追従させる。base 未解決の kind は no-op に degrade。
// 全体同期（StdFolders_alignFolders_）の「保存単位の部分適用」に相当する。
// =============================================

function StdFolders_hasOwnKeys_(obj) {
  if (!obj) return false;
  for (var k in obj) { if (obj.hasOwnProperty(k)) return true; }
  return false;
}

// クエスチョン json から参照フォーム id を集める（query.gui.formId + query.formSources[].formId）。
function StdFolders_collectFormIdsFromQuestionJson_(json) {
  var ids = [];
  var query = json && json.query;
  if (query && typeof query === "object") {
    if (query.gui && typeof query.gui === "object" && query.gui.formId) ids.push(query.gui.formId);
    if (Array.isArray(query.formSources)) {
      for (var i = 0; i < query.formSources.length; i++) {
        if (query.formSources[i] && query.formSources[i].formId) ids.push(query.formSources[i].formId);
      }
    }
  }
  return ids;
}

// ダッシュボード json から参照クエスチョン id を集める（cards[].questionId）。
function StdFolders_collectQuestionIdsFromDashboardJson_(json) {
  var ids = [];
  if (json && Array.isArray(json.cards)) {
    for (var c = 0; c < json.cards.length; c++) {
      if (json.cards[c] && json.cards[c].questionId) ids.push(json.cards[c].questionId);
    }
  }
  return ids;
}

// remap（旧id→新id）を json 内の参照に適用する。
//   kind="questions" → query.gui.formId / query.formSources[].formId
//   kind="dashboards"→ cards[].questionId
// 書き換えたら true。
function StdFolders_applyRemapToRefs_(json, kind, remap) {
  if (!json || !StdFolders_hasOwnKeys_(remap)) return false;
  var changed = false;
  if (kind === "questions") {
    var query = json.query;
    if (query && typeof query === "object") {
      if (query.gui && typeof query.gui === "object" && query.gui.formId && remap[query.gui.formId]) {
        query.gui.formId = remap[query.gui.formId]; changed = true;
      }
      if (Array.isArray(query.formSources)) {
        for (var i = 0; i < query.formSources.length; i++) {
          var src = query.formSources[i];
          if (src && src.formId && remap[src.formId]) { src.formId = remap[src.formId]; changed = true; }
        }
      }
    }
  } else if (kind === "dashboards") {
    if (Array.isArray(json.cards)) {
      for (var c = 0; c < json.cards.length; c++) {
        var card = json.cards[c];
        if (card && card.questionId && remap[card.questionId]) { card.questionId = remap[card.questionId]; changed = true; }
      }
    }
  }
  return changed;
}

// fileId の json を読み、remap を参照に適用して書き戻す。書き換えたら true。
function StdFolders_rewriteRefsInFile_(fileId, kind, remap) {
  if (!fileId || !StdFolders_hasOwnKeys_(remap)) return false;
  try {
    var file = DriveApp.getFileById(fileId);
    if (typeof file.isTrashed === "function" && file.isTrashed()) return false;
    var json = JSON.parse(file.getBlob().getDataAsString());
    if (StdFolders_applyRemapToRefs_(json, kind, remap)) {
      file.setContent(JSON.stringify(json, null, 2));
      return true;
    }
  } catch (e) {
    Logger.log("[StdFolders_rewriteRefsInFile_] " + fileId + ": " + nfbErrorToString_(e));
  }
  return false;
}

// 与えた id 集合（参照先）に ①〜④ を適用する。base 未解決は skipped:true で no-op。
// ②外部コピー/③再採用の旧→新 id は ctx.remap に積まれる。戻り件数 { aligned, moved, copiedExternal, rekeyed, errors }。
function StdFolders_alignIdSet_(adapter, ids, ctx) {
  var counts = { aligned: 0, moved: 0, copiedExternal: 0, rekeyed: 0, errors: 0 };
  if (!adapter.baseFolderOrNull()) { counts.skipped = true; return counts; }
  if (!ids || !ids.length) return counts;
  var mapping = adapter.getMapping();
  ctx.dirty = false;
  var seen = {};
  for (var i = 0; i < ids.length; i++) {
    var id = ids[i];
    if (!id || seen[id]) continue;
    seen[id] = true;
    if (ctx.remap[id]) continue;       // 既に他経路で remap 済みの旧 id はスキップ
    if (!mapping[id]) continue;        // 未登録参照は ①〜④ 対象外（relink / 全体同期へ委ねる）
    var outcome = StdFolders_alignEntry_(adapter, mapping, id, false, ctx);
    if (counts.hasOwnProperty(outcome)) counts[outcome]++;
    else if (outcome === "error") counts.errors++;
  }
  if (ctx.dirty) adapter.saveMapping(mapping);
  return counts;
}

// 保存後フック。kind = "questions" | "dashboards"、savedFileId = 保存したエンティティの fileId。
// 戻り: { ok, kind, forms, questions, errors, remap, relinkedFiles }。
function StdFolders_alignReferencesOnSave_(kind, savedFileId) {
  var result = { ok: true, kind: kind, forms: null, questions: null, errors: [], remap: {}, relinkedFiles: 0 };
  try {
    if (kind !== "questions" && kind !== "dashboards") return result;
    var savedJson = StdFolders_readJsonByFileId_(savedFileId);
    if (!savedJson) return result;

    var ctx = { errors: [], invalidCandidates: [], remap: {}, dirty: false, guard: null };
    var formsAdapter = StdFolders_entityAdapter_("forms");

    if (kind === "questions") {
      var formIds = StdFolders_collectFormIdsFromQuestionJson_(savedJson);
      result.forms = StdFolders_alignIdSet_(formsAdapter, formIds, ctx);
      // 参照先フォームの id が変わったら、保存済みクエスチョンのリンクを追従。
      if (StdFolders_rewriteRefsInFile_(savedFileId, "questions", ctx.remap)) result.relinkedFiles++;
    } else {
      var questionsAdapter = StdFolders_entityAdapter_("questions");
      var questionIds = StdFolders_collectQuestionIdsFromDashboardJson_(savedJson);
      result.questions = StdFolders_alignIdSet_(questionsAdapter, questionIds, ctx);

      // クエスチョンから先のフォームも整合する（remap 後の実 id でクエスチョン json を読む）。
      var qFileIds = [];
      var allFormIds = [];
      var seenQ = {};
      for (var i = 0; i < questionIds.length; i++) {
        var qid = ctx.remap[questionIds[i]] || questionIds[i];
        if (!qid || seenQ[qid]) continue;
        seenQ[qid] = true;
        qFileIds.push(qid);
        var qjson = StdFolders_readJsonByFileId_(qid);
        if (qjson) allFormIds = allFormIds.concat(StdFolders_collectFormIdsFromQuestionJson_(qjson));
      }
      result.forms = StdFolders_alignIdSet_(formsAdapter, allFormIds, ctx);

      // フォーム id が変わったら各中間クエスチョンのリンクを追従。
      for (var j = 0; j < qFileIds.length; j++) {
        if (StdFolders_rewriteRefsInFile_(qFileIds[j], "questions", ctx.remap)) result.relinkedFiles++;
      }
      // クエスチョン id が変わったら、保存済みダッシュボードのリンクを追従。
      if (StdFolders_rewriteRefsInFile_(savedFileId, "dashboards", ctx.remap)) result.relinkedFiles++;
    }

    result.errors = ctx.errors;
    result.remap = ctx.remap;
  } catch (err) {
    Logger.log("[StdFolders_alignReferencesOnSave_] " + nfbErrorToString_(err));
    result.ok = false;
    result.error = nfbErrorToString_(err);
  }
  return result;
}
