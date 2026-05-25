import assert from "node:assert/strict";
import test from "node:test";
import {
  appendDriveFileId,
  areDriveFolderStatesEqual,
  createEmptyDriveFolderState,
  hasConfiguredDriveFolder,
  markDriveFolderForDeletion,
  normalizeDriveFolderState,
  resolveEffectiveDriveFolderUrl,
} from "./driveFolderState.js";

test("normalizeDriveFolderState は pendingDeleteUrl を含めて正規化する", () => {
  assert.deepEqual(
    normalizeDriveFolderState({
      resolvedUrl: "https://drive.google.com/drive/folders/current123",
      pendingDeleteUrl: " https://drive.google.com/drive/folders/old123 ",
      autoCreated: true,
      sessionUploadFileIds: ["file_1", "file_1", " file_2 "],
    }),
    {
      resolvedUrl: "https://drive.google.com/drive/folders/current123",
      inputUrl: "https://drive.google.com/drive/folders/current123",
      pendingDeleteUrl: " https://drive.google.com/drive/folders/old123 ",
      autoCreated: true,
      sessionUploadFileIds: ["file_1", "file_2"],
      pendingPrintFileIds: [],
    },
  );
});

test("markDriveFolderForDeletion は現在の保存先を削除待ちにして入力を空に戻す", () => {
  assert.deepEqual(
    markDriveFolderForDeletion({
      resolvedUrl: "https://drive.google.com/drive/folders/current123",
      inputUrl: "https://drive.google.com/drive/folders/current123",
      autoCreated: true,
      sessionUploadFileIds: ["file_1"],
      pendingPrintFileIds: ["print_1"],
    }),
    {
      resolvedUrl: "",
      inputUrl: "",
      pendingDeleteUrl: "https://drive.google.com/drive/folders/current123",
      autoCreated: false,
      sessionUploadFileIds: ["file_1"],
      pendingPrintFileIds: ["print_1"],
    },
  );
});

test("markDriveFolderForDeletion の後で新しい保存先を設定しても pendingDeleteUrl を維持する", () => {
  const deleted = markDriveFolderForDeletion({
    resolvedUrl: "https://drive.google.com/drive/folders/current123",
  });
  const reassigned = normalizeDriveFolderState({
    ...deleted,
    resolvedUrl: "https://drive.google.com/drive/folders/new123",
    inputUrl: "https://drive.google.com/drive/folders/new123",
  });

  assert.equal(resolveEffectiveDriveFolderUrl(reassigned), "https://drive.google.com/drive/folders/new123");
  assert.equal(reassigned.pendingDeleteUrl, "https://drive.google.com/drive/folders/current123");
});

test("areDriveFolderStatesEqual は pendingDeleteUrl の差分も dirty として扱う", () => {
  const base = createEmptyDriveFolderState();
  const next = markDriveFolderForDeletion({
    resolvedUrl: "https://drive.google.com/drive/folders/current123",
  });

  assert.equal(areDriveFolderStatesEqual(base, next), false);
});

test("hasConfiguredDriveFolder は削除待ちだけなら false を返す", () => {
  const deleted = markDriveFolderForDeletion({
    resolvedUrl: "https://drive.google.com/drive/folders/current123",
  });

  assert.equal(hasConfiguredDriveFolder(deleted), false);
});

test("appendDriveFileId は空文字を無視し重複を追加しない", () => {
  assert.deepEqual(appendDriveFileId(["file_1"], " file_1 "), ["file_1"]);
  assert.deepEqual(appendDriveFileId(["file_1"], "file_2"), ["file_1", "file_2"]);
});
