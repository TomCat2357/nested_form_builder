/**
 * Plan P4 / P5 管理者向け移行スクリプトの単体テスト。
 *
 * テスト対象は文字列処理 (Admin_rewriteNfbUdfsInExpressionString_) と
 * フォーム JSON 走査 (Admin_rewriteFormJson_) のみ。
 * シート I/O 系（Admin_migrateMetaDatetimesToSheetDates_）は GAS 環境必須なので
 * 単体テストでは扱わず、手動検証に委ねる。
 */

const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");
const fs = require("node:fs");
const vm = require("node:vm");

function loadAdminMigrations() {
  const ctx = { console };
  vm.createContext(ctx);
  const filePath = path.join(__dirname, "..", "gas", "adminMigrations.gs");
  vm.runInContext(fs.readFileSync(filePath, "utf8"), ctx, { filename: filePath });
  return ctx;
}

// ---------------------------------------------------------------------------
// Admin_rewriteNfbUdfsInExpressionString_
// ---------------------------------------------------------------------------

test("単純 rename: NFB_TIME_FORMAT(...) → TIME_FORMAT(...) かつ `_NOW` → NOW()", () => {
  const ctx = loadAdminMigrations();
  const fn = ctx.Admin_rewriteNfbUdfsInExpressionString_;
  assert.equal(
    fn("{NFB_TIME_FORMAT(`_NOW`, 'YYYY-MM-DD')}"),
    "{TIME_FORMAT(NOW(), 'YYYY-MM-DD')}"
  );
});

test("複数 rename を 1 回でまとめて処理", () => {
  const ctx = loadAdminMigrations();
  const fn = ctx.Admin_rewriteNfbUdfsInExpressionString_;
  const input = "NFB_KANA(`氏名`) || NFB_NUMBER_FORMAT(`金額`, '#,##0')";
  const expected = "KANA(`氏名`) || NUMBER_FORMAT(`金額`, '#,##0')";
  assert.equal(fn(input), expected);
});

test("CAST 展開: NFB_TO_BOOL(x) → CAST(x AS BOOLEAN)", () => {
  const ctx = loadAdminMigrations();
  const fn = ctx.Admin_rewriteNfbUdfsInExpressionString_;
  assert.equal(fn("NFB_TO_BOOL(`active`)"), "CAST(`active` AS BOOLEAN)");
});

test("CAST 展開: NFB_TO_NUMBER(x) → CAST(x AS NUMBER)", () => {
  const ctx = loadAdminMigrations();
  const fn = ctx.Admin_rewriteNfbUdfsInExpressionString_;
  assert.equal(fn("NFB_TO_NUMBER(`金額`)"), "CAST(`金額` AS NUMBER)");
});

test("IFNULL 展開: NFB_DEFAULT(x, y) → IFNULL(NULLIF(x, ''), y)", () => {
  const ctx = loadAdminMigrations();
  const fn = ctx.Admin_rewriteNfbUdfsInExpressionString_;
  assert.equal(
    fn("NFB_DEFAULT(`memo`, '未記入')"),
    "IFNULL(NULLIF(`memo`, ''), '未記入')"
  );
});

test("LPAD/RPAD rename: NFB_PAD_LEFT/RIGHT", () => {
  const ctx = loadAdminMigrations();
  const fn = ctx.Admin_rewriteNfbUdfsInExpressionString_;
  assert.equal(fn("NFB_PAD_LEFT(`no`, 5, '0')"), "LPAD(`no`, 5, '0')");
  assert.equal(fn("NFB_PAD_RIGHT(`code`, 8, ' ')"), "RPAD(`code`, 8, ' ')");
});

test("prefix-less PAD_LEFT / PAD_RIGHT も LPAD / RPAD に rename される", () => {
  const ctx = loadAdminMigrations();
  const fn = ctx.Admin_rewriteNfbUdfsInExpressionString_;
  assert.equal(fn("PAD_LEFT(`no`, 5, '0')"), "LPAD(`no`, 5, '0')");
  assert.equal(fn("PAD_RIGHT(`code`, 8, ' ')"), "RPAD(`code`, 8, ' ')");
});

test("DATE rename: NFB_PARSE_DATE → DATE / prefix-less PARSE_DATE → DATE", () => {
  const ctx = loadAdminMigrations();
  const fn = ctx.Admin_rewriteNfbUdfsInExpressionString_;
  assert.equal(fn("NFB_PARSE_DATE(`販売日`)"), "DATE(`販売日`)");
  assert.equal(fn("PARSE_DATE(`販売日`)"), "DATE(`販売日`)");
});

