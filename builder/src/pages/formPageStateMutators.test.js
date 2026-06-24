import assert from "node:assert/strict";
import { test } from "node:test";
import { planDiscardUnsavedUploads } from "./formPageStateMutators.js";

// 未保存キャンセル時の Drive 巻き戻し計画（純関数）。開封時 state と現在 state の比較で
// 「セッション新規フォルダ＝フォルダごと trash / 既存フォルダ＝追加ファイルのみ trash / 削除のみ＝何もしない」
// を導く。削除は保存まで遅延されるため untrash は不要、という設計の検証も兼ねる。

test("planDiscardUnsavedUploads: 初回でファイル＋フォルダ両方できたらフォルダごと trash（中のファイルも一緒）", () => {
  const current = {
    f1: { resolvedUrl: "https://drive.google.com/drive/folders/NEW", folderName: "record_x", sessionUploadFileIds: ["a", "b"] },
  };
  const initial = { f1: {} }; // 開封時はフォルダ無し
  const plan = planDiscardUnsavedUploads(current, initial);
  assert.deepEqual(plan.folderUrlsToTrash, ["https://drive.google.com/drive/folders/NEW"]);
  assert.deepEqual(plan.fileIds, [], "フォルダごと捨てるので個別ファイル trash はしない");
});

test("planDiscardUnsavedUploads: 既存フォルダにファイルだけ増えたら追加ファイルのみ trash・フォルダ温存", () => {
  const current = {
    f1: { resolvedUrl: "https://drive.google.com/drive/folders/OLD", folderName: "record_x", sessionUploadFileIds: ["c"] },
  };
  const initial = {
    f1: { resolvedUrl: "https://drive.google.com/drive/folders/OLD", folderName: "record_x" },
  };
  const plan = planDiscardUnsavedUploads(current, initial);
  assert.deepEqual(plan.folderUrlsToTrash, [], "既存フォルダは温存");
  assert.deepEqual(plan.fileIds, ["c"]);
});

test("planDiscardUnsavedUploads: セッション生成フォルダを削除（pendingDeleteUrl）してもフォルダごと trash", () => {
  const current = {
    f1: { resolvedUrl: "", inputUrl: "", pendingDeleteUrl: "https://drive.google.com/drive/folders/NEW", folderName: "", sessionUploadFileIds: ["a"] },
  };
  const initial = { f1: {} };
  const plan = planDiscardUnsavedUploads(current, initial);
  assert.deepEqual(plan.folderUrlsToTrash, ["https://drive.google.com/drive/folders/NEW"]);
  assert.deepEqual(plan.fileIds, []);
});

test("planDiscardUnsavedUploads: 既存ファイル/フォルダを削除したが未保存なら何も trash しない（＝復活）", () => {
  const current = {
    f1: { resolvedUrl: "", inputUrl: "", pendingDeleteUrl: "https://drive.google.com/drive/folders/OLD", folderName: "", sessionUploadFileIds: [] },
  };
  const initial = {
    f1: { resolvedUrl: "https://drive.google.com/drive/folders/OLD", folderName: "record_x" },
  };
  const plan = planDiscardUnsavedUploads(current, initial);
  assert.deepEqual(plan.folderUrlsToTrash, [], "既存フォルダは削除されていないので残す");
  assert.deepEqual(plan.fileIds, []);
});

test("planDiscardUnsavedUploads: 既存フォルダで削除＋ファイル追加が混在しても、追加ファイルだけ trash・フォルダ温存", () => {
  const current = {
    f1: { resolvedUrl: "https://drive.google.com/drive/folders/OLD", folderName: "record_x", sessionUploadFileIds: ["new1"] },
  };
  const initial = {
    f1: { resolvedUrl: "https://drive.google.com/drive/folders/OLD", folderName: "record_x" },
  };
  const plan = planDiscardUnsavedUploads(current, initial);
  assert.deepEqual(plan.folderUrlsToTrash, []);
  assert.deepEqual(plan.fileIds, ["new1"]);
});

test("planDiscardUnsavedUploads: 複数フィールド（新規フォルダ＋既存フォルダ）を同時に正しく分類", () => {
  const current = {
    fNew: { resolvedUrl: "https://drive.google.com/drive/folders/NEW", folderName: "record_a", sessionUploadFileIds: ["x"] },
    fOld: { resolvedUrl: "https://drive.google.com/drive/folders/OLD", folderName: "record_b", sessionUploadFileIds: ["y", "y", "", "z"] },
  };
  const initial = {
    fOld: { resolvedUrl: "https://drive.google.com/drive/folders/OLD", folderName: "record_b" },
  };
  const plan = planDiscardUnsavedUploads(current, initial);
  assert.deepEqual(plan.folderUrlsToTrash, ["https://drive.google.com/drive/folders/NEW"]);
  assert.deepEqual(plan.fileIds, ["y", "z"], "重複・空 id は正規化される");
});

test("planDiscardUnsavedUploads: 変更が無ければ空の計画を返す", () => {
  const plan = planDiscardUnsavedUploads({}, {});
  assert.deepEqual(plan.folderUrlsToTrash, []);
  assert.deepEqual(plan.fileIds, []);
});
