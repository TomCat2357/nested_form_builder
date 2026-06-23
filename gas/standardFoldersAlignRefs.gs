// =============================================
// 標準フォルダ構成: 保存時の参照整合（①〜④）
// standardFoldersAlign.gs（整合エンジン）から分離。参照グラフの収集・remap 追従と
// 保存後フックを束ねる。整合判定そのもの（StdFolders_alignEntry_）はエンジン側。
// バンドル時に連結されるため関数はグローバル。
// =============================================

// 汎用ヘルパー: 自己所有キーを 1 つでも持つか。adminAuthEmail.gs にあった同一実装を統合。
function nfbHasOwnKeys_(obj) {
  if (!obj) return false;
  for (var k in obj) { if (obj.hasOwnProperty(k)) return true; }
  return false;
}

// 参照種別ごとの参照ホルダーを列挙する共通ビジター。3 種の参照形状の走査を 1 箇所に集約する。
//   kind="questions"  → Q→Form（query.gui.formId/formPath + query.formSources[].formId/formPath）
//   kind="dashboards" → D→Q（cards[].questionId/questionPath）
//   kind="forms"      → form→childForm（schema 内 formLink の childFormId/childFormPath）
// visit には { holder, idKey, pathKey, nameKey, targetKind } を渡す（targetKind ＝ 参照先エンティティ種別。
// StdFolders_qualifiedPathForId_ の第 1 引数に使う。nameKey ＝ 撤去対象の旧「相手の名前」キー）。
// 物理 id か論理パス（*Path）の少なくとも一方を持つ参照を visit する（コピーで物理を全消去し *Path だけが
// 残った参照も拾えるよう、id だけでなく pathKey でもゲートする）。
function StdFolders_forEachRef_(json, kind, visit) {
  if (!json) return;
  if (kind === "questions") {
    var query = json.query;
    if (!query || typeof query !== "object") return;
    if (query.gui && typeof query.gui === "object" && (query.gui.formId || query.gui.formPath)) {
      visit({ holder: query.gui, idKey: "formId", pathKey: "formPath", nameKey: "formName", targetKind: "forms" });
    }
    if (Array.isArray(query.formSources)) {
      for (var i = 0; i < query.formSources.length; i++) {
        var src = query.formSources[i];
        if (src && (src.formId || src.formPath)) visit({ holder: src, idKey: "formId", pathKey: "formPath", nameKey: "formName", targetKind: "forms" });
      }
    }
  } else if (kind === "dashboards") {
    if (Array.isArray(json.cards)) {
      for (var c = 0; c < json.cards.length; c++) {
        var card = json.cards[c];
        if (card && (card.questionId || card.questionPath)) visit({ holder: card, idKey: "questionId", pathKey: "questionPath", nameKey: "questionName", targetKind: "questions" });
      }
    }
  } else if (kind === "forms") {
    StdFolders_walkFields_(json.schema, function(field) {
      if (field && field.type === "formLink" && (field.childFormId || field.childFormPath)) {
        visit({ holder: field, idKey: "childFormId", pathKey: "childFormPath", nameKey: "childFormName", targetKind: "forms" });
      }
    });
  }
}

// 参照ホルダーから旧「相手の名前」キー（formName / questionName / childFormName）を剥取する。
// 名前の二重持ちは撤去済（復旧は registry の folder+title/name アンカーと home の *Path に一本化）だが、
// 旧フロント／旧データが残骸を載せてくることがあるため、保存前にサーバ側でも確定的に剥がす。
// 剥がしたら true。id を持たない（=visit されない）参照は対象外。
function StdFolders_stripRefNames_(json, kind) {
  var changed = false;
  StdFolders_forEachRef_(json, kind, function(ref) {
    if (ref.holder && Object.prototype.hasOwnProperty.call(ref.holder, ref.nameKey)) {
      delete ref.holder[ref.nameKey];
      changed = true;
    }
  });
  return changed;
}