test("NFB_REGEX_TEST(x, p) → REGEXP_LIKE(x, p, 'i')（case-insensitive 維持）", () => {
  const ctx = loadAdminMigrations();
  const fn = ctx.Admin_rewriteNfbUdfsInExpressionString_;
  assert.equal(
    fn("NFB_REGEX_TEST(`text`, '\\d+')"),
    "REGEXP_LIKE(`text`, '\\d+', 'i')"
  );
});

test("NFB_REGEX_MATCH(x, p, i) → REGEXP_MATCH(x, p, i)", () => {
  const ctx = loadAdminMigrations();
  const fn = ctx.Admin_rewriteNfbUdfsInExpressionString_;
  assert.equal(
    fn("NFB_REGEX_MATCH(`text`, '(\\d+)', 1)"),
    "REGEXP_MATCH(`text`, '(\\d+)', 1)"
  );
});

test("REGEX_MATCH → REGEXP_MATCH rename（PR #164 後継）", () => {
  const ctx = loadAdminMigrations();
  const fn = ctx.Admin_rewriteNfbUdfsInExpressionString_;
  assert.equal(
    fn("REGEX_MATCH(`text`, '(\\d+)', 1)"),
    "REGEXP_MATCH(`text`, '(\\d+)', 1)"
  );
  // 識別子境界: REGEX_MATCH_EXTRA は別関数なので書き換えない
  assert.equal(fn("REGEX_MATCH_EXTRA(`x`)"), "REGEX_MATCH_EXTRA(`x`)");
});

test("REGEX_TEST(x, p) → REGEXP_LIKE(x, p, 'i')", () => {
  const ctx = loadAdminMigrations();
  const fn = ctx.Admin_rewriteNfbUdfsInExpressionString_;
  assert.equal(
    fn("REGEX_TEST(`氏名`, '田.*')"),
    "REGEXP_LIKE(`氏名`, '田.*', 'i')"
  );
});

test("REGEX_EXTRACT(x, p) / (x, p, i) → REGEXP_MATCH（2/3 引数互換）", () => {
  const ctx = loadAdminMigrations();
  const fn = ctx.Admin_rewriteNfbUdfsInExpressionString_;
  assert.equal(
    fn("REGEX_EXTRACT(`text`, '\\d+')"),
    "REGEXP_MATCH(`text`, '\\d+')"
  );
  assert.equal(
    fn("REGEX_EXTRACT(`text`, '(\\d+)', 1)"),
    "REGEXP_MATCH(`text`, '(\\d+)', 1)"
  );
});

test("REGEX_EXTRACT(x, p, i, flags) は書き換え不可 — 元式維持 + 警告", () => {
  const ctx = loadAdminMigrations();
  // console.warn を捕捉
  const warnings = [];
  const origWarn = ctx.console && ctx.console.warn;
  ctx.console = { warn: function(msg) { warnings.push(String(msg)); }, log: function() {} };
  const fn = ctx.Admin_rewriteNfbUdfsInExpressionString_;
  // 4 引数版（flags）は移行不可
  const result = fn("REGEX_EXTRACT(`text`, '(\\d+)', 1, 'i')");
  assert.equal(result, "REGEX_EXTRACT(`text`, '(\\d+)', 1, 'i')");
  assert.ok(warnings.length >= 1, "should emit a warning");
  assert.match(warnings[0], /REGEX_EXTRACT/);
  if (origWarn) ctx.console.warn = origWarn;
});

test("REGEX_EXTRACT_ALL は廃止 — 元式維持 + 警告", () => {
  const ctx = loadAdminMigrations();
  const warnings = [];
  ctx.console = { warn: function(msg) { warnings.push(String(msg)); }, log: function() {} };
  const fn = ctx.Admin_rewriteNfbUdfsInExpressionString_;
  const result = fn("REGEX_EXTRACT_ALL(`text`, '\\d+')");
  assert.equal(result, "REGEX_EXTRACT_ALL(`text`, '\\d+')");
  assert.ok(warnings.length >= 1, "should emit a warning");
  assert.match(warnings[0], /REGEX_EXTRACT_ALL/);
});

