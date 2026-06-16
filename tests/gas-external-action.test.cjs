const assert = require("node:assert/strict");
const test = require("node:test");
const { loadGasFiles } = require("./helpers/gasVmLoader.cjs");

function loadContext(urlFetchImpl) {
  const context = {
    console,
    Logger: { log() {} },
    // nfbSafeCall_ の最小スタブ（errors.gs と同じ try/catch セマンティクス）。
    nfbSafeCall_(fn) { try { return fn(); } catch (err) { return { ok: false, error: String(err && err.message ? err.message : err) }; } },
    Nfb_runScriptAction_() { throw new Error("not used in this test"); },
    ScriptApp: { getOAuthToken() { return "TEST_TOKEN"; } },
    UrlFetchApp: { fetch: urlFetchImpl || function () { throw new Error("fetch not stubbed"); } },
  };
  return loadGasFiles(context, ["externalAction.gs"]);
}

test("ExtAction_isValidUrl_ は http(s) のみ許可する", () => {
  const ctx = loadContext();
  assert.equal(ctx.ExtAction_isValidUrl_("https://script.google.com/x/exec"), true);
  assert.equal(ctx.ExtAction_isValidUrl_("http://example.com"), true);
  assert.equal(ctx.ExtAction_isValidUrl_("javascript:alert(1)"), false);
  assert.equal(ctx.ExtAction_isValidUrl_(""), false);
  assert.equal(ctx.ExtAction_isValidUrl_(null), false);
});

test("ExtAction_appendRelayParam_ は nfbRelay=1 を冪等に付与する", () => {
  const ctx = loadContext();
  assert.equal(ctx.ExtAction_appendRelayParam_("https://x/exec"), "https://x/exec?nfbRelay=1");
  assert.equal(ctx.ExtAction_appendRelayParam_("https://x/exec?k=abc"), "https://x/exec?k=abc&nfbRelay=1");
  // 既に付いていれば二重付与しない。
  assert.equal(ctx.ExtAction_appendRelayParam_("https://x/exec?nfbRelay=1"), "https://x/exec?nfbRelay=1");
  // ハッシュは末尾に温存する。
  assert.equal(ctx.ExtAction_appendRelayParam_("https://x/exec?k=1#frag"), "https://x/exec?k=1&nfbRelay=1#frag");
});

test("ExtAction_send_ は不正 URL を BAD_URL で弾く（fetch を呼ばない）", () => {
  let called = false;
  const ctx = loadContext(() => { called = true; });
  const res = ctx.ExtAction_send_({ url: "ftp://x", payload: {} });
  assert.equal(res.ok, false);
  assert.equal(res.code, "BAD_URL");
  assert.equal(called, false);
});

test("ExtAction_send_ は payload を form フィールド payload(JSON) + Bearer で POST する", () => {
  let captured = null;
  const ctx = loadContext((url, opts) => {
    captured = { url, opts };
    return { getResponseCode() { return 200; }, getContentText() { return "{\"ok\":true}"; } };
  });
  const res = ctx.ExtAction_send_({ url: "https://x/exec?k=abc", payload: { context: "record", n: 1 } });
  assert.equal(res.ok, true);
  assert.equal(res.status, 200);
  assert.equal(res.body, "{\"ok\":true}");
  assert.equal(captured.url, "https://x/exec?k=abc&nfbRelay=1");
  assert.equal(captured.opts.method, "post");
  assert.equal(captured.opts.payload.payload, JSON.stringify({ context: "record", n: 1 }));
  assert.equal(captured.opts.headers.Authorization, "Bearer TEST_TOKEN");
  assert.equal(captured.opts.muteHttpExceptions, true);
});

test("ExtAction_send_ は受信側の 4xx/5xx を ok:false で返す", () => {
  const ctx = loadContext(() => ({ getResponseCode() { return 500; }, getContentText() { return "err"; } }));
  const res = ctx.ExtAction_send_({ url: "https://x/exec", payload: {} });
  assert.equal(res.ok, false);
  assert.equal(res.status, 500);
});
