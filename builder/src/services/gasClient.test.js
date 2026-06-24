import assert from "node:assert/strict";
import { test } from "node:test";
import {
  acquireSaveLock,
  archiveForm,
  archiveForms,
  createGoogleDocumentFromTemplate,
  countRecordsByPid,
  createRecordPrintDocument,
  deleteEntry,
  executeRecordOutputAction,
  finalizeRecordDriveFolder,
  getAdminEmail,
  getAdminKey,
  getEntry,
  listEntries,
  listForms,
  listRecordsByPid,
  listRecordsByPids,
  setAdminEmail,
  setAdminKey,
  submitResponses,
  syncRecordsProxy,
  trashDriveFilesByIds,
  unarchiveForm,
  unarchiveForms,
} from "./gasClient.js";
import { registerFormPid, unregisterFormPid } from "./formPidContext.js";

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

// レコード系 API は spreadsheetId を送らず formId を必須とする（GAS が formId から解決）。

test("syncRecordsProxy は formId 必須で payload をそのまま送信し spreadsheetId を含めない", async () => {
  const originalGoogle = globalThis.google;
  const { run, calls } = createGoogleScriptRunStub({
    syncRecordsProxy: (payload) => ({ ok: true, payload }),
  });
  globalThis.google = { script: { run } };

  try {
    const result = await syncRecordsProxy({
      formId: "form_1",
      sheetName: "Data",
      extra: "value",
    });

    assert.equal(result.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].payload.formId, "form_1");
    assert.equal(calls[0].payload.sheetName, "Data");
    assert.equal(calls[0].payload.extra, "value");
    assert.equal("spreadsheetId" in calls[0].payload, false);
  } finally {
    globalThis.google = originalGoogle;
  }
});

test("syncRecordsProxy は formId が無ければエラーにする", async () => {
  await assert.rejects(
    syncRecordsProxy({ sheetName: "Data" }),
    /formId is required/,
  );
});

test("submitResponses は formId と payload を送り spreadsheetId を含めない", async () => {
  const originalGoogle = globalThis.google;
  const { run, calls } = createGoogleScriptRunStub({
    saveResponses: (payload) => ({ ok: true, payload }),
  });
  globalThis.google = { script: { run } };

  try {
    await submitResponses({ formId: "form_1", sheetName: "Data", payload: { id: "rec1" } });
    assert.equal(calls[0].functionName, "saveResponses");
    assert.equal(calls[0].payload.formId, "form_1");
    assert.equal(calls[0].payload.id, "rec1");
    assert.equal("spreadsheetId" in calls[0].payload, false);
  } finally {
    globalThis.google = originalGoogle;
  }
});

test("submitResponses は formId が無ければエラーにする", async () => {
  await assert.rejects(
    async () => submitResponses({ sheetName: "Data", payload: {} }),
    /formId is required/,
  );
});

test("listRecordsByPids は pids 配列を dedupe/trim して listRecords へ送り records を返す", async () => {
  const originalGoogle = globalThis.google;
  const { run, calls } = createGoogleScriptRunStub({
    listRecords: (payload) => ({ ok: true, records: [{ id: "c1", pid: payload.pids[0] }], count: 1 }),
  });
  globalThis.google = { script: { run } };

  try {
    const records = await listRecordsByPids({ formId: "childForm", pids: [" p1 ", "p2", "p1", "", null] });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].functionName, "listRecords");
    assert.equal(calls[0].payload.formId, "childForm");
    assert.equal(calls[0].payload.forceFullSync, true);
    assert.deepEqual(calls[0].payload.pids, ["p1", "p2"]);
    assert.equal("pid" in calls[0].payload, false);
    assert.equal(records.length, 1);
  } finally {
    globalThis.google = originalGoogle;
  }
});

test("listRecordsByPids は pids が空なら呼ばずに空配列を返す", async () => {
  const originalGoogle = globalThis.google;
  const { run, calls } = createGoogleScriptRunStub({
    listRecords: () => ({ ok: true, records: [{ id: "x" }], count: 1 }),
  });
  globalThis.google = { script: { run } };

  try {
    assert.deepEqual(await listRecordsByPids({ formId: "childForm", pids: [] }), []);
    assert.deepEqual(await listRecordsByPids({ formId: "childForm", pids: ["", null] }), []);
    assert.equal(calls.length, 0);
  } finally {
    globalThis.google = originalGoogle;
  }
});

