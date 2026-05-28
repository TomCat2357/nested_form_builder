// =============================================
// Analytics CRUD — Question / Dashboard list / get / save / delete / archive
// =============================================

function Analytics_listTemplates_(type, options) {
  return nfbSafeCall_(function() {
    var includeArchived = !!(options && options.includeArchived);
    var mapping = Analytics_getMapping_(type);
    var items = [];
    var loadFailures = [];

    for (var id in mapping) {
      if (!mapping.hasOwnProperty(id)) continue;
      var entry = mapping[id] || {};
      var fileId = Nfb_resolveFileIdFromEntry_(entry);
      if (!fileId) {
        loadFailures.push({ id: id, error: "ファイルIDが登録されていません" });
        continue;
      }
      try {
        var file = DriveApp.getFileById(fileId);
        if (file.isTrashed()) {
          loadFailures.push({ id: id, error: "ファイルがゴミ箱に移動されています" });
          continue;
        }
        var item = JSON.parse(file.getBlob().getDataAsString());
        item.id = id;
        item.archived = !!item.archived;
        if (!item.driveFileUrl) item.driveFileUrl = entry.driveFileUrl || file.getUrl();

        // Dashboard は v2 スキーマ (Metabase 風自由配置) のみフロントに返す。
        if (type === "dashboards" && item.schemaVersion !== 2) {
          loadFailures.push({ id: id, error: "旧形式 (schemaVersion=" + (item.schemaVersion || 1) + ") のため読み飛ばしました" });
          continue;
        }

        if (!includeArchived && item.archived) continue;
        items.push(item);
      } catch (err) {
        loadFailures.push({ id: id, error: nfbErrorToString_(err) });
      }
    }

    var result = { ok: true, loadFailures: loadFailures };
    result[Analytics_getResultListKey_(type)] = items;
    return result;
  });
}

function Analytics_getTemplate_(type, templateId) {
  return nfbSafeCall_(function() {
    if (!templateId) throw new Error("IDが指定されていません");
    var mapping = Analytics_getMapping_(type);
    var entry = mapping[templateId] || {};
    var fileId = Nfb_resolveFileIdFromEntry_(entry);
    if (!fileId) throw new Error("ファイルIDが登録されていません: " + templateId);

    var file = DriveApp.getFileById(fileId);
    var item = JSON.parse(file.getBlob().getDataAsString());
    item.id = templateId;
    item.archived = !!item.archived;
    if (!item.driveFileUrl) item.driveFileUrl = entry.driveFileUrl || file.getUrl();

    var resultKey = Analytics_getResultKey_(type);
    var result = { ok: true };
    result[resultKey] = item;
    return result;
  });
}

/**
 * テンプレート保存。
 * targetUrl は file URL / folder URL を受け付け、Forms_saveForm_ と同等の 4 モード
 * (auto/overwrite_existing/copy_to_folder/copy_to_root) を解釈する。
 */
