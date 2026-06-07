// =============================================
// 標準フォルダ構成: 論理↔物理 整合同期エンジン（6ケース）
// standardFolders.gs から分離。バンドル時に連結されるため関数はグローバル。
// =============================================

// =============================================
// (2.6) 論理↔物理 整合（①〜④・エントリ単位）
// 登録エンティティごとに (論理パス L, 物理パス P, fileId 解決) を比較し、論理 L を正として
// 物理/マッピングを揃える。手動の「同期（フォルダ走査）」は廃止され、現在は保存時の参照整合
// （alignReferencesOnSave_）と、フォルダのリネーム/移動後の自己修復（verify パス）から呼ばれる。
//
//   ① L==P かつ fileId 一致         → 何もしない
//   ② fileId 解決・P≠L              → 物理を L へ。プロジェクト内 move / 外 copy（コピー先新 id 採用）
//   ③ fileId 未解決・L に同名別id    → その物理 id を論理に再採用（mapping 振替え）
//   ④ fileId 未解決・物理も未発見     → 削除せずエラー報告
//
// 論理フォルダのリネーム/移動は影響エンティティに ①〜④（verify パス）を適用する。
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
