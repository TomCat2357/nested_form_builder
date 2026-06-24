import assert from "node:assert/strict";
import test from "node:test";
import {
  isValidExternalActionUrl,
  migrateLegacyExternalActionUrlTokens,
  hasBlockedSensitiveRefs,
  buildSpreadsheetUrl,
  buildDocumentUrl,
  SENSITIVE_RESERVED_REFS,
} from "./externalActionUrl.js";

test("buildDocumentUrl は素 fileId から Doc 編集 URL を組み立て、空は空文字を返す", () => {
  assert.equal(buildDocumentUrl("doc123"), "https://docs.google.com/document/d/doc123/edit");
  assert.equal(buildDocumentUrl(""), "");
  assert.equal(buildDocumentUrl(null), "");
});

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

// --- 旧・単括弧固定トークン → alasql 予約参照への自動マップ ---

test("migrateLegacyExternalActionUrlTokens は 8 種の旧トークンを予約参照へマップする", () => {
  const url = "https://x.com/?id={id}&fid={formId}&fn={formName}"
    + "&ssid={spreadsheetId}&ssu={spreadsheetUrl}&sn={sheetName}&du={driveFileUrl}&ue={userEmail}";
  assert.equal(
    migrateLegacyExternalActionUrlTokens(url),
    "https://x.com/?id={{`_id`}}&fid={{`_form_id`}}&fn={{`_form_name`}}"
      + "&ssid={{`_spreadsheet_id`}}&ssu={{`_spreadsheet_url`}}&sn={{`_sheet_name`}}&du={{`_drive_file_url`}}&ue={{`_user_email`}}",
  );
});

test("migrateLegacyExternalActionUrlTokens は冪等（既に {{...}} のものは触らない）", () => {
  const url = "https://x.com/?id={{`_id`}}&name={{`氏名`}}";
  assert.equal(migrateLegacyExternalActionUrlTokens(url), url);
});

test("migrateLegacyExternalActionUrlTokens は二重括弧内の擬似トークンを壊さない", () => {
  // {{id}} は前後がブレースなので旧トークンとして拾わない。
  const url = "https://x.com/?a={{id}}";
  assert.equal(migrateLegacyExternalActionUrlTokens(url), url);
});

test("migrateLegacyExternalActionUrlTokens はトークンが無ければそのまま返す", () => {
  assert.equal(migrateLegacyExternalActionUrlTokens("https://x.com/path?a=1"), "https://x.com/path?a=1");
  assert.equal(migrateLegacyExternalActionUrlTokens(""), "");
  assert.equal(migrateLegacyExternalActionUrlTokens(null), "");
});

// --- 機微予約トークンのゲート判定 ---

test("hasBlockedSensitiveRefs は許可なしで機微参照を弾く", () => {
  assert.equal(hasBlockedSensitiveRefs(["_spreadsheet_id"], { adminOnly: false, isAdmin: false }), true);
  assert.equal(hasBlockedSensitiveRefs(["_id", "_user_email"], { adminOnly: true, isAdmin: false }), true);
  assert.equal(hasBlockedSensitiveRefs(["_id", "_drive_file_url"], { adminOnly: false, isAdmin: true }), true);
});

test("hasBlockedSensitiveRefs は adminOnly && isAdmin で許可する", () => {
  assert.equal(hasBlockedSensitiveRefs(["_spreadsheet_id", "_user_email"], { adminOnly: true, isAdmin: true }), false);
});

test("hasBlockedSensitiveRefs は非機微トークンのみなら常に許可", () => {
  assert.equal(hasBlockedSensitiveRefs(["_id", "_form_id", "_form_name"], { adminOnly: false, isAdmin: false }), false);
  assert.equal(hasBlockedSensitiveRefs([], { adminOnly: false, isAdmin: false }), false);
});

test("SENSITIVE_RESERVED_REFS は機微 5 種を含む", () => {
  ["_spreadsheet_id", "_spreadsheet_url", "_sheet_name", "_drive_file_url", "_user_email"]
    .forEach((name) => assert.equal(SENSITIVE_RESERVED_REFS.has(name), true));
  assert.equal(SENSITIVE_RESERVED_REFS.has("_id"), false);
  assert.equal(SENSITIVE_RESERVED_REFS.has("_form_id"), false);
});

test("buildSpreadsheetUrl は spreadsheetId からドキュメント URL を組む", () => {
  assert.equal(buildSpreadsheetUrl("ABC_123"), "https://docs.google.com/spreadsheets/d/ABC_123");
  assert.equal(buildSpreadsheetUrl(""), "");
});
