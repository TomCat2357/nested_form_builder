const assert = require("node:assert/strict");
const test = require("node:test");
const { loadGasFiles } = require("./helpers/gasVmLoader.cjs");

// formId → spreadsheetId のサーバ側解決（gas/formsCrud.gs）と、非管理者クライアントへの
// spreadsheetId ストリップ（gas/formsPublicApi.gs）の回帰検証。
// 機微情報 spreadsheetId はクライアントから送らせず、GAS が formId から権威的に解決する。

function loadResolverContext() {
  const context = {
    console,
    Logger: { log() {} },
    NFB_DEFAULT_SHEET_NAME: "Data",
    Model_normalizeSpreadsheetId_: (v) => {
      var s = String(v || "").trim();
      var m = s.match(/\/d\/([a-zA-Z0-9-_]+)/);
      return m ? m[1] : s;
    },
    // 物理優先解決の生存判定（本体は standardFolders.gs）。既定では非空 id を生存扱い。
    // 物理死亡時の論理フォールバックを試すテストは個別に差し替える。
    StdFolders_isFileIdAlive_: (id) => !!id,
    // Forms_getForm_ は formsCrud.gs 内で再定義されるが、テストでは __forms から引く版へ載せ替える。
    __forms: {},
    __getFormCalls: {},
  };
  const ctx = loadGasFiles(context, ["formsCrud.gs"]);
  // load 後に Forms_getForm_ を差し替え（Nfb_getFormCached_ は呼び出し時に global を解決する）。
  ctx.Forms_getForm_ = function (formId) {
    ctx.__getFormCalls[formId] = (ctx.__getFormCalls[formId] || 0) + 1;
    return ctx.__forms[formId] || null;
  };
  return ctx;
}

test("Nfb_resolveFormSheetTarget_: form 設定から spreadsheetId/sheetName を解決", () => {
  const ctx = loadResolverContext();
  ctx.Nfb_resetFormRequestCache_();
  ctx.__forms.f1 = { settings: { spreadsheetId: "ss_abc", sheetName: "回答" } };

  const target = ctx.Nfb_resolveFormSheetTarget_("f1");
  assert.equal(target.spreadsheetId, "ss_abc");
  assert.equal(target.sheetName, "回答");
});

test("Nfb_resolveFormSheetTarget_: URL 形式の spreadsheetId を正規化、sheetName 未設定は既定", () => {
  const ctx = loadResolverContext();
  ctx.Nfb_resetFormRequestCache_();
  ctx.__forms.f1 = { settings: { spreadsheetId: "https://docs.google.com/spreadsheets/d/ss_xyz/edit" } };

  const target = ctx.Nfb_resolveFormSheetTarget_("f1");
  assert.equal(target.spreadsheetId, "ss_xyz");
  assert.equal(target.sheetName, "Data");
});

test("Nfb_resolveFormSheetTarget_: spreadsheetId 未設定/未解決フォームは null", () => {
  const ctx = loadResolverContext();
  ctx.Nfb_resetFormRequestCache_();
  ctx.__forms.f1 = { settings: { sheetName: "Data" } };

  assert.equal(ctx.Nfb_resolveFormSheetTarget_("f1"), null);
  assert.equal(ctx.Nfb_resolveFormSheetTarget_("missing"), null);
  assert.equal(ctx.Nfb_resolveFormSheetTarget_(""), null);
});

test("Nfb_resolveFormSheetTarget_: 物理優先（spreadsheetId 生存）→ 論理（spreadsheetPath）フォールバック", () => {
  const ctx = loadResolverContext();
  // 04_spreadsheets 配下の論理パス → fileId 解決をスタブ（standardFolders.gs は未ロード）。
  ctx.StdFolders_resolveSpreadsheetPathToFileId_ = (p) => (p === "売上/集計" ? "ss_from_path" : "");

  // A) 物理（spreadsheetId）が生存 → path より物理を優先（二重持ち・物理優先）。
  ctx.StdFolders_isFileIdAlive_ = (id) => id === "ss_direct";
  ctx.Nfb_resetFormRequestCache_();
  ctx.__forms.f1 = { settings: { spreadsheetPath: "売上/集計", spreadsheetId: "ss_direct", sheetName: "回答" } };
  let target = ctx.Nfb_resolveFormSheetTarget_("f1");
  assert.equal(target.spreadsheetId, "ss_direct", "物理が生存していれば物理を優先");
  assert.equal(target.sheetName, "回答");

  // B) 物理が死亡 → 論理パスでフォールバック解決し、物理は採用しない。
  ctx.StdFolders_isFileIdAlive_ = () => false;
  ctx.Nfb_resetFormRequestCache_();
  ctx.__forms.f2 = { settings: { spreadsheetPath: "売上/集計", spreadsheetId: "ss_dead" } };
  assert.equal(ctx.Nfb_resolveFormSheetTarget_("f2").spreadsheetId, "ss_from_path", "物理死亡時は論理パスへフォールバック");

  // C) 物理死亡・論理も未解決 → null（空リンク扱い）。
  ctx.StdFolders_isFileIdAlive_ = () => false;
  ctx.Nfb_resetFormRequestCache_();
  ctx.__forms.f3 = { settings: { spreadsheetPath: "無い/パス", spreadsheetId: "ss_dead" } };
  assert.equal(ctx.Nfb_resolveFormSheetTarget_("f3"), null);

  // D) 物理空・論理解決可能 → 論理パス。
  ctx.StdFolders_isFileIdAlive_ = (id) => !!id;
  ctx.Nfb_resetFormRequestCache_();
  ctx.__forms.f4 = { settings: { spreadsheetPath: "売上/集計", spreadsheetId: "" } };
  assert.equal(ctx.Nfb_resolveFormSheetTarget_("f4").spreadsheetId, "ss_from_path");
});

