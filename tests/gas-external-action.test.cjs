const assert = require("node:assert/strict");
const test = require("node:test");
const crypto = require("node:crypto");
const { loadGasFiles } = require("./helpers/gasVmLoader.cjs");

// テスト内で受信側署名を再現するための参照実装（GAS の ExtAction_hmacHex_ と同値）。
function hmacHex(message, secret) {
  return crypto.createHmac("sha256", String(secret)).update(String(message)).digest("hex");
}

function loadContext(urlFetchImpl, extActionSecret, extra) {
  const context = {
    console,
    Logger: { log() {} },
    // 送信元シークレットは管理者設定（スクリプトプロパティ）から読む。テストでは
    // GetExtActionSecret_ をスタブして注入する（既定は未設定＝空文字）。
    GetExtActionSecret_() { return extActionSecret || ""; },
    // nfbSafeCall_ の最小スタブ（errors.gs と同じ try/catch セマンティクス）。
    nfbSafeCall_(fn) { try { return fn(); } catch (err) { return { ok: false, error: String(err && err.message ? err.message : err) }; } },
    Nfb_runScriptAction_() { throw new Error("not used in this test"); },
    // 誤送信防止ハンドシェイク用の nonce 生成（決定的なスタブ）。
    Nfb_generateUlid_() { return "NONCE_FIXED"; },
    ScriptApp: { getOAuthToken() { return "TEST_TOKEN"; } },
    // GAS の computeHmacSha256Signature を node crypto で本物相当に再現（バイト配列を返す）。
    Utilities: {
      computeHmacSha256Signature(message, key) {
        return Array.from(crypto.createHmac("sha256", String(key)).update(String(message)).digest());
      },
    },
    UrlFetchApp: { fetch: urlFetchImpl || function () { throw new Error("fetch not stubbed"); } },
  };
  if (extra && typeof extra === "object") {
    Object.keys(extra).forEach((key) => { context[key] = extra[key]; });
  }
  return loadGasFiles(context, ["externalAction.gs"]);
}

// HTTP 応答スタブ（getResponseCode / getContentText）。
function httpResponse(status, body) {
  return { getResponseCode() { return status; }, getContentText() { return body; } };
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
  let calls = 0;
  const ctx = loadContext((url, opts) => {
    calls += 1;
    captured = { url, opts };
    return httpResponse(200, "{\"ok\":true}");
  });
  const res = ctx.ExtAction_send_({ url: "https://x/exec?k=abc", payload: { recordCount: 1, n: 1 } });
  assert.equal(res.ok, true);
  assert.equal(res.status, 200);
  assert.equal(res.body, "{\"ok\":true}");
  assert.equal(calls, 1); // シークレットなし＝プローブなし＝1 回だけ
  assert.equal(captured.url, "https://x/exec?k=abc&nfbRelay=1");
  assert.equal(captured.opts.method, "post");
  assert.equal(captured.opts.payload.payload, JSON.stringify({ recordCount: 1, n: 1 }));
  assert.equal(captured.opts.headers.Authorization, "Bearer TEST_TOKEN");
  assert.equal(captured.opts.muteHttpExceptions, true);
});

test("ExtAction_send_ は受信側の 4xx/5xx を ok:false で返す", () => {
  const ctx = loadContext(() => httpResponse(500, "err"));
  const res = ctx.ExtAction_send_({ url: "https://x/exec", payload: {} });
  assert.equal(res.ok, false);
  assert.equal(res.status, 500);
});

// ----- 誤送信防止ハンドシェイク（共有シークレット HMAC） ----------------------

test("ExtAction_hmacHex_ は computeHmacSha256Signature を 16 進文字列で返す（決定的）", () => {
  const ctx = loadContext();
  const a = ctx.ExtAction_hmacHex_("NONCE_FIXED", "secret");
  assert.equal(a, hmacHex("NONCE_FIXED", "secret"));
  // 同一入力は同一出力。
  assert.equal(ctx.ExtAction_hmacHex_("NONCE_FIXED", "secret"), a);
  // 入力が違えば変わる。
  assert.notEqual(ctx.ExtAction_hmacHex_("NONCE_FIXED", "other"), a);
});

