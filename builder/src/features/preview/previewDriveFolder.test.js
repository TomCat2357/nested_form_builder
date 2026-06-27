import { test } from "node:test";
import assert from "node:assert/strict";
import { computeNextDriveFolderStateFromPrintResult } from "./previewDriveFolder.js";

// updater は正規化済み state（文字列フィールド・配列 pendingPrintFileIds）で呼ばれる前提。
const baseState = () => ({
  resolvedUrl: "",
  inputUrl: "",
  pendingDeleteUrl: "",
  folderName: "",
  autoCreated: false,
  sessionUploadFileIds: [],
  pendingPrintFileIds: [],
});

test("result.folderUrl があれば resolvedUrl に採用し inputUrl を埋める", () => {
  const next = computeNextDriveFolderStateFromPrintResult(baseState(), {
    folderUrl: "  https://drive/x  ",
    fileId: "file1",
  });
  assert.equal(next.resolvedUrl, "https://drive/x");
  assert.equal(next.inputUrl, "https://drive/x");
  assert.deepEqual(next.pendingPrintFileIds, ["file1"]);
});

test("手入力済み inputUrl は尊重される", () => {
  const prev = { ...baseState(), inputUrl: "https://manual" };
  const next = computeNextDriveFolderStateFromPrintResult(prev, { folderUrl: "https://auto" });
  assert.equal(next.resolvedUrl, "https://auto");
  assert.equal(next.inputUrl, "https://manual");
});

test("result.folderUrl が無ければ現在の有効 URL を維持", () => {
  const prev = { ...baseState(), resolvedUrl: "https://existing" };
  const next = computeNextDriveFolderStateFromPrintResult(prev, { fileId: "f2" });
  assert.equal(next.resolvedUrl, "https://existing");
});

test("同一 URL の autoCreated は維持される", () => {
  const prev = { ...baseState(), resolvedUrl: "https://same", inputUrl: "https://same", autoCreated: true };
  const next = computeNextDriveFolderStateFromPrintResult(prev, { folderUrl: "https://same" });
  assert.equal(next.autoCreated, true);
});

test("URL が変われば autoCreated は result.autoCreated に従う", () => {
  const prev = { ...baseState(), resolvedUrl: "https://old", inputUrl: "https://old", autoCreated: true };
  const next = computeNextDriveFolderStateFromPrintResult(prev, { folderUrl: "https://new" });
  assert.equal(next.autoCreated, false);
  const next2 = computeNextDriveFolderStateFromPrintResult(prev, { folderUrl: "https://new", autoCreated: true });
  assert.equal(next2.autoCreated, true);
});

test("fileId は重複排除して追記、空 fileId は無視", () => {
  const prev = { ...baseState(), pendingPrintFileIds: ["a"] };
  const next = computeNextDriveFolderStateFromPrintResult(prev, { fileId: "a" });
  assert.deepEqual(next.pendingPrintFileIds, ["a"]);
  const next2 = computeNextDriveFolderStateFromPrintResult(prev, { fileId: "b" });
  assert.deepEqual(next2.pendingPrintFileIds, ["a", "b"]);
  const next3 = computeNextDriveFolderStateFromPrintResult(prev, {});
  assert.deepEqual(next3.pendingPrintFileIds, ["a"]);
});