// 参照種別ごとに {id, path}（path＝冗長保存した論理パス、無ければ ""）の組を集める。
// fileId 切れ時の「論理パス再探索による復旧」に使う。
function StdFolders_collectRefPairs_(json, refKind) {
  var pairs = [];
  StdFolders_forEachRef_(json, refKind, function(ref) {
    var path = ref.holder[ref.pathKey];
    pairs.push({ id: ref.holder[ref.idKey], path: typeof path === "string" ? path : "" });
  });
  return pairs;
}

// 中央辞書（kind の mapping）から id の論理パス "folder/.../葉名" を組み立てる。未登録は null。
function StdFolders_qualifiedPathForId_(kind, id) {
  if (!id) return null;
  var adapter = StdFolders_entityAdapter_(kind);
  var mapping = adapter.getMapping();
  var entry = mapping[id];
  if (!entry) return null;
  var name = entry[adapter.nameField] || "";
  var folder = Forms_normalizeFolderPath_(entry.folder);
  if (!name) return null;
  return folder ? (folder + "/" + name) : name;
}

// json 内の参照に、中央辞書から導出した論理パスを冗長保存（stamp）する。リンク切れ時の復旧アンカー。
// 解決できない id は据え置き（既存値維持・changed 扱いにしない）。書き換えたら true。
function StdFolders_stampRefPaths_(json, kind) {
  var changed = false;
  StdFolders_forEachRef_(json, kind, function(ref) {
    var p = StdFolders_qualifiedPathForId_(ref.targetKind, ref.holder[ref.idKey]);
    if (p !== null && ref.holder[ref.pathKey] !== p) { ref.holder[ref.pathKey] = p; changed = true; }
  });
  return changed;
}

// 論理パス path（"folder/.../葉名"）で物理ファイルを再探索し、生存する新 id を返す。
// brokenId が生存していれば復旧不要として null。見つからなければ null（削除はしない＝呼び出し側でエラー扱い）。
function StdFolders_recoverRefByPath_(adapter, brokenId, path) {
  if (brokenId && StdFolders_isFileIdAlive_(brokenId)) return null;
  if (typeof path !== "string" || !path) return null;
  var norm = Forms_normalizeFolderPath_(path);
  if (!norm) return null;
  var parts = norm.split("/");
  var leaf = parts.pop();
  var folder = parts.join("/");
  if (!leaf) return null;
  var folderObj = adapter.lookupFolderForPath(folder);
  var found = folderObj ? StdFolders_findFileByNameInFolder_(folderObj, leaf + ".json") : null;
  if (found && found.getId() !== brokenId) return found.getId();
  return null;
}

// 未登録（中央辞書に無い）かつ fileId 切れの参照を、冗長保存した path で再探索して
// ctx.remap に旧→新 id を積む。登録済み id は alignIdSet_/alignEntry_ の ⓪①②③ に委ねる。
function StdFolders_recoverUnregisteredRefs_(adapter, pairs, ctx) {
  if (!pairs || !pairs.length) return;
  if (!adapter.baseFolderOrNull()) return;
  var mapping = adapter.getMapping();
  for (var i = 0; i < pairs.length; i++) {
    var id = pairs[i].id;
    if (!id || ctx.remap[id]) continue;
    if (mapping[id]) continue;                       // 登録済みは ⓪①②③ に委ねる
    if (StdFolders_isFileIdAlive_(id)) continue;     // 生存（未登録でも）ならリンクは有効
    var newId = StdFolders_recoverRefByPath_(adapter, id, pairs[i].path);
    if (newId && newId !== id) ctx.remap[id] = newId;
  }
}

// remap（旧id→新id）を json 内の参照に適用する。書き換えたら true（path 解決不能でも id を
// 書き換えた時点で true・path は旧値維持）。冗長保存の path は新 id の論理パスへ再計算する。
function StdFolders_applyRemapToRefs_(json, kind, remap) {
  if (!json || !nfbHasOwnKeys_(remap)) return false;
  var changed = false;
  StdFolders_forEachRef_(json, kind, function(ref) {
    var newId = remap[ref.holder[ref.idKey]];
    if (!newId) return;
    ref.holder[ref.idKey] = newId;
    var p = StdFolders_qualifiedPathForId_(ref.targetKind, newId);
    if (p !== null) ref.holder[ref.pathKey] = p;
    changed = true;
  });
  return changed;
}