function Analytics_saveTemplate_(type, template, targetUrl) {
  return nfbSafeCall_(function() {
    if (!template || typeof template !== "object") throw new Error("テンプレートデータが不正です");

    var id = template.id;
    var isNew = !id;
    if (isNew) {
      id = Analytics_getIdPrefix_(type) + "_" + Nfb_generateUlid_();
    }

    var mapping = Analytics_getMapping_(type);
    var existingEntry = mapping[id] || {};
    var existingFileId = Nfb_resolveFileIdFromEntry_(existingEntry);

    // archived/createdAt/modifiedAt を正規化
    var nowMs = Date.now();
    var normalizedTemplate = {};
    for (var k in template) {
      if (template.hasOwnProperty(k) && k !== "id" && k !== "driveFileUrl") {
        normalizedTemplate[k] = template[k];
      }
    }
    normalizedTemplate.archived = !!normalizedTemplate.archived;
    if (typeof normalizedTemplate.createdAt !== "number" || isNaN(normalizedTemplate.createdAt)) {
      normalizedTemplate.createdAt = nowMs;
    }
    normalizedTemplate.modifiedAt = nowMs;
    if (type === "dashboards") {
      // Dashboard は v2 スキーマ (Metabase 風自由配置) を強制する。
      normalizedTemplate.schemaVersion = 2;
    } else {
      normalizedTemplate.schemaVersion = normalizedTemplate.schemaVersion || 1;
    }

    // 名前のユニーク化: 既存テンプレート名と衝突する場合は ` (1)` ` (2)` を付与
    // mapping にキャッシュされた name を優先し、無ければ各ファイルを読みに行く。
    var existingNames = [];
    for (var otherId in mapping) {
      if (!mapping.hasOwnProperty(otherId)) continue;
      if (otherId === id) continue; // 自分自身は除外
      var otherEntry = mapping[otherId] || {};
      var otherName = otherEntry.name;
      if (typeof otherName !== "string" || !otherName) {
        // 旧 mapping にキャッシュが無いケース。実ファイルから読む（コスト高だが移行期のみ）
        var otherFileId = Nfb_resolveFileIdFromEntry_(otherEntry);
        if (otherFileId) {
          try {
            var otherFile = DriveApp.getFileById(otherFileId);
            if (!otherFile.isTrashed()) {
              var otherItem = JSON.parse(otherFile.getBlob().getDataAsString());
              otherName = otherItem && otherItem.name;
              if (typeof otherName === "string" && otherName) {
                // 次回以降の高速化のため mapping にキャッシュ
                otherEntry.name = otherName;
                mapping[otherId] = otherEntry;
              }
            }
          } catch (errRead) {
            Logger.log("[Analytics_saveTemplate_] failed to read name for " + otherId + ": " + errRead);
          }
        }
      }
      if (typeof otherName === "string" && otherName) {
        existingNames.push(otherName);
      }
    }
    var uniqueName = Forms_makeUniqueFormTitle_(normalizedTemplate.name || "", existingNames);
    normalizedTemplate.name = uniqueName;

    var fileName = uniqueName + ".json";
    // ファイルへ id を埋め込む（リンク切れ時に id でファイルを探せるようにするため）。
    // list/get は読み出し後に mapping の id で上書きするので副作用はない。
    var contentObj = {};
    for (var ck in normalizedTemplate) {
      if (normalizedTemplate.hasOwnProperty(ck)) contentObj[ck] = normalizedTemplate[ck];
    }
    contentObj.id = id;
    var content = JSON.stringify(contentObj, null, 2);

    // targetUrl をパースして saveMode を決定
    var parsedTarget = null;
    if (targetUrl) {
      parsedTarget = Forms_parseGoogleDriveUrl_(targetUrl);
      if (!parsedTarget.type) {
        throw new Error("無効な Google Drive URL です: " + targetUrl);
      }
    }

    var saveMode = "auto";
    if (parsedTarget && parsedTarget.type === "folder") {
      saveMode = "copy_to_folder";
    } else if (parsedTarget && parsedTarget.type === "file") {
      saveMode = "overwrite_existing";
    } else if (existingFileId) {
      saveMode = "overwrite_existing";
    } else {
      saveMode = "copy_to_root";
    }

    var file = null;
    var fileUrl = null;

    if (saveMode === "overwrite_existing") {
      var overwriteFileId = (parsedTarget && parsedTarget.type === "file") ? parsedTarget.id : existingFileId;
      if (!overwriteFileId) {
        throw new Error("上書き先のファイルIDを解決できません");
      }
      try {
        file = DriveApp.getFileById(overwriteFileId);
        if (file.isTrashed()) {
          // ゴミ箱に入っていたら新規作成にフォールバック
          file = null;
        } else {
          // 名前を変えたら Drive ファイル名も追従させる（uniqueName.json へリネーム）。
          if (file.getName() !== fileName) file.setName(fileName);
          file.setContent(content);
        }
      } catch (err) {
        Logger.log("[Analytics_saveTemplate_] overwrite failed: " + err);
        file = null;
      }
    }

    if (!file && saveMode === "copy_to_folder") {
      var folder = DriveApp.getFolderById(parsedTarget.id);
      file = folder.createFile(fileName, content, MimeType.PLAIN_TEXT);
    }

    // 自動整理が ON で明示指定が無い場合は 02_questions / 03_dashboards へ作成する。
    var stdAnalyticsKey = type === "questions" ? "questions" : "dashboards";

    if (!file && saveMode === "copy_to_root") {
      var defaultFolder = StdFolders_autoFileFolderOrNull_(stdAnalyticsKey) || Analytics_getOrCreateFolder_(type);
      file = defaultFolder.createFile(fileName, content, MimeType.PLAIN_TEXT);
    }

    if (!file) {
      // overwrite_existing で失敗した場合のフォールバック (標準フォルダ → 既定フォルダ)
      var fallbackFolder = StdFolders_autoFileFolderOrNull_(stdAnalyticsKey) || Analytics_getOrCreateFolder_(type);
      file = fallbackFolder.createFile(fileName, content, MimeType.PLAIN_TEXT);
    }

    fileUrl = file.getUrl();

    // マッピング更新 — name をキャッシュして次回以降の衝突判定を高速化
    mapping[id] = { fileId: file.getId(), driveFileUrl: fileUrl, name: uniqueName };
    Analytics_saveMapping_(type, mapping);

    var saved = {};
    for (var sk in normalizedTemplate) {
      if (normalizedTemplate.hasOwnProperty(sk)) saved[sk] = normalizedTemplate[sk];
    }
    saved.id = id;
    saved.driveFileUrl = fileUrl;

    var resultKey = Analytics_getResultKey_(type);
    var result = { ok: true, fileUrl: fileUrl, saveMode: saveMode };
    result[resultKey] = saved;
    return result;
  });
}

