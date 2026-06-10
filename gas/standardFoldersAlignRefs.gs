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

// フォーム json の schema から formLink 参照の子フォーム id を集める（childFormId）。
function StdFolders_collectChildFormIdsFromFormJson_(json) {
  var ids = [];
  if (json && Array.isArray(json.schema)) {
    StdFolders_walkFields_(json.schema, function(field) {
      if (field && field.type === "formLink" && field.childFormId) ids.push(field.childFormId);
    });
  }
  return ids;
}

// 参照種別ごとに {id, path}（path＝冗長保存した論理パス、無ければ ""）の組を集める。
// fileId 切れ時の「論理パス再探索による復旧」に使う。
//   refKind="questions"  → Q→Form（query.gui.formPath / query.formSources[].formPath）
//   refKind="dashboards" → D→Q（cards[].questionPath）
//   refKind="forms"      → form→childForm（schema 内 formLink の childFormPath）
function StdFolders_collectRefPairs_(json, refKind) {
  var pairs = [];
  if (!json) return pairs;
  if (refKind === "questions") {
    var query = json.query;
    if (query && typeof query === "object") {
      if (query.gui && typeof query.gui === "object" && query.gui.formId) {
        pairs.push({ id: query.gui.formId, path: typeof query.gui.formPath === "string" ? query.gui.formPath : "" });
      }
      if (Array.isArray(query.formSources)) {
        for (var i = 0; i < query.formSources.length; i++) {
          var src = query.formSources[i];
          if (src && src.formId) pairs.push({ id: src.formId, path: typeof src.formPath === "string" ? src.formPath : "" });
        }
      }
    }
  } else if (refKind === "dashboards") {
    if (Array.isArray(json.cards)) {
      for (var c = 0; c < json.cards.length; c++) {
        var card = json.cards[c];
        if (card && card.questionId) pairs.push({ id: card.questionId, path: typeof card.questionPath === "string" ? card.questionPath : "" });
      }
    }
  } else if (refKind === "forms") {
    if (Array.isArray(json.schema)) {
      StdFolders_walkFields_(json.schema, function(field) {
        if (field && field.type === "formLink" && field.childFormId) {
          pairs.push({ id: field.childFormId, path: typeof field.childFormPath === "string" ? field.childFormPath : "" });
        }
      });
    }
  }
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
//   kind="questions"  → query.gui.formPath / query.formSources[].formPath
//   kind="dashboards" → cards[].questionPath
//   kind="forms"      → schema 内 formLink の childFormPath
// 解決できない id は据え置き（既存値維持）。書き換えたら true。
function StdFolders_stampRefPaths_(json, kind) {
  if (!json) return false;
  var changed = false;
  if (kind === "questions") {
    var query = json.query;
    if (query && typeof query === "object") {
      if (query.gui && typeof query.gui === "object" && query.gui.formId) {
        var gp = StdFolders_qualifiedPathForId_("forms", query.gui.formId);
        if (gp !== null && query.gui.formPath !== gp) { query.gui.formPath = gp; changed = true; }
      }
      if (Array.isArray(query.formSources)) {
        for (var i = 0; i < query.formSources.length; i++) {
          var src = query.formSources[i];
          if (src && src.formId) {
            var sp = StdFolders_qualifiedPathForId_("forms", src.formId);
            if (sp !== null && src.formPath !== sp) { src.formPath = sp; changed = true; }
          }
        }
      }
    }
  } else if (kind === "dashboards") {
    if (Array.isArray(json.cards)) {
      for (var c = 0; c < json.cards.length; c++) {
        var card = json.cards[c];
        if (card && card.questionId) {
          var qp = StdFolders_qualifiedPathForId_("questions", card.questionId);
          if (qp !== null && card.questionPath !== qp) { card.questionPath = qp; changed = true; }
        }
      }
    }
  } else if (kind === "forms") {
    StdFolders_walkFields_(json.schema, function(field) {
      if (!field || field.type !== "formLink" || !field.childFormId) return;
      var p = StdFolders_qualifiedPathForId_("forms", field.childFormId);
      if (p !== null && field.childFormPath !== p) { field.childFormPath = p; changed = true; }
    });
  }
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

// remap（旧id→新id）を json 内の参照に適用する。
//   kind="questions" → query.gui.formId(+formPath) / query.formSources[].formId(+formPath)
//   kind="dashboards"→ cards[].questionId(+questionPath)
//   kind="forms"     → schema 内 formLink の childFormId(+childFormPath)
// 書き換えたら true。冗長保存の path は新 id の論理パスへ再計算する。
function StdFolders_applyRemapToRefs_(json, kind, remap) {
  if (!json || !StdFolders_hasOwnKeys_(remap)) return false;
  var changed = false;
  if (kind === "forms") {
    StdFolders_walkFields_(json.schema, function(field) {
      if (!field || field.type !== "formLink") return;
      if (field.childFormId && remap[field.childFormId]) {
        field.childFormId = remap[field.childFormId];
        var p = StdFolders_qualifiedPathForId_("forms", field.childFormId);
        if (p !== null) field.childFormPath = p;
        changed = true;
      }
    });
    return changed;
  }
  if (kind === "questions") {
    var query = json.query;
    if (query && typeof query === "object") {
      if (query.gui && typeof query.gui === "object" && query.gui.formId && remap[query.gui.formId]) {
        query.gui.formId = remap[query.gui.formId];
        var gp = StdFolders_qualifiedPathForId_("forms", query.gui.formId);
        if (gp !== null) query.gui.formPath = gp;
        changed = true;
      }
      if (Array.isArray(query.formSources)) {
        for (var i = 0; i < query.formSources.length; i++) {
          var src = query.formSources[i];
          if (src && src.formId && remap[src.formId]) {
            src.formId = remap[src.formId];
            var sp = StdFolders_qualifiedPathForId_("forms", src.formId);
            if (sp !== null) src.formPath = sp;
            changed = true;
          }
        }
      }
    }
  } else if (kind === "dashboards") {
    if (Array.isArray(json.cards)) {
      for (var c = 0; c < json.cards.length; c++) {
        var card = json.cards[c];
        if (card && card.questionId && remap[card.questionId]) {
          card.questionId = remap[card.questionId];
          var qp = StdFolders_qualifiedPathForId_("questions", card.questionId);
          if (qp !== null) card.questionPath = qp;
          changed = true;
        }
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

// 保存後フック。kind = "questions" | "dashboards" | "forms"、savedFileId = 保存したエンティティの fileId。
// 参照先（Q→Form / D→Q(+Form) / form→childForm）へ ⓪①②③ を適用し、id 変化を追従させる。
// 加えて、中央辞書に無い（未登録）かつ fileId 切れの参照は冗長保存した論理パスで再探索して復旧する。
// 戻り: { ok, kind, forms, questions, errors, remap, relinkedFiles }。
function StdFolders_alignReferencesOnSave_(kind, savedFileId) {
  var result = { ok: true, kind: kind, forms: null, questions: null, errors: [], remap: {}, relinkedFiles: 0 };
  try {
    if (kind !== "questions" && kind !== "dashboards" && kind !== "forms") return result;
    var savedJson = StdFolders_readJsonByFileId_(savedFileId);
    if (!savedJson) return result;

    var ctx = { errors: [], invalidCandidates: [], remap: {}, dirty: false, guard: null };
    var formsAdapter = StdFolders_entityAdapter_("forms");

    if (kind === "forms") {
      // form→childForm（formLink）。子フォームへ ⓪①②③ + path 復旧を適用し、親の childFormId を追従。
      StdFolders_recoverUnregisteredRefs_(formsAdapter, StdFolders_collectRefPairs_(savedJson, "forms"), ctx);
      var childIds = StdFolders_collectChildFormIdsFromFormJson_(savedJson);
      result.forms = StdFolders_alignIdSet_(formsAdapter, childIds, ctx);
      if (StdFolders_rewriteRefsInFile_(savedFileId, "forms", ctx.remap)) result.relinkedFiles++;
    } else if (kind === "questions") {
      StdFolders_recoverUnregisteredRefs_(formsAdapter, StdFolders_collectRefPairs_(savedJson, "questions"), ctx);
      var formIds = StdFolders_collectFormIdsFromQuestionJson_(savedJson);
      result.forms = StdFolders_alignIdSet_(formsAdapter, formIds, ctx);
      // 参照先フォームの id が変わったら、保存済みクエスチョンのリンクを追従。
      if (StdFolders_rewriteRefsInFile_(savedFileId, "questions", ctx.remap)) result.relinkedFiles++;
    } else {
      var questionsAdapter = StdFolders_entityAdapter_("questions");
      StdFolders_recoverUnregisteredRefs_(questionsAdapter, StdFolders_collectRefPairs_(savedJson, "dashboards"), ctx);
      var questionIds = StdFolders_collectQuestionIdsFromDashboardJson_(savedJson);
      result.questions = StdFolders_alignIdSet_(questionsAdapter, questionIds, ctx);

      // クエスチョンから先のフォームも整合する（remap 後の実 id でクエスチョン json を読む）。
      var qFileIds = [];
      var allFormIds = [];
      var allFormPairs = [];
      var seenQ = {};
      for (var i = 0; i < questionIds.length; i++) {
        var qid = ctx.remap[questionIds[i]] || questionIds[i];
        if (!qid || seenQ[qid]) continue;
        seenQ[qid] = true;
        qFileIds.push(qid);
        var qjson = StdFolders_readJsonByFileId_(qid);
        if (qjson) {
          allFormIds = allFormIds.concat(StdFolders_collectFormIdsFromQuestionJson_(qjson));
          allFormPairs = allFormPairs.concat(StdFolders_collectRefPairs_(qjson, "questions"));
        }
      }
      StdFolders_recoverUnregisteredRefs_(formsAdapter, allFormPairs, ctx);
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
