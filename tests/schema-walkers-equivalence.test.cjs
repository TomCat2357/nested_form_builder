/**
 * スキーマ走査ユーティリティのフロント / GAS 等価性テスト。
 *
 * 双子実装:
 *   フロント: builder/src/core/schemaUtils.js (resolveOrderedChildKeys / traverseSchema /
 *             mapSchema / countSchemaNodes) + builder/src/core/schema.js (stripSchemaIDs)
 *   GAS:      gas/schemaUtils.gs (nfbResolveOrderedChildKeys_ / nfbTraverseSchema_ /
 *             nfbMapSchema_ / nfbStripSchemaIDs_)
 *
 * 物理的に1ファイルへ統合はせず（フロントは ESM、GAS バンドルはグローバル関数）、
 * このテストで両者が同じ入力に同じ結果を返すことを担保してドリフトを検知する。
 */

const assert = require("node:assert/strict");
const test = require("node:test");
const { loadGasFiles } = require("./helpers/gasVmLoader.cjs");

// schema.js の UI_TEMP_KEYS と一致させること（stripSchemaIDs はこれらを除去する）。
const UI_TEMP_KEYS = [
  "_savedChoiceState",
  "_savedStyleSettings",
  "_savedChildrenForChoice",
  "_savedDisplayModeForChoice",
];

// nfb* walkers は NfbAlasqlRuntime（共有ランタイム）へのデリゲート。
// 本テストは「GAS 側デリゲート配線＝フロント実装」の等価性スモークとして維持する。
function loadGas() {
  return loadGasFiles({ console }, ["schemaUtils.gs"]);
}

async function loadFrontend() {
  const schemaUtils = await import("../builder/src/core/schemaUtils.js");
  const schema = await import("../builder/src/core/schema.js");
  return { schemaUtils, schema };
}

const clone = (v) => JSON.parse(JSON.stringify(v));

const FIXTURES = {
  // childrenByValue が options 順と異なる
  outOfOrderBranches: [
    {
      id: "f1",
      type: "select",
      label: "親",
      options: [{ id: "o1", label: "B" }, { id: "o2", label: "A" }],
      childrenByValue: {
        A: [{ id: "f2", type: "text", label: "Aの子" }],
        B: [{ id: "f3", type: "text", label: "Bの子" }],
        C: [{ id: "f4", type: "text", label: "options外" }],
      },
    },
  ],
  // children 配列 + ネスト
  nestedChildren: [
    {
      id: "g1",
      type: "checkboxes",
      label: "親C",
      options: [{ id: "co1", label: "X" }, { id: "co2", label: "Y" }],
      childrenByValue: {
        X: [
          { id: "g2", type: "text", label: "Xの子" },
          {
            id: "g3",
            type: "radio",
            label: "Xの子(分岐)",
            options: [{ id: "ro1", label: "はい" }],
            childrenByValue: { はい: [{ id: "g4", type: "number", label: "孫" }] },
          },
        ],
        Y: [{ id: "g5", type: "text", label: "Yの子", children: [{ id: "g6", type: "text", label: "Y孫" }] }],
      },
    },
    { id: "g7", type: "text", label: "  ", children: [{ id: "g8", type: "text", label: "ラベル空の子" }] },
  ],
  // ラベル無し → fallback label
  emptyLabels: [
    { type: "text" },
    { type: "select", options: [{ label: "a" }], childrenByValue: { a: [{ type: "text" }] } },
  ],
};

test("resolveOrderedChildKeys ≡ nfbResolveOrderedChildKeys_", async () => {
  const gas = loadGas();
  const { schemaUtils } = await loadFrontend();
  for (const field of [
    FIXTURES.outOfOrderBranches[0],
    FIXTURES.nestedChildren[0],
    { childrenByValue: { z: [], a: [] } },
    { options: [{ label: "a" }], childrenByValue: {} },
    {},
    null,
  ]) {
    // GAS の戻り値は vm レルムの Array なので clone() で素の配列に正規化してから比較する。
    assert.deepEqual(
      schemaUtils.resolveOrderedChildKeys(field),
      clone(gas.nfbResolveOrderedChildKeys_(field)),
      `resolveOrderedChildKeys mismatch for ${JSON.stringify(field)}`,
    );
  }
});

const collectTraversal = (traverse, schema, options) => {
  const out = [];
  traverse(schema, (field, ctx) => {
    out.push({
      path: ctx.pathSegments.join("|"),
      depth: ctx.depth,
      index: ctx.index,
      indexTrail: ctx.indexTrail.join("."),
      type: field && field.type,
    });
  }, options);
  return out;
};

