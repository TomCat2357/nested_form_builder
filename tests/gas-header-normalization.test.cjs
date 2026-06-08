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

test("Sheets_collectColumnFormatMap_ はテキスト系・選択肢列を '@' にし数値/日時は除外する", () => {
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
  ];

  const map = toPlain(gas.Sheets_collectColumnFormatMap_(schema));

  // テキスト系（text / phone）と選択肢マーカー列は "@"
  assert.equal(map["氏名"], "@");
  assert.equal(map["電話"], "@");
  assert.equal(map["性別/男"], "@");
  assert.equal(map["性別/女"], "@");
  // 数値・日時列はマップに含めない（数値のまま / 専用日時セル経路）
  assert.ok(!("年齢" in map));
  assert.ok(!("生年月日" in map));
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
