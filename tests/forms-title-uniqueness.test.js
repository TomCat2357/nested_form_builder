const assert = require("node:assert/strict");
const test = require("node:test");
const {
  Forms_normalizeFormTitle_,
  Forms_makeUniqueFormTitle_,
} = require("../gas/formsTitleHelpers.js");

test("normalize は空白とパイプを _ に置換する", () => {
  assert.equal(Forms_normalizeFormTitle_("Hello World"), "Hello_World");
  assert.equal(Forms_normalizeFormTitle_("a|b"), "a_b");
  assert.equal(Forms_normalizeFormTitle_("a | b\tc\n"), "a_b_c");
});

test("normalize は連続する空白/パイプを 1 つの _ に集約する", () => {
  assert.equal(Forms_normalizeFormTitle_("a   b"), "a_b");
  assert.equal(Forms_normalizeFormTitle_("a||b"), "a_b");
});

test("normalize は空文字や null を (名称未設定) に変換する", () => {
  assert.equal(Forms_normalizeFormTitle_(""), "(名称未設定)");
  assert.equal(Forms_normalizeFormTitle_(null), "(名称未設定)");
  assert.equal(Forms_normalizeFormTitle_(undefined), "(名称未設定)");
  assert.equal(Forms_normalizeFormTitle_("   "), "(名称未設定)");
});

test("normalize は日本語・記号を保持する", () => {
  assert.equal(Forms_normalizeFormTitle_("札幌市苦情"), "札幌市苦情");
  assert.equal(Forms_normalizeFormTitle_("R7環境共生"), "R7環境共生");
});

test("makeUniqueFormTitle: 衝突なしならそのまま返す", () => {
  assert.equal(Forms_makeUniqueFormTitle_("Foo", []), "Foo");
  assert.equal(Forms_makeUniqueFormTitle_("Foo", ["Bar", "Baz"]), "Foo");
});

test("makeUniqueFormTitle: 衝突時は (1) を付ける", () => {
  assert.equal(Forms_makeUniqueFormTitle_("Foo", ["Foo"]), "Foo (1)");
});

test("makeUniqueFormTitle: 連続衝突は最小未使用番号を割り当てる", () => {
  assert.equal(Forms_makeUniqueFormTitle_("Foo", ["Foo", "Foo (1)"]), "Foo (2)");
  assert.equal(Forms_makeUniqueFormTitle_("Foo", ["Foo", "Foo (1)", "Foo (2)"]), "Foo (3)");
});

test("makeUniqueFormTitle: 番号の隙間は埋める", () => {
  assert.equal(Forms_makeUniqueFormTitle_("Foo", ["Foo", "Foo (2)"]), "Foo (1)");
  assert.equal(Forms_makeUniqueFormTitle_("Foo", ["Foo", "Foo (1)", "Foo (3)"]), "Foo (2)");
});

test("makeUniqueFormTitle: 入力タイトルは normalize されてから比較される", () => {
  assert.equal(Forms_makeUniqueFormTitle_("Hello World", ["Hello_World"]), "Hello_World (1)");
  assert.equal(Forms_makeUniqueFormTitle_("a|b", ["a_b"]), "a_b (1)");
});

test("makeUniqueFormTitle: existingTitles が undefined でも動く", () => {
  assert.equal(Forms_makeUniqueFormTitle_("Foo", undefined), "Foo");
  assert.equal(Forms_makeUniqueFormTitle_("Foo", null), "Foo");
});
