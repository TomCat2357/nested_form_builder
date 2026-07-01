import assert from "node:assert/strict";
import test from "node:test";
import { buildColumnIndex, resolveColumnRef } from "./columnIdentifierResolver.js";

const mkForm = () => ({
  id: "f1",
  schema: [
    {
      id: "f_auto_aaa",
      type: "group",
      label: "基本情報",
      children: [
        { id: "f_auto_bbb", type: "text", label: "区" },
        { id: "f_auto_ccc", type: "text", label: "氏名" },
      ],
    },
    { id: "f_auto_ddd", type: "date", label: "受付日" },
  ],
});

test("buildColumnIndex はパイプパスと field.id の引きを構築する", () => {
  const idx = buildColumnIndex(mkForm());
  assert.equal(idx.byPipePath.get("基本情報/区"), "基本情報__区");
  assert.equal(idx.byPipePath.get("受付日"), "受付日");
  assert.equal(idx.byFieldId.get("f_auto_bbb"), "基本情報__区");
  assert.equal(idx.byFieldId.get("f_auto_ddd"), "受付日");
});

test("buildColumnIndex は固定列(id, createdAt 等) も登録する", () => {
  const idx = buildColumnIndex(mkForm());
  assert.equal(idx.byPipePath.get("createdAt"), "createdAt");
  assert.equal(idx.byPipePath.get("id"), "id");
});

test("buildColumnIndex / resolveColumnRef は固定列 No. を行の実キー No_ に解決する", () => {
  const idx = buildColumnIndex(mkForm());
  assert.equal(idx.byPipePath.get("No."), "No_");
  assert.equal(resolveColumnRef("No.", idx), "No_");
});

test("buildColumnIndex / resolveColumnRef は pid メタ列を解決する（親子 JOIN 用）", () => {
  const idx = buildColumnIndex(mkForm());
  assert.equal(idx.byPipePath.get("pid"), "pid");
  assert.equal(resolveColumnRef("pid", idx), "pid");
});

test("resolveColumnRef: パイプパス → AlaSQL キー", () => {
  const idx = buildColumnIndex(mkForm());
  assert.equal(resolveColumnRef("基本情報|区", idx), "基本情報__区");
});

test("resolveColumnRef: field.id → AlaSQL キー", () => {
  const idx = buildColumnIndex(mkForm());
  assert.equal(resolveColumnRef("f_auto_bbb", idx), "基本情報__区");
});

test("resolveColumnRef: 未登録トークンも | → __ 変換だけ施して素通し", () => {
  const idx = buildColumnIndex(mkForm());
  assert.equal(resolveColumnRef("count", idx), "count");
  assert.equal(resolveColumnRef("不明|列", idx), "不明__列");
});

test("resolveColumnRef: index 未指定でも素通しする", () => {
  assert.equal(resolveColumnRef("a|b", null), "a__b");
});
