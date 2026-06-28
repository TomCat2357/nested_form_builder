const assert = require("node:assert/strict");
const test = require("node:test");
const { loadGasFiles } = require("./helpers/gasVmLoader.cjs");

function loadGasContext() {
  const fixedHeaderPaths = [
    ["id"],
    ["No."],
    ["createdAt"],
    ["modifiedAt"],
    ["deletedAt"],
    ["createdBy"],
    ["modifiedBy"],
    ["deletedBy"],
  ];
  const reservedKeys = {};
  for (const pathParts of fixedHeaderPaths) {
    reservedKeys[pathParts[0]] = true;
  }

  const context = {
    console,
    Logger: { log() {} },
    NFB_HEADER_DEPTH: 11,
    NFB_HEADER_START_ROW: 1,
    NFB_DATA_START_ROW: 12,
    NFB_FIXED_HEADER_PATHS: fixedHeaderPaths,
    NFB_RESERVED_HEADER_KEYS: reservedKeys,
    NFB_SHEETS_TEXT_FORMAT: "@",
    Sheets_ensureRowCapacity_: () => {},
    Sheets_ensureColumnExists_: () => {},
    Sheets_touchSheetLastUpdated_: () => {},
  };

  return loadGasFiles(context, [
    "schemaUtils.gs",
    "pathCodec.gs", "sheetsHeaders.gs",
    "sheetsRecords.gs",
    "sheetsRowOps.gs",
  ]);
}

function toPlain(value) {
  return JSON.parse(JSON.stringify(value));
}

test("既存ヘッダーの前後空白を無視して列パスを読む", () => {
  const gas = loadGasContext();
  const matrix = Array.from({ length: gas.NFB_HEADER_DEPTH }, () => [""]);
  matrix[0][0] = "  質問カード  ";
  matrix[1][0] = "  選択肢A ";

  const paths = toPlain(gas.Sheets_extractColumnPaths_(matrix));

  assert.deepEqual(paths, [["質問カード", "選択肢A"]]);
});

test("既存列が前後空白だけ違う場合は新規列として扱わない", () => {
  const gas = loadGasContext();

  const desired = gas.Sheets_buildDesiredPaths_(["  質問カード / 選択肢A  "], [["質問カード", "選択肢A"]]);
  const matches = desired.filter((pathParts) => gas.Sheets_pathKey_(pathParts) === "質問カード/選択肢A");

  assert.equal(matches.length, 1);
});

test("保存時の order と responses も同じキー正規化を通す", () => {
  const gas = loadGasContext();
  const ctx = {
    order: ["  質問カード / 選択肢A  "],
    responses: {
      "  質問カード / 選択肢A  ": "回答",
    },
  };

  gas.Sheets_prepareResponses_(ctx);

  assert.deepEqual(toPlain(ctx.order), ["質問カード/選択肢A"]);
  assert.deepEqual(toPlain(ctx.responses), { "質問カード/選択肢A": "回答" });
});

test("Sheets_collectColumnFormatMap_ は日付/時間以外の全データ列を '@' にし date/time だけ除外する", () => {
  const gas = loadGasContext();
  const schema = [
    { id: "q1", type: "text", label: "氏名" },
    { id: "q2", type: "number", label: "年齢" },
    { id: "q3", type: "date", label: "生年月日" },
    { id: "q4", type: "phone", label: "電話" },
    {
      id: "q5",
      type: "select",
      label: "性別",
      options: [{ id: "o1", label: "男" }, { id: "o2", label: "女" }],
    },
    { id: "q6", type: "time", label: "開始時刻" },
  ];

  const map = toPlain(gas.Sheets_collectColumnFormatMap_(schema));

  // テキスト系（text / phone）・数値（number）・選択肢マーカー列はすべて "@"
  assert.equal(map["氏名"], "@");
  assert.equal(map["電話"], "@");
  assert.equal(map["年齢"], "@");
  assert.equal(map["性別/男"], "@");
  assert.equal(map["性別/女"], "@");
  // date / time 列だけはマップに含めない（専用の日時セル経路で日時書式を付ける）
  assert.ok(!("生年月日" in map));
  assert.ok(!("開始時刻" in map));
});

test("Sheets_buildOrderFromSchema_ は列キーを Sheets_collectColumnFormatMap_ と同じ規則で生成する", () => {
  const gas = loadGasContext();
  const schema = [
    { id: "q1", type: "text", label: "氏名" },
    {
      id: "q5",
      type: "select",
      label: "性別",
      options: [{ id: "o1", label: "男" }, { id: "o2", label: "女" }],
    },
  ];

  const order = toPlain(gas.Sheets_buildOrderFromSchema_(schema));
  assert.deepEqual(order, ["氏名", "性別/男", "性別/女"]);
});

