import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeFolderPath,
  joinFolderPath,
  compileNameMatcher,
  buildFolderLevel,
  splitBreadcrumbs,
  countItemsUnder,
  folderExists,
  isUnderFolder,
  reparentFolderPath,
  reparentFolders,
  renameFolderPath,
  renameFolderPaths,
  removeFolderSubtree,
  reassignEntityFolder,
} from "./folderTree.js";

test("joinFolderPath はフォルダと葉名を結合し正規化する（フォルダ空は葉名のみ）", () => {
  assert.equal(joinFolderPath("受付/2024", "苦情データ"), "受付/2024/苦情データ");
  assert.equal(joinFolderPath("", "苦情データ"), "苦情データ");
  assert.equal(joinFolderPath("/受付/ ", " 苦情データ "), "受付/苦情データ");
  assert.equal(joinFolderPath(null, "x"), "x");
  assert.equal(joinFolderPath("a", ""), "a");
});

test("normalizeFolderPath は前後/重複スラッシュと空白を除去する", () => {
  assert.equal(normalizeFolderPath("/営業//見積/ "), "営業/見積");
  assert.equal(normalizeFolderPath("  営業 / 見積 "), "営業/見積");
  assert.equal(normalizeFolderPath(""), "");
  assert.equal(normalizeFolderPath("///"), "");
  assert.equal(normalizeFolderPath(null), "");
  assert.equal(normalizeFolderPath(undefined), "");
  assert.equal(normalizeFolderPath("営業"), "営業");
});

test("isUnderFolder は base 自身と子孫を true、他は false、base 空は常に true", () => {
  // base="" は全件対象（ルート検索）
  assert.equal(isUnderFolder("営業/見積", ""), true);
  assert.equal(isUnderFolder("", ""), true);
  // base 自身と子孫
  assert.equal(isUnderFolder("営業", "営業"), true);
  assert.equal(isUnderFolder("営業/見積", "営業"), true);
  assert.equal(isUnderFolder("営業/見積/2024", "営業"), true);
  // 別フォルダ・前方一致だけの別名は対象外
  assert.equal(isUnderFolder("総務", "営業"), false);
  assert.equal(isUnderFolder("営業部", "営業"), false);
  assert.equal(isUnderFolder("", "営業"), false);
  // 正規化込みで判定
  assert.equal(isUnderFolder("/営業//見積/", " 営業 "), true);
});

test("compileNameMatcher は正規表現の部分一致でマッチする（二三 → 一二三）", () => {
  const m = compileNameMatcher("二三");
  assert.equal(m("一二三"), true);
  assert.equal(m("二三四"), true);
  assert.equal(m("一二四"), false);
});

test("compileNameMatcher は空クエリで全件 true", () => {
  const m = compileNameMatcher("");
  assert.equal(m("なんでも"), true);
  assert.equal(compileNameMatcher("   ")("x"), true);
});

test("compileNameMatcher は大文字小文字を無視する", () => {
  const m = compileNameMatcher("abc");
  assert.equal(m("ABCDE"), true);
  assert.equal(m("xAbCy"), true);
});

test("compileNameMatcher は不正な正規表現でリテラル一致にフォールバックする", () => {
  const m = compileNameMatcher("(");
  assert.equal(m("a(b"), true); // "(" を含む名前にリテラルマッチ
  assert.equal(m("ab"), false);
});

test("compileNameMatcher は null/非文字列の名前でも落ちない", () => {
  const m = compileNameMatcher("x");
  assert.equal(m(null), false);
  assert.equal(m(undefined), false);
});

test("buildFolderLevel はルート直下のフォルダとアイテムを分ける", () => {
  const items = [
    { id: "a", folder: "" },
    { id: "b", folder: "営業" },
    { id: "c", folder: "営業/見積" },
    { id: "d", folder: "経理" },
  ];
  const { folders, items: direct } = buildFolderLevel(items, { getFolder: (x) => x.folder });
  assert.deepEqual(direct.map((x) => x.id), ["a"]);
  assert.deepEqual(folders, [
    { name: "営業", path: "営業", count: 2 }, // b + c（子孫含む）
    { name: "経理", path: "経理", count: 1 },
  ]);
});

test("buildFolderLevel は currentPath 配下を1段だけ展開する", () => {
  const items = [
    { id: "b", folder: "営業" },
    { id: "c", folder: "営業/見積" },
    { id: "e", folder: "営業/見積/2026" },
    { id: "f", folder: "経理" },
  ];
  const { folders, items: direct } = buildFolderLevel(items, {
    getFolder: (x) => x.folder,
    currentPath: "営業",
  });
  assert.deepEqual(direct.map((x) => x.id), ["b"]);
  assert.deepEqual(folders, [{ name: "見積", path: "営業/見積", count: 2 }]); // c + e
});

test("buildFolderLevel は正規化前のパスも扱える", () => {
  const items = [{ id: "c", folder: "/営業//見積/" }];
  const { folders } = buildFolderLevel(items, { getFolder: (x) => x.folder });
  assert.deepEqual(folders, [{ name: "営業", path: "営業", count: 1 }]);
});

test("buildFolderLevel は extraFolderPaths の空フォルダを count 0 で出す", () => {
  const items = [{ id: "b", folder: "営業" }];
  const { folders } = buildFolderLevel(items, {
    getFolder: (x) => x.folder,
    extraFolderPaths: ["営業", "総務", "総務/庶務"],
  });
  assert.deepEqual(folders, [
    { name: "営業", path: "営業", count: 1 }, // フォーム由来のカウントを維持
    { name: "総務", path: "総務", count: 0 }, // 空フォルダ
  ]);
});