test("DATE_BIN 展開: (NFB_)DATE_BIN(x, n) → SUBSTRING(DATETIME(x), 1, n)", () => {
  const ctx = loadAdminMigrations();
  const fn = ctx.Admin_rewriteNfbUdfsInExpressionString_;
  assert.equal(
    fn("NFB_DATE_BIN(`createdAt`, 7)"),
    "SUBSTRING(DATETIME(`createdAt`), 1, 7)"
  );
  assert.equal(
    fn("DATE_BIN(`createdAt`, 10)"),
    "SUBSTRING(DATETIME(`createdAt`), 1, 10)"
  );
  // 引数省略時は 10（YYYY-MM-DD）
  assert.equal(
    fn("DATE_BIN(`createdAt`)"),
    "SUBSTRING(DATETIME(`createdAt`), 1, 10)"
  );
});

test("TIME_SECONDS 展開: TIME_SECONDS(x) → (HOUR(x)*3600 + MINUTE(x)*60 + SECOND(x))", () => {
  const ctx = loadAdminMigrations();
  const fn = ctx.Admin_rewriteNfbUdfsInExpressionString_;
  assert.equal(
    fn("TIME_SECONDS(`受付時刻`)"),
    "(HOUR(`受付時刻`) * 3600 + MINUTE(`受付時刻`) * 60 + SECOND(`受付時刻`))"
  );
});

test("DATETIME2ERA / ERA2DATETIME の改名（DATE2ERA / ERA2DATE は据え置き）", () => {
  const ctx = loadAdminMigrations();
  const fn = ctx.Admin_rewriteNfbUdfsInExpressionString_;
  assert.equal(fn("DATETIME2ERA(`createdAt`)"), "DATETIME2ERATIME(`createdAt`)");
  assert.equal(fn("ERA2DATETIME(`和暦`)"), "ERATIME2DATETIME(`和暦`)");
  // 据え置きの DATE2ERA / ERA2DATE は誤って巻き込まない
  assert.equal(fn("DATE2ERA(`d`)"), "DATE2ERA(`d`)");
  assert.equal(fn("ERA2DATE(`d`)"), "ERA2DATE(`d`)");
  // 既に新名のものは二重リネームしない
  assert.equal(fn("DATETIME2ERATIME(`d`)"), "DATETIME2ERATIME(`d`)");
  assert.equal(fn("ERATIME2DATETIME(`d`)"), "ERATIME2DATETIME(`d`)");
});

test("識別子の境界条件: 単語の一部はマッチさせない", () => {
  const ctx = loadAdminMigrations();
  const fn = ctx.Admin_rewriteNfbUdfsInExpressionString_;
  // NFB_KANA_EXTRA は別の識別子。書き換えない。
  assert.equal(fn("NFB_KANA_EXTRA(`x`)"), "NFB_KANA_EXTRA(`x`)");
});

test("関数呼び出しでない箇所は書き換えない", () => {
  const ctx = loadAdminMigrations();
  const fn = ctx.Admin_rewriteNfbUdfsInExpressionString_;
  // identifier 単独（直後 '(' なし）は素通し
  assert.equal(fn("NFB_KANA"), "NFB_KANA");
});

test("ネストした関数呼び出しでも正しく展開", () => {
  const ctx = loadAdminMigrations();
  const fn = ctx.Admin_rewriteNfbUdfsInExpressionString_;
  // NFB_TO_BOOL が中にあるケース
  assert.equal(
    fn("IIF(NFB_TO_BOOL(`active`), '有効', '無効')"),
    "IIF(CAST(`active` AS BOOLEAN), '有効', '無効')"
  );
});

test("空文字列・null は変換せず返す", () => {
  const ctx = loadAdminMigrations();
  const fn = ctx.Admin_rewriteNfbUdfsInExpressionString_;
  assert.equal(fn(""), "");
  assert.equal(fn(null), null);
});

// ---------------------------------------------------------------------------
// Admin_rewriteFormJson_
// ---------------------------------------------------------------------------

test("Admin_rewriteFormJson_: 再帰的にネストしたテキストフィールドを置換", () => {
  const ctx = loadAdminMigrations();
  const form = {
    description: "{NFB_TIME_FORMAT(`_NOW`, 'YYYY-MM-DD')} 受付",
    schema: [
      {
        type: "computed",
        template: "NFB_KANA(`氏名`)",
        children: [
          { template: "NFB_TO_BOOL(`active`)" },
        ],
      },
    ],
  };
  const changed = ctx.Admin_rewriteFormJson_(form);
  assert.equal(changed, true);
  assert.equal(form.description, "{TIME_FORMAT(NOW(), 'YYYY-MM-DD')} 受付");
  assert.equal(form.schema[0].template, "KANA(`氏名`)");
  assert.equal(form.schema[0].children[0].template, "CAST(`active` AS BOOLEAN)");
});

