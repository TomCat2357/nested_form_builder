import assert from "node:assert/strict";
import { test } from "node:test";
import { createRecordPrintDocument, listForms, syncRecordsProxy } from "./gasClient.js";

const createGoogleScriptRunStub = (handlers = {}) => {
  const calls = [];

  const run = {
    _successHandler: null,
    _failureHandler: null,
    withSuccessHandler(handler) {
      this._successHandler = handler;
      return this;
    },
    withFailureHandler(handler) {
      this._failureHandler = handler;
      return this;
    },
  };

  Object.entries(handlers).forEach(([functionName, handler]) => {
    run[functionName] = function stubbedAppsScriptFunction(payload) {
      calls.push({ functionName, payload });
      if (this._successHandler) this._successHandler(handler(payload));
    };
  });

  return { run, calls };
};

test("syncRecordsProxy は URL の spreadsheetId を ID に正規化して送信する", async () => {
  const originalGoogle = globalThis.google;
  const { run, calls } = createGoogleScriptRunStub({
    syncRecordsProxy: (payload) => ({ ok: true, payload }),
  });
  globalThis.google = { script: { run } };

  try {
    const result = await syncRecordsProxy({
      spreadsheetId: "https://docs.google.com/spreadsheets/d/abc1234567/edit#gid=0",
      sheetName: "Data",
      extra: "value",
    });

    assert.equal(result.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].payload.spreadsheetId, "abc1234567");
    assert.equal(calls[0].payload.sheetName, "Data");
    assert.equal(calls[0].payload.extra, "value");
  } finally {
    globalThis.google = originalGoogle;
  }
});

test("syncRecordsProxy は ID の spreadsheetId をそのまま送信する", async () => {
  const originalGoogle = globalThis.google;
  const { run, calls } = createGoogleScriptRunStub({
    syncRecordsProxy: (payload) => ({ ok: true, payload }),
  });
  globalThis.google = { script: { run } };

  try {
    await syncRecordsProxy({
      spreadsheetId: "alreadyId123",
      sheetName: "Data",
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].payload.spreadsheetId, "alreadyId123");
  } finally {
    globalThis.google = originalGoogle;
  }
});

test("syncRecordsProxy は spreadsheetId が空ならエラーにする", async () => {
  await assert.rejects(
    syncRecordsProxy({ spreadsheetId: "   " }),
    /spreadsheetId is required/,
  );
});

test("Apps Script 関数が未定義の場合は関数名を含むエラーを返す", async () => {
  const originalGoogle = globalThis.google;
  const { run } = createGoogleScriptRunStub();
  globalThis.google = { script: { run } };

  try {
    await assert.rejects(
      listForms(),
      /Apps Script function "nfbListForms" is not available/,
    );
  } finally {
    globalThis.google = originalGoogle;
  }
});

test("createRecordPrintDocument は nfbCreateRecordPrintDocument を呼び出す", async () => {
  const originalGoogle = globalThis.google;
  const payload = {
    fileName: "印刷フォーム_相談票_rec001_20260309_120000",
    formTitle: "相談票",
    recordId: "rec001",
    recordNo: "12",
    exportedAtIso: "2026-03-09T03:00:00.000Z",
    items: [{ label: "氏名", value: "山田 太郎", depth: 0, type: "text" }],
  };
  const { run, calls } = createGoogleScriptRunStub({
    nfbCreateRecordPrintDocument: (receivedPayload) => ({
      ok: true,
      fileUrl: "https://docs.google.com/document/d/file123/edit",
      payload: receivedPayload,
    }),
  });
  globalThis.google = { script: { run } };

  try {
    const result = await createRecordPrintDocument(payload);

    assert.equal(result.ok, true);
    assert.equal(result.fileUrl, "https://docs.google.com/document/d/file123/edit");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].functionName, "nfbCreateRecordPrintDocument");
    assert.deepEqual(calls[0].payload, payload);
  } finally {
    globalThis.google = originalGoogle;
  }
});
