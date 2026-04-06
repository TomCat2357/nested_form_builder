import assert from "node:assert/strict";
import test from "node:test";
import { buildSchemaMapItems, collectExpandableIds } from "./schemaMapNavTree.js";

const schema = [
  {
    id: "parent_a",
    type: "radio",
    label: "親A",
    options: [{ label: "A-1" }, { label: "A-2" }],
    childrenByValue: {
      "A-1": [
        {
          id: "child_a_1",
          type: "checkboxes",
          label: "子A-1",
          options: [{ label: "A-1-x" }, { label: "A-1-y" }],
          childrenByValue: {
            "A-1-y": [{ id: "grandchild_a_1_y", type: "text", label: "孫A-1-y" }],
          },
        },
      ],
      "A-2": [{ id: "child_a_2", type: "text", label: "子A-2" }],
    },
  },
  {
    id: "parent_b",
    type: "text",
    label: "親B",
  },
];

test("buildSchemaMapItems は scope=all で全分岐をツリー化する", () => {
  const items = buildSchemaMapItems({ schema, scope: "all" });

  assert.equal(items.length, 2);
  assert.equal(items[0].id, "parent_a");
  assert.equal(items[0].children.length, 2);
  assert.equal(items[0].children[0].id, "child_a_1");
  assert.equal(items[0].children[0].children[0].id, "grandchild_a_1_y");
  assert.equal(items[0].children[1].id, "child_a_2");
  assert.equal(items[1].id, "parent_b");
});

test("buildSchemaMapItems は scope=visible で現在表示中の分岐だけをツリー化する", () => {
  const items = buildSchemaMapItems({
    schema,
    scope: "visible",
    responses: {
      parent_a: "A-1",
      child_a_1: ["A-1-y"],
    },
  });

  assert.equal(items.length, 2);
  assert.equal(items[0].id, "parent_a");
  assert.deepEqual(items[0].children.map((item) => item.id), ["child_a_1"]);
  assert.deepEqual(items[0].children[0].children.map((item) => item.id), ["grandchild_a_1_y"]);
  assert.equal(items[1].id, "parent_b");
});

test("collectExpandableIds は子ノードを持つIDだけを返す", () => {
  const ids = collectExpandableIds(buildSchemaMapItems({ schema, scope: "all" }));
  assert.deepEqual(Array.from(ids).sort(), ["child_a_1", "parent_a"]);
});
