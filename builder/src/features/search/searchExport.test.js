import assert from "node:assert/strict";
import test from "node:test";
import { buildSearchFileRefs, buildExportTableData } from "./searchExport.js";

const form = {
  schema: [
    { type: "text", label: "氏名" },
    { type: "fileUpload", label: "添付" },
  ],
};

const uploadCell = JSON.stringify({
  files: [
    { name: "見積.pdf", driveFileId: "FID1", driveFileUrl: "" },
    { name: "図面.pdf", driveFileId: "", driveFileUrl: "https://drive.google.com/file/d/FID2/view" },
  ],
  folderUrl: "https://drive.google.com/drive/folders/FOLDER1",
  folderName: "06_upload_files/r1",
});

test("buildSearchFileRefs は行ごとに fileUpload のファイル/フォルダ URL を集める", () => {
  const entries = [
    { id: "r1", data: { "氏名": "山田", "添付": uploadCell } },
    { id: "r2", data: { "氏名": "佐藤" } }, // 添付なし
  ];
  const refs = buildSearchFileRefs({ form, entries });
  assert.equal(refs.length, 2);
  assert.equal(refs[0].length, 1);
  const ref = refs[0][0];
  assert.equal(ref.question, "添付");
  assert.equal(ref.folderUrl, "https://drive.google.com/drive/folders/FOLDER1");
  assert.equal(ref.folderName, "06_upload_files/r1");
  // driveFileUrl は非永続 → driveFileId から決定的に再構成。既存 URL はそのまま残す。
  assert.deepEqual(ref.files, [
    { name: "見積.pdf", driveFileId: "FID1", driveFileUrl: "https://drive.google.com/file/d/FID1/view" },
    { name: "図面.pdf", driveFileId: "", driveFileUrl: "https://drive.google.com/file/d/FID2/view" },
  ]);
  // 添付の無い行は空配列。
  assert.deepEqual(refs[1], []);
});

test("buildSearchFileRefs は fileUpload 項目が無ければ空配列を返す", () => {
  const noFileForm = { schema: [{ type: "text", label: "氏名" }] };
  assert.deepEqual(buildSearchFileRefs({ form: noFileForm, entries: [{ id: "r1", data: {} }] }), []);
});

test("buildExportTableData の folderLink セルは {text, hyperlink} 形のまま（回帰ガード）", () => {
  const entries = [{ id: "r1", data: { "氏名": "山田", "添付": uploadCell } }];
  const table = buildExportTableData({ form, entries });
  const fileColIdx = table.columns.findIndex((c) => c.actionKind === "folderLink");
  assert.ok(fileColIdx >= 0, "folderLink 列が存在する");
  const cell = table.rows[0][fileColIdx];
  assert.equal(typeof cell, "object");
  assert.equal(cell.hyperlink, "https://drive.google.com/drive/folders/FOLDER1");
  assert.equal(typeof cell.text, "string");
});
