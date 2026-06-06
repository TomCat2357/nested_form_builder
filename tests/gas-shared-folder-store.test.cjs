// VM realm 由来のオブジェクト/配列を比較するため、prototype を厳密照合しない loose assert を使う。
const assert = require("node:assert");
const test = require("node:test");
const { loadGasFiles } = require("./helpers/gasVmLoader.cjs");

// sharedFolderStore.gs（型汎用コア）+ formsFolderStore.gs / analyticsFolderStore.gs（実 adapter +
// 公開ラッパー）を、インメモリの Drive / mapping / Properties で検証する。
// 既存テストは登録簿の CRUD（create / move / rename / delete）を直接実行していないため、
// 統合後の振る舞いを担保する唯一の安全網となる。
//
// 検証ポイント:
//   - move / relocate が型ごとの modifiedAt 形式を保つ（forms=JST文字列+serial / analytics=ms）
//   - relocate が配下アイテムの folder を prefix 置換する
//   - rename の同名衝突を弾く
//   - delete が部分木（配下アイテム + 登録簿サブツリー）を消す
//   - 結果ペイロードキーが型ごとに維持される（movedFormIds/deletedFormCount vs movedIds/deletedCount）

const normalizePath = (raw) =>
  typeof raw !== "string" ? "" : raw.split("/").map((s) => String(s).trim()).filter(Boolean).join("/");