test("Admin_rewriteFormJson_: 変更なしのときは false を返す", () => {
  const ctx = loadAdminMigrations();
  const form = {
    description: "Just a plain description",
    schema: [{ type: "text", label: "氏名" }],
  };
  const changed = ctx.Admin_rewriteFormJson_(form);
  assert.equal(changed, false);
});

// ---------------------------------------------------------------------------
// Admin_rewriteTemplateBraces_ — 単一 {...} → 二重 {{...}} 移行
// ---------------------------------------------------------------------------

test("Admin_rewriteTemplateBraces_: 単一ブレースを二重ブレースに変換", () => {
  const ctx = loadAdminMigrations();
  const fn = ctx.Admin_rewriteTemplateBraces_;
  assert.equal(fn("{`氏名`}"), "{{`氏名`}}");
  assert.equal(fn("Hello {`氏名`}!"), "Hello {{`氏名`}}!");
  assert.equal(fn("{`姓` || `名`}"), "{{`姓` || `名`}}");
});

test("Admin_rewriteTemplateBraces_: 既に {{...}} は冪等（再実行安全）", () => {
  const ctx = loadAdminMigrations();
  const fn = ctx.Admin_rewriteTemplateBraces_;
  assert.equal(fn("{{`氏名`}}"), "{{`氏名`}}");
  assert.equal(fn(fn("{`氏名`}")), "{{`氏名`}}");
});

test("Admin_rewriteTemplateBraces_: ネストは外側ペアのみ二重化", () => {
  const ctx = loadAdminMigrations();
  const fn = ctx.Admin_rewriteTemplateBraces_;
  assert.equal(fn("{IIF(`a`>0, 'x', 'y')}"), "{{IIF(`a`>0, 'x', 'y')}}");
  assert.equal(fn("{f({x:1})}"), "{{f({x:1})}}");
});

test("Admin_rewriteTemplateBraces_: \{ \} エスケープは保持", () => {
  const ctx = loadAdminMigrations();
  const fn = ctx.Admin_rewriteTemplateBraces_;
  assert.equal(fn("\\{literal\\}"), "\\{literal\\}");
  assert.equal(fn("\\{lit\\} {`x`}"), "\\{lit\\} {{`x`}}");
});

test("Admin_rewriteTemplateBraces_: 不均衡な { は放置", () => {
  const ctx = loadAdminMigrations();
  const fn = ctx.Admin_rewriteTemplateBraces_;
  assert.equal(fn("未閉じ {`x`"), "未閉じ {`x`");
  assert.equal(fn("{ が無い文"), "{ が無い文");
});

test("Admin_rewriteTemplateBraces_: 複数トークン", () => {
  const ctx = loadAdminMigrations();
  const fn = ctx.Admin_rewriteTemplateBraces_;
  assert.equal(fn("{`a`}-{`b`}"), "{{`a`}}-{{`b`}}");
});

test("Admin_rewriteFormTemplateBraces_: テンプレキーのみ書き換え、ラベル等は触らない", () => {
  const ctx = loadAdminMigrations();
  const form = {
    schema: [
      { id: "q1", type: "text", label: "予算{2024}" }, // ラベルはテンプレキーでない → 不変
      { id: "q2", type: "substitution", templateText: "Hello {`氏名`}" },
      { id: "q3", type: "printTemplate", printTemplateAction: { fileNameTemplate: "{`_id`}_出力", gmailTemplateBody: "本文 {`氏名`} 様" } },
    ],
    settings: { standardPrintFileNameTemplate: "様式_{`_id`}" },
  };
  const changed = ctx.Admin_rewriteFormTemplateBraces_(form);
  assert.equal(changed, true);
  assert.equal(form.schema[0].label, "予算{2024}"); // ラベルは不変
  assert.equal(form.schema[1].templateText, "Hello {{`氏名`}}");
  assert.equal(form.schema[2].printTemplateAction.fileNameTemplate, "{{`_id`}}_出力");
  assert.equal(form.schema[2].printTemplateAction.gmailTemplateBody, "本文 {{`氏名`}} 様");
  assert.equal(form.settings.standardPrintFileNameTemplate, "様式_{{`_id`}}");
});

test("Admin_rewriteFormTemplateBraces_: 変更が無ければ false", () => {
  const ctx = loadAdminMigrations();
  const form = { schema: [{ id: "q1", type: "substitution", templateText: "{{`氏名`}}" }] };
  assert.equal(ctx.Admin_rewriteFormTemplateBraces_(form), false);
});
