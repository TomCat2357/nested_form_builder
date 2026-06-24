// =============================================
// Shared Entity CRUD — Forms / Analytics（Question / Dashboard）の CRUD で重複していた
// 「論理参照 → 物理 Drive ファイル解決」アルゴリズムの型汎用コア。
//
// フロントの cache 優先取得が渡す stale な id（実体とずれた fileId / 旧 ULID /
// mapping から消えたキー）でも実体を引き当て、保存時に「別ファイル新規作成 / 上書き失敗」
// ではなく「実体の上書き(setName)」へ倒して二重化・保存エラーを防ぐための共通解決ロジック。
//
// formsCrud.gs（Forms_resolveFormFileOrNull_）と analyticsCrud.gs（Analytics_resolveItemFileOrNull_）
// はほぼ同一の多段解決だったため、ここにコアを集約し、各 public 関数は Drive バックエンドの差分
// （フォルダ解決 / ツリー探索）を opts コールバックで注入する薄いラッパーになる。
//
// 解決順（上から順に試し、最初に見つかった生存ファイルを返す）:
//   1) fileId が生存（非ゴミ箱）          … 通常ケース
//   2) driveFileUrl から救済（任意）       … mapping にエントリが無い / 名前を失った stale id
//   3) 論理パス folder + 名前.json をパス限定で探す（同名異フォルダの誤解決を防ぐ・正規化名も試す）
//   4) 名前でツリー全体を探す
//   5) idFallbackName でツリー全体を探す（任意・旧 ULID をファイル名にしていたデータの救済）
//   見つからなければ null（呼び出し側でエラー化 / 従来フォールバックへ）。
//
// opts 形（型ごとの差分をここ 1 箇所に閉じ込める）:
//   name                  解決に使う表示名（forms は entry.title / analytics は entry.name）
//   folder                論理パス（string なら scoped 探索、それ以外なら scoped をスキップ）
//   driveFileUrl          URL 救済に使う URL（forms のみ。"" で救済スキップ）
//   lookupFolderForPath(folderPath) -> Folder|null   論理パス → 物理フォルダ解決
//   findInTree(name) -> File|null                    base サブツリーを名前で探索
//   idFallbackName        id 名フォールバックに使う文字列（analytics のみ。"" でスキップ）
// =============================================
function SharedCrud_resolveEntityFileOrNull_(fileId, opts) {
  // 1) fileId が生存（非ゴミ箱）。
  if (fileId) {
    try {
      var f = DriveApp.getFileById(fileId);
      if (!(typeof f.isTrashed === "function" && f.isTrashed())) return f;
    } catch (e) { /* 消失/不正 fileId → URL / アンカーで復旧へ */ }
  }

  // 2) driveFileUrl から救済（任意）。
  if (opts.driveFileUrl) {
    var parsed = Forms_parseGoogleDriveUrl_(opts.driveFileUrl);
    if (parsed && parsed.type === "file" && parsed.id) {
      try {
        var fu = DriveApp.getFileById(parsed.id);
        if (!(typeof fu.isTrashed === "function" && fu.isTrashed())) return fu;
      } catch (eu) { /* fallthrough */ }
    }
  }

  var name = (typeof opts.name === "string" && opts.name) ? opts.name : "";

  // 3) 論理パス folder + 名前.json をパス限定で探す（正規化名も試す）。
  if (name && typeof opts.folder === "string") {
    var scopedFolder = opts.lookupFolderForPath(opts.folder);
    if (scopedFolder) {
      var scoped = StdFolders_findFileByNameInFolder_(scopedFolder, name + ".json");
      if (!scoped && typeof Forms_normalizeFormTitle_ === "function") {
        scoped = StdFolders_findFileByNameInFolder_(scopedFolder, Forms_normalizeFormTitle_(name) + ".json");
      }
      if (scoped) return scoped;
    }
  }

  // 4) 名前でツリー全体を探す。
  if (name) {
    var byName = opts.findInTree(name);
    if (byName) return byName;
  }

  // 5) idFallbackName でツリー全体を探す（任意）。
  if (opts.idFallbackName) {
    var byId = opts.findInTree(opts.idFallbackName);
    if (byId) return byId;
  }

  return null;
}

