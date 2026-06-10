import assert from "node:assert/strict";
import test from "node:test";
import { buildExternalActionPayload, submitExternalActionPost, openExternalActionWindow } from "./externalActionPost.js";

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
  });
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

// --- submitExternalActionPost ---

test("submitExternalActionPost は http(s) 以外の URL を false で弾く", () => {
  assert.equal(submitExternalActionPost("javascript:alert(1)", { a: 1 }), false);
  assert.equal(submitExternalActionPost("", { a: 1 }), false);
  assert.equal(submitExternalActionPost(null, { a: 1 }), false);
});

test("submitExternalActionPost は隠しフォームを生成・送信・除去する", () => {
  const created = [];
  const appended = [];
  const removed = [];
  let submitted = null;

  const makeEl = () => {
    const el = {
      style: {},
      children: [],
      appendChild(child) { this.children.push(child); },
      submit() { submitted = this; },
    };
    return el;
  };

  const originalDocument = globalThis.document;
  globalThis.document = {
    createElement(tag) {
      const el = makeEl();
      el.tagName = tag;
      created.push(el);
      return el;
    },
    body: {
      appendChild(node) { appended.push(node); },
      removeChild(node) { removed.push(node); },
    },
  };

  try {
    const ok = submitExternalActionPost("https://example.com/exec", { context: "search", n: 1 });
    assert.equal(ok, true);
    const form = created.find((el) => el.tagName === "form");
    const input = created.find((el) => el.tagName === "input");
    assert.ok(form, "form が生成される");
    assert.equal(form.method, "POST");
    assert.equal(form.action, "https://example.com/exec");
    assert.equal(form.target, "_blank");
    assert.equal(input.name, "payload");
    assert.equal(input.value, JSON.stringify({ context: "search", n: 1 }));
    assert.equal(submitted, form, "form.submit() が呼ばれる");
    assert.equal(appended[0], form, "body に append される");
    assert.equal(removed[0], form, "送信後に body から remove される");
  } finally {
    globalThis.document = originalDocument;
  }
});

test("submitExternalActionPost は target.name を form.target に使う（事前 open タブへ POST）", () => {
  const created = [];
  const makeEl = () => ({ style: {}, children: [], appendChild(c) { this.children.push(c); }, submit() {} });
  const originalDocument = globalThis.document;
  globalThis.document = {
    createElement(tag) { const el = makeEl(); el.tagName = tag; created.push(el); return el; },
    body: { appendChild() {}, removeChild() {} },
  };
  try {
    const ok = submitExternalActionPost("https://example.com/exec", { n: 1 }, { win: {}, name: "nfbExternalAction_7" });
    assert.equal(ok, true);
    const form = created.find((el) => el.tagName === "form");
    assert.equal(form.target, "nfbExternalAction_7");
  } finally {
    globalThis.document = originalDocument;
  }
});

test("submitExternalActionPost は不正 URL のとき事前 open タブを閉じる", () => {
  let closed = false;
  const ok = submitExternalActionPost("javascript:alert(1)", { n: 1 }, { win: { close() { closed = true; } }, name: "nfbExternalAction_8" });
  assert.equal(ok, false);
  assert.equal(closed, true, "不正 URL では空タブを残さず閉じる");
});

// --- openExternalActionWindow ---

test("openExternalActionWindow は window.open を空 URL + 一意名で呼び { win, name } を返す", () => {
  const calls = [];
  const fakeWin = { document: { write() {}, close() {} } };
  const originalWindow = globalThis.window;
  globalThis.window = { open(url, name) { calls.push({ url, name }); return fakeWin; } };
  try {
    const a = openExternalActionWindow();
    const b = openExternalActionWindow();
    assert.equal(calls[0].url, "", "空 URL で開く");
    assert.ok(/^nfbExternalAction_\d+$/.test(a.name), "一意名が付く");
    assert.notEqual(a.name, b.name, "呼ぶたびに名前が変わる");
    assert.equal(a.win, fakeWin);
    assert.equal(calls[0].name, a.name, "form.target に使う名前で open する");
  } finally {
    globalThis.window = originalWindow;
  }
});

test("openExternalActionWindow は window.open が null を返すとき null（ブロック時）", () => {
  const originalWindow = globalThis.window;
  globalThis.window = { open() { return null; } };
  try {
    assert.equal(openExternalActionWindow(), null);
  } finally {
    globalThis.window = originalWindow;
  }
});
