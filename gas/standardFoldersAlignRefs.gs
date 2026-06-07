// =============================================
// 標準フォルダ構成: 保存時の参照整合（①〜④）
// standardFoldersAlign.gs（整合エンジン）から分離。参照グラフの収集・remap 追従と
// 保存後フックを束ねる。整合判定そのもの（StdFolders_alignEntry_）はエンジン側。
// バンドル時に連結されるため関数はグローバル。
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
