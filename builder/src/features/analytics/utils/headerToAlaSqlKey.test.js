import assert from "node:assert/strict";
import test from "node:test";
import { headerKeyToAlaSqlKey } from "./headerToAlaSqlKey.js";

test("固定列 No. は行の実キー No_ にエイリアスされる", () => {
  assert.equal(headerKeyToAlaSqlKey("No."), "No_");
});

test("他の固定列(id, createdAt 等)は無変換のまま", () => {
  assert.equal(headerKeyToAlaSqlKey("id"), "id");
  assert.equal(headerKeyToAlaSqlKey("createdAt"), "createdAt");
  assert.equal(headerKeyToAlaSqlKey("pid"), "pid");
});

test("パス区切り(/ と legacy |)は従来どおり __ に変換される", () => {
  assert.equal(headerKeyToAlaSqlKey("基本情報/区"), "基本情報__区");
  assert.equal(headerKeyToAlaSqlKey("基本情報|区"), "基本情報__区");
});

test("空入力は空文字を返す", () => {
  assert.equal(headerKeyToAlaSqlKey(""), "");
  assert.equal(headerKeyToAlaSqlKey(null), "");
  assert.equal(headerKeyToAlaSqlKey(undefined), "");
});