test("ヘッダーマップ生成でも前後空白を無視する", () => {
  const gas = loadGasContext();
  const matrix = Array.from({ length: gas.NFB_HEADER_DEPTH }, () => ["", ""]);
  matrix[0][0] = " id ";
  matrix[0][1] = "  質問カード ";

  const sheet = {
    getLastColumn() {
      return 2;
    },
    getRange() {
      return {
        getValues() {
          return matrix;
        },
      };
    },
  };

  const map = gas.Sheets_buildHeaderKeyMap_(sheet);

  assert.equal(map["id"], 1);
  assert.equal(map["質問カード"], 2);
});

// ---------------------------------------------------------------------------
// フロント / GAS の「列ヘッダ（列キー）セグメント正規化」等価性。
// 双子:
//   フロント: builder/src/core/schemaUtils.js
//             normalizeHeaderSegment / headerFieldSegment / headerBranchSegment
//   GAS:      gas/sheetsHeaders.gs
//             Sheets_normalizeHeaderSegment_ / Sheets_headerFieldSegmentWithFallback_ /
//             Sheets_headerBranchSegment_
// 永続フォルダのオープン時 effect が作る path を GAS の col.key と一致させるため、
// CRLF/CR 畳み込み・前後空白・空ラベル fallback の振る舞いがドリフトしないことを担保する。
// ---------------------------------------------------------------------------

async function loadFrontHeaderSegments() {
  const mod = await import("../builder/src/core/schemaUtils.js");
  return {
    normalizeHeaderSegment: mod.normalizeHeaderSegment,
    headerFieldSegment: mod.headerFieldSegment,
    headerBranchSegment: mod.headerBranchSegment,
  };
}

const SEGMENT_INPUTS = [
  "  abc  ",
  "a\r\nb",
  "a\rb",
  "a\nb",
  "\r\n 前後 \r\n",
  "親\r\n子",
  "",
  "   ",
  "No.",
  "性別/男",
];

test("normalizeHeaderSegment は GAS Sheets_normalizeHeaderSegment_ と一致する", async () => {
  const gas = loadGasContext();
  const front = await loadFrontHeaderSegments();
  for (const input of SEGMENT_INPUTS) {
    assert.equal(
      front.normalizeHeaderSegment(input),
      gas.Sheets_normalizeHeaderSegment_(input),
      `normalizeHeaderSegment(${JSON.stringify(input)})`,
    );
  }
  // null / undefined / 数値も同値（いずれも空 or 文字列化）
  assert.equal(front.normalizeHeaderSegment(null), gas.Sheets_normalizeHeaderSegment_(null));
  assert.equal(front.normalizeHeaderSegment(undefined), gas.Sheets_normalizeHeaderSegment_(undefined));
  assert.equal(front.normalizeHeaderSegment(123), gas.Sheets_normalizeHeaderSegment_(123));
});

test("headerBranchSegment は GAS Sheets_headerBranchSegment_ と一致する（空は null）", async () => {
  const gas = loadGasContext();
  const front = await loadFrontHeaderSegments();
  for (const input of SEGMENT_INPUTS) {
    assert.equal(
      front.headerBranchSegment(input),
      gas.Sheets_headerBranchSegment_(input),
      `headerBranchSegment(${JSON.stringify(input)})`,
    );
  }
});

test("headerFieldSegment は GAS Sheets_headerFieldSegmentWithFallback_ と一致する（fallback 含む）", async () => {
  const gas = loadGasContext();
  const front = await loadFrontHeaderSegments();
  const cases = [
    [{ label: "  名前 " }, { indexTrail: [1] }],
    [{ label: "親\r\n子" }, { indexTrail: [1, 2] }],
    [{ label: "", type: "text" }, { indexTrail: [2, 3] }],
    [{ label: "   ", type: "select" }, { indexTrail: [4] }],
    [{ label: "\r\n", type: "" }, { indexTrail: [1] }],
    [{ type: "fileUpload" }, { indexTrail: [5, 1, 2] }],
    [{}, { indexTrail: [9] }],
  ];
  for (const [field, ctx] of cases) {
    assert.equal(
      front.headerFieldSegment(field, ctx),
      gas.Sheets_headerFieldSegmentWithFallback_(field, ctx),
      `headerFieldSegment(${JSON.stringify(field)}, ${JSON.stringify(ctx)})`,
    );
  }
});