// 保存先（targetUrl パース結果）と既存ファイルの有無から saveMode を決定する共通本体。
// Forms_saveForm_ / Analytics_saveTemplate_ で同一だった優先順位:
//   フォルダ指定 → copy_to_folder / ファイル指定 → overwrite_existing /
//   既存ファイルあり → overwrite_existing / それ以外 → copy_to_root。
function SharedCrud_resolveSaveMode_(parsedTarget, existingFileId) {
  if (parsedTarget && parsedTarget.type === "folder") return "copy_to_folder";
  if (parsedTarget && parsedTarget.type === "file") return "overwrite_existing";
  if (existingFileId) return "overwrite_existing";
  return "copy_to_root";
}

// =============================================
// 壊れた論理参照（リンク）を物理ファイルへ解決し、adopt して結果オブジェクトに包む共通コア。
// Forms_resolveFormRef_（クエスチョン→フォーム）/ Analytics_resolveQuestionRef_（ダッシュボード→
// クエスチョン）が同一だった「① fileId で解決 → adopt → ② registry の folder+名前アンカーで引き当て
// 直し → adopt → ③ null」のスケルトンを集約する。nfbSafeCall_ ラップは呼び出し側に残す（位置不変）。
//
// 解決順（最初に adopt 成功したものを返す）:
//   1) wantId（登録があればその fileId、無ければ wantId 自体を fileId とみなす）が生存 & JSON
//      → adoptFile → { ..., relinked: entity.id !== wantId, matchedBy: "id" }
//   2) resolveFileOrNull（registry の folder + 名前アンカーで物理ファイルを引き当て直す）が File を返す
//      → adoptFile → { ..., relinked: true, matchedBy: "registry" }（id 変化＝コピー/再作成の自動再リンク）
//   3) どちらも不可 → { ok: true, [entityKey]: null }
//
// opts（型ごとの差分をここ 1 箇所に閉じ込める）:
//   getMapping() -> mapping
//   adoptFile(file, mapping) -> entity|null            parse + adopt（型固有検証込み・id を確定）
//   resolveFileOrNull(wantId, entry, mapping) -> File|null   ② 専用の registry アンカー解決
//   entityKey                結果に entity を格納するキー（"form" / "question"）
//   idKey                    結果に entity.id を格納するキー（"formId" / "questionId"）
function SharedCrud_resolveEntityRef_(wantId, opts) {
  var mapping = opts.getMapping();
  var entry = wantId ? (mapping[wantId] || null) : null;

  // 1) id（＝fileId）で解決を試みる。
  if (wantId) {
    var fid = (entry ? Nfb_resolveFileIdFromEntry_(entry) : null) || wantId;
    if (fid) {
      try {
        var f0 = DriveApp.getFileById(fid);
        if (!(typeof f0.isTrashed === "function" && f0.isTrashed()) && StdFolders_isJsonFile_(f0)) {
          var e0 = opts.adoptFile(f0, mapping);
          if (e0) return SharedCrud_buildRefResult_(opts, e0, e0.id !== wantId, "id");
        }
      } catch (e) { /* 壊れている / 非 fileId → registry アンカーで復旧へ */ }
    }
  }

  // 2) registry の folder + 名前アンカーで物理ファイルを引き当て直す（id 変化の自動再リンク）。
  var recovered = opts.resolveFileOrNull(wantId, entry, mapping);
  if (recovered) {
    var e1 = opts.adoptFile(recovered, mapping);
    if (e1) return SharedCrud_buildRefResult_(opts, e1, true, "registry");
  }

  // 3) どちらも不可。
  var miss = { ok: true };
  miss[opts.entityKey] = null;
  return miss;
}

// SharedCrud_resolveEntityRef_ の結果オブジェクトを組み立てる。entityKey/idKey は型ごとに異なる。
function SharedCrud_buildRefResult_(opts, entity, relinked, matchedBy) {
  var r = { ok: true };
  r[opts.entityKey] = entity;
  r[opts.idKey] = entity.id;
  r.relinked = relinked;
  r.matchedBy = matchedBy;
  return r;
}

// =============================================
// Shared Entity CRUD — Forms / Analytics の delete / archive / copy 系で
// 「ほぼ行単位で同一」だった本体ロジックを adapter 注入方式で集約したコア群。
// 各 public 関数（Forms_*_ / Analytics_*_）は空チェック・nfbSafeCall_ ラップ位置・
// メッセージ文言の差分だけを保持した薄い委譲ラッパーになる。
//
// adapter（マッピング store の差分をここ 1 箇所に閉じ込める）:
//   getMapping() -> mapping            論理側マッピングを読む（forms: Forms_getMapping_ /
//                                      analytics: type つき）
//   saveMapping(mapping)               マッピングを永続化する
// =============================================