/**
 * 複数テンプレートを削除。マッピングからの除去のみ。Drive ファイルは残す。
 */
function Analytics_deleteTemplates_(type, templateIds) {
  return nfbSafeCall_(function() {
    var ids = Nfb_normalizeIdList_(templateIds);
    if (!ids.length) {
      throw new Error("IDが指定されていません");
    }
    var mapping = Analytics_getMapping_(type);
    var deleted = 0;
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      if (mapping.hasOwnProperty(id)) {
        delete mapping[id];
        deleted += 1;
      }
    }
    Analytics_saveMapping_(type, mapping);
    return { ok: true, deleted: deleted, errors: [] };
  });
}

/**
 * 複数テンプレートのアーカイブ状態を一括変更
 */
function Analytics_setTemplatesArchivedState_(type, templateIds, archived) {
  return nfbSafeCall_(function() {
    var ids = Nfb_normalizeIdList_(templateIds);
    if (!ids.length) {
      throw new Error("IDが指定されていません");
    }
    var errors = [];
    var updated = 0;
    var updatedItems = [];
    var resultKey = Analytics_getResultKey_(type);

    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      try {
        var getRes = Analytics_getTemplate_(type, id);
        if (!getRes || !getRes.ok || !getRes[resultKey]) {
          errors.push({ id: id, error: "テンプレートが見つかりません" });
          continue;
        }
        var template = getRes[resultKey];
        template.archived = !!archived;
        var saveRes = Analytics_saveTemplate_(type, template);
        if (saveRes && saveRes.ok && saveRes[resultKey]) {
          updated += 1;
          updatedItems.push(saveRes[resultKey]);
        } else {
          errors.push({ id: id, error: (saveRes && saveRes.error) || "保存に失敗しました" });
        }
      } catch (err) {
        Logger.log("[Analytics_setTemplatesArchivedState_] Error for id " + id + ": " + err);
        errors.push({ id: id, error: nfbErrorToString_(err) });
      }
    }

    var result = {
      ok: errors.length === 0,
      updated: updated,
      errors: errors,
    };
    result[Analytics_getResultListKey_(type)] = updatedItems;
    return result;
  });
}

