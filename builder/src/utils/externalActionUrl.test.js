import assert from "node:assert/strict";
import test from "node:test";
import { resolveExternalActionUrl, isValidExternalActionUrl } from "./externalActionUrl.js";

test("isValidExternalActionUrl は http / https を受理する", () => {
  assert.equal(isValidExternalActionUrl("http://example.com"), true);
  assert.equal(isValidExternalActionUrl("https://example.com"), true);
  assert.equal(isValidExternalActionUrl("  https://example.com  "), true);
});

test("isValidExternalActionUrl は http(s) 以外と空を弾く", () => {
  assert.equal(isValidExternalActionUrl("javascript:alert(1)"), false);
  assert.equal(isValidExternalActionUrl("data:text/html,foo"), false);
  assert.equal(isValidExternalActionUrl("ftp://example.com"), false);
  assert.equal(isValidExternalActionUrl(""), false);
  assert.equal(isValidExternalActionUrl(null), false);
  assert.equal(isValidExternalActionUrl(undefined), false);
});

test("resolveExternalActionUrl はトークンを encodeURIComponent で置換する", () => {
  const url = "https://script.google.com/exec?id={id}&form={formId}";
  const out = resolveExternalActionUrl(url, { id: "r_01H/abc", formId: "f_001" });
  assert.equal(out, "https://script.google.com/exec?id=r_01H%2Fabc&form=f_001");
});

test("resolveExternalActionUrl は formName を URL エンコードする", () => {
  const url = "https://example.com/run?name={formName}";
  const out = resolveExternalActionUrl(url, { formName: "ヒグマ 講座" });
  assert.equal(out, "https://example.com/run?name=" + encodeURIComponent("ヒグマ 講座"));
});

test("resolveExternalActionUrl は欠落トークンを空文字に置換する", () => {
  const url = "https://example.com/x?id={id}&form={formId}";
  const out = resolveExternalActionUrl(url, { formId: "f1" });
  assert.equal(out, "https://example.com/x?id=&form=f1");
});

test("resolveExternalActionUrl は空/空白の URL に null を返す", () => {
  assert.equal(resolveExternalActionUrl("", {}), null);
  assert.equal(resolveExternalActionUrl("   ", {}), null);
  assert.equal(resolveExternalActionUrl(null, {}), null);
});

test("resolveExternalActionUrl は http(s) で始まらない URL に null を返す", () => {
  assert.equal(resolveExternalActionUrl("javascript:alert(1)", {}), null);
  assert.equal(resolveExternalActionUrl("//example.com", {}), null);
  assert.equal(resolveExternalActionUrl("ftp://example.com", {}), null);
});

test("resolveExternalActionUrl はトークン経由でも非 http スキームへの変換を許さない", () => {
  // ベースが https なら、token 内の文字列はクエリ値として encodeURIComponent され、スキーム侵害は起きない
  const url = "https://x.com?q={id}";
  assert.equal(
    resolveExternalActionUrl(url, { id: "javascript:bad" }),
    "https://x.com?q=" + encodeURIComponent("javascript:bad"),
  );
});

test("resolveExternalActionUrl はトークンが無ければ URL をそのまま返す", () => {
  assert.equal(
    resolveExternalActionUrl("https://example.com/path?a=1", {}),
    "https://example.com/path?a=1",
  );
});

// --- 機微トークン (admin only) のテスト ---

test("機微トークンは adminOnly && isAdmin で展開される (spreadsheetId)", () => {
  const url = "https://example.com/?ssid={spreadsheetId}";
  const out = resolveExternalActionUrl(
    url,
    { spreadsheetId: "1abcDEF_123" },
    { adminOnly: true, isAdmin: true },
  );
  assert.equal(out, "https://example.com/?ssid=1abcDEF_123");
});

test("機微トークンは adminOnly && isAdmin で展開される (sheetName)", () => {
  const url = "https://example.com/?sheet={sheetName}";
  const out = resolveExternalActionUrl(
    url,
    { sheetName: "Data" },
    { adminOnly: true, isAdmin: true },
  );
  assert.equal(out, "https://example.com/?sheet=Data");
});

test("機微トークンは adminOnly && isAdmin で展開される (driveFileUrl / userEmail)", () => {
  const url = "https://example.com/?file={driveFileUrl}&u={userEmail}";
  const out = resolveExternalActionUrl(
    url,
    { driveFileUrl: "https://drive.google.com/x", userEmail: "a+b@example.com" },
    { adminOnly: true, isAdmin: true },
  );
  assert.equal(
    out,
    "https://example.com/?file=" + encodeURIComponent("https://drive.google.com/x") + "&u=" + encodeURIComponent("a+b@example.com"),
  );
});

test("spreadsheetUrl は context.spreadsheetId から構築される", () => {
  const url = "https://example.com/?u={spreadsheetUrl}";
  const out = resolveExternalActionUrl(
    url,
    { spreadsheetId: "ABC_123" },
    { adminOnly: true, isAdmin: true },
  );
  assert.equal(out, "https://example.com/?u=" + encodeURIComponent("https://docs.google.com/spreadsheets/d/ABC_123"));
});

test("spreadsheetUrl は spreadsheetId 空のとき空文字に置換される", () => {
  const url = "https://example.com/?u={spreadsheetUrl}";
  const out = resolveExternalActionUrl(
    url,
    { spreadsheetId: "" },
    { adminOnly: true, isAdmin: true },
  );
  assert.equal(out, "https://example.com/?u=");
});

test("機微トークンは adminOnly=true, isAdmin=false で URL 全体を null 化", () => {
  const url = "https://example.com/?ssid={spreadsheetId}";
  const out = resolveExternalActionUrl(
    url,
    { spreadsheetId: "ABC" },
    { adminOnly: true, isAdmin: false },
  );
  assert.equal(out, null);
});

test("機微トークンは adminOnly=false, isAdmin=true で URL 全体を null 化", () => {
  const url = "https://example.com/?ssid={spreadsheetId}";
  const out = resolveExternalActionUrl(
    url,
    { spreadsheetId: "ABC" },
    { adminOnly: false, isAdmin: true },
  );
  assert.equal(out, null);
});

test("第 3 引数省略時 (既存 API 形) は機微トークン使用で null", () => {
  const url = "https://example.com/?ssid={spreadsheetId}";
  const out = resolveExternalActionUrl(url, { spreadsheetId: "ABC" });
  assert.equal(out, null);
});

test("第 3 引数省略時でも既存トークンは展開される (後方互換)", () => {
  const url = "https://example.com/?id={id}&form={formId}";
  const out = resolveExternalActionUrl(url, { id: "r1", formId: "f1" });
  assert.equal(out, "https://example.com/?id=r1&form=f1");
});

test("同じ機微トークンが複数回現れても全て置換される", () => {
  const url = "https://example.com/?a={spreadsheetId}&b={spreadsheetId}";
  const out = resolveExternalActionUrl(
    url,
    { spreadsheetId: "ABC" },
    { adminOnly: true, isAdmin: true },
  );
  assert.equal(out, "https://example.com/?a=ABC&b=ABC");
});

test("既存トークンと機微トークン混在 (adminOnly && isAdmin)", () => {
  const url = "https://example.com/?id={id}&ssid={spreadsheetId}&email={userEmail}";
  const out = resolveExternalActionUrl(
    url,
    { id: "r1", spreadsheetId: "ABC", userEmail: "u@example.com" },
    { adminOnly: true, isAdmin: true },
  );
  assert.equal(out, "https://example.com/?id=r1&ssid=ABC&email=" + encodeURIComponent("u@example.com"));
});