// fileId の json を読み、remap を参照に適用して書き戻す。書き換えたら true。
function StdFolders_rewriteRefsInFile_(fileId, kind, remap) {
  if (!fileId || !nfbHasOwnKeys_(remap)) return false;
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

// fileId の json を読み、参照の冗長保存パス（*Path）を中央辞書の現値で再 stamp して書き戻す。
// move（id 保持・論理パスのみ変化）後に、参照元の陳腐化した復旧アンカーを更新する。書き換えたら true。
function StdFolders_refreshRefPathsInFile_(fileId, kind) {
  if (!fileId) return false;
  try {
    var file = DriveApp.getFileById(fileId);
    if (typeof file.isTrashed === "function" && file.isTrashed()) return false;
    var json = JSON.parse(file.getBlob().getDataAsString());
    if (StdFolders_stampRefPaths_(json, kind)) {
      file.setContent(JSON.stringify(json, null, 2));
      return true;
    }
  } catch (e) {
    Logger.log("[StdFolders_refreshRefPathsInFile_] " + fileId + ": " + nfbErrorToString_(e));
  }
  return false;
}

// fileId の json を 1 回読み、remap（id 振替）と path 再 stamp を 1 パスで適用して書き戻す。
// 逆方向の全走査（StdFolders_propagateRelinkToAllRefs_）で二重読み書きを避けるために使う。
// remap 振替・path 再 stamp のどちらか一方でも書き換えたら true。remap 空 & doPathRefresh 偽なら即 false。
function StdFolders_relinkRefsInFile_(fileId, kind, remap, doPathRefresh) {
  if (!fileId) return false;
  var hasRemap = nfbHasOwnKeys_(remap);
  if (!hasRemap && !doPathRefresh) return false;
  try {
    var file = DriveApp.getFileById(fileId);
    if (typeof file.isTrashed === "function" && file.isTrashed()) return false;
    var json = JSON.parse(file.getBlob().getDataAsString());
    var changed = false;
    if (hasRemap && StdFolders_applyRemapToRefs_(json, kind, remap)) changed = true;
    if (doPathRefresh && StdFolders_stampRefPaths_(json, kind)) changed = true;
    if (changed) {
      file.setContent(JSON.stringify(json, null, 2));
      return true;
    }
  } catch (e) {
    Logger.log("[StdFolders_relinkRefsInFile_] " + fileId + ": " + nfbErrorToString_(e));
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

// 保存後フック。kind = "questions" | "dashboards" | "forms"、savedFileId = 保存したエンティティの fileId。
// 参照先（Q→Form / D→Q(+Form) / form→childForm）へ ⓪①②③ を適用し、id 変化を追従させる。
// 加えて、中央辞書に無い（未登録）かつ fileId 切れの参照は冗長保存した論理パスで再探索して復旧する。
// selfChangedHint=true（保存本体エンティティ自身の論理パス／名前が変わった）のときは、その参照元も
// 追従させるため逆方向走査を発火させる（保存層が move/rename を検知して渡す）。
// 戻り: { ok, kind, forms, questions, errors, remap, relinkedFiles }。
function StdFolders_alignReferencesOnSave_(kind, savedFileId, selfChangedHint) {
  var result = { ok: true, kind: kind, forms: null, questions: null, errors: [], remap: {}, relinkedFiles: 0 };
  try {
    if (kind !== "questions" && kind !== "dashboards" && kind !== "forms") return result;
    var savedJson = StdFolders_readJsonByFileId_(savedFileId);
    if (!savedJson) return result;

    var ctx = { errors: [], invalidCandidates: [], remap: {}, pathChanged: {}, dirty: false, guard: null };
    // 保存本体自身が move/rename されたら、参照元の path アンカー更新のため逆走査を発火させる。
    if (selfChangedHint) ctx.pathChanged[savedFileId] = true;
    var formsAdapter = StdFolders_entityAdapter_("forms");

    // 参照 {id, path} の収集は 1 回で済ませ、alignIdSet 用の id 配列は pairs から導出する。
    var refIdsOf = function(pairs) {
      var ids = [];
      for (var pi = 0; pi < pairs.length; pi++) ids.push(pairs[pi].id);
      return ids;
    };

    if (kind === "forms") {
      // form→childForm（formLink）。子フォームへ ⓪①②③ + path 復旧を適用し、親の childFormId を追従。
      var childPairs = StdFolders_collectRefPairs_(savedJson, "forms");
      StdFolders_recoverUnregisteredRefs_(formsAdapter, childPairs, ctx);
      result.forms = StdFolders_alignIdSet_(formsAdapter, refIdsOf(childPairs), ctx);
      if (StdFolders_rewriteRefsInFile_(savedFileId, "forms", ctx.remap)) result.relinkedFiles++;
    } else if (kind === "questions") {
      var formPairs = StdFolders_collectRefPairs_(savedJson, "questions");
      StdFolders_recoverUnregisteredRefs_(formsAdapter, formPairs, ctx);
      result.forms = StdFolders_alignIdSet_(formsAdapter, refIdsOf(formPairs), ctx);
      // 参照先フォームの id が変わったら、保存済みクエスチョンのリンクを追従。
      if (StdFolders_rewriteRefsInFile_(savedFileId, "questions", ctx.remap)) result.relinkedFiles++;
    } else {
      var questionsAdapter = StdFolders_entityAdapter_("questions");
      var questionPairs = StdFolders_collectRefPairs_(savedJson, "dashboards");
      StdFolders_recoverUnregisteredRefs_(questionsAdapter, questionPairs, ctx);
      var questionIds = refIdsOf(questionPairs);
      result.questions = StdFolders_alignIdSet_(questionsAdapter, questionIds, ctx);

      // クエスチョンから先のフォームも整合する（remap 後の実 id でクエスチョン json を読む）。
      var qFileIds = [];
      var allFormPairs = [];
      var seenQ = {};
      for (var i = 0; i < questionIds.length; i++) {
        var qid = ctx.remap[questionIds[i]] || questionIds[i];
        if (!qid || seenQ[qid]) continue;
        seenQ[qid] = true;
        qFileIds.push(qid);
        var qjson = StdFolders_readJsonByFileId_(qid);
        if (qjson) {
          allFormPairs = allFormPairs.concat(StdFolders_collectRefPairs_(qjson, "questions"));
        }
      }
      StdFolders_recoverUnregisteredRefs_(formsAdapter, allFormPairs, ctx);
      result.forms = StdFolders_alignIdSet_(formsAdapter, refIdsOf(allFormPairs), ctx);

      // フォーム id が変わったら各中間クエスチョンのリンクを追従。
      for (var j = 0; j < qFileIds.length; j++) {
        if (StdFolders_rewriteRefsInFile_(qFileIds[j], "questions", ctx.remap)) result.relinkedFiles++;
      }
      // クエスチョン id が変わったら、保存済みダッシュボードのリンクを追従。
      if (StdFolders_rewriteRefsInFile_(savedFileId, "dashboards", ctx.remap)) result.relinkedFiles++;
    }

    // 逆方向の完全再リンク: 参照先（または保存本体）の論理パスが変わったときだけ走らせる（重い全走査をゲート）。
    //   ・remap（外部コピー/再採用で id 変化）→ 参照元の id を全件振替
    //   ・pathChanged（move/物理追従でフォルダ変化、または保存本体の rename）→ 参照元の *Path を全件再 stamp
    // 保存本体（savedFileId）は上で個別に remap 追従済みなので、ここでは path 再 stamp のみ補い、全走査では除外する。
    if (nfbHasOwnKeys_(ctx.pathChanged)) {
      if (StdFolders_refreshRefPathsInFile_(savedFileId, kind)) result.relinkedFiles++;
    }
    if (nfbHasOwnKeys_(ctx.remap) || nfbHasOwnKeys_(ctx.pathChanged)) {
      result.relinkedFiles += StdFolders_propagateRelinkToAllRefs_(ctx.remap, ctx.pathChanged, savedFileId);
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

// ===========================================================================
// コピー先 初回解決ゲート: 論理パス（*Path）から物理（fileId / URL）を再解決する。
// プロジェクトコピーは物理を全消去するため（standardFoldersCopy.gs）、コピー先では
// Admin_rebuildRegistryFromLogical_ で registry を充填した後、各エンティティの参照を
// *Path から貼り直す（エンティティ参照は読取時の論理フォールバックが無いためここで確定する）。
// 物理が生存していれば触らない（physical-first・冪等）。
// ===========================================================================

// 印刷様式 URL（urlKey）が空/死で *Path（pathKey）があれば、05_report_templates から再解決して URL を貼り直す。
// 物理が生存していれば no-op。書き換えたら true。
function StdFolders_reresolveTemplateUrlFromPath_(holder, urlKey, pathKey) {
  if (!holder) return false;
  var path = holder[pathKey];
  if (typeof path !== "string" || !path) return false;
  var url = holder[urlKey];
  if (typeof url === "string" && url) {
    var parsed = Forms_parseGoogleDriveUrl_(url);
    var id = (parsed && parsed.type === "file") ? parsed.id : "";
    if (id && StdFolders_isFileIdAlive_(id)) return false;   // 物理生存 → 触らない
  }
  var fileId = StdFolders_resolvePathToFileId_("report_templates", path);
  if (!fileId) return false;
  try {
    holder[urlKey] = DriveApp.getFileById(fileId).getUrl();
    return true;
  } catch (e) {
    return false;
  }
}

// forms の非エンティティ物理参照（spreadsheet / 印刷様式）を *Path から再解決する。書き換えたら true。
function StdFolders_reresolveFormPhysicalFromLogical_(json) {
  if (!json || !json.settings) return false;
  var changed = false;
  var s = json.settings;
  // spreadsheet: 物理（spreadsheetId）が空/死なら spreadsheetPath（04_spreadsheets 配下の論理）から再解決。
  if (typeof s.spreadsheetPath === "string" && s.spreadsheetPath) {
    var ssId = Model_normalizeSpreadsheetId_(s.spreadsheetId);
    if (!ssId || !StdFolders_isFileIdAlive_(ssId)) {
      var ssFileId = StdFolders_resolveSpreadsheetPathToFileId_(s.spreadsheetPath);
      if (ssFileId && ssFileId !== ssId) { s.spreadsheetId = ssFileId; changed = true; }
    }
  }
  // 標準印刷様式（フォームレベル）。
  if (StdFolders_reresolveTemplateUrlFromPath_(s, "standardPrintTemplateUrl", "standardPrintTemplatePath")) changed = true;
  // field 個別の印刷様式。
  StdFolders_walkFields_(json.schema, function(field) {
    if (field && field.printTemplateAction) {
      if (StdFolders_reresolveTemplateUrlFromPath_(field.printTemplateAction, "templateUrl", "templatePath")) changed = true;
    }
  });
  return changed;
}

// fileId の 1 エンティティについて、エンティティ参照（Q→Form / D→Q / form→childForm）の空/死 id を
// *Path（pathKey）から再解決し、forms は spreadsheet / 印刷様式 の物理も再解決して書き戻す。書き換えたら true。
function StdFolders_reresolveRefsFromLogical_(fileId, kind) {
  if (!fileId) return false;
  var changed = false;
  try {
    var read = Nfb_readJsonFileById_(fileId);
    if (!read || !read.file) return false;
    var file = read.file;
    var json = read.json;
    StdFolders_forEachRef_(json, kind, function(ref) {
      var curId = ref.holder[ref.idKey];
      if (curId && StdFolders_isFileIdAlive_(curId)) return;   // 物理生存 → 触らない
      var path = ref.holder[ref.pathKey];
      if (typeof path !== "string" || !path) return;
      var adapter = StdFolders_entityAdapter_(ref.targetKind);
      if (!adapter.baseFolderOrNull()) return;
      var newId = StdFolders_recoverRefByPath_(adapter, curId || "", path);
      if (newId && newId !== curId) { ref.holder[ref.idKey] = newId; changed = true; }
    });
    if (kind === "forms" && StdFolders_reresolveFormPhysicalFromLogical_(json)) changed = true;
    if (changed) Nfb_writeJsonToFile_(file, json);
  } catch (err) {
    Logger.log("[StdFolders_reresolveRefsFromLogical_] " + fileId + " (" + kind + "): " + nfbErrorToString_(err));
  }
  return changed;
}
