const assert = require("node:assert/strict");
const test = require("node:test");
const { loadGasFiles } = require("./helpers/gasVmLoader.cjs");

// gas/sheetsDatetime.gs（Sheets_toStrictUnixMs_ / Sheets_sheetDateCellToCanonical_ など）と
// gas/codeHandlers.gs（SerializeRecord_ / SerializeDataValue_）を同一 vm コンテキストにロードして
// レコードシリアライズの回帰を検証する。
//
// 回帰の趣旨: 旧 SerializeDateLike_ は既に canonical 化された data 値（"14:50:00" 等）を
// Sheets_parseDateLikeToJstDate_ → Date → toISOString() で "1899-12-30T05:50:00.000Z" に
// 再変換してしまい、分析（alasql）側で time 型が "1899-12-30" / "00:00:00" になっていた。
// 修正後は data 値はそのまま（canonical 文字列）通り、生 Date のみ canonical 文字列化する。
function loadContext() {
  const context = {
    console,
    Logger: { log() {} },
    Utilities: { formatDate: () => "" },
    Date,
    NFB_TZ: "Asia/Tokyo",
    NFB_MS_PER_DAY: 24 * 60 * 60 * 1000,
    NFB_JST_OFFSET_MS: 9 * 60 * 60 * 1000,
    NFB_SHEETS_EPOCH_MS: Date.UTC(1899, 11, 30) - 9 * 60 * 60 * 1000,
    NFB_RESERVED_HEADER_KEYS: {},
    // Sheets_sheetDateCellToCanonical_ が委譲する canonical 整形器のスタブ。
    // 実体は NfbAlasqlRuntime.formatCanonical だが、ここでは kind を反映した目印を返すだけで足りる。
    nfbDt_formatCanonical_: (value, kind) => "CANON:" + kind,
  };

  return loadGasFiles(context, ["sheetsDatetime.gs", "codeHandlers.gs"]);
}

const ctx = loadContext();

test("SerializeRecord_: data の canonical 文字列はそのまま通る（ISO に再変換しない）", () => {
  const timeUnixMs = Date.UTC(1899, 11, 30, 5, 50, 0); // 1899-12-30 14:50 JST 相当
  const dateUnixMs = Date.UTC(2026, 3, 4, 15, 0, 0); // 2026-04-05 00:00 JST 相当
  const result = ctx.SerializeRecord_({
    id: "rec_1",
    "No.": 1,
    createdAt: "2026-05-01_13:50:47",
    modifiedAt: "2026-05-01_13:50:47",
    deletedAt: "",
    createdBy: "a@example.com",
    modifiedBy: "a@example.com",
    deletedBy: "",
    data: {
      "対応時間【出】": "14:50:00",
      "日付": "2026-04-05",
      "メモ": "hello",
      "数量": 3,
    },
    dataUnixMs: {
      "対応時間【出】": timeUnixMs,
      "日付": dateUnixMs,
    },
  });

  assert.equal(result.data["対応時間【出】"], "14:50:00");
  assert.equal(result.data["日付"], "2026-04-05");
  assert.equal(result.data["メモ"], "hello");
  assert.equal(result.data["数量"], "3"); // 非時刻スカラは従来どおり文字列化
  assert.equal(result.dataUnixMs["対応時間【出】"], timeUnixMs);
  assert.equal(result.dataUnixMs["日付"], dateUnixMs);
});

test("SerializeRecord_: dataUnixMs の非数値は落とす", () => {
  const result = ctx.SerializeRecord_({
    id: "rec_2",
    data: { a: "x" },
    dataUnixMs: { a: "not-a-number", b: NaN, c: 123456789 },
  });
  assert.equal("a" in result.dataUnixMs, false);
  assert.equal("b" in result.dataUnixMs, false);
  assert.equal(result.dataUnixMs.c, 123456789);
});

test("SerializeDataValue_: 生 Date は canonical 文字列化する（toISOString にしない）", () => {
  const timeDate = new Date(1899, 11, 30, 14, 50, 0); // ローカル 1899-12-30 14:50 → kind "time"
  assert.equal(ctx.SerializeDataValue_(timeDate), "CANON:time");
  assert.notEqual(ctx.SerializeDataValue_(timeDate), timeDate.toISOString());

  const midnightDate = new Date(2026, 0, 1, 0, 0, 0); // ローカル真夜中 → kind "date"
  assert.equal(ctx.SerializeDataValue_(midnightDate), "CANON:date");

  const dateTimeDate = new Date(2026, 0, 1, 12, 34, 56); // 真夜中以外 → kind "datetime"
  assert.equal(ctx.SerializeDataValue_(dateTimeDate), "CANON:datetime");
});

test("SerializeDataValue_: 非 Date は従来どおり（null→\"\" / object→JSON / primitive→String）", () => {
  assert.equal(ctx.SerializeDataValue_(null), "");
  assert.equal(ctx.SerializeDataValue_(undefined), "");
  assert.equal(ctx.SerializeDataValue_(42), "42");
  assert.equal(ctx.SerializeDataValue_(true), "true");
  assert.equal(ctx.SerializeDataValue_("14:50:00"), "14:50:00");
  assert.equal(ctx.SerializeDataValue_({ a: 1 }), '{"a":1}');
});

test("SerializeDateLike_ は廃止された", () => {
  assert.equal(typeof ctx.SerializeDateLike_, "undefined");
});
