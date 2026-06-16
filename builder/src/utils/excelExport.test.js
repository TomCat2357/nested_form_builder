import test from "node:test";
import assert from "node:assert/strict";

// exceljs と、それを静的 import する対象モジュールを動的ロードする。
// 依存未インストール環境（`npm run builder:install` 前）では import が throw するため、
// ファイルごとクラッシュ（exitCode 1）させず、skip 理由を立てて緑を保つ。
let ExcelJS;
let createExcelBlob;
let skip = false;
try {
  ({ default: ExcelJS } = await import("exceljs"));
  ({ createExcelBlob } = await import("./excelExport.js"));
} catch (err) {
  skip = "exceljs 未インストール。`npm run builder:install` 後に実行されます: " + (err && err.message ? err.message : String(err));
}

test("createExcelBlob はヘッダー行でも Formula Injection 対策を適用して Blob を生成する", { skip }, async () => {
  const blob = await createExcelBlob({
    columns: [{ key: "name" }],
    headerRows: [["=SUM(1,1)"]],
    rows: [["-danger"]],
  }, {});

  assert.equal(typeof blob.arrayBuffer, "function");

  const workbook = new ExcelJS.Workbook();
  const buffer = Buffer.from(await blob.arrayBuffer());
  await workbook.xlsx.load(buffer);

  const worksheet = workbook.getWorksheet("Data");
  assert.equal(worksheet.getRow(1).getCell(1).value, "'=SUM(1,1)");
  assert.equal(worksheet.getRow(2).getCell(1).value, "'-danger");
});

test("createExcelBlob は { text, hyperlink } セルをハイパーリンクとして出力する", { skip }, async () => {
  const blob = await createExcelBlob({
    columns: [{ key: "file" }],
    headerRows: [["file"]],
    rows: [[{ text: "a.pdf", hyperlink: "https://drive.google.com/drive/folders/F1" }]],
  }, {});

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(await blob.arrayBuffer()));
  const cell = workbook.getWorksheet("Data").getRow(2).getCell(1);
  assert.equal(cell.value.text, "a.pdf");
  assert.equal(cell.value.hyperlink, "https://drive.google.com/drive/folders/F1");
  assert.equal(cell.font?.underline, true);
});

test("createExcelBlob はハイパーリンクセルのテキストにも Formula Injection 対策を適用する", { skip }, async () => {
  const blob = await createExcelBlob({
    columns: [{ key: "file" }],
    headerRows: [["file"]],
    rows: [[{ text: "=DANGER", hyperlink: "https://example.com" }]],
  }, {});

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(await blob.arrayBuffer()));
  const cell = workbook.getWorksheet("Data").getRow(2).getCell(1);
  assert.equal(cell.value.text, "'=DANGER");
  assert.equal(cell.value.hyperlink, "https://example.com");
});
