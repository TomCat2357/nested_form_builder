// =============================================
// Analytics CRUD — Question / Dashboard list / get / save / delete / archive
// =============================================

// 同一物理ファイル（fileId）を指す mapping キーが複数あるときの自己修復は、
// Forms / Analytics 共通の Nfb_dedupeMappingByFileId_（formsCrud.gs）へ集約した。

function Analytics_listTemplates_(type, options) {
  return nfbSafeCall_(function() {
    var includeArchived = !!(options && options.includeArchived);
    var mapping = Analytics_getMapping_(type);
    // 既存の二重登録（旧 ULID キー + fileId キーが同一ファイルを指す）を畳んでから一覧化する。
    if (Nfb_dedupeMappingByFileId_(mapping)) Analytics_saveMapping_(type, mapping);
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
        // 名前 ＝ Drive ファイル名（.json 除去）。.json 内に name は持たない運用。
        item.name = Nfb_nameFromFile_(file);
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

// 論理側（mapping）が指す物理ファイルを解決する。
//   1) fileId が生存（非ゴミ箱）→ そのファイル。
//   2) fileId 不在 → 中央辞書の論理パス folder + 名前で、まず <folder>/<name>.json をパス限定で探す
//        （同名異フォルダの誤解決を防ぐ）。見つからなければ名前でツリー全体を探す。
//        探索名は entry.name（キャッシュ名）優先、無ければ id 自体（旧 ULID をファイル名にしていた救済）。
//   見つからなければ null（呼び出し側でエラー化）。
function Analytics_resolveItemFileOrNull_(type, fileId, id, entry, mapping) {
  if (fileId) {
    try {
      var f = DriveApp.getFileById(fileId);
      if (!(typeof f.isTrashed === "function" && f.isTrashed())) return f;
    } catch (e) { /* 消失 → 中央辞書アンカーで復旧へ */ }
  }
  var name = (entry && typeof entry.name === "string" && entry.name) ? entry.name : "";
  // 第一級フィールドの folder があれば、その物理フォルダ内に限定して name.json を探す。
  if (name && entry && typeof entry.folder === "string") {
    var scopedFolder = AnalyticsDrive_lookupFolderForPath_(type, entry.folder);
    if (scopedFolder) {
      var scoped = StdFolders_findFileByNameInFolder_(scopedFolder, name + ".json");
      if (!scoped && typeof Forms_normalizeFormTitle_ === "function") {
        scoped = StdFolders_findFileByNameInFolder_(scopedFolder, Forms_normalizeFormTitle_(name) + ".json");
      }
      if (scoped) return scoped;
    }
  }
  var byName = name ? AnalyticsDrive_findFileByNameInTree_(type, name) : null;
  if (byName) return byName;
  // entry.name が無いケース: id 文字列をファイル名候補として最終探索（旧データ救済）。
  if (id) {
    var byId = AnalyticsDrive_findFileByNameInTree_(type, Nfb_nameFromFileName_(id));
    if (byId) return byId;
  }
  return null;
}

function Analytics_getTemplate_(type, templateId) {
  return nfbSafeCall_(function() {
    if (!templateId) throw new Error("IDが指定されていません");
    var mapping = Analytics_getMapping_(type);
    var entry = mapping[templateId] || {};
    var fileId = Nfb_resolveFileIdFromEntry_(entry);

    // 論理側が持つ物理ファイル（fileId）が存在しない（消失/ゴミ箱/未登録）ときは、
    // 論理パス（= 名前）で物理ファイルを探し直して解決する。見つかれば mapping を張り替える。
    var file = Analytics_resolveItemFileOrNull_(type, fileId, templateId, entry, mapping);
    if (!file) {
      throw new Error("ファイルを解決できませんでした（物理ファイルが見つかりません）: " + templateId);
    }
    var resolvedFileId = file.getId();
    if (resolvedFileId !== fileId) {
      // 解決先の fileId へ論理側を上書き（id ＝ fileId 統一を維持）。
      delete mapping[templateId];
      var resolvedName = Nfb_nameFromFile_(file);
      var resolvedFolder = AnalyticsDrive_relativeFolderOfFile_(type, resolvedFileId);
      mapping[resolvedFileId] = {
        fileId: resolvedFileId,
        driveFileUrl: file.getUrl(),
        name: resolvedName,
        folder: typeof resolvedFolder === "string" ? resolvedFolder : null
      };
      Analytics_saveMapping_(type, mapping);
      templateId = resolvedFileId;
    }
    var item = JSON.parse(file.getBlob().getDataAsString());
    item.id = templateId;
    // 名前 ＝ Drive ファイル名（.json 除去）。.json 内に name は持たない運用。
    item.name = Nfb_nameFromFile_(file);
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

    // id ＝ Drive fileId へ統一。既存は template.id（＝fileId）を上書き、新規は保存後に fileId を採番する。
    var existingId = template.id || "";
    var mapping = Analytics_getMapping_(type);
    var existingEntry = existingId ? (mapping[existingId] || {}) : {};
    // 既存ファイルを「fileId → 論理パス folder + 名前アンカー」の順で解決する（Analytics_getTemplate_ と対称）。
    // cache 優先 getById が渡す stale な id（実体とずれた fileId / 旧 ULID）でも実体を引き当て、
    // リネームを「別ファイル新規作成」ではなく「実体の上書き(setName)」へ倒して重複を防ぐ。
    var existingFile = existingId
      ? Analytics_resolveItemFileOrNull_(type, Nfb_resolveFileIdFromEntry_(existingEntry), existingId, existingEntry, mapping)
      : null;
    // 名前/フォルダで実体を引き当てられない場合、テンプレート自身が持つ driveFileUrl から救済する
    // （フロントの IndexedDB キャッシュに残った stale id で mapping にエントリ自体が無い／名前を
    //  失っているケース。これをしないと存在しない id を fileId 扱いして新規ファイルを作り二重化する）。
    if (!existingFile && template.driveFileUrl) {
      var parsedSelfUrl = Forms_parseGoogleDriveUrl_(template.driveFileUrl);
      if (parsedSelfUrl && parsedSelfUrl.type === "file" && parsedSelfUrl.id) {
        try {
          var selfFile = DriveApp.getFileById(parsedSelfUrl.id);
          if (!(typeof selfFile.isTrashed === "function" && selfFile.isTrashed())) existingFile = selfFile;
        } catch (eSelf) { /* fallthrough */ }
      }
    }
    var existingFileId = existingFile
      ? existingFile.getId()
      : (Nfb_resolveFileIdFromEntry_(existingEntry) || (existingId || null));

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

    // 名前のユニーク化: 既存テンプレート名と衝突する場合は ` (1)` ` (2)` を付与。
    // 衝突判定は「同一論理フォルダ内」に限定する。論理パス folder が違えば同名を許容する
    // （questions / dashboards / forms は種類ごとに mapping が別なので互いに衝突しない）。
    // mapping にキャッシュされた name を優先し、無ければ各ファイルを読みに行く。
    var targetFolderPath = Forms_normalizeFolderPath_(normalizedTemplate.folder);
    var existingNames = [];
    for (var otherId in mapping) {
      if (!mapping.hasOwnProperty(otherId)) continue;
      if (otherId === existingId) continue; // 自分自身は除外
      var otherEntry = mapping[otherId] || {};
      // 二重登録が残っている場合、同一物理ファイルを指す別名キー（旧 ULID 等）も
      // 自分扱いで除外する。除外しないと自分の名前と衝突して誤って ` (1)` が付く。
      if (existingFileId && Nfb_resolveFileIdFromEntry_(otherEntry) === existingFileId) continue;
      // 論理フォルダが異なるアイテムは衝突対象外（フォルダが違えば同名可）。
      if (Forms_normalizeFolderPath_(otherEntry.folder) !== targetFolderPath) continue;
      var otherName = otherEntry.name;
      if (typeof otherName !== "string" || !otherName) {
        // mapping にキャッシュが無いケース。名前 ＝ ファイル名なので実ファイル名から導出する。
        var otherFileId = Nfb_resolveFileIdFromEntry_(otherEntry);
        if (otherFileId) {
          try {
            var otherFile = DriveApp.getFileById(otherFileId);
            if (!otherFile.isTrashed()) {
              otherName = Nfb_nameFromFile_(otherFile);
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
    // 保存する .json は「自分自身の id も名前（ファイル名）も持たない」運用とする。
    // id を埋め込まず、name も書かない。読み込み時に fileId / ファイル名から復元する。
    var contentObj = {};
    for (var ck in normalizedTemplate) {
      if (normalizedTemplate.hasOwnProperty(ck) && ck !== "name") contentObj[ck] = normalizedTemplate[ck];
    }
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
        // 既に解決済みの実体があれば再取得を避けて再利用する（同一 fileId のとき）。
        file = (existingFile && overwriteFileId === existingFile.getId())
          ? existingFile
          : DriveApp.getFileById(overwriteFileId);
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

    var id = file.getId();   // id ＝ Drive fileId

    // 保存時の物理/論理フォルダ整合: 明示フォルダ指定（copy_to_folder）以外は、
    // item.folder に対応する物理フォルダ（02_questions / 03_dashboards 配下）へ揃える。
    // 構成内ファイルは move（fileId 保持）、解決不能時は no-op（安全側）。
    if (saveMode !== "copy_to_folder") {
      var folderPath = Forms_normalizeFolderPath_(normalizedTemplate.folder);
      AnalyticsDrive_moveItemFileToPath_(type, id, folderPath);
    }
    fileUrl = file.getUrl();

    // 旧 id キー（例: 移行前の ULID キー）が今回保存した fileId と異なる場合は除去し、
    // 同一ファイルを指すキーが 2 つ残る二重登録を防ぐ。Analytics_getTemplate_ の
    // 張り替え（delete mapping[templateId]）と対称。existingFileId は旧キーのエントリから
    // 解決済みなので、この delete は必ず id 確定後に行う（先に消すと上書き先を解決できない）。
    if (existingId && existingId !== id && mapping.hasOwnProperty(existingId)) {
      delete mapping[existingId];
    }
    // マッピング更新（fileId キー）— name と論理パス folder を中央辞書へ第一級保存
    mapping[id] = {
      fileId: id,
      driveFileUrl: fileUrl,
      name: uniqueName,
      folder: Forms_normalizeFolderPath_(normalizedTemplate.folder)
    };
    Analytics_saveMapping_(type, mapping);

    // 保存後: 参照先（questions→forms / dashboards→questions+forms）に ①〜④ 整合を適用し、
    // ②外部コピー/③再採用で参照先 id が変わったらリンクを追従させる。base 未設定なら no-op。
    var referenceSync = null;
    try {
      referenceSync = StdFolders_alignReferencesOnSave_(type, id);
      if (referenceSync && referenceSync.remap) {
        // 返却オブジェクトのリンクも追従させ、クライアント表示と Drive 実体を一致させる。
        StdFolders_applyRemapToRefs_(normalizedTemplate, type, referenceSync.remap);
      }
    } catch (errRefSync) {
      Logger.log("[Analytics_saveTemplate_] alignReferencesOnSave failed: " + nfbErrorToString_(errRefSync));
    }

    var saved = {};
    for (var sk in normalizedTemplate) {
      if (normalizedTemplate.hasOwnProperty(sk)) saved[sk] = normalizedTemplate[sk];
    }
    saved.id = id;
    saved.driveFileUrl = fileUrl;

    var resultKey = Analytics_getResultKey_(type);
    var result = { ok: true, fileUrl: fileUrl, saveMode: saveMode };
    result[resultKey] = saved;
    if (referenceSync) result.referenceSync = referenceSync;
    return result;
  });
}

/**
 * 複数テンプレート（クエスチョン / ダッシュボード）のリンクを解除（アンマウント）する。
 * Drive 上の実体は削除せず残し、中央辞書（マッピング）の登録のみを除去する。
 * 戻り値の deleted は「リンク解除した件数」（後方互換のためキー名は据え置き）。
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
      // リンク（登録）のみ解除する。Drive 上のファイル本体は削除しない。
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

  // id ＝ Drive fileId / 名前 ＝ Drive ファイル名 へ統一。
  var id = fileId;
  var name = Nfb_nameFromFile_(file);
  var fileUrl = file.getUrl();
  mapping[id] = {
    fileId: fileId,
    driveFileUrl: fileUrl,
    name: name,
    folder: Forms_normalizeFolderPath_(json.folder)
  };
  Analytics_saveMapping_("questions", mapping);

  json.id = id;
  json.name = name;
  json.archived = !!json.archived;
  if (!json.driveFileUrl) json.driveFileUrl = fileUrl;
  return json;
}

/**
 * 壊れた Question 参照（ダッシュボードカード）を解決する。
 * ref = { questionId }（参照は fileId のみ。旧 ref.name は受け取っても無視）
 *   1) questionId（＝fileId）が生存ファイルに解決できればそれを返す（relinked:false）。
 *   2) id 不在 → 中央辞書（マッピング）の論理パス folder + 名前アンカーで物理ファイルを引き当て直す
 *      （Analytics_resolveItemFileOrNull_。id 変化＝コピー/再作成の自動再リンク。matchedBy:"registry"）。
 * 戻り: { ok:true, question, questionId, relinked, matchedBy }。見つからなければ question:null。
 */
function Analytics_resolveQuestionRef_(ref) {
  return nfbSafeCall_(function() {
    ref = ref || {};
    var wantId = ref.questionId ? String(ref.questionId) : "";
    if (!wantId) return { ok: true, question: null };

    var mapping = Analytics_getMapping_("questions");
    var entry = mapping[wantId] || null;

    // 1) id（＝fileId）で解決を試みる。マッピング登録があればその fileId、無ければ wantId 自体を
    //    fileId とみなして直接開く（コピー直後でマッピング未構築のケースを救済）。
    var fid = (entry ? Nfb_resolveFileIdFromEntry_(entry) : null) || wantId;
    if (fid) {
      try {
        var f0 = DriveApp.getFileById(fid);
        if (!f0.isTrashed() && StdFolders_isJsonFile_(f0)) {
          var q0 = Analytics_adoptQuestionFile_(f0, mapping);
          if (q0) return { ok: true, question: q0, questionId: q0.id, relinked: q0.id !== wantId, matchedBy: "id" };
        }
      } catch (e0) { /* 壊れている / fileId でない → 中央辞書アンカーで復旧へ */ }
    }

    // 2) 中央辞書の folder + 名前で物理ファイルを引き当て直す（id 変化の復旧）。
    var recovered = Analytics_resolveItemFileOrNull_("questions", null, wantId, entry, mapping);
    if (recovered) {
      var qn = Analytics_adoptQuestionFile_(recovered, mapping);
      if (qn) return { ok: true, question: qn, questionId: qn.id, relinked: true, matchedBy: "registry" };
    }

    return { ok: true, question: null };
  });
}
