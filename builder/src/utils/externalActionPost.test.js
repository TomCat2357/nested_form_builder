import assert from "node:assert/strict";
import test from "node:test";
import { buildExternalActionPayload, interpretExternalActionResponse } from "./externalActionPost.js";

// --- buildExternalActionPayload ---

test("buildExternalActionPayload は共通フィールドと base をマージする", () => {
  const payload = buildExternalActionPayload({
    context: "search",
    formId: "f1",
    formName: "ヒグマ講座",
    base: { list: { rows: [["a"]], rowCount: 1 } },
  });
  assert.equal(payload.context, "search");
  assert.equal(payload.formId, "f1");
  assert.equal(payload.formName, "ヒグマ講座");
  assert.equal(typeof payload.generatedAt, "string");
  assert.deepEqual(payload.list, { rows: [["a"]], rowCount: 1 });
});

test("buildExternalActionPayload は非管理者では storage を含めない", () => {
  const storageFields = { spreadsheetId: "ABC", sheetName: "Data", driveFileUrl: "https://drive/x", userEmail: "u@example.com" };
  const payload = buildExternalActionPayload({
    context: "record",
    formId: "f1",
    storageFields,
    gate: { adminOnly: true, isAdmin: false },
  });
  assert.equal(payload.storage, undefined);
});

test("buildExternalActionPayload は adminOnly=false のボタンでは storage を含めない", () => {
  const storageFields = { spreadsheetId: "ABC" };
  const payload = buildExternalActionPayload({
    context: "record",
    storageFields,
    gate: { adminOnly: false, isAdmin: true },
  });
  assert.equal(payload.storage, undefined);
});

test("buildExternalActionPayload は adminOnly && isAdmin のとき storage を含める", () => {
  const storageFields = { spreadsheetId: "ABC", sheetName: "Data", driveFileUrl: "https://drive/x", userEmail: "u@example.com" };
  const payload = buildExternalActionPayload({
    context: "record",
    storageFields,
    gate: { adminOnly: true, isAdmin: true },
  });
  assert.deepEqual(payload.storage, {
    spreadsheetId: "ABC",
    spreadsheetUrl: "https://docs.google.com/spreadsheets/d/ABC",
    sheetName: "Data",
    driveFileUrl: "https://drive/x",
    userEmail: "u@example.com",
    childSpreadsheetId: "",
    childSpreadsheetUrl: "",
    childSheetName: "",
  });
});

test("buildExternalActionPayload は childSpreadsheetId / childSheetName を admin ゲートで storage に含める", () => {
  const storageFields = { spreadsheetId: "ABC", childSpreadsheetId: "CHILD", childSheetName: "従事者" };
  const adminPayload = buildExternalActionPayload({
    context: "search",
    storageFields,
    gate: { adminOnly: true, isAdmin: true },
  });
  assert.equal(adminPayload.storage.childSpreadsheetId, "CHILD");
  assert.equal(adminPayload.storage.childSpreadsheetUrl, "https://docs.google.com/spreadsheets/d/CHILD");
  assert.equal(adminPayload.storage.childSheetName, "従事者");
  // 非管理者では storage 自体が出ない（子 SS も漏れない）。
  const nonAdminPayload = buildExternalActionPayload({
    context: "search",
    storageFields,
    gate: { adminOnly: true, isAdmin: false },
  });
  assert.equal(nonAdminPayload.storage, undefined);
});

test("buildExternalActionPayload は spreadsheetId 空のとき spreadsheetUrl を空文字にする", () => {
  const payload = buildExternalActionPayload({
    context: "search",
    storageFields: { spreadsheetId: "" },
    gate: { adminOnly: true, isAdmin: true },
  });
  assert.equal(payload.storage.spreadsheetUrl, "");
});

test("buildExternalActionPayload は引数省略時も壊れない", () => {
  const payload = buildExternalActionPayload();
  assert.equal(payload.formId, "");
  assert.equal(payload.formName, "");
  assert.equal(payload.storage, undefined);
});

// --- interpretExternalActionResponse ---

test("interpretExternalActionResponse は受信側 JSON ({ ok, message, openUrl }) を解釈する", () => {
  const res = { status: 200, body: JSON.stringify({ ok: true, title: "完了", message: "様式を作成しました", openUrl: "https://drive/x" }) };
  const out = interpretExternalActionResponse(res);
  assert.deepEqual(out, { ok: true, title: "完了", message: "様式を作成しました", openUrl: "https://drive/x" });
});

test("interpretExternalActionResponse は ok:false の JSON を失敗として扱う", () => {
  const res = { status: 200, body: JSON.stringify({ ok: false, message: "アクセスキー不一致" }) };
  const out = interpretExternalActionResponse(res);
  assert.equal(out.ok, false);
  assert.equal(out.message, "アクセスキー不一致");
});

test("interpretExternalActionResponse は非 JSON (旧受信アプリの HTML) で汎用成功にフォールバックする", () => {
  const res = { status: 200, body: "<html><body>受信完了</body></html>" };
  const out = interpretExternalActionResponse(res);
  assert.equal(out.ok, true);
  assert.equal(out.openUrl, "");
  assert.match(out.message, /HTTP 200/);
});

test("interpretExternalActionResponse は引数欠落でも壊れない", () => {
  const out = interpretExternalActionResponse(undefined);
  assert.equal(out.ok, true);
  assert.equal(out.openUrl, "");
});