// kind ("forms" | "questions") ごとに公開ラッパーを呼べる context を組み立てる。
function makeEnv(kind) {
  let mapping = {};        // id -> { fileId, folder, title|name }
  const fileBodies = {};   // fileId -> JSON 文字列（Drive ファイル本文）
  const fileNames = {};    // fileId -> Drive ファイル名（"名前.json"）
  const store = {};        // PropertiesService
  const driveOps = [];     // 物理 Drive 操作ログ
  let seq = 0;
  // 中央辞書で「名前」を保持するキーは型で異なる（forms=title / analytics=name）。
  const nameKey = kind === "forms" ? "title" : "name";

  function addItem(id, folder, name) {
    const fileId = "file_" + ++seq;
    const nm = name == null ? id : name;
    fileBodies[fileId] = JSON.stringify({ folder, schema: [] });
    fileNames[fileId] = nm + ".json";
    mapping[id] = { fileId, folder, [nameKey]: nm };
    return id;
  }
  function itemFolder(fileId) {
    try { return normalizePath(JSON.parse(fileBodies[fileId]).folder); } catch (e) { return ""; }
  }
  function items() {
    return Object.keys(mapping).map((id) => ({ id, folder: itemFolder(mapping[id].fileId) }));
  }

  const props = {
    getProperty: (k) => (k in store ? store[k] : null),
    setProperty: (k, v) => { store[k] = v; },
  };
  const DriveApp = {
    getFileById: (id) => {
      if (!(id in fileBodies)) throw new Error("no file " + id);
      return {
        getId: () => id,
        getName: () => fileNames[id],
        setName: (n) => { fileNames[id] = n; },
        getBlob: () => ({ getDataAsString: () => fileBodies[id] }),
        setContent: (c) => { fileBodies[id] = c; },
      };
    },
  };

  const context = {
    console,
    Logger: { log() {} },
    JSON,
    DriveApp,
    Date,
    WithScriptLock_: (label, fn) => fn(),
    Nfb_getActiveProperties_: () => props,
    Nfb_resolveFileIdFromEntry_: (e) => (e && e.fileId) || null,
    Nfb_normalizeIdList_: (arr) => (Array.isArray(arr) ? arr.filter(Boolean) : []),
    // 名前 ＝ Drive ファイル名（.json 除去）。本来は gas/formsCrud.gs 定義（ここではロードしないため shim）。
    Nfb_nameFromFileName_: (fileName) => (fileName == null ? "" : String(fileName)).replace(/\.json$/i, ""),
    Nfb_nameFromFile_: (file) => {
      try { return (file.getName() == null ? "" : String(file.getName())).replace(/\.json$/i, ""); } catch (e) { return ""; }
    },
    // verify は別レイヤ（標準フォルダ整合エンジン）。folder store ロジックの検証では透過スタブ。
    StdFolders_entityAdapter_: (k) => ({ kind: k }),
    StdFolders_verifyEntriesAfterRelocate_: (adapter, ids) => ({ checked: ids.length }),

    // ---- forms 側依存 ----
    Forms_getMapping_: () => mapping,
    Forms_saveMapping_: (m) => { mapping = m; },
    Forms_listForms_: () => ({ forms: items() }),
    Forms_getForm_: (id) => {
      const fid = mapping[id] && mapping[id].fileId;
      if (!fid) return null;
      try { return JSON.parse(fileBodies[fid]); } catch (e) { return null; }
    },
    Forms_deleteForms_: (ids) => { ids.forEach((id) => delete mapping[id]); return { deleted: ids.length }; },
    FormsDrive_ensureFolderForPath_: (p) => { driveOps.push(["ensure", p]); },
    FormsDrive_moveFormFileToPath_: (fileId, p) => { driveOps.push(["moveFile", fileId, p]); },
    FormsDrive_movePathFolder_: (o, n) => { driveOps.push(["movePath", o, n]); },
    FormsDrive_trashPathFolder_: (p) => { driveOps.push(["trash", p]); },
    Sheets_dateToSerial_: () => 45444.5,
    Sheets_formatJstString_: () => "2026-06-01 12:00:00",

    // ---- analytics 側依存 ----
    Analytics_getMapping_: () => mapping,
    Analytics_saveMapping_: (type, m) => { mapping = m; },
    Analytics_listTemplates_: () => ({ questions: items() }),
    Analytics_getResultListKey_: () => "questions",
    Analytics_deleteTemplates_: (type, ids) => { ids.forEach((id) => delete mapping[id]); return { deleted: ids.length }; },
    AnalyticsDrive_ensureFolderForPath_: (type, p) => { driveOps.push(["ensure", p]); },
    AnalyticsDrive_moveItemFileToPath_: (type, fileId, p) => { driveOps.push(["moveFile", fileId, p]); },
    AnalyticsDrive_movePathFolder_: (type, o, n) => { driveOps.push(["movePath", o, n]); },
    AnalyticsDrive_trashPathFolder_: (type, p) => { driveOps.push(["trash", p]); },
  };

  loadGasFiles(context, [
    "constants.gs",
    "driveFile.gs",
    // 移動時の同名衝突採番（StdFolderStore_uniqueNameInFolder_ → Forms_makeUniqueFormTitle_）で必要。
    "formsTitleHelpers.js",
    "sharedFolderStore.gs",
    "formsFolderStore.gs",
    "analyticsFolderStore.gs",
  ]);

  // kind ごとの公開ラッパーを薄く束ねた API（forms は引数なし、analytics は type を前置）。
  const T = "questions";
  const api = kind === "forms"
    ? {
        create: (p) => context.Forms_createFolder_(p),
        move: (p) => context.Forms_moveItems_(p),
        rename: (p) => context.Forms_renameFolder_(p),
        del: (p) => context.Forms_deleteFolder_(p),
        listFolders: () => context.Forms_collectFolders_(),
      }
    : {
        create: (p) => context.Analytics_createFolder_(T, p),
        // analytics の move payload は itemIds を使う（テスト側で itemIds を渡す）。
        move: (p) => context.Analytics_moveItems_(T, p),
        rename: (p) => context.Analytics_renameFolder_(T, p),
        del: (p) => context.Analytics_deleteFolder_(T, p),
        listFolders: () => context.Analytics_collectFolders_(T),
      };

  const itemName = (id) => {
    const fid = mapping[id] && mapping[id].fileId;
    return fid ? String(fileNames[fid] || "").replace(/\.json$/i, "") : "";
  };
  return { context, api, addItem, itemFolder, itemName, mapping: () => mapping, fileBodies, fileNames, store, driveOps, nameKey };
}