// 複数 ID のリンク（マッピング登録）のみを解除する共通本体。Drive 実体は触らない。
// Forms_deleteForms_ / Analytics_deleteTemplates_ の共通コア。
// 戻り値の deleted は「リンク解除した件数」（後方互換のためキー名は据え置き）。
function SharedEntity_deleteByIds_(ids, adapter) {
  var normalized = Nfb_normalizeIdList_(ids);
  var mapping = adapter.getMapping();
  var deleted = 0;
  for (var i = 0; i < normalized.length; i++) {
    var id = normalized[i];
    if (!id) continue;
    // リンク（登録）のみ解除する。Drive 上のファイル本体は削除しない。
    if (mapping.hasOwnProperty(id)) {
      delete mapping[id];
      deleted += 1;
    }
  }
  adapter.saveMapping(mapping);
  return { ok: true, deleted: deleted, errors: [] };
}

// 複数 ID を「削除」する共通本体。リンク解除に加え、プロジェクト内（標準フォルダ
// stdSubfolderKey 配下、ネスト含む）にある実体ファイルだけを Drive のゴミ箱へ移動する。
// プロジェクト外のファイルはリンク解除のみで実体は残す。
// Forms_deleteFormsWithFiles_ / Analytics_deleteTemplatesWithFiles_ の共通コア。
function SharedEntity_deleteWithFiles_(ids, stdSubfolderKey, adapter) {
  var normalized = Nfb_normalizeIdList_(ids);
  var mapping = adapter.getMapping();
  var deleted = 0;
  var trashed = 0;
  var errors = [];
  for (var i = 0; i < normalized.length; i++) {
    var id = normalized[i];
    if (!id) continue;

    // 実体トラッシュ判定用の fileId（id ≠ fileId に備えてマッピングからも解決）。
    var fileId = Nfb_resolveFileIdFromEntry_(mapping[id]) || id;

    // リンク（登録）を解除する。
    if (mapping.hasOwnProperty(id)) {
      delete mapping[id];
      deleted += 1;
    }

    // プロジェクト内のファイルだけ実体をゴミ箱へ移動する。
    if (fileId && StdFolders_isFileInStdSubfolder_(fileId, stdSubfolderKey)) {
      try {
        DriveApp.getFileById(fileId).setTrashed(true);
        trashed += 1;
      } catch (err) {
        errors.push({ id: id, fileId: fileId, reason: nfbErrorToString_(err) });
      }
    }
  }
  adapter.saveMapping(mapping);
  return { ok: true, deleted: deleted, trashed: trashed, errors: errors };
}

// 複数アイテムの真偽状態フラグを一括変更する共通本体（get → フラグ更新 → save → 結果集計）。
// Forms_setFormsStateField_ / Analytics_setTemplatesArchivedState_ の共通コア。
//
// opts（型ごとの差分）:
//   field       設定するフィールド名（"archived" / "readOnly"）
//   value       設定値
//   clearField  value が truthy のとき false へ強制する相互排他フィールド名（任意）
//   clearFields value が truthy のとき false へ強制する相互排他フィールド名の配列（任意、3 値以上の排他用）
//   idKey       errors[].のキー名（forms: "formId" / analytics: "id"）
//   listKey     更新済みアイテム配列を返すキー名（forms: "forms" / analytics: resultListKey）
//   notFoundMsg / saveFailMsg  エラーメッセージ
//   logTag      Logger.log 用タグ
//   getItem(id) -> item|null              対象アイテムを取得
//   beforeSave(item)                      save 直前の追加更新（任意。forms の modifiedAt 等）
//   saveItem(item) -> { ok, item, error } 保存（item は更新後の値、error は失敗時の文言）
function SharedEntity_setStateField_(ids, field, value, opts) {
  var normalized = Nfb_normalizeIdList_(ids);
  var errors = [];
  var updated = 0;
  var updatedItems = [];
  var nextValue = !!value;
  var idKey = opts.idKey;

  for (var i = 0; i < normalized.length; i++) {
    var id = normalized[i];
    if (!id) continue;

    try {
      var item = opts.getItem(id);
      if (!item) {
        var eNotFound = {}; eNotFound[idKey] = id; eNotFound.error = opts.notFoundMsg;
        errors.push(eNotFound);
        continue;
      }

      item[field] = nextValue;
      if (nextValue && opts.clearField) item[opts.clearField] = false;
      // clearFields（配列）: 3 値以上の相互排他で、設定時に複数フィールドを false へ落とす。
      if (nextValue && opts.clearFields) {
        for (var c = 0; c < opts.clearFields.length; c++) {
          if (opts.clearFields[c]) item[opts.clearFields[c]] = false;
        }
      }
      if (typeof opts.beforeSave === "function") opts.beforeSave(item);

      var saved = opts.saveItem(item);
      if (saved && saved.ok) {
        updated += 1;
        updatedItems.push(saved.item);
      } else {
        var eSave = {}; eSave[idKey] = id; eSave.error = (saved && saved.error) || opts.saveFailMsg;
        errors.push(eSave);
      }
    } catch (err) {
      Logger.log((opts.logTag || "[SharedEntity_setStateField_]") + " Error for " + id + ": " + err);
      var eThrow = {}; eThrow[idKey] = id; eThrow.error = err.message || String(err);
      errors.push(eThrow);
    }
  }

  var result = { ok: errors.length === 0, updated: updated, errors: errors };
  result[opts.listKey] = updatedItems;
  return result;
}

