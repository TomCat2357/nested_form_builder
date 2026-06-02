const assert = require("node:assert/strict");
const test = require("node:test");
const { loadGasFiles } = require("./helpers/gasVmLoader.cjs");

// メタ列の正規位置揃え（gas/sheetsHeaders.gs: Sheets_repairMetaColumnPositions_ /
// Sheets_ensureHeaderMatrix_）の回帰検証。
//   - 既存シートで pid が無ければ deletedBy の直後（物理列 9）へ「挿入」され、データ列は右へシフト
//   - 新規シートは id..deletedBy, pid, <data> の順に並ぶ
//   - メタ列が別位置にある場合は正規位置へ「移動」して修整する
//   - pid を特別扱いせず、全メタ列を一律に NFB_FIXED_HEADER_PATHS 順へ揃える

const DEPTH = 11;
const META = ["id", "No.", "createdAt", "modifiedAt", "deletedAt", "createdBy", "modifiedBy", "deletedBy"];

// 列（縦のヘッダーパス）と任意のデータ行から、最小限の機能を持つモックシートを作る。
function makeSheet({ columns = [], dataRows = [] }) {
  var cols = columns.length;
  var rows = Math.max(DEPTH + dataRows.length, DEPTH + 1);
  var grid = [];
  for (var r = 0; r < rows; r++) grid.push(new Array(Math.max(cols, 1)).fill(""));
  // ヘッダー（縦）: 列 c のパス seg を行 0..len-1 に書く
  columns.forEach(function (path, c) {
    path.forEach(function (seg, d) { if (d < DEPTH) grid[d][c] = seg; });
  });
  // データ行は行 index DEPTH 以降
  dataRows.forEach(function (row, i) {
    row.forEach(function (v, c) { grid[DEPTH + i][c] = v; });
  });

  var frozen = 0;
  var width = function () { return grid[0].length; };
  var fillRow = function () { return new Array(width()).fill(""); };

  var sheet = {
    getParent: function () { return { getId: function () { return "ss"; } }; },
    getName: function () { return "Data"; },
    getMaxRows: function () { return grid.length; },
    getMaxColumns: function () { return width(); },
    getFrozenRows: function () { return frozen; },
    setFrozenRows: function (n) { frozen = n; },
    getLastColumn: function () {
      var last = 0;
      for (var r = 0; r < grid.length; r++) {
        for (var c = 0; c < grid[r].length; c++) {
          if (String(grid[r][c] == null ? "" : grid[r][c]) !== "") last = Math.max(last, c + 1);
        }
      }
      return last;
    },
    insertRowsAfter: function (pos1, n) {
      for (var i = 0; i < n; i++) grid.splice(pos1 + i, 0, fillRow());
    },
    insertColumnsBefore: function (pos1, n) {
      for (var r = 0; r < grid.length; r++) {
        var ins = new Array(n).fill("");
        grid[r].splice.apply(grid[r], [pos1 - 1, 0].concat(ins));
      }
    },
    insertColumnsAfter: function (pos1, n) {
      for (var r = 0; r < grid.length; r++) {
        var ins = new Array(n).fill("");
        grid[r].splice.apply(grid[r], [pos1, 0].concat(ins));
      }
    },
    moveColumns: function (rangeObj, dest1) {
      var start = rangeObj._startCol;
      var num = rangeObj._numCols;
      for (var r = 0; r < grid.length; r++) {
        var removed = grid[r].splice(start - 1, num);
        grid[r].splice.apply(grid[r], [dest1 - 1, 0].concat(removed));
      }
    },
    getRange: function (row1, col1, numRows, numCols) {
      return {
        _startRow: row1, _startCol: col1, _numRows: numRows, _numCols: numCols,
        getValues: function () {
          var out = [];
          for (var r = 0; r < numRows; r++) {
            var rr = row1 - 1 + r;
            var line = [];
            for (var c = 0; c < numCols; c++) {
              var cc = col1 - 1 + c;
              line.push(grid[rr] && grid[rr][cc] !== undefined ? grid[rr][cc] : "");
            }
            out.push(line);
          }
          return out;
        },
        setValues: function (values) {
          for (var r = 0; r < values.length; r++) {
            var rr = row1 - 1 + r;
            while (!grid[rr]) grid.push(fillRow());
            for (var c = 0; c < values[r].length; c++) {
              var cc = col1 - 1 + c;
              while (grid[rr].length <= cc) grid[rr].push("");
              grid[rr][cc] = values[r][c];
            }
          }
        },
      };
    },
    __grid: grid,
  };
  return sheet;
}

