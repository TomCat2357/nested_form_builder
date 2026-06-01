import assert from "node:assert/strict";
import test from "node:test";
import { sortAndFilterOptions } from "./searchableSelectOptions.js";

const OPTS = [
  { value: "1", label: "営業/月次/B フォーム", folder: "営業/月次" },
  { value: "2", label: "営業/A フォーム", folder: "営業" },
  { value: "3", label: "総務/休暇申請", folder: "総務" },
  { value: "4", label: "営業/月次/A フォーム", folder: "営業/月次" },
  { value: "5", label: "問い合わせ", folder: "" },
];

test("フォルダ順 → label 順に並べ替える（空フォルダが先頭）", () => {
  const out = sortAndFilterOptions(OPTS, "", "").map((o) => o.value);
  // folder: "" < "営業" < "営業/月次" < "総務"、同一フォルダ内は label 順
  assert.deepEqual(out, ["5", "2", "4", "1", "3"]);
});

test("query で label 部分一致の絞り込み（大文字小文字無視）", () => {
  const out = sortAndFilterOptions(OPTS, "月次", "").map((o) => o.value);
  assert.deepEqual(out, ["4", "1"]);
});

test("不正な正規表現はリテラル一致にフォールバック", () => {
  const out = sortAndFilterOptions([{ value: "x", label: "a(b", folder: "" }], "a(b", "");
  assert.deepEqual(out.map((o) => o.value), ["x"]);
});

test("選択中の値が絞り込みで消えても先頭に補完される", () => {
  const out = sortAndFilterOptions(OPTS, "総務", "2");
  // "総務" にマッチするのは value 3 のみだが、選択中 value 2 が先頭に補完される
  assert.deepEqual(out.map((o) => o.value), ["2", "3"]);
});

test("選択値が空なら補完しない", () => {
  const out = sortAndFilterOptions(OPTS, "存在しない語", "");
  assert.deepEqual(out, []);
});
