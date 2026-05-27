import test from "node:test";
import assert from "node:assert/strict";
import {
  copyStandardFolders,
  rebuildMappingsFromFolders,
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
      destRootUrl: "https://drive.google.com/drive/folders/DEST", copyData: true, copyWebhooks: false,
    });
    assert.deepEqual(captured.payload, {
      destRootUrl: "https://drive.google.com/drive/folders/DEST", copyData: true, copyWebhooks: false, rebuildMapping: true,
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
  } finally {
    clearGoogleStub();
  }
});

test("rebuildMappingsFromFolders: 件数オブジェクトを返す", async () => {
  installGoogleStub("nfbRebuildMappingsFromFolders", {
    ok: true, forms: { count: 5 }, questions: { count: 3 }, dashboards: { count: 1 },
  });
  try {
    const r = await rebuildMappingsFromFolders("");
    assert.equal(r.forms.count, 5);
    assert.equal(r.questions.count, 3);
    assert.equal(r.dashboards.count, 1);
  } finally {
    clearGoogleStub();
  }
});
