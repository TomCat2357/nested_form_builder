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
