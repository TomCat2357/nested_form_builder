import assert from "node:assert/strict";
import test from "node:test";
import { preprocessAlaSqlExpression } from "./preprocessAlaSqlExpression.js";

test("バッククォート列名のパイプを __ に変換する", () => {
  assert.equal(
    preprocessAlaSqlExpression("`基本情報|区` = '新宿区'"),
    "`基本情報__区` = '新宿区'"
  );
});

test("複数のバッククォート列名を変換する", () => {
  assert.equal(
    preprocessAlaSqlExpression("`a|b` + `c|d`"),
    "`a__b` + `c__d`"
  );
});

test("文字列リテラル内のパイプは保護される", () => {
  assert.equal(
    preprocessAlaSqlExpression("`氏名` = 'a|b|c'"),
    "`氏名` = 'a|b|c'"
  );
});

test("ダブルクォート文字列内のパイプも保護される", () => {
  assert.equal(
    preprocessAlaSqlExpression('`氏名` = "a|b"'),
    '`氏名` = "a|b"'
  );
});

test("バッククォート無しの識別子はそのまま", () => {
  assert.equal(
    preprocessAlaSqlExpression("年齢 >= 20"),
    "年齢 >= 20"
  );
});

test("空入力は空文字を返す", () => {
  assert.equal(preprocessAlaSqlExpression(""), "");
  assert.equal(preprocessAlaSqlExpression(null), "");
  assert.equal(preprocessAlaSqlExpression(undefined), "");
});

test("関数呼び出しと組み合わせ", () => {
  assert.equal(
    preprocessAlaSqlExpression("YEAR(`受付日|タイムスタンプ`) = 2025"),
    "YEAR(`受付日__タイムスタンプ`) = 2025"
  );
});

test("シングルクォートのエスケープ ('') を含む文字列を保護する", () => {
  assert.equal(
    preprocessAlaSqlExpression("`氏名` = 'O''Brien|Junior'"),
    "`氏名` = 'O''Brien|Junior'"
  );
});

test("角括弧列名のパイプを __ に変換する", () => {
  assert.equal(
    preprocessAlaSqlExpression("[基本情報|区] = '新宿区'"),
    "[基本情報__区] = '新宿区'"
  );
});

test("複数の角括弧列名を変換する", () => {
  assert.equal(
    preprocessAlaSqlExpression("[a|b] + [c|d]"),
    "[a__b] + [c__d]"
  );
});

test("バッククォートと角括弧の混在を変換する", () => {
  assert.equal(
    preprocessAlaSqlExpression("`a|b` = [c|d]"),
    "`a__b` = [c__d]"
  );
});

test("角括弧 — 文字列リテラル内の [a|b] は保護される", () => {
  assert.equal(
    preprocessAlaSqlExpression("[氏名] = '[a|b]'"),
    "[氏名] = '[a|b]'"
  );
});

test("固定列 No. は角括弧で書いても No_ に変換される", () => {
  assert.equal(preprocessAlaSqlExpression("[No.] = 1"), "[No_] = 1");
});

test("固定列 No. はバッククォートで書いても No_ に変換される", () => {
  assert.equal(preprocessAlaSqlExpression("`No.` = 1"), "`No_` = 1");
});

test("角括弧 CASE WHEN 実例を変換する", () => {
  const input = [
    "CASE",
    "  WHEN [設置場所] IS NULL OR [設置場所] = '' THEN '未設置'",
    "  WHEN [設置場所|設置開始日] IS NOT NULL AND [設置場所|設置開始日] <> ''",
    "    AND ([設置場所|設置終了日] IS NULL OR [設置場所|設置終了日] = '') THEN '設置中'",
    "  WHEN [設置場所|設置終了日] IS NOT NULL AND [設置場所|設置終了日] <> '' THEN '回収済'",
    "END AS [状態]"
  ].join("\n");
  const expected = [
    "CASE",
    "  WHEN [設置場所] IS NULL OR [設置場所] = '' THEN '未設置'",
    "  WHEN [設置場所__設置開始日] IS NOT NULL AND [設置場所__設置開始日] <> ''",
    "    AND ([設置場所__設置終了日] IS NULL OR [設置場所__設置終了日] = '') THEN '設置中'",
    "  WHEN [設置場所__設置終了日] IS NOT NULL AND [設置場所__設置終了日] <> '' THEN '回収済'",
    "END AS [状態]"
  ].join("\n");
  assert.equal(preprocessAlaSqlExpression(input), expected);
});