test("listRecordsByPids は formId が無ければエラーにする", async () => {
  await assert.rejects(async () => listRecordsByPids({ pids: ["p1"] }), /formId is required/);
});

// GAS の listRecords は admin にはソフトデリート行も返すため、formLink 子データ用途の
// ラッパーはクライアント側で必ず除外する（件数バッジ・外部アクション payload・コピー複製の混入防止）。
test("listRecordsByPids はソフトデリート済みレコードを除外する", async () => {
  const originalGoogle = globalThis.google;
  const { run } = createGoogleScriptRunStub({
    listRecords: () => ({
      ok: true,
      records: [
        { id: "c1", pid: "p1" },
        { id: "c2", pid: "p1", deletedAt: 1781000000000, deletedAtUnixMs: 1781000000000 },
        { id: "c3", pid: "p1", deletedAtUnixMs: 1781000000000 },
        { id: "c4", pid: "p1", deletedAt: null, deletedAtUnixMs: null },
      ],
      count: 4,
    }),
  });
  globalThis.google = { script: { run } };

  try {
    const records = await listRecordsByPids({ formId: "childForm", pids: ["p1"] });
    assert.deepEqual(records.map((r) => r.id), ["c1", "c4"]);
  } finally {
    globalThis.google = originalGoogle;
  }
});

test("listRecordsByPid / countRecordsByPid もソフトデリート済みを除外した結果を返す", async () => {
  const originalGoogle = globalThis.google;
  const { run } = createGoogleScriptRunStub({
    listRecords: () => ({
      ok: true,
      records: [
        { id: "c1", pid: "p1" },
        { id: "c2", pid: "p1", deletedAt: 1781000000000, deletedAtUnixMs: 1781000000000 },
      ],
      count: 2,
    }),
  });
  globalThis.google = { script: { run } };

  try {
    const records = await listRecordsByPid({ formId: "childForm", pid: "p1" });
    assert.deepEqual(records.map((r) => r.id), ["c1"]);
    const count = await countRecordsByPid({ formId: "childForm", pid: "p1" });
    assert.equal(count, 1);
  } finally {
    globalThis.google = originalGoogle;
  }
});

test("acquireSaveLock / getEntry / listEntries / deleteEntry は formId を必須とする", async () => {
  await assert.rejects(async () => acquireSaveLock({ sheetName: "Data" }), /formId is required/);
  await assert.rejects(async () => getEntry({ sheetName: "Data", entryId: "r1" }), /formId is required/);
  await assert.rejects(async () => listEntries({ sheetName: "Data" }), /formId is required/);
  await assert.rejects(async () => deleteEntry({ sheetName: "Data", entryId: "r1" }), /formId is required/);
});

test("getEntry は formId/id を送り spreadsheetId を含めない", async () => {
  const originalGoogle = globalThis.google;
  const { run, calls } = createGoogleScriptRunStub({
    getRecord: () => ({ ok: true, record: { id: "r1" }, rowIndex: 3 }),
  });
  globalThis.google = { script: { run } };

  try {
    const result = await getEntry({ formId: "form_1", sheetName: "Data", entryId: "r1" });
    assert.deepEqual(result, { record: { id: "r1" }, rowIndex: 3 });
    assert.equal(calls[0].functionName, "getRecord");
    assert.equal(calls[0].payload.formId, "form_1");
    assert.equal(calls[0].payload.id, "r1");
    assert.equal("spreadsheetId" in calls[0].payload, false);
  } finally {
    globalThis.google = originalGoogle;
  }
});

