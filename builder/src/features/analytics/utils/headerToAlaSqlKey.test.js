import assert from "node:assert/strict";
import test from "node:test";
import { headerKeyToAlaSqlKey } from "./headerToAlaSqlKey.js";

test("headerKeyToAlaSqlKey はパイプ区切りを __ に変換する", () => {
  assert.equal(headerKeyToAlaSqlKey("基本情報|区"), "基本情報__区");
  assert.equal(headerKeyToAlaSqlKey("親|子|孫"), "親__子__孫");
});

test("headerKeyToAlaSqlKey はスラッシュ区切りも同じ __ に揃える（/ と | を等価に扱う）", () => {
  assert.equal(headerKeyToAlaSqlKey("基本情報/区"), "基本情報__区");
  assert.equal(headerKeyToAlaSqlKey("親/子/孫"), "親__子__孫");
  // / と | の混在も同一キーへ収束する → どちらの区切りで参照しても解決できる
  assert.equal(headerKeyToAlaSqlKey("親|子/孫"), "親__子__孫");
  assert.equal(headerKeyToAlaSqlKey("親|子|孫"), headerKeyToAlaSqlKey("親/子/孫"));
});

test("headerKeyToAlaSqlKey は固定列・空をそのまま返す", () => {
  assert.equal(headerKeyToAlaSqlKey("createdAt"), "createdAt");
  assert.equal(headerKeyToAlaSqlKey("No."), "No.");
  assert.equal(headerKeyToAlaSqlKey(""), "");
  assert.equal(headerKeyToAlaSqlKey(null), "");
});
