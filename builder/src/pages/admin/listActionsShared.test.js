import test from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeFileBaseName,
  resolveDialogTargetIds,
  createFolderCreateActions,
  createRenameActions,
} from "./listActionsShared.js";

// useConfirmDialog の最小スタブ（state / open / reset）。
const makeDialog = (initial = {}) => {
  const d = { state: { ...initial }, open: (s) => { d.state = { ...s }; }, reset: () => { d.state = { ...initial }; } };
  return d;
};

test("sanitizeFileBaseName: 使用不可文字を _ に / 空なら fallback", () => {
  assert.equal(sanitizeFileBaseName("a/b:c", "x"), "a_b_c");
  assert.equal(sanitizeFileBaseName("a*?\"<>|d", "x"), "a______d");
  assert.equal(sanitizeFileBaseName("...", "x"), "x");
  assert.equal(sanitizeFileBaseName("", "x"), "x");
  assert.equal(sanitizeFileBaseName(null, "x"), "x");
  assert.equal(sanitizeFileBaseName(undefined, "x"), "x");
  assert.equal(sanitizeFileBaseName("普通の名前", "x"), "普通の名前");
  assert.equal(sanitizeFileBaseName(".hidden", "x"), "hidden");
});

test("resolveDialogTargetIds: targetIds 優先 → idKey → []", () => {
  assert.deepEqual(resolveDialogTargetIds({ targetIds: ["a", "b"], id: "c" }, "id"), ["a", "b"]);
  assert.deepEqual(resolveDialogTargetIds({ targetIds: [], id: "c" }, "id"), ["c"]);
  assert.deepEqual(resolveDialogTargetIds({ targetIds: [], formId: "f" }, "formId"), ["f"]);
  assert.deepEqual(resolveDialogTargetIds({ targetIds: [] }, "id"), []);
  assert.deepEqual(resolveDialogTargetIds({}, "id"), []);
  assert.deepEqual(resolveDialogTargetIds(null, "id"), []);
});

test("createFolderCreateActions.confirmCreateFolder: 空名はエラー、有効名は currentPath 配下を作成", async () => {
  const calls = [];
  const dialog = makeDialog();
  let folderError = "init";
  const base = {
    showAlert: () => {},
    currentPath: "親",
    newFolderDialog: dialog,
    setNewFolderName: (v) => calls.push(["name", v]),
    setNewFolderError: (v) => { folderError = v; },
  };

  // 空名 → エラー、createFolder 未呼び出し
  let created = null;
  const empty = createFolderCreateActions({ ...base, newFolderName: "  ", createFolder: (p) => { created = p; } });
  await empty.confirmCreateFolder();
  assert.equal(folderError, "フォルダ名を入力してください");
  assert.equal(created, null);

  // 有効名 → 正規化パスで作成、リセット
  const ok = createFolderCreateActions({ ...base, newFolderName: "子", createFolder: (p) => { created = p; } });
  await ok.confirmCreateFolder();
  assert.equal(created, "親/子");
  assert.equal(folderError, "");
});

test("createFolderCreateActions.confirmCreateFolder: 失敗時は onError とエラー表示", async () => {
  let errored = null;
  let folderError = "";
  const actions = createFolderCreateActions({
    showAlert: () => {},
    currentPath: "",
    newFolderDialog: makeDialog(),
    newFolderName: "x",
    setNewFolderName: () => {},
    setNewFolderError: (v) => { folderError = v; },
    createFolder: () => { throw new Error("boom"); },
    onError: (e) => { errored = e; },
  });
  await actions.confirmCreateFolder();
  assert.equal(errored.message, "boom");
  assert.equal(folderError, "boom");
});

test("createRenameActions.confirmRename: item は renameItem を呼び選択解除", async () => {
  let renamed = null;
  let cleared = null;
  const dialog = makeDialog();
  dialog.state = { kind: "item", id: "Q1" };
  const actions = createRenameActions({
    sortedItems: [],
    selected: new Set(),
    selectedFolders: new Set(),
    renameDialog: dialog,
    renameName: "新名",
    setRenameName: () => {},
    setRenameError: () => {},
    registeredFolders: [],
    renameItem: (id, name) => { renamed = [id, name]; },
    renameFolder: () => {},
    clearSelectionByIds: (ids) => { cleared = ids; },
    getItemName: (it) => it.name || "",
    showAlert: () => {},
  });
  await actions.confirmRename();
  assert.deepEqual(renamed, ["Q1", "新名"]);
  assert.deepEqual(cleared, ["Q1"]);
});

test("createRenameActions.confirmRename: folder は / 禁止・同名衝突をブロック、正常時 renameFolder", async () => {
  const dialog = makeDialog();
  let folderRenamed = null;
  let renameError = "";
  const base = {
    sortedItems: [],
    selected: new Set(),
    selectedFolders: new Set(),
    renameDialog: dialog,
    setRenameName: () => {},
    setRenameError: (v) => { renameError = v; },
    registeredFolders: ["親/既存"],
    renameItem: () => {},
    renameFolder: ({ path, newName }) => { folderRenamed = { path, newName }; },
    clearSelectionByIds: () => {},
    getItemName: () => "",
    showAlert: () => {},
  };

  // "/" を含む → エラー
  dialog.state = { kind: "folder", path: "親/元" };
  await createRenameActions({ ...base, renameName: "a/b" }).confirmRename();
  assert.equal(renameError, "フォルダ名に「/」は使用できません");
  assert.equal(folderRenamed, null);

  // 同名衝突 → エラー
  dialog.state = { kind: "folder", path: "親/元" };
  await createRenameActions({ ...base, renameName: "既存" }).confirmRename();
  assert.match(renameError, /既に存在します/);
  assert.equal(folderRenamed, null);

  // 正常 → renameFolder 呼び出し
  dialog.state = { kind: "folder", path: "親/元" };
  await createRenameActions({ ...base, renameName: "新規" }).confirmRename();
  assert.deepEqual(folderRenamed, { path: "親/元", newName: "新規" });
});