// 02_questions 内のファイルを Question として確定する。
// 既存マッピングに fileId 登録済みならその id、無ければ json.id、それも無ければ新規採番。
// マッピングを最新化（fileId/url）し、id をセットした Question を返す。失敗時は null。
function Analytics_adoptQuestionFile_(file, mapping) {
  var fileId = file.getId();
  var json;
  try {
    json = JSON.parse(file.getBlob().getDataAsString());
  } catch (err) {
    Logger.log("[Analytics_adoptQuestionFile_] parse failed: " + file.getName());
    return null;
  }
  if (!json || typeof json !== "object") return null;

  var rev = StdFolders_buildFileIdToId_(mapping);
  var id = rev[fileId]
    || ((typeof json.id === "string" && json.id) ? json.id : ("q_" + Nfb_generateUlid_()));

  var fileUrl = file.getUrl();
  mapping[id] = { fileId: fileId, driveFileUrl: fileUrl, name: json.name || id };
  Analytics_saveMapping_("questions", mapping);

  json.id = id;
  json.archived = !!json.archived;
  if (!json.driveFileUrl) json.driveFileUrl = fileUrl;
  return json;
}

/**
 * 壊れた Question 参照（ダッシュボードカード）を解決する。
 * ref = { questionId, name }
 *   1) 既存マッピングの questionId が生存ファイルに解決できればそれを返す（relinked:false）。
 *   2) 標準フォルダ 02_questions を「ファイル名 (name + ".json") または json.name」で探す（matchedBy:"name"）。
 *   3) 同フォルダを「json.id === questionId」で探す（matchedBy:"id"）。
 * 戻り: { ok:true, question, questionId, relinked, matchedBy }。見つからなければ question:null。
 */
function Analytics_resolveQuestionRef_(ref) {
  return nfbSafeCall_(function() {
    ref = ref || {};
    var wantId = ref.questionId ? String(ref.questionId) : "";
    var wantName = (typeof ref.name === "string") ? ref.name : "";

    var mapping = Analytics_getMapping_("questions");

    // 1) 既存マッピングで解決を試みる
    if (wantId && mapping[wantId]) {
      var fid = Nfb_resolveFileIdFromEntry_(mapping[wantId]);
      if (fid) {
        try {
          var f0 = DriveApp.getFileById(fid);
          if (!f0.isTrashed()) {
            var q0 = Analytics_adoptQuestionFile_(f0, mapping);
            if (q0) return { ok: true, question: q0, questionId: q0.id, relinked: false, matchedBy: "mapping" };
          }
        } catch (e0) { /* 壊れている → フォルダ走査へ */ }
      }
    }

    var folder = StdFolders_autoFileFolderOrNull_("questions");
    if (!folder) return { ok: true, question: null };

    // 2) ファイル名 / json.name で探す
    if (wantName) {
      var targetFileName = wantName + ".json";
      var it2 = folder.getFiles();
      while (it2.hasNext()) {
        var fn = it2.next();
        if (typeof fn.isTrashed === "function" && fn.isTrashed()) continue;
        if (!StdFolders_isJsonFile_(fn)) continue;
        if (fn.getName() !== targetFileName) {
          // ファイル名が一致しなくても中身の name が一致すれば採用（旧データ救済）。
          // 一致判定だけ先に行い、不一致ファイルを mapping へ登録しない。
          var peek;
          try {
            peek = JSON.parse(fn.getBlob().getDataAsString());
          } catch (ePeek) {
            continue;
          }
          if (!peek || peek.name !== wantName) continue;
        }
        var qn = Analytics_adoptQuestionFile_(fn, mapping);
        if (qn) return { ok: true, question: qn, questionId: qn.id, relinked: true, matchedBy: "name" };
      }
    }

    // 3) json.id === questionId で探す
    if (wantId) {
      var it3 = folder.getFiles();
      while (it3.hasNext()) {
        var fi = it3.next();
        if (typeof fi.isTrashed === "function" && fi.isTrashed()) continue;
        if (!StdFolders_isJsonFile_(fi)) continue;
        var jsonI;
        try {
          jsonI = JSON.parse(fi.getBlob().getDataAsString());
        } catch (eI) {
          continue;
        }
        if (jsonI && jsonI.id === wantId) {
          var qi = Analytics_adoptQuestionFile_(fi, mapping);
          if (qi) return { ok: true, question: qi, questionId: qi.id, relinked: true, matchedBy: "id" };
        }
      }
    }

    return { ok: true, question: null };
  });
}
