const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadStrictParserContext() {
  const context = {
    console,
    Logger: { log() {} },
    Utilities: {
      formatDate: () => "",
    },
    Date,
    NFB_TZ: "Asia/Tokyo",
    NFB_MS_PER_DAY: 86400000,
    NFB_JST_OFFSET_MS: 9 * 60 * 60 * 1000,
    NFB_SHEETS_EPOCH_MS: Date.UTC(1899, 11, 30) - 9 * 60 * 60 * 1000,
  };

  vm.createContext(context);

  const projectRoot = path.join(__dirname, "..");
  const code = fs.readFileSync(path.join(projectRoot, "gas", "sheetsDatetime.gs"), "utf8");
  vm.runInContext(code, context, { filename: "sheetsDatetime.gs" });

  return context;
}

const ctx = loadStrictParserContext();

test("Sheets_toStrictUnixMs_ は13桁のUnix msをそのまま返す", () => {
  const unixMs = Date.UTC(2026, 0, 1, 0, 0, 0);
  assert.equal(ctx.Sheets_toStrictUnixMs_(unixMs), unixMs);
});

test("Sheets_toStrictUnixMs_ は1e11以上の値を ms として通す", () => {
  assert.equal(ctx.Sheets_toStrictUnixMs_(100000000000), 100000000000);
  assert.equal(ctx.Sheets_toStrictUnixMs_(174608640000), 174608640000); // 1桁削減
});

test("Sheets_toStrictUnixMs_ は10〜11桁の値を null にする（Unix秒として ×1000 しない）", () => {
  assert.equal(ctx.Sheets_toStrictUnixMs_(99999999999), null);
  assert.equal(ctx.Sheets_toStrictUnixMs_(1746086400), null); // Unix 秒
  assert.equal(ctx.Sheets_toStrictUnixMs_(17460864000), null);
});

test("Sheets_toStrictUnixMs_ は1〜9桁の値を null にする（Excel シリアル値解釈をしない）", () => {
  assert.equal(ctx.Sheets_toStrictUnixMs_(46000), null);
  assert.equal(ctx.Sheets_toStrictUnixMs_(17460864), null); // 5桁削減
  assert.equal(ctx.Sheets_toStrictUnixMs_(1), null);
  assert.equal(ctx.Sheets_toStrictUnixMs_(0), null);
});

test("Sheets_toStrictUnixMs_ は Date オブジェクトを getTime() で返す", () => {
  const d = new Date(Date.UTC(2026, 0, 1, 0, 0, 0));
  assert.equal(ctx.Sheets_toStrictUnixMs_(d), d.getTime());
});

test("Sheets_toStrictUnixMs_ は数字のみの文字列を数値ルールで判定する", () => {
  const unixMs = Date.UTC(2026, 0, 1, 0, 0, 0);
  assert.equal(ctx.Sheets_toStrictUnixMs_(String(unixMs)), unixMs);
  assert.equal(ctx.Sheets_toStrictUnixMs_("17460864"), null);
});

test("Sheets_toStrictUnixMs_ は null/undefined/空文字を null にする", () => {
  assert.equal(ctx.Sheets_toStrictUnixMs_(null), null);
  assert.equal(ctx.Sheets_toStrictUnixMs_(undefined), null);
  assert.equal(ctx.Sheets_toStrictUnixMs_(""), null);
  assert.equal(ctx.Sheets_toStrictUnixMs_("   "), null);
  assert.equal(ctx.Sheets_toStrictUnixMs_(NaN), null);
});