// 既存アイテムを同じフォルダに新 ID で複製する共通本体（load → deep copy → id 削除 → save）。
// Forms_copyForm_ / Analytics_copyTemplate_ の共通コア。空チェック・nfbSafeCall_ ラップは
// 呼び出し側に残す。
//
// opts:
//   logLabel                   SharedDrive_parentFolderUrlOfFileId_ のログ識別子
//   loadItem(id) -> item       コピー元を取得（見つからなければ throw）
//   getSourceFileId(id) -> id  親フォルダ解決に使う元ファイルの fileId
//   prepCopy(copy, source)     deep copy 後の型固有初期化（任意。title/name 引き継ぎ・readOnly 等）
//   saveCopy(copy, parentFolderUrl) -> result  保存（戻り値をそのまま返す）
function SharedEntity_copyEntity_(srcId, opts) {
  var source = opts.loadItem(srcId);

  // 元ファイルの親フォルダ URL を取得（不明なら null → 呼び出し側 saveCopy がルート扱い）。
  var parentFolderUrl = SharedDrive_parentFolderUrlOfFileId_(opts.getSourceFileId(srcId), opts.logLabel);

  // クローンを作成（id / driveFileUrl を捨てて save 側で新 ID 採番、衝突名は採番に委譲）。
  var copy = JSON.parse(JSON.stringify(source));
  delete copy.id;
  delete copy.driveFileUrl;
  copy.archived = false;
  if (typeof opts.prepCopy === "function") opts.prepCopy(copy, source);

  return opts.saveCopy(copy, parentFolderUrl);
}

// インポート済みファイルを「標準フォルダ構成内へ配置 → 中央辞書（マッピング）へ登録」する共通本体。
// 標準フォルダ構成内（01_forms / 02_questions / 03_dashboards）からの取り込みは参照のまま、
// 構成外なら該当サブフォルダへコピーしてリンクする。id ＝ Drive fileId へ統一する。
// Forms_registerImportedForm_ / Analytics_registerImportedTemplate_ の共通コア。
// ラベル（forms: title / analytics: name）の決定だけは型ごとに大きく異なるため resolveLabel で注入する。
//
// opts:
//   stdKey                          StdFolders_ensureFileInStdFolder_ のサブフォルダ key
//   getMapping() / saveMapping(m)   マッピング store
//   labelKey                        マッピングエントリのラベルキー（"title" / "name"）
//   relativeFolderOfFile(fileId)    物理位置から論理パスのベースラインを導出
//   resolveLabel(mapping, newId, placedFileId) -> label  ラベル決定（forms はユニーク化 + 物理名追従）
// 戻り: { newId, fileId, fileUrl, label, mapping }
function SharedEntity_registerImported_(fileId, opts) {
  var placed = StdFolders_ensureFileInStdFolder_(fileId, opts.stdKey);
  var placedFileId = placed.fileId;
  var fileUrl = placed.fileUrl;

  var mapping = opts.getMapping();
  var newId = placedFileId;   // id ＝ Drive fileId へ統一

  var label = opts.resolveLabel(mapping, newId, placedFileId);

  // 論理パス folder のベースラインは物理位置。payload.folder 明示時は呼び出し側が中央辞書も含め上書きする。
  var baseFolder = opts.relativeFolderOfFile(placedFileId);
  var entry = { fileId: placedFileId, driveFileUrl: fileUrl };
  entry[opts.labelKey] = label;
  entry.folder = baseFolder == null ? "" : baseFolder;
  mapping[newId] = entry;
  opts.saveMapping(mapping);

  return { newId: newId, fileId: placedFileId, fileUrl: fileUrl, label: label, mapping: mapping };
}
