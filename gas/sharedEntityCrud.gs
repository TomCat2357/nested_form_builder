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
