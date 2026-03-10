import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { createExcelBlob } from "./excelExport.js";

test("createExcelBlob はヘッダー行でも Formula Injection 対策を適用して Blob を生成する", async () => {
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
