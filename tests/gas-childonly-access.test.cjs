const assert = require("node:assert/strict");
const test = require("node:test");
const { loadGasFiles } = require("./helpers/gasVmLoader.cjs");

// 子フォーム専用（childOnly）フォームの直接アクセス遮断（gas/settings.gs DetermineAccess_）の回帰検証。
//   - childOnly フォームは pid（親リンク経由）が無い直接 URL アクセスを forbidden で遮断する
//   - childOnly でも pid 付きなら通常ユーザーモードで開ける
//   - 非 childOnly フォームは従来どおり pid 有無に関わらず開ける
//   - 存在しないフォームは form_not_found（childOnly 判定より前）
//
// DetermineAccess_ の依存（GetFormUrl_ / Forms_isChildOnlyForm_ 等）は本ファイルでスタブする。
function loadAccessContext({ formExists = true, childOnly = false } = {}) {
  const context = {
    console,
    Logger: { log() {} },
    GetFormUrl_: () => (formExists ? "https://drive.google.com/file/d/x/view" : null),
    Forms_isChildOnlyForm_: () => !!childOnly,
    // 以下は formParam ありの早期 return では到達しないが、念のためスタブ。
    Nfb_isAdminSettingsEnabled_: () => false,
    GetAdminKey_: () => "",
    IsAdminEmailMatched_: () => false,
  };
  return loadGasFiles(context, ["settings.gs"]);
}

// VM 越しの戻り値はプロトタイプが別レルムのため deepStrictEqual は使えない。フィールド毎に検証する。
function assertAccess(result, expected) {
  assert.equal(result.isAdmin, expected.isAdmin);
  assert.equal(result.formId, expected.formId);
  assert.equal(result.authError, expected.authError);
}

test("DetermineAccess_: 非 childOnly フォームは pid 無しでも開ける", () => {
  const ctx = loadAccessContext({ formExists: true, childOnly: false });
  const result = ctx.DetermineAccess_("form123", "", "user@example.com", "");
  assertAccess(result, { isAdmin: false, formId: "form123", authError: "" });
});

test("DetermineAccess_: childOnly フォームは pid 無しの直接アクセスを forbidden で遮断する", () => {
  const ctx = loadAccessContext({ formExists: true, childOnly: true });
  const result = ctx.DetermineAccess_("childForm", "", "user@example.com", "");
  assertAccess(result, { isAdmin: false, formId: "", authError: "forbidden" });
});

test("DetermineAccess_: childOnly フォームでも pid（親リンク経由）があれば開ける", () => {
  const ctx = loadAccessContext({ formExists: true, childOnly: true });
  const result = ctx.DetermineAccess_("childForm", "", "user@example.com", "parentRec001");
  assertAccess(result, { isAdmin: false, formId: "childForm", authError: "" });
});

test("DetermineAccess_: 存在しないフォームは childOnly 判定より前に form_not_found", () => {
  const ctx = loadAccessContext({ formExists: false, childOnly: true });
  const result = ctx.DetermineAccess_("missing", "", "user@example.com", "");
  assertAccess(result, { isAdmin: false, formId: "", authError: "form_not_found" });
});
