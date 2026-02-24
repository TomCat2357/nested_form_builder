import test from "node:test";
import assert from "node:assert/strict";
import { buildExportTableData } from "./searchTable.js";

const buildRegressionForm = () => ({
  schema: [
    {
      type: "select",
      label: "top",
      options: [{ label: "opt1" }, { label: "opt2" }],
      childrenByValue: {
        opt1: [
          {
            type: "text",
            label: "xxx",
            childrenByValue: {
              a: [{ type: "text", label: "leaf1" }],
              b: [{ type: "text", label: "leaf2" }],
            },
          },
        ],
        opt2: [{ type: "text", label: "xxx" }],
      },
    },
  ],
});

test("空白セルを挟んだ同一ヘッダーは残す", () => {
  const { headerRows } = buildExportTableData({ form: buildRegressionForm(), entries: [] });
  assert.equal(headerRows[2][3], "xxx");
  assert.equal(headerRows[2][4], "");
  assert.equal(headerRows[2][5], "");
  assert.equal(headerRows[2][6], "xxx");
});

test("連続する同一ヘッダーは2つ目以降を空白化する", () => {
  const { headerRows } = buildExportTableData({ form: buildRegressionForm(), entries: [] });
  assert.equal(headerRows[0][2], "top");
  assert.deepEqual(headerRows[0].slice(3), ["", "", "", ""]);
});