test("ExtAction_verifyProbeResponse_ は正規署名のときだけ true", () => {
  const ctx = loadContext();
  const nonce = "NONCE_FIXED";
  const secret = "S";
  const good = JSON.stringify({ ok: true, nfbExternalAction: true, signature: hmacHex(nonce, secret) });
  assert.equal(ctx.ExtAction_verifyProbeResponse_(good, nonce, secret), true);
  // 署名が別シークレット由来 → false。
  assert.equal(ctx.ExtAction_verifyProbeResponse_(
    JSON.stringify({ ok: true, nfbExternalAction: true, signature: hmacHex(nonce, "OTHER") }), nonce, secret), false);
  // nfbExternalAction:false（シークレット未設定の受信側）→ false。
  assert.equal(ctx.ExtAction_verifyProbeResponse_(JSON.stringify({ ok: true, nfbExternalAction: false }), nonce, secret), false);
  // ok:false → false。
  assert.equal(ctx.ExtAction_verifyProbeResponse_(
    JSON.stringify({ ok: false, nfbExternalAction: true, signature: hmacHex(nonce, secret) }), nonce, secret), false);
  // signature 欠落 → false。
  assert.equal(ctx.ExtAction_verifyProbeResponse_(JSON.stringify({ ok: true, nfbExternalAction: true }), nonce, secret), false);
  // 非 JSON（旧 HTML 受信アプリ等）→ false。
  assert.equal(ctx.ExtAction_verifyProbeResponse_("<html>not json</html>", nonce, secret), false);
  // 空文字 → false。
  assert.equal(ctx.ExtAction_verifyProbeResponse_("", nonce, secret), false);
});

test("ExtAction_send_ は送信元シークレット設定時に正規宛先へ 2 段階送信する（プローブに機微なし）", () => {
  const calls = [];
  const ctx = loadContext((url, opts) => {
    calls.push({ url, opts });
    const body = opts.payload;
    if (body && String(body.nfbProbe) === "1") {
      // 正規受信アプリを模擬：受け取った nonce を同じシークレットで署名して返す。
      const sig = hmacHex(String(body.nonce), "S");
      return httpResponse(200, JSON.stringify({ ok: true, nfbExternalAction: true, signature: sig }));
    }
    return httpResponse(200, JSON.stringify({ ok: true, title: "受信" }));
  }, "S");
  const res = ctx.ExtAction_send_({ url: "https://x/exec", payload: { recordCount: 1, secretData: "x" } });
  assert.equal(res.ok, true);
  assert.equal(calls.length, 2);
  // Phase1（プローブ）: nfbProbe/nonce を含み、本 payload は含まない。
  assert.equal(calls[0].opts.payload.nfbProbe, "1");
  assert.equal(calls[0].opts.payload.nonce, "NONCE_FIXED");
  assert.equal(calls[0].opts.payload.payload, undefined);
  // Phase2（本送信）: 本 payload を送る。
  assert.equal(calls[1].opts.payload.payload, JSON.stringify({ recordCount: 1, secretData: "x" }));
});

// ----- ファイル参照は payload.records[].items[].files 内包（サーバ側 Drive 解決は廃止） --------

test("ExtAction_send_ は raw.files を無視し、payload をそのまま中継する（サーバ側 files 解決は廃止）", () => {
  let captured = null;
  const ctx = loadContext((url, opts) => { captured = opts; return httpResponse(200, JSON.stringify({ ok: true })); });
  const payload = { recordCount: 1, records: [{ id: "r1", no: 1, items: [{ question: "添付", type: "fileUpload", files: [{ name: "a.txt", url: "https://drive/F1" }] }] }] };
  const res = ctx.ExtAction_send_({
    url: "https://x/exec",
    payload,
    files: [{ question: "添付", name: "a.txt", driveFileId: "F1" }], // 旧 files param は無視される
  });
  assert.equal(res.ok, true);
  const sent = JSON.parse(captured.payload.payload);
  // 中継 payload は入力そのまま（ファイルは items[].files に既に内包）。サーバが files キーを生やさない。
  assert.deepEqual(sent, payload);
  assert.equal(sent.files, undefined);
});

test("ExtAction_send_ は宛先を確認できないとき本データを送らない（DEST_UNVERIFIED）", () => {
  for (const probeBody of [
    "<html>random site</html>",                                   // 無関係サイト（HTML）
    JSON.stringify({ ok: true }),                                  // ただの API
    JSON.stringify({ ok: true, nfbExternalAction: true, signature: hmacHex("NONCE_FIXED", "WRONG") }), // 別シークレット
  ]) {
    const calls = [];
    const ctx = loadContext((url, opts) => {
      calls.push({ url, opts });
      return httpResponse(200, probeBody);
    }, "S");
    const res = ctx.ExtAction_send_({ url: "https://wrong/exec", payload: { secretData: "x" } });
    assert.equal(res.ok, false);
    assert.equal(res.code, "DEST_UNVERIFIED");
    // プローブ 1 回のみ。本送信（2 回目）は行わない。
    assert.equal(calls.length, 1);
    assert.equal(calls[0].opts.payload.nfbProbe, "1");
  }
});
