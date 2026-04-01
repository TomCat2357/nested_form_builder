const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadGasContext() {
  const fixedHeaderPaths = [
    ["id"],
    ["parentRecordId"],
    ["No."],
    ["createdAt"],
    ["modifiedAt"],
    ["deletedAt"],
    ["createdBy"],
    ["modifiedBy"],
    ["deletedBy"],
    ["driveFolderUrl"],
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
    Sheets_ensureRowCapacity_: () => {},
    Sheets_ensureColumnExists_: () => {},
    Sheets_touchSheetLastUpdated_: () => {},
  };

  vm.createContext(context);

  const projectRoot = path.join(__dirname, "..");
  const sourceFiles = [
    path.join(projectRoot, "gas", "sheetsHeaders.gs"),
    path.join(projectRoot, "gas", "sheetsRecords.gs"),
    path.join(projectRoot, "gas", "sheetsRowOps.gs"),
  ];

  for (const sourceFile of sourceFiles) {
    const code = fs.readFileSync(sourceFile, "utf8");
    vm.runInContext(code, context, { filename: sourceFile });
  }

  return context;
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

  const desired = gas.Sheets_buildDesiredPaths_(["  質問カード | 選択肢A  "], [["質問カード", "選択肢A"]]);
  const matches = desired.filter((pathParts) => gas.Sheets_pathKey_(pathParts) === "質問カード|選択肢A");

  assert.equal(matches.length, 1);
});

test("保存時の order と responses も同じキー正規化を通す", () => {
  const gas = loadGasContext();
  const ctx = {
    order: ["  質問カード | 選択肢A  "],
    responses: {
      "  質問カード | 選択肢A  ": "回答",
    },
  };

  gas.Sheets_prepareResponses_(ctx);

  assert.deepEqual(toPlain(ctx.order), ["質問カード|選択肢A"]);
  assert.deepEqual(toPlain(ctx.responses), { "質問カード|選択肢A": "回答" });
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
