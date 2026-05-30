import test from "node:test";
import assert from "node:assert/strict";
import {
  copyStandardFolders,
  rebuildMappingsFromFolders,
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

test("rebuildMappingsFromFolders: 6ケース整合の結果を整形して返す", async () => {
  const captured = installGoogleStub("nfbRebuildMappingsFromFolders", {
    ok: true,
    mode: "dryRun",
    align: {
      forms: { aligned: 2, moved: 1, copiedExternal: 1, rekeyed: 0, errors: 1 },
      questions: { aligned: 3 },
    },
    orphans: {
      forms: { scanned: 4, registered: 2, invalid: 1 },
    },
    errors: [{ kind: "forms", id: "F1", name: "壊れ", folder: "a", reason: "fileId未解決かつ物理ファイル未検出" }],
    invalidCandidates: [{ kind: "forms", fileId: "BAD1", name: "memo", relPath: "a/memo.txt" }],
    relink: { questions: { refsRelinked: 1 }, dashboards: { refsRelinked: 0 } },
    truncated: false,
  });
  try {
    const r = await rebuildMappingsFromFolders("", { applyDelete: false });
    assert.deepEqual(captured.payload, { rootUrl: "", applyDelete: false });
    assert.equal(r.mode, "dryRun");
    assert.equal(r.align.forms.copiedExternal, 1);
    assert.equal(r.align.forms.errors, 1);
    // 欠落 kind はデフォルト形で埋める。
    assert.equal(r.align.dashboards.aligned, 0);
    assert.equal(r.orphans.forms.registered, 2);
    assert.equal(r.orphans.questions.registered, 0);
    assert.equal(r.errors.length, 1);
    assert.equal(r.invalidCandidates[0].relPath, "a/memo.txt");
    assert.equal(r.relink.questions.refsRelinked, 1);
    assert.equal(r.truncated, false);
  } finally {
    clearGoogleStub();
  }
});

test("rebuildMappingsFromFolders: applyDelete:true を payload へ渡す", async () => {
  const captured = installGoogleStub("nfbRebuildMappingsFromFolders", { ok: true, mode: "apply" });
  try {
    const r = await rebuildMappingsFromFolders("", { applyDelete: true });
    assert.deepEqual(captured.payload, { rootUrl: "", applyDelete: true });
    assert.equal(r.mode, "apply");
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
