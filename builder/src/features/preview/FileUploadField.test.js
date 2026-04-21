import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildDriveUploadSettings,
  computeFolderStateAfterFinalize,
  computeFolderStateAfterUpload,
} from "./fileUploadHelpers.js";

const baseState = (overrides = {}) => ({
  resolvedUrl: "",
  inputUrl: "",
  pendingDeleteUrl: "",
  autoCreated: false,
  sessionUploadFileIds: [],
  pendingPrintFileIds: [],
  ...overrides,
});

test("computeFolderStateAfterUpload は result.folderUrl を新しい resolvedUrl にし、fileId を重複排除で追加する", () => {
  const next = computeFolderStateAfterUpload({
    prev: baseState({ sessionUploadFileIds: ["file_1"] }),
    current: baseState(),
    result: { folderUrl: "https://drive.google.com/drive/folders/new", fileId: "file_2", autoCreated: true },
  });
  assert.equal(next.resolvedUrl, "https://drive.google.com/drive/folders/new");
  assert.equal(next.inputUrl, "https://drive.google.com/drive/folders/new");
  assert.equal(next.autoCreated, true);
  assert.deepEqual(next.sessionUploadFileIds, ["file_1", "file_2"]);
});

test("computeFolderStateAfterUpload は result.folderUrl が空なら current/prev を維持する", () => {
  const next = computeFolderStateAfterUpload({
    prev: baseState({ resolvedUrl: "https://drive.google.com/drive/folders/prev", inputUrl: "https://drive.google.com/drive/folders/prev" }),
    current: baseState({ resolvedUrl: "https://drive.google.com/drive/folders/current", inputUrl: "https://drive.google.com/drive/folders/current" }),
    result: { folderUrl: "", fileId: "file_x" },
  });
  assert.equal(next.resolvedUrl, "https://drive.google.com/drive/folders/current");
  assert.deepEqual(next.sessionUploadFileIds, ["file_x"]);
});

test("computeFolderStateAfterUpload はユーザーが編集した inputUrl を上書きしない", () => {
  const next = computeFolderStateAfterUpload({
    prev: baseState({ inputUrl: "https://user-typed.example.com/" }),
    current: baseState(),
    result: { folderUrl: "https://drive.google.com/drive/folders/new", fileId: "file_1" },
  });
  assert.equal(next.inputUrl, "https://user-typed.example.com/");
  assert.equal(next.resolvedUrl, "https://drive.google.com/drive/folders/new");
});

test("computeFolderStateAfterUpload は同じ resolvedUrl なら autoCreated を保持する", () => {
  const same = "https://drive.google.com/drive/folders/same";
  const next = computeFolderStateAfterUpload({
    prev: baseState({ resolvedUrl: same, autoCreated: true }),
    current: baseState({ resolvedUrl: same }),
    result: { folderUrl: same, fileId: "file_1", autoCreated: false },
  });
  assert.equal(next.autoCreated, true);
});

test("computeFolderStateAfterUpload は resolvedUrl が変わると autoCreated をリセットする", () => {
  const next = computeFolderStateAfterUpload({
    prev: baseState({ resolvedUrl: "https://drive.google.com/drive/folders/old", autoCreated: true }),
    current: baseState(),
    result: { folderUrl: "https://drive.google.com/drive/folders/new", fileId: "file_1", autoCreated: false },
  });
  assert.equal(next.autoCreated, false);
});

test("computeFolderStateAfterFinalize は result.folderUrl を resolvedUrl にし autoCreated を合成する", () => {
  const next = computeFolderStateAfterFinalize({
    prev: baseState({ inputUrl: "", autoCreated: false, sessionUploadFileIds: ["file_1"] }),
    result: { folderUrl: "https://drive.google.com/drive/folders/finalized", autoCreated: true },
  });
  assert.equal(next.resolvedUrl, "https://drive.google.com/drive/folders/finalized");
  assert.equal(next.inputUrl, "https://drive.google.com/drive/folders/finalized");
  assert.equal(next.autoCreated, true);
  assert.deepEqual(next.sessionUploadFileIds, ["file_1"]);
});

test("computeFolderStateAfterFinalize はユーザー入力の inputUrl を維持する", () => {
  const next = computeFolderStateAfterFinalize({
    prev: baseState({ inputUrl: "https://user-typed.example.com/" }),
    result: { folderUrl: "https://drive.google.com/drive/folders/finalized", autoCreated: false },
  });
  assert.equal(next.inputUrl, "https://user-typed.example.com/");
});

test("buildDriveUploadSettings は field の設定と folderState から driveSettings を構築する", () => {
  const settings = buildDriveUploadSettings({
    folderState: baseState({
      resolvedUrl: "https://drive.google.com/drive/folders/folder",
      inputUrl: "https://drive.google.com/drive/folders/folder",
      autoCreated: true,
    }),
    field: {
      driveRootFolderUrl: "https://drive.google.com/drive/folders/root",
      driveFolderNameTemplate: "{recordId}_template",
    },
    driveSettings: { responses: { q_1: "a" }, recordId: "rec_1" },
  });
  assert.equal(settings.responses.q_1, "a");
  assert.equal(settings.recordId, "rec_1");
  assert.equal(settings.rootFolderUrl, "https://drive.google.com/drive/folders/root");
  assert.equal(settings.folderNameTemplate, "{recordId}_template");
  assert.equal(settings.folderUrl, "https://drive.google.com/drive/folders/folder");
  assert.equal(settings.autoCreated, true);
});

test("buildDriveUploadSettings は field/driveSettings が欠けていても空文字で埋める", () => {
  const settings = buildDriveUploadSettings({
    folderState: baseState(),
    field: undefined,
    driveSettings: undefined,
  });
  assert.equal(settings.rootFolderUrl, "");
  assert.equal(settings.folderNameTemplate, "");
  assert.equal(settings.folderUrl, "");
  assert.equal(settings.autoCreated, false);
});