test("Nfb_getFormCached_: 同一リクエスト内は 1 回だけ Forms_getForm_ を呼ぶ", () => {
  const ctx = loadResolverContext();
  ctx.Nfb_resetFormRequestCache_();
  ctx.__forms.f1 = { settings: { spreadsheetId: "ss_abc" } };

  ctx.Nfb_getFormCached_("f1");
  ctx.Nfb_getFormCached_("f1");
  ctx.Nfb_resolveFormSheetTarget_("f1");
  assert.equal(ctx.__getFormCalls.f1, 1);

  // リセットで再読込される
  ctx.Nfb_resetFormRequestCache_();
  ctx.Nfb_getFormCached_("f1");
  assert.equal(ctx.__getFormCalls.f1, 2);
});

// === 非管理者ストリップ（gas/formsPublicApi.gs） ===

function loadStripContext({ isAdmin = false } = {}) {
  const context = {
    console,
    Logger: { log() {} },
    Model_normalizeSpreadsheetId_: (v) => String(v || "").trim(),
    Nfb_isAdminFromCtx_: () => isAdmin,
    // FORMS_HANDLERS_ の run が依存する外部ヘルパをスタブ。
    // Nfb_requireField_ は本来 gas/errors.gs 定義（forms_get/copy/import の必須検証で使用）。
    Nfb_requireField_: (raw, key, msg) => ((raw && raw[key]) ? null : { ok: false, error: msg }),
    __forms: {},
    __list: [],
  };
  context.Forms_getForm_ = function (formId) { return context.__forms[formId] || null; };
  context.Forms_listForms_ = function () { return { forms: context.__list, loadFailures: [] }; };
  // forms_list ハンドラが folders 派生に使う外部ヘルパ（本体は gas/formsFolderStore.gs）。
  // この回帰テストは spreadsheetId ストリップのみが対象なので空配列で十分。
  context.Forms_collectFolders_ = function () { return []; };
  return loadGasFiles(context, ["formsPublicApi.gs"]);
}

const formWithSheet = () => ({ id: "f1", settings: { spreadsheetId: "ss_secret", sheetName: "Data" } });

test("Forms_dispatch_ forms_get: 非管理者には spreadsheetId を伏せ hasSpreadsheet を付与", () => {
  const ctx = loadStripContext({ isAdmin: false });
  ctx.__forms.f1 = formWithSheet();

  const res = ctx.Forms_dispatch_("forms_get", { raw: { formId: "f1" } });
  assert.equal(res.ok, true);
  assert.equal("spreadsheetId" in res.form.settings, false);
  assert.equal(res.form.settings.hasSpreadsheet, true);
});

test("Forms_dispatch_ forms_get: 論理パス（spreadsheetPath）のみでも hasSpreadsheet=true・両キーを伏せる", () => {
  const ctx = loadStripContext({ isAdmin: false });
  ctx.__forms.f1 = { id: "f1", settings: { spreadsheetPath: "売上/集計", sheetName: "Data" } };

  const res = ctx.Forms_dispatch_("forms_get", { raw: { formId: "f1" } });
  assert.equal(res.ok, true);
  assert.equal("spreadsheetId" in res.form.settings, false);
  assert.equal("spreadsheetPath" in res.form.settings, false, "論理パスも伏せる");
  assert.equal(res.form.settings.hasSpreadsheet, true);
});

test("Forms_dispatch_ forms_get: formId 欠落時は Nfb_requireField_ 経由で必須エラーを返す", () => {
  const ctx = loadStripContext({ isAdmin: false });
  const res = ctx.Forms_dispatch_("forms_get", { raw: {} });
  assert.equal(res.ok, false);
  assert.equal(res.error, "フォームIDが指定されていません");
});

test("Forms_dispatch_ forms_get: 管理者には spreadsheetId をそのまま返す", () => {
  const ctx = loadStripContext({ isAdmin: true });
  ctx.__forms.f1 = formWithSheet();

  const res = ctx.Forms_dispatch_("forms_get", { raw: { formId: "f1" } });
  assert.equal(res.ok, true);
  assert.equal(res.form.settings.spreadsheetId, "ss_secret");
});

test("Forms_dispatch_ forms_list: 非管理者には配列の全フォームから spreadsheetId を伏せる", () => {
  const ctx = loadStripContext({ isAdmin: false });
  ctx.__list = [
    { id: "f1", settings: { spreadsheetId: "ss1", sheetName: "Data" } },
    { id: "f2", settings: { sheetName: "Data" } },
  ];

  const res = ctx.Forms_dispatch_("forms_list", { raw: {} });
  assert.equal(res.ok, true);
  assert.equal("spreadsheetId" in res.forms[0].settings, false);
  assert.equal(res.forms[0].settings.hasSpreadsheet, true);
  assert.equal("spreadsheetId" in res.forms[1].settings, false);
  assert.equal(res.forms[1].settings.hasSpreadsheet, false);
});