test("withUrlPid: pid は __FORM_ID__ と __PID__ が両方非空のときだけ付与される", async () => {
  const originalGoogle = globalThis.google;
  const originalWindow = globalThis.window;
  const { run, calls } = createGoogleScriptRunStub({
    listRecords: (payload) => ({ ok: true, records: [], payload }),
  });
  globalThis.google = { script: { run } };

  try {
    // formid 固定（__FORM_ID__ 非空）＋ pid → pid 付与
    globalThis.window = { __FORM_ID__: "form_1", __PID__: "rec_parent" };
    await listEntries({ formId: "form_1", sheetName: "Data" });
    assert.equal(calls.at(-1).payload.pid, "rec_parent");

    // formid 未固定（__FORM_ID__ 空）→ pid 非付与（pid が URL に紛れていても無効）
    globalThis.window = { __FORM_ID__: "", __PID__: "rec_parent" };
    await listEntries({ formId: "form_1", sheetName: "Data" });
    assert.equal("pid" in calls.at(-1).payload, false);

    // pid 空 → 非付与
    globalThis.window = { __FORM_ID__: "form_1", __PID__: "" };
    await listEntries({ formId: "form_1", sheetName: "Data" });
    assert.equal("pid" in calls.at(-1).payload, false);
  } finally {
    globalThis.google = originalGoogle;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test("withUrlPid: URL グローバル pid は payload.formId が __FORM_ID__ と一致するときだけ付く", async () => {
  const originalGoogle = globalThis.google;
  const originalWindow = globalThis.window;
  const { run, calls } = createGoogleScriptRunStub({
    listRecords: (payload) => ({ ok: true, records: [], payload }),
  });
  globalThis.google = { script: { run } };

  try {
    // 親タブは form_1 に固定（pid 空）。別フォーム form_2 への呼び出しに親 pid が漏れないこと。
    globalThis.window = { __FORM_ID__: "form_1", __PID__: "rec_parent" };
    await listEntries({ formId: "form_1", sheetName: "Data" });
    assert.equal(calls.at(-1).payload.pid, "rec_parent");
    await listEntries({ formId: "form_2", sheetName: "Data" });
    assert.equal("pid" in calls.at(-1).payload, false);
  } finally {
    globalThis.google = originalGoogle;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test("withUrlPid: formPidContext の登録 pid が formId 単位で最優先される", async () => {
  const originalGoogle = globalThis.google;
  const originalWindow = globalThis.window;
  const { run, calls } = createGoogleScriptRunStub({
    listRecords: (payload) => ({ ok: true, records: [], payload }),
  });
  globalThis.google = { script: { run } };

  try {
    // 親タブは form_parent 固定・pid 空。オーバーレイが子 form_child に pid を登録。
    globalThis.window = { __FORM_ID__: "form_parent", __PID__: "" };
    registerFormPid("form_child", "rec_parent");

    // 子フォームへの呼び出しは登録 pid が付く。
    await listEntries({ formId: "form_child", sheetName: "Data" });
    assert.equal(calls.at(-1).payload.pid, "rec_parent");

    // 親フォームへの同時呼び出しは登録が無く pid 無し（混線しない）。
    await listEntries({ formId: "form_parent", sheetName: "Data" });
    assert.equal("pid" in calls.at(-1).payload, false);

    // 解除後は子フォームにも付かない。
    unregisterFormPid("form_child");
    await listEntries({ formId: "form_child", sheetName: "Data" });
    assert.equal("pid" in calls.at(-1).payload, false);
  } finally {
    unregisterFormPid("form_child");
    globalThis.google = originalGoogle;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
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
    fileNameTemplate: "{@_id}_{氏名}",
    driveSettings: {
      recordId: "rec001",
      responses: { name: "山田 太郎" },
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
    folderUrlToTrash: "https://drive.google.com/drive/folders/current123",
    rootFolderUrl: "https://drive.google.com/drive/folders/root123",
    folderNameTemplate: "{@_id}_資料",
    responses: { name: "山田 太郎" },
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

test("trashDriveFilesByIds は nfbTrashDriveFilesByIds を呼び出す", async () => {
  const originalGoogle = globalThis.google;
  const payload = ["file_1", "file_2"];
  const { run, calls } = createGoogleScriptRunStub({
    nfbTrashDriveFilesByIds: (receivedPayload) => ({
      ok: true,
      trashedIds: receivedPayload,
    }),
  });
  globalThis.google = { script: { run } };

  try {
    const result = await trashDriveFilesByIds(payload);
    assert.equal(result.ok, true);
    assert.deepEqual(result.trashedIds, payload);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].functionName, "nfbTrashDriveFilesByIds");
    assert.deepEqual(calls[0].payload, payload);
  } finally {
    globalThis.google = originalGoogle;
  }
});

test("executeRecordOutputAction は nfbExecuteRecordOutputAction を呼び出す", async () => {
  const originalGoogle = globalThis.google;
  const payload = {
    action: { outputType: "gmail", enabled: true, fileNameTemplate: "{@_id}_mail", gmailTemplateSubject: "{@_id} のご案内" },
    settings: { standardPrintTemplateId: "template123" },
    recordContext: { formId: "form_1", recordId: "rec001" },
    driveSettings: { recordId: "rec001", fileNameTemplate: "{@_id}_mail" },
  };
  const { run, calls } = createGoogleScriptRunStub({
    nfbExecuteRecordOutputAction: (receivedPayload) => ({
      ok: true,
      openUrl: "https://mail.google.com/mail/#drafts",
      payload: receivedPayload,
    }),
  });
  globalThis.google = { script: { run } };

  try {
    const result = await executeRecordOutputAction(payload);
    assert.equal(result.ok, true);
    assert.equal(result.openUrl, "https://mail.google.com/mail/#drafts");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].functionName, "nfbExecuteRecordOutputAction");
    assert.deepEqual(calls[0].payload, payload);
  } finally {
    globalThis.google = originalGoogle;
  }
});

test("archive/unarchive 系は formId 必須エラー文言を維持する", async () => {
  await assert.rejects(archiveForm(), /formId is required/);
  await assert.rejects(unarchiveForm(), /formId is required/);
});

test("archive/unarchive 系は mapResult で form を返し未定義時は null を返す", async () => {
  const originalGoogle = globalThis.google;
  const { run } = createGoogleScriptRunStub({
    nfbArchiveForm: () => ({ ok: true, form: { id: "f1" } }),
    nfbUnarchiveForm: () => ({ ok: true }),
  });
  globalThis.google = { script: { run } };

  try {
    const archived = await archiveForm("f1");
    const unarchived = await unarchiveForm("f1");
    assert.deepEqual(archived, { id: "f1" });
    assert.equal(unarchived, null);
  } finally {
    globalThis.google = originalGoogle;
  }
});

test("archiveForms/unarchiveForms は formIds 必須エラー文言を維持する", async () => {
  await assert.rejects(archiveForms(), /formIds array is required/);
  await assert.rejects(unarchiveForms([]), /formIds array is required/);
});

test("archiveForms/unarchiveForms は配列 payload をそのまま送信する", async () => {
  const originalGoogle = globalThis.google;
  const { run, calls } = createGoogleScriptRunStub({
    nfbArchiveForms: (payload) => ({ ok: true, archived: payload.length }),
    nfbUnarchiveForms: (payload) => ({ ok: true, unarchived: payload.length }),
  });
  globalThis.google = { script: { run } };

  try {
    const ids = ["f1", "f2"];
    const archiveResult = await archiveForms(ids);
    const unarchiveResult = await unarchiveForms(ids);
    assert.equal(archiveResult.archived, 2);
    assert.equal(unarchiveResult.unarchived, 2);
    assert.deepEqual(calls[0].payload, ids);
    assert.deepEqual(calls[1].payload, ids);
  } finally {
    globalThis.google = originalGoogle;
  }
});

test("admin key/email 系は mapResult で既定値を返す", async () => {
  const originalGoogle = globalThis.google;
  const { run } = createGoogleScriptRunStub({
    nfbGetAdminKey: () => ({ ok: true }),
    nfbSetAdminKey: () => ({ ok: true, adminKey: "new-key" }),
    nfbGetAdminEmail: () => ({ ok: true }),
    nfbSetAdminEmail: () => ({ ok: true, adminEmail: "admin@example.com" }),
  });
  globalThis.google = { script: { run } };

  try {
    assert.equal(await getAdminKey(), "");
    assert.equal(await setAdminKey("new-key"), "new-key");
    assert.equal(await getAdminEmail(), "");
    assert.equal(await setAdminEmail("admin@example.com"), "admin@example.com");
  } finally {
    globalThis.google = originalGoogle;
  }
});