test("traverseSchema ≡ nfbTraverseSchema_ (default walk)", async () => {
  const gas = loadGas();
  const { schemaUtils } = await loadFrontend();
  for (const name of Object.keys(FIXTURES)) {
    assert.deepEqual(
      collectTraversal(schemaUtils.traverseSchema, clone(FIXTURES[name])),
      collectTraversal(gas.nfbTraverseSchema_, clone(FIXTURES[name])),
      `traverseSchema mismatch for ${name}`,
    );
  }
});

test("traverseSchema ≡ nfbTraverseSchema_ (visitor returns false で subtree 打ち切り)", async () => {
  const gas = loadGas();
  const { schemaUtils } = await loadFrontend();
  const cutoff = (traverse, schema) => {
    const out = [];
    traverse(schema, (field, ctx) => {
      out.push(ctx.pathSegments.join("|"));
      return field && field.type === "checkboxes" ? false : undefined;
    });
    return out;
  };
  assert.deepEqual(
    cutoff(schemaUtils.traverseSchema, clone(FIXTURES.nestedChildren)),
    cutoff(gas.nfbTraverseSchema_, clone(FIXTURES.nestedChildren)),
  );
});

test("traverseSchema ≡ nfbTraverseSchema_ (responses 駆動: checkboxes / radio / select 分岐)", async () => {
  const gas = loadGas();
  const { schemaUtils } = await loadFrontend();
  const responses = {
    g1: ["X"],
    g3: "はい",
    f1: "A",
  };
  const opts = { responses };
  assert.deepEqual(
    collectTraversal(schemaUtils.traverseSchema, clone(FIXTURES.nestedChildren), opts),
    collectTraversal(gas.nfbTraverseSchema_, clone(FIXTURES.nestedChildren), opts),
  );
  assert.deepEqual(
    collectTraversal(schemaUtils.traverseSchema, clone(FIXTURES.outOfOrderBranches), { responses }),
    collectTraversal(gas.nfbTraverseSchema_, clone(FIXTURES.outOfOrderBranches), { responses }),
  );
});

test("traverseSchema ≡ nfbTraverseSchema_ (getChildKeys / fieldSegment / branchSegment コールバック)", async () => {
  const gas = loadGas();
  const { schemaUtils } = await loadFrontend();
  const opts = {
    getChildKeys: (field) => (field.childrenByValue ? Object.keys(field.childrenByValue).sort() : []),
    fieldSegment: (field) => (field && field.type === "number" ? null : (field && field.label) || "?"),
    branchSegment: (key) => `[${key}]`,
  };
  assert.deepEqual(
    collectTraversal(schemaUtils.traverseSchema, clone(FIXTURES.nestedChildren), opts),
    collectTraversal(gas.nfbTraverseSchema_, clone(FIXTURES.nestedChildren), opts),
  );
});

test("mapSchema ≡ nfbMapSchema_", async () => {
  const gas = loadGas();
  const { schemaUtils } = await loadFrontend();
  const mapper = (field, ctx) => ({ ...field, _path: ctx.pathSegments.join("|"), _depth: ctx.depth });
  for (const name of Object.keys(FIXTURES)) {
    assert.deepEqual(
      clone(schemaUtils.mapSchema(clone(FIXTURES[name]), mapper)),
      clone(gas.nfbMapSchema_(clone(FIXTURES[name]), mapper)),
      `mapSchema mismatch for ${name}`,
    );
  }
});

test("countSchemaNodes はGAS走査のノード数と一致する", async () => {
  const gas = loadGas();
  const { schemaUtils } = await loadFrontend();
  for (const name of Object.keys(FIXTURES)) {
    let gasCount = 0;
    gas.nfbTraverseSchema_(clone(FIXTURES[name]), () => { gasCount += 1; });
    assert.equal(schemaUtils.countSchemaNodes(clone(FIXTURES[name])), gasCount, `countSchemaNodes mismatch for ${name}`);
  }
});

test("stripSchemaIDs ≡ nfbStripSchemaIDs_(nodes, { uiTempKeys })", async () => {
  const gas = loadGas();
  const { schema } = await loadFrontend();
  const withTempState = [
    {
      id: "f1",
      type: "select",
      label: "親",
      _savedChoiceState: { a: 1 },
      options: [{ id: "o1", label: "A" }, { id: "o2", label: "B" }],
      childrenByValue: {
        A: [{ id: "f2", type: "text", label: "子", _savedStyleSettings: {} }],
        B: [{ id: "f3", type: "text", label: "子2", children: [{ id: "f4", type: "text", label: "孫" }] }],
      },
    },
  ];
  assert.deepEqual(
    clone(schema.stripSchemaIDs(clone(withTempState))),
    clone(gas.nfbStripSchemaIDs_(clone(withTempState), { uiTempKeys: UI_TEMP_KEYS })),
  );
});
