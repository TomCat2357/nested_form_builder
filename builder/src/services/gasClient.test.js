import assert from "node:assert/strict";
import { test } from "node:test";
import { syncRecordsProxy } from "./gasClient.js";

const createGoogleScriptRunStub = () => {
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
    syncRecordsProxy(payload) {
      calls.push({ functionName: "syncRecordsProxy", payload });
      if (this._successHandler) this._successHandler({ ok: true, payload });
    },
  };

  return { run, calls };
};

test("syncRecordsProxy は URL の spreadsheetId を ID に正規化して送信する", async () => {
  const originalGoogle = globalThis.google;
  const { run, calls } = createGoogleScriptRunStub();
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
  const { run, calls } = createGoogleScriptRunStub();
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