function loadContext() {
  var fixedHeaderPaths = [
    ["id"], ["No."], ["createdAt"], ["modifiedAt"], ["deletedAt"],
    ["createdBy"], ["modifiedBy"], ["deletedBy"], ["pid"],
  ];
  var reservedKeys = {};
  for (var i = 0; i < fixedHeaderPaths.length; i++) reservedKeys[fixedHeaderPaths[i][0]] = true;

  var context = {
    console,
    Logger: { log: function () {} },
    NFB_HEADER_DEPTH: DEPTH,
    NFB_HEADER_START_ROW: 1,
    NFB_DATA_START_ROW: DEPTH + 1,
    NFB_DEFAULT_SHEET_NAME: "Data",
    NFB_FIXED_HEADER_PATHS: fixedHeaderPaths,
    NFB_RESERVED_HEADER_KEYS: reservedKeys,
    SetSheetLastUpdatedAt_: function () {},
  };
  return loadGasFiles(context, ["sheetsHeaders.gs", "sheetsRecords.gs"]);
}

// ensureHeaderMatrix 実行後の列キー順（左→右）を返す。
function columnKeys(gas, sheet) {
  var paths = gas.Sheets_readColumnPaths_(sheet, sheet.getLastColumn());
  return Array.from(paths, function (p) { return p.key; });
}

test("既存シートで pid 欠落時、deletedBy の直後（列9）へ挿入しデータ列を右へシフト", () => {
  const gas = loadContext();
  // id..deletedBy(1..8) + 質問1(9) + 質問2(10)。pid なし。データ行あり。
  const columns = META.map((k) => [k]).concat([["質問1"], ["質問2"]]);
  const dataRows = [["r1", 1, "", "", "", "", "", "", "ans1", "ans2"]];
  const sheet = makeSheet({ columns, dataRows });

  gas.Sheets_ensureHeaderMatrix_(sheet, ["質問1", "質問2"]);

  assert.deepEqual(
    columnKeys(gas, sheet),
    ["id", "No.", "createdAt", "modifiedAt", "deletedAt", "createdBy", "modifiedBy", "deletedBy", "pid", "質問1", "質問2"]
  );
  // データ行: id は列1のまま、pid（列9, index8）は空、質問1/質問2 が右へシフト
  const dataRow = sheet.getRange(DEPTH + 1, 1, 1, sheet.getLastColumn()).getValues()[0];
  assert.equal(dataRow[0], "r1");
  assert.equal(dataRow[8], ""); // pid 列は既存行で空
  assert.equal(dataRow[9], "ans1");
  assert.equal(dataRow[10], "ans2");
});

test("新規シートは id..deletedBy, pid, データ列の順に並ぶ", () => {
  const gas = loadContext();
  const sheet = makeSheet({ columns: [], dataRows: [] }); // 空のプレースホルダ1列
  gas.Sheets_ensureHeaderMatrix_(sheet, ["質問1"]);
  assert.deepEqual(
    columnKeys(gas, sheet),
    ["id", "No.", "createdAt", "modifiedAt", "deletedAt", "createdBy", "modifiedBy", "deletedBy", "pid", "質問1"]
  );
});

test("メタ列が別位置にある場合は正規位置へ移動して修整する（pid が質問列の後ろ）", () => {
  const gas = loadContext();
  // pid が 質問1 の後ろ（列10）にある状態。
  const columns = META.map((k) => [k]).concat([["質問1"], ["pid"]]);
  const dataRows = [["r1", 1, "", "", "", "", "", "", "ans1", "p100"]];
  const sheet = makeSheet({ columns, dataRows });

  gas.Sheets_ensureHeaderMatrix_(sheet, ["質問1"]);

  assert.deepEqual(
    columnKeys(gas, sheet),
    ["id", "No.", "createdAt", "modifiedAt", "deletedAt", "createdBy", "modifiedBy", "deletedBy", "pid", "質問1"]
  );
  // pid 値 p100 が列9（index8）へ移動し、質問1 値が列10（index9）へ寄る
  const dataRow = sheet.getRange(DEPTH + 1, 1, 1, sheet.getLastColumn()).getValues()[0];
  assert.equal(dataRow[8], "p100");
  assert.equal(dataRow[9], "ans1");
});

test("既に正規配置のシートはミューテートしない（repair は false を返す）", () => {
  const gas = loadContext();
  const columns = META.map((k) => [k]).concat([["pid"], ["質問1"]]);
  const sheet = makeSheet({ columns, dataRows: [] });
  const before = JSON.stringify(sheet.__grid);
  const changed = gas.Sheets_repairMetaColumnPositions_(sheet);
  assert.equal(changed, false);
  assert.equal(JSON.stringify(sheet.__grid), before);
});
