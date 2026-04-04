import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createGoogleDocumentFromTemplate,
  createRecordPrintDocument,
  executeRecordOutputAction,
  finalizeRecordDriveFolder,
  listForms,
  syncRecordsProxy,
} from "./gasClient.js";

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
    fileName: "印刷様式_相談票_rec001_20260309_120000",
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
      folderUrl: "https://drive.google.com/drive/folders/folder123",
      autoCreated: true,
      payload: receivedPayload,
    }),
  });
  globalThis.google = { script: { run } };

  try {
    const result = await createRecordPrintDocument(payload);

      assert.equal(result.ok, true);
      assert.equal(result.fileUrl, "https://docs.google.com/document/d/file123/edit");
      assert.equal(result.folderUrl, "https://drive.google.com/drive/folders/folder123");
      assert.equal(result.autoCreated, true);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].functionName, "nfbCreateRecordPrintDocument");
      assert.deepEqual(calls[0].payload, payload);
  } finally {
    globalThis.google = originalGoogle;
  }
});

test("createRecordPrintDocument は一括 payload でも nfbCreateRecordPrintDocument を呼び出す", async () => {
  const originalGoogle = globalThis.google;
  const payload = {
    fileName: "印刷様式_相談票_一括_2件_20260309_120000",
    records: [
      {
        fileName: "印刷様式_相談票_1_20260309_120000",
        formTitle: "相談票",
        recordId: "rec001",
        recordNo: "1",
        exportedAtIso: "2026-03-09T03:00:00.000Z",
        items: [{ label: "氏名", value: "山田 太郎", depth: 0, type: "text" }],
      },
      {
        fileName: "印刷様式_相談票_2_20260309_120000",
        formTitle: "相談票",
        recordId: "rec002",
        recordNo: "2",
        exportedAtIso: "2026-03-09T03:00:00.000Z",
        items: [{ label: "氏名", value: "佐藤 花子", depth: 0, type: "text" }],
      },
    ],
  };
  const { run, calls } = createGoogleScriptRunStub({
    nfbCreateRecordPrintDocument: (receivedPayload) => ({
      ok: true,
      fileUrl: "https://docs.google.com/document/d/file456/edit",
      folderUrl: "",
      autoCreated: false,
      payload: receivedPayload,
    }),
  });
  globalThis.google = { script: { run } };

  try {
    const result = await createRecordPrintDocument(payload);

      assert.equal(result.ok, true);
      assert.equal(result.fileUrl, "https://docs.google.com/document/d/file456/edit");
      assert.equal(result.folderUrl, "");
      assert.equal(result.autoCreated, false);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].functionName, "nfbCreateRecordPrintDocument");
      assert.deepEqual(calls[0].payload, payload);
  } finally {
    globalThis.google = originalGoogle;
  }
});

test("createGoogleDocumentFromTemplate は nfbCreateGoogleDocumentFromTemplate を呼び出す", async () => {
  const originalGoogle = globalThis.google;
  const payload = {
    sourceUrl: "https://docs.google.com/document/d/template123/edit",
    fileNameTemplate: "{ID}_{氏名}",
    driveSettings: {
      recordId: "rec001",
      responses: { name: "山田 太郎" },
      fieldLabels: { name: "氏名" },
      fieldValues: { name: "山田 太郎" },
    },
  };
  const { run, calls } = createGoogleScriptRunStub({
    nfbCreateGoogleDocumentFromTemplate: (receivedPayload) => ({
      ok: true,
      fileUrl: "https://docs.google.com/document/d/generated123/edit",
      fileName: "rec001_山田 太郎",
      fileId: "generated123",
      folderUrl: "https://drive.google.com/drive/folders/folder123",
      autoCreated: true,
      payload: receivedPayload,
    }),
  });
  globalThis.google = { script: { run } };

  try {
    const result = await createGoogleDocumentFromTemplate(payload);

    assert.equal(result.ok, true);
    assert.equal(result.fileId, "generated123");
    assert.equal(result.fileUrl, "https://docs.google.com/document/d/generated123/edit");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].functionName, "nfbCreateGoogleDocumentFromTemplate");
    assert.deepEqual(calls[0].payload, payload);
  } finally {
    globalThis.google = originalGoogle;
  }
});

test("finalizeRecordDriveFolder は trashFileIds を含む payload をそのまま送信する", async () => {
  const originalGoogle = globalThis.google;
  const payload = {
    currentDriveFolderUrl: "https://drive.google.com/drive/folders/current123",
    inputDriveFolderUrl: "",
    rootFolderUrl: "https://drive.google.com/drive/folders/root123",
    folderNameTemplate: "{ID}_資料",
    responses: { name: "山田 太郎" },
    fieldLabels: { name: "氏名" },
    fieldValues: { name: "山田 太郎" },
    fileIds: ["file_keep_1", "file_print_1"],
    trashFileIds: ["file_old_1"],
    recordId: "rec001",
  };
  const { run, calls } = createGoogleScriptRunStub({
    nfbFinalizeRecordDriveFolder: (receivedPayload) => ({
      ok: true,
      folderUrl: "https://drive.google.com/drive/folders/final123",
      autoCreated: false,
      payload: receivedPayload,
    }),
  });
  globalThis.google = { script: { run } };

  try {
    const result = await finalizeRecordDriveFolder(payload);

    assert.equal(result.ok, true);
    assert.equal(result.folderUrl, "https://drive.google.com/drive/folders/final123");
    assert.equal(result.autoCreated, false);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].functionName, "nfbFinalizeRecordDriveFolder");
    assert.deepEqual(calls[0].payload, payload);
  } finally {
    globalThis.google = originalGoogle;
  }
});

test("executeRecordOutputAction は nfbExecuteRecordOutputAction を呼び出す", async () => {
  const originalGoogle = globalThis.google;
  const payload = {
    action: { outputType: "gmail", enabled: true, fileNameTemplate: "{ID}_mail" },
    settings: { gmailTemplateSubject: "{ID} のご案内" },
    recordContext: { formId: "form_1", recordId: "rec001" },
    driveSettings: { recordId: "rec001", fileNameTemplate: "{ID}_mail" },
  };
  const { run, calls } = createGoogleScriptRunStub({
    nfbExecuteRecordOutputAction: (receivedPayload) => ({
      ok: true,
      openUrl: "https://mail.google.com/mail/u/0/#drafts",
      payload: receivedPayload,
    }),
  });
  globalThis.google = { script: { run } };

  try {
    const result = await executeRecordOutputAction(payload);
    assert.equal(result.ok, true);
    assert.equal(result.openUrl, "https://mail.google.com/mail/u/0/#drafts");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].functionName, "nfbExecuteRecordOutputAction");
    assert.deepEqual(calls[0].payload, payload);
  } finally {
    globalThis.google = originalGoogle;
  }
});