const movedKey = (kind) => (kind === "forms" ? "movedFormIds" : "movedIds");
const deletedKey = (kind) => (kind === "forms" ? "deletedFormCount" : "deletedCount");

for (const kind of ["forms", "questions"]) {
  test(`[${kind}] createFolder: 登録簿に祖先含めて追加`, () => {
    const env = makeEnv(kind);
    const res = env.api.create("a/b/c");
    assert.equal(res.ok, true);
    assert.deepEqual(res.folders, ["a", "a/b", "a/b/c"]);
    assert.deepEqual(env.driveOps.filter((o) => o[0] === "ensure"), [["ensure", "a/b/c"]]);
  });

  test(`[${kind}] createFolder: 空パスはエラー`, () => {
    const env = makeEnv(kind);
    assert.deepEqual(env.api.create("  "), { ok: false, error: "フォルダ名を入力してください" });
  });

  test(`[${kind}] moveItems: 単一アイテムを dest へ移動し modifiedAt を型別に刻む`, () => {
    const env = makeEnv(kind);
    env.addItem("id1", "old");
    env.api.create("dest");
    const res = env.api.move(kind === "forms" ? { formIds: ["id1"], destPath: "dest" } : { itemIds: ["id1"], destPath: "dest" });
    assert.equal(res.ok, true);
    assert.deepEqual(res[movedKey(kind)], ["id1"]);
    const body = JSON.parse(env.fileBodies[env.mapping()["id1"].fileId]);
    assert.equal(body.folder, "dest");
    if (kind === "forms") {
      assert.equal(body.modifiedAt, "2026-06-01 12:00:00");
      assert.equal(body.modifiedAtUnixMs, 45444.5);
    } else {
      assert.equal(typeof body.modifiedAt, "number"); // Date.now() (ms)
      assert.equal("modifiedAtUnixMs" in body, false);
    }
    // 中央辞書 folder も追従
    assert.equal(env.mapping()["id1"].folder, "dest");
  });

  test(`[${kind}] moveItems(folder): relocate が配下アイテムの folder を prefix 置換`, () => {
    const env = makeEnv(kind);
    env.addItem("id1", "x/y");
    env.addItem("id2", "x/y/deep");
    env.api.create("x/y");
    env.api.create("z"); // 移動先
    const payload = kind === "forms"
      ? { folderPaths: ["x/y"], destPath: "z" }
      : { folderPaths: ["x/y"], destPath: "z" };
    const res = env.api.move(payload);
    assert.equal(res.ok, true);
    // x/y → z/y、x/y/deep → z/y/deep
    assert.equal(JSON.parse(env.fileBodies[env.mapping()["id1"].fileId]).folder, "z/y");
    assert.equal(JSON.parse(env.fileBodies[env.mapping()["id2"].fileId]).folder, "z/y/deep");
    assert.deepEqual(res[movedKey(kind)].sort(), ["id1", "id2"]);
    assert.ok(env.api.listFolders().includes("z/y"));
    assert.ok(!env.api.listFolders().includes("x/y"));
  });

  test(`[${kind}] moveItems: 移動対象未選択はエラー（itemNoun を含む）`, () => {
    const env = makeEnv(kind);
    const res = env.api.move({ destPath: "" });
    assert.equal(res.ok, false);
    const noun = kind === "forms" ? "フォーム" : "アイテム";
    assert.equal(res.error, "移動する" + noun + "またはフォルダを選択してください");
  });

  test(`[${kind}] moveItems: 移動先に同名アイテムがあれば (1) を付けてリネームする`, () => {
    const env = makeEnv(kind);
    env.addItem("keep", "dest", "見積書"); // 移動先に既存の同名
    env.addItem("mover", "src", "見積書"); // 別フォルダの同名を移動
    env.api.create("dest");
    const res = env.api.move(kind === "forms"
      ? { formIds: ["mover"], destPath: "dest" }
      : { itemIds: ["mover"], destPath: "dest" });
    assert.equal(res.ok, true);
    assert.deepEqual(res[movedKey(kind)], ["mover"]);
    // 移動した方が ` (1)` で採番される（既存は不変）。
    assert.equal(env.itemName("mover"), "見積書 (1)");
    assert.equal(env.fileNames[env.mapping()["mover"].fileId], "見積書 (1).json");
    assert.equal(env.mapping()["mover"][env.nameKey], "見積書 (1)");
    assert.equal(env.mapping()["mover"].folder, "dest");
    assert.equal(env.itemName("keep"), "見積書", "既存アイテムの名前は変わらない");
  });

  test(`[${kind}] moveItems: 移動先に同名が無ければ名前を保持する（フォルダ違いの同名は許容）`, () => {
    const env = makeEnv(kind);
    env.addItem("other", "dest", "売上集計"); // 別の名前なので衝突しない
    env.addItem("mover", "src", "見積書");
    env.api.create("dest");
    const res = env.api.move(kind === "forms"
      ? { formIds: ["mover"], destPath: "dest" }
      : { itemIds: ["mover"], destPath: "dest" });
    assert.equal(res.ok, true);
    assert.equal(env.itemName("mover"), "見積書", "衝突しないので名前は再正規化されない");
    assert.equal(env.mapping()["mover"].folder, "dest");
  });

  test(`[${kind}] moveItems: 同名アイテムを複数まとめて同一フォルダへ移動すると一方に (1)`, () => {
    const env = makeEnv(kind);
    env.addItem("a", "fa", "レポート");
    env.addItem("b", "fb", "レポート");
    env.api.create("dest");
    const res = env.api.move(kind === "forms"
      ? { formIds: ["a", "b"], destPath: "dest" }
      : { itemIds: ["a", "b"], destPath: "dest" });
    assert.equal(res.ok, true);
    const names = [env.itemName("a"), env.itemName("b")].sort();
    assert.deepEqual(names, ["レポート", "レポート (1)"]);
    assert.equal(env.mapping()["a"].folder, "dest");
    assert.equal(env.mapping()["b"].folder, "dest");
  });

  test(`[${kind}] renameFolder: leaf 名だけ変更し配下を追従`, () => {
    const env = makeEnv(kind);
    env.addItem("id1", "x/y");
    env.api.create("x/y");
    const res = env.api.rename({ path: "x/y", newName: "yy" });
    assert.equal(res.ok, true);
    assert.deepEqual(res[movedKey(kind)], ["id1"]);
    assert.equal(JSON.parse(env.fileBodies[env.mapping()["id1"].fileId]).folder, "x/yy");
    assert.ok(env.api.listFolders().includes("x/yy"));
  });

  test(`[${kind}] renameFolder: 同名衝突は拒否`, () => {
    const env = makeEnv(kind);
    env.api.create("x/y");
    env.api.create("x/yy");
    const res = env.api.rename({ path: "x/y", newName: "yy" });
    assert.deepEqual(res, { ok: false, error: "同名のフォルダ「x/yy」が既に存在します" });
  });

  test(`[${kind}] deleteFolder: 配下アイテムのリンク解除と登録簿サブツリー除去（実体は残す）`, () => {
    const env = makeEnv(kind);
    env.addItem("id1", "d");
    env.addItem("id2", "d/sub");
    env.addItem("keep", "other");
    env.api.create("d/sub");
    env.api.create("other");
    const res = env.api.del("d");
    assert.equal(res.ok, true);
    assert.equal(res[deletedKey(kind)], 2);
    // 配下アイテムはマッピングから消え、無関係アイテムは残る
    assert.deepEqual(Object.keys(env.mapping()).sort(), ["keep"]);
    // 登録簿から d と d/sub が消え、other は残る
    const folders = env.api.listFolders();
    assert.ok(!folders.includes("d") && !folders.includes("d/sub"));
    assert.ok(folders.includes("other"));
    // リンク解除のみ: 物理フォルダ trash は呼ばれない
    assert.deepEqual(env.driveOps.filter((o) => o[0] === "trash"), []);
  });
}
