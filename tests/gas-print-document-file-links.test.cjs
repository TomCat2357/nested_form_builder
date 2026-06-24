const assert = require("node:assert/strict");
const test = require("node:test");
const { loadGasFiles } = require("./helpers/gasVmLoader.cjs");

// drivePrintDocument.gs の印刷様式テーブル描画のうち、添付ファイルのリンク描画を検証する。
// 対象関数（nfbSetPrintDocumentCellFileLinks_ / nfbAppendPrintDocumentTableRow_）は
// DocumentApp を直接触らず table/cell を受け取るので、記録用モックを渡してロードする。
function loadPrintDoc() {
  return loadGasFiles({ console, JSON }, ["drivePrintDocument.gs"]);
}

// テキストの setText / setLinkUrl(範囲) / setUnderline(範囲) / setForegroundColor(範囲) を記録するセルモック。
function makeCell() {
  const state = { text: "", links: [], underlines: [], colorRanges: [], wholeColor: null };
  const text = {
    setText(v) { state.text = v === undefined || v === null ? "" : String(v); return text; },
    setFontFamily() { return text; },
    setFontSize() { return text; },
    setBold() { return text; },
    setForegroundColor(a, b, c) {
      if (c !== undefined) state.colorRanges.push({ start: a, end: b, color: c });
      else state.wholeColor = a;
      return text;
    },
    setUnderline(a, b, c) {
      if (c !== undefined) state.underlines.push({ start: a, end: b, value: c });
      return text;
    },
    setLinkUrl(start, end, url) { state.links.push({ start, end, url }); return text; },
  };
  const paragraph = {
    editAsText() { return text; },
    setHeading() { return paragraph; },
    setIndentStart() { return paragraph; },
    setSpacingBefore() { return paragraph; },
    setSpacingAfter() { return paragraph; },
  };
  const cell = {
    getChild() { return { asParagraph() { return paragraph; } }; },
    appendParagraph() { return paragraph; },
    setBackgroundColor() { return cell; },
  };
  return { cell, state };
}

// appendTableRow→appendTableCell の 1 列目=label, 2 列目=value を記録するテーブルモック。
function makeTable() {
  const valueCells = [];
  const labelCells = [];
  const table = {
    appendTableRow() {
      let n = 0;
      return {
        appendTableCell() {
          const m = makeCell();
          if (n === 0) labelCells.push(m); else valueCells.push(m);
          n++;
          return m.cell;
        },
      };
    },
  };
  return { table, valueCells, labelCells };
}

test("nfbSetPrintDocumentCellFileLinks_: ファイル名を ', ' 連結し URL のある範囲だけリンクを貼る", () => {
  const gas = loadPrintDoc();
  const { cell, state } = makeCell();
  gas.nfbSetPrintDocumentCellFileLinks_(cell, [
    { name: "見積書.pdf", url: "https://drive.google.com/file/d/AAA/view" },
    { name: "申請書.docx", url: "" },                                   // URL 無し → リンクなし
    { name: "議事録.pdf", url: "https://drive.google.com/file/d/CCC/view" },
  ], { fontFamily: "Arial", fontSize: 10, color: "#202124", spacingAfter: 0 });

  assert.equal(state.text, "見積書.pdf, 申請書.docx, 議事録.pdf");
  // 見積書.pdf=7文字[0,6]、", "(2)、申請書.docx=8文字[9,16]、", "(2)、議事録.pdf=7文字[19,25]
  assert.deepEqual(state.links, [
    { start: 0, end: 6, url: "https://drive.google.com/file/d/AAA/view" },
    { start: 19, end: 25, url: "https://drive.google.com/file/d/CCC/view" },
  ]);
  // リンク範囲は青字＋下線
  assert.deepEqual(state.colorRanges, [
    { start: 0, end: 6, color: "#1a73e8" },
    { start: 19, end: 25, color: "#1a73e8" },
  ]);
  assert.deepEqual(state.underlines, [
    { start: 0, end: 6, value: true },
    { start: 19, end: 25, value: true },
  ]);
});

test("nfbAppendPrintDocumentTableRow_: fileUpload で linkUploadFiles ON なら value セルにリンクを貼る", () => {
  const gas = loadPrintDoc();
  const { table, valueCells } = makeTable();
  gas.nfbAppendPrintDocumentTableRow_(table, {
    label: "添付資料",
    value: "見積書.pdf",
    depth: 0,
    type: "fileUpload",
    files: [{ name: "見積書.pdf", url: "https://drive.google.com/file/d/AAA/view" }],
  }, true);

  assert.equal(valueCells.length, 1);
  assert.equal(valueCells[0].state.text, "見積書.pdf");
  assert.deepEqual(valueCells[0].state.links, [
    { start: 0, end: 6, url: "https://drive.google.com/file/d/AAA/view" },
  ]);
});

test("nfbAppendPrintDocumentTableRow_: linkUploadFiles OFF ならリンクを貼らずテキストのみ", () => {
  const gas = loadPrintDoc();
  const { table, valueCells } = makeTable();
  gas.nfbAppendPrintDocumentTableRow_(table, {
    label: "添付資料",
    value: "見積書.pdf",
    depth: 0,
    type: "fileUpload",
    files: [{ name: "見積書.pdf", url: "https://drive.google.com/file/d/AAA/view" }],
  }, false);

  assert.equal(valueCells[0].state.text, "見積書.pdf");
  assert.deepEqual(valueCells[0].state.links, []);
});

test("nfbAppendPrintDocumentTableRow_: URL を持つファイルが無ければリンクを貼らずテキスト(value)へフォールバック", () => {
  const gas = loadPrintDoc();
  const { table, valueCells } = makeTable();
  gas.nfbAppendPrintDocumentTableRow_(table, {
    label: "添付資料",
    value: "見積書.pdf, 申請書.docx",
    depth: 0,
    type: "fileUpload",
    files: [{ name: "見積書.pdf", url: "" }, { name: "申請書.docx", url: "" }],
  }, true);

  assert.equal(valueCells[0].state.text, "見積書.pdf, 申請書.docx");
  assert.deepEqual(valueCells[0].state.links, []);
});

test("nfbAppendPrintDocumentTableRow_: fileUpload 以外は files があってもリンクを貼らない", () => {
  const gas = loadPrintDoc();
  const { table, valueCells } = makeTable();
  gas.nfbAppendPrintDocumentTableRow_(table, {
    label: "氏名",
    value: "山田太郎",
    depth: 0,
    type: "text",
    files: [{ name: "山田太郎", url: "https://drive.google.com/file/d/AAA/view" }],
  }, true);

  assert.equal(valueCells[0].state.text, "山田太郎");
  assert.deepEqual(valueCells[0].state.links, []);
});
