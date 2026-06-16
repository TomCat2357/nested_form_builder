import test from "node:test";
import assert from "node:assert/strict";
import {
  copyStandardFolders,
  exportMapping,
  importMapping,
} from "./gasClient.js";

// google.script.run.withSuccessHandler(fn).withFailureHandler(fn)[fnName](payload) を模した
// スタブを作る。指定された関数名で result を成功ハンドラへ渡す。payload は capture する。
function installGoogleStub(fnName, result) {
  const captured = {};
  const runner = {};
  runner.withSuccessHandler = (fn) => { runner._success = fn; return runner; };
  runner.withFailureHandler = (fn) => { runner._failure = fn; return runner; };
  runner[fnName] = (payload) => { captured.payload = payload; runner._success(result); };
  globalThis.google = { script: { run: runner } };
  return captured;
}

function clearGoogleStub() {
  delete globalThis.google;
}

test("copyStandardFolders: destRootUrl 未指定はリクエスト前にエラー", async () => {
  await assert.rejects(() => copyStandardFolders({ destRootUrl: "" }), /コピー先/);
});

test("copyStandardFolders: payload を送り結果をマッピングして返す", async () => {
  const captured = installGoogleStub("nfbCopyStandardFolders", {
    ok: true, destRootUrl: "https://drive.google.com/drive/folders/DEST",
    summary: { forms: 2, spreadsheets: 2 }, clearedLinks: 3, message: "done",
  });
  try {
    const r = await copyStandardFolders({
      destRootUrl: "https://drive.google.com/drive/folders/DEST", copyData: true, copyExternalActions: false,
    });
    assert.deepEqual(captured.payload, {
      destRootUrl: "https://drive.google.com/drive/folders/DEST", copyData: true, copyExternalActions: false, rebuildMapping: true,
    });
    assert.equal(r.destRootUrl, "https://drive.google.com/drive/folders/DEST");
    assert.deepEqual(r.summary, { forms: 2, spreadsheets: 2 });
    assert.equal(r.clearedLinks, 3);
    assert.equal(r.message, "done");
  } finally {
    clearGoogleStub();
  }
});

test("copyStandardFolders: appsScriptCopied を boolean で返す", async () => {
  installGoogleStub("nfbCopyStandardFolders", {
    ok: true, destRootUrl: "https://drive.google.com/drive/folders/DEST",
    summary: {}, clearedLinks: 0, appsScriptCopied: true, message: "done",
  });
  try {
    const r = await copyStandardFolders({ destRootUrl: "https://drive.google.com/drive/folders/DEST" });
    assert.equal(r.appsScriptCopied, true);
    assert.equal(r.appsScriptCopyError, "");
  } finally {
    clearGoogleStub();
  }
});

test("copyStandardFolders: appsscript 本体コピー失敗時は理由を appsScriptCopyError で返す", async () => {
  installGoogleStub("nfbCopyStandardFolders", {
    ok: true, destRootUrl: "https://drive.google.com/drive/folders/DEST",
    summary: {}, clearedLinks: 0, appsScriptCopied: false,
    appsScriptCopyError: "Apps Script API が無効です。", message: "done",
  });
  try {
    const r = await copyStandardFolders({ destRootUrl: "https://drive.google.com/drive/folders/DEST" });
    assert.equal(r.appsScriptCopied, false);
    assert.equal(r.appsScriptCopyError, "Apps Script API が無効です。");
  } finally {
    clearGoogleStub();
  }
});

test("exportMapping: サーバの mapping ドキュメントをそのまま返す", async () => {
  const doc = { type: "nfb-mapping", version: 1, forms: { f1: { fileId: "FF1" } }, questions: {}, dashboards: {}, folders: {} };
  installGoogleStub("nfbExportMapping", { ok: true, mapping: doc });
  try {
    const r = await exportMapping();
    assert.equal(r.type, "nfb-mapping");
    assert.equal(r.forms.f1.fileId, "FF1");
  } finally {
    clearGoogleStub();
  }
});

test("importMapping: payload に { url } を送り、件数結果を返す", async () => {
  const captured = installGoogleStub("nfbImportMapping", {
    ok: true, imported: { forms: 2, questions: 1, dashboards: 0 }, skipped: 1, errors: [],
  });
  try {
    const r = await importMapping("https://drive.google.com/file/d/FID/view");
    assert.deepEqual(captured.payload, { url: "https://drive.google.com/file/d/FID/view" });
    assert.equal(r.imported.forms, 2);
    assert.equal(r.skipped, 1);
    assert.deepEqual(r.errors, []);
  } finally {
    clearGoogleStub();
  }
});

test("importMapping: 引数なしは url 空文字で送る（ルート最新読込）", async () => {
  const captured = installGoogleStub("nfbImportMapping", { ok: true, imported: {}, skipped: 0, errors: [] });
  try {
    await importMapping();
    assert.deepEqual(captured.payload, { url: "" });
  } finally {
    clearGoogleStub();
  }
});