test("buildFolderLevel は extraFolderPaths を currentPath 配下にも展開する", () => {
  const { folders } = buildFolderLevel([], {
    getFolder: (x) => x.folder,
    currentPath: "総務",
    extraFolderPaths: ["総務/庶務", "総務/人事"],
  });
  // 並び順はロケール依存のため集合として検証する
  const byPath = Object.fromEntries(folders.map((f) => [f.path, f]));
  assert.deepEqual(byPath["総務/庶務"], { name: "庶務", path: "総務/庶務", count: 0 });
  assert.deepEqual(byPath["総務/人事"], { name: "人事", path: "総務/人事", count: 0 });
  assert.equal(folders.length, 2);
});

test("countItemsUnder は path 自身と子孫を数える", () => {
  const items = [
    { id: "a", folder: "営業" },
    { id: "b", folder: "営業/見積" },
    { id: "c", folder: "営業見積" }, // 前方一致だが別フォルダ（"/" 区切りでない）
    { id: "d", folder: "経理" },
  ];
  assert.equal(countItemsUnder(items, (x) => x.folder, "営業"), 2);
  assert.equal(countItemsUnder(items, (x) => x.folder, "経理"), 1);
  assert.equal(countItemsUnder(items, (x) => x.folder, ""), 4); // ルートは全件
});

test("folderExists は正規化して一致判定、空は最上位として true", () => {
  const paths = ["営業", "営業/見積", "総務"];
  assert.equal(folderExists(paths, "営業/見積"), true);
  assert.equal(folderExists(paths, "/営業//見積/"), true); // 正規化一致
  assert.equal(folderExists(paths, "存在しない"), false);
  assert.equal(folderExists(paths, ""), true);
});

test("splitBreadcrumbs は累積パスを返す", () => {
  assert.deepEqual(splitBreadcrumbs("営業/見積/2026"), [
    { name: "営業", path: "営業" },
    { name: "見積", path: "営業/見積" },
    { name: "2026", path: "営業/見積/2026" },
  ]);
  assert.deepEqual(splitBreadcrumbs(""), []);
});

// ---------------------------------------------------------------------------
// 楽観的フォルダ操作のパス書換え（move / rename / delete）
// ---------------------------------------------------------------------------

test("reparentFolderPath: target 自身と子孫だけ dest 配下へ、無関係は null", () => {
  assert.equal(reparentFolderPath("a/b", "a/b", "x"), "x/b");
  assert.equal(reparentFolderPath("a/b/c", "a/b", "x"), "x/b/c");
  assert.equal(reparentFolderPath("a/b", "a/b", ""), "b"); // 最上位へ移動
  assert.equal(reparentFolderPath("a/z", "a/b", "x"), null); // 無関係
  assert.equal(reparentFolderPath("a/b", "", "x"), null); // 最上位は移動対象にできない
});

test("reparentFolders: 複数フォルダ移動を一覧へ適用し重複を畳む", () => {
  const folders = ["a/b", "a/b/c", "a/z", "x"];
  assert.deepEqual(reparentFolders(folders, ["a/b"], "x"), ["x/b", "x/b/c", "a/z", "x"]);
});

test("renameFolderPath: target の葉名だけ変更（親は保持）、無関係は null", () => {
  assert.equal(renameFolderPath("a/b", "a/b", "B2"), "a/B2");
  assert.equal(renameFolderPath("a/b/c", "a/b", "B2"), "a/B2/c");
  assert.equal(renameFolderPath("a/z", "a/b", "B2"), null);
  assert.equal(renameFolderPath("top", "top", "TOP2"), "TOP2");
});

test("renameFolderPaths: 一覧へ名前変更を適用（子孫 prefix も書換え）", () => {
  assert.deepEqual(renameFolderPaths(["a/b", "a/b/c", "a/z"], "a/b", "B2"), ["a/B2", "a/B2/c", "a/z"]);
});

test("removeFolderSubtree: path 自身と子孫を一覧から除去（最上位は無効）", () => {
  assert.deepEqual(removeFolderSubtree(["a/b", "a/b/c", "a/z"], "a/b"), ["a/z"]);
  assert.deepEqual(removeFolderSubtree(["a", "b"], ""), ["a", "b"]);
});

test("reassignEntityFolder: move は itemId 一致で dest、配下フォルダは reparent、無関係は据え置き", () => {
  // id 一致 → dest へ
  assert.equal(
    reassignEntityFolder("a/b", "move", { itemId: "F1", itemIds: ["F1"], folderPaths: [], destPath: "x" }),
    "x",
  );
  // フォルダ移動の巻き込み（id 不一致だが folder が移動対象配下）
  assert.equal(
    reassignEntityFolder("a/b/c", "move", { itemId: "F2", itemIds: ["F1"], folderPaths: ["a/b"], destPath: "x" }),
    "x/b/c",
  );
  // 無関係は据え置き
  assert.equal(
    reassignEntityFolder("a/z", "move", { itemId: "F2", itemIds: ["F1"], folderPaths: ["a/b"], destPath: "x" }),
    "a/z",
  );
});

test("reassignEntityFolder: rename は配下を書換え、無関係は据え置き", () => {
  assert.equal(reassignEntityFolder("a/b/c", "rename", { path: "a/b", newName: "B2" }), "a/B2/c");
  assert.equal(reassignEntityFolder("a/z", "rename", { path: "a/b", newName: "B2" }), "a/z");
});

test("reassignEntityFolder: delete は配下なら null（削除対象）、それ以外は据え置き", () => {
  assert.equal(reassignEntityFolder("a/b/c", "delete", { path: "a/b" }), null);
  assert.equal(reassignEntityFolder("a/b", "delete", { path: "a/b" }), null);
  assert.equal(reassignEntityFolder("a/z", "delete", { path: "a/b" }), "a/z");
});
