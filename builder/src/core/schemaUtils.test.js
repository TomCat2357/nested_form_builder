import assert from "node:assert/strict";
import test from "node:test";
import { mapSchema, traverseSchema } from "./schemaUtils.js";

const collectPaths = (schema) => {
  const paths = [];
  traverseSchema(schema, (field, context) => {
    paths.push(context.pathSegments.join("|"));
  });
  return paths;
};

test("traverseSchemaはchildrenByValueがoptions順と異なっていてもoptions順で巡回する", () => {
  const schema = [
    {
      type: "select",
      label: "親",
      options: [{ label: "B" }, { label: "A" }],
      childrenByValue: {
        A: [{ type: "text", label: "Aの子" }],
        B: [{ type: "text", label: "Bの子" }],
      },
    },
  ];

  const paths = collectPaths(schema);
  assert.deepEqual(paths, ["親", "親|B|Bの子", "親|A|Aの子"]);
});

test("traverseSchemaはoptionsにない分岐キーを末尾に保持する", () => {
  const schema = [
    {
      type: "select",
      label: "親",
      options: [{ label: "B" }],
      childrenByValue: {
        X: [{ type: "text", label: "Xの子" }],
        B: [{ type: "text", label: "Bの子" }],
        A: [{ type: "text", label: "Aの子" }],
      },
    },
  ];

  const paths = collectPaths(schema);
  assert.deepEqual(paths, ["親", "親|B|Bの子", "親|X|Xの子", "親|A|Aの子"]);
});

test("mapSchemaはchildrenByValueのキー順をoptions優先で再構築する", () => {
  const schema = [
    {
      type: "checkboxes",
      label: "親",
      options: [{ label: "B" }],
      childrenByValue: {
        X: [{ type: "text", label: "Xの子" }],
        B: [{ type: "text", label: "Bの子" }],
        A: [{ type: "text", label: "Aの子" }],
      },
    },
  ];

  const mapped = mapSchema(schema, (field) => ({ ...field }));
  assert.deepEqual(Object.keys(mapped[0].childrenByValue), ["B", "X", "A"]);
});

test("traverseSchemaは children 配列を親パスを継承して巡回する", () => {
  const schema = [
    {
      type: "text",
      label: "親",
      children: [
        { type: "text", label: "子1" },
        { type: "number", label: "子2" },
      ],
    },
  ];
  const paths = collectPaths(schema);
  assert.deepEqual(paths, ["親", "親|子1", "親|子2"]);
});

test("traverseSchema は children と childrenByValue 双方を辿る", () => {
  const schema = [
    {
      type: "text",
      label: "P",
      children: [{ type: "text", label: "C1" }],
    },
    {
      type: "select",
      label: "Q",
      options: [{ label: "A" }],
      childrenByValue: {
        A: [{ type: "text", label: "Q-A-c" }],
      },
    },
  ];
  const paths = collectPaths(schema);
  assert.deepEqual(paths, ["P", "P|C1", "Q", "Q|A|Q-A-c"]);
});

test("mapSchema は children も再帰的に変換する", () => {
  const schema = [
    {
      type: "text",
      label: "親",
      children: [{ type: "text", label: "子" }],
    },
  ];
  const mapped = mapSchema(schema, (field) => ({ ...field, marked: true }));
  assert.equal(mapped[0].marked, true);
  assert.equal(mapped[0].children[0].marked, true);
});

test("traverseSchema は responses モードで親が空のとき children をスキップする", () => {
  const schema = [
    {
      id: "p1",
      type: "text",
      label: "親",
      children: [{ id: "c1", type: "text", label: "子" }],
    },
  ];
  const visit = (responses) => {
    const paths = [];
    traverseSchema(
      schema,
      (field, ctx) => {
        paths.push(ctx.pathSegments.join("|"));
      },
      { responses },
    );
    return paths;
  };

  assert.deepEqual(visit({ p1: "" }), ["親"]);
  assert.deepEqual(visit({ p1: "あり" }), ["親", "親|子"]);
});
