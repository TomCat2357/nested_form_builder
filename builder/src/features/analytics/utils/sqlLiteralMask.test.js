import assert from "node:assert/strict";
import test from "node:test";
import {
  scanMaskRegions,
  maskWithPlaceholders,
  maskWithSpaces,
  KIND_SINGLE_QUOTE,
  KIND_DOUBLE_QUOTE,
  KIND_BRACKET,
  KIND_BACKTICK,
  KIND_LINE_COMMENT,
  KIND_BLOCK_COMMENT,
} from "./sqlLiteralMask.js";

// -------- scanMaskRegions --------

test("scanMaskRegions: 単一引用符のみ既定で対象", () => {
  const r = scanMaskRegions("a = 'x' AND b = 1");
  assert.deepEqual(r, [{ start: 4, end: 7, kind: KIND_SINGLE_QUOTE }]);
});

test("scanMaskRegions: '' エスケープを跨いで終端を見つける", () => {
  const sql = "name = 'O''Brien'";
  const r = scanMaskRegions(sql);
  assert.equal(r.length, 1);
  assert.equal(sql.substring(r[0].start, r[0].end), "'O''Brien'");
});

test("scanMaskRegions: singleQuoteAllowsBackslash で \\' エスケープを跨ぐ", () => {
  const sql = "name = 'a\\'b'";
  const r = scanMaskRegions(sql, { singleQuoteAllowsBackslash: true });
  assert.equal(r.length, 1);
  assert.equal(sql.substring(r[0].start, r[0].end), "'a\\'b'");
});

test("scanMaskRegions: includeDoubleQuote で \"...\" を対象に追加", () => {
  const sql = `a = "x" AND b = 'y'`;
  const r = scanMaskRegions(sql, { includeDoubleQuote: true });
  assert.deepEqual(r.map((x) => x.kind), [KIND_DOUBLE_QUOTE, KIND_SINGLE_QUOTE]);
});

test("scanMaskRegions: includeBracket / includeBacktick で識別子も対象", () => {
  const sql = "SELECT [col], `c2` FROM t";
  const r = scanMaskRegions(sql, { includeBracket: true, includeBacktick: true });
  assert.deepEqual(r.map((x) => x.kind), [KIND_BRACKET, KIND_BACKTICK]);
});

test("scanMaskRegions: includeLineComment で -- ... \\n 直前まで", () => {
  const sql = "SELECT 1 -- inline\nFROM t";
  const r = scanMaskRegions(sql, { includeLineComment: true });
  assert.equal(r.length, 1);
  assert.equal(sql.substring(r[0].start, r[0].end), "-- inline");
});

test("scanMaskRegions: includeBlockComment で /* ... */ を含む", () => {
  const sql = "SELECT 1 /* a\nb */ FROM t";
  const r = scanMaskRegions(sql, { includeBlockComment: true });
  assert.equal(r.length, 1);
  assert.equal(sql.substring(r[0].start, r[0].end), "/* a\nb */");
});

test("scanMaskRegions: 未閉じブロックコメントは末尾まで", () => {
  const sql = "x /* abc";
  const r = scanMaskRegions(sql, { includeBlockComment: true });
  assert.equal(r.length, 1);
  assert.equal(r[0].end, sql.length);
});

test("scanMaskRegions: 未閉じブラケットは末尾まで", () => {
  const sql = "SELECT [abc";
  const r = scanMaskRegions(sql, { includeBracket: true });
  assert.equal(r.length, 1);
  assert.equal(r[0].end, sql.length);
});

// -------- maskWithPlaceholders --------

test("maskWithPlaceholders: 文字列リテラルを SOH 囲み番号で置換し復元できる", () => {
  const { masked, unmask } = maskWithPlaceholders("SELECT 'a' || 'b' FROM t");
  // masked から ' は完全に消える
  assert.equal(masked.includes("'"), false);
  // 復元すると元に戻る
  assert.equal(unmask(masked), "SELECT 'a' || 'b' FROM t");
});

test("maskWithPlaceholders: placeholders 配列は元領域文字列を保持", () => {
  const { placeholders } = maskWithPlaceholders("a 'x' b 'yy'");
  assert.deepEqual(placeholders, ["'x'", "'yy'"]);
});

test("maskWithPlaceholders: 復元は派生文字列に対しても安全（識別子と衝突しない）", () => {
  // SOH に囲まれた数字以外は復元対象にならない
  const { masked, unmask } = maskWithPlaceholders("SELECT 'lit' AS L0 FROM t");
  // masked には placeholder トークンと L0 識別子が両方含まれる
  assert.match(masked, /L0/);
  // 復元時に L0 が誤って展開されない（PLACEHOLDER_RE は SOH に囲まれた数字だけを拾う）
  const restored = unmask(masked);
  assert.equal(restored, "SELECT 'lit' AS L0 FROM t");
});

test("maskWithPlaceholders: コメントも対象に含められる", () => {
  const { masked, unmask } = maskWithPlaceholders(
    "SELECT 1 -- comment\n/* block */ FROM t",
    { includeLineComment: true, includeBlockComment: true }
  );
  assert.equal(masked.includes("--"), false);
  assert.equal(masked.includes("/*"), false);
  assert.equal(unmask(masked), "SELECT 1 -- comment\n/* block */ FROM t");
});

test("maskWithPlaceholders: 入力が null / undefined のとき空文字扱い", () => {
  assert.equal(maskWithPlaceholders(null).masked, "");
  assert.equal(maskWithPlaceholders(undefined).masked, "");
});

test("maskWithPlaceholders: 復元関数は書き換え後の文字列でも動く", () => {
  const { masked, unmask, placeholders } = maskWithPlaceholders("WHERE name = 'O''Brien'");
  // 別の書き換え工程（架空）を経た文字列でも placeholder が残っていれば復元される
  const transformed = masked.replace(/WHERE/, "FILTER");
  assert.equal(unmask(transformed), "FILTER name = 'O''Brien'");
  assert.equal(placeholders.length, 1);
});

// -------- maskWithSpaces --------

test("maskWithSpaces: 文字列リテラル内部を空白で覆い、長さを保持する", () => {
  const sql = "SELECT 'abc' FROM t";
  const masked = maskWithSpaces(sql);
  assert.equal(masked.length, sql.length);
  assert.equal(masked, "SELECT       FROM t");
});

test("maskWithSpaces: ブラケットは [ ] を残して中身だけ空白", () => {
  const sql = "SELECT [name|x] FROM t";
  const masked = maskWithSpaces(sql, { includeBracket: true });
  assert.equal(masked.length, sql.length);
  assert.equal(masked, "SELECT [      ] FROM t");
});

test("maskWithSpaces: バッククォートも `..` を残す", () => {
  const sql = "SELECT `col,1` FROM t";
  const masked = maskWithSpaces(sql, { includeBacktick: true });
  assert.equal(masked.length, sql.length);
  assert.equal(masked, "SELECT `     ` FROM t");
});

test("maskWithSpaces: 未閉じブラケットでも長さ保存・末尾に ] を補う", () => {
  const sql = "SELECT [abc";
  const masked = maskWithSpaces(sql, { includeBracket: true });
  assert.equal(masked.length, sql.length);
  assert.equal(masked.charAt(masked.length - 1), "]");
});

test("maskWithSpaces: \\' エスケープを含む文字列を 1 トークンとして覆う", () => {
  const sql = "WHERE name = 'a\\'b' AND id = 1";
  const masked = maskWithSpaces(sql, { singleQuoteAllowsBackslash: true });
  assert.equal(masked.length, sql.length);
  // 1 つ目の '...' 全体が空白化
  assert.equal(masked, "WHERE name =        AND id = 1");
});

test("maskWithSpaces: '' エスケープを含む文字列を 1 トークンとして覆う", () => {
  const sql = "WHERE name = 'O''Brien' AND id = 1";
  const masked = maskWithSpaces(sql);
  assert.equal(masked.length, sql.length);
  // 'O''Brien' (長さ 10) 全体が空白化
  assert.equal(masked, "WHERE name =            AND id = 1");
});

test("maskWithSpaces: 文字列内のカンマ・括弧・キーワードがマスクされる", () => {
  const sql = "WHERE x = 'a, b, FROM, (subq)' AND y = 1";
  const masked = maskWithSpaces(sql);
  // マスク後の文字列にカンマ・括弧・FROM は出現しない
  assert.equal(masked.includes(","), false);
  assert.equal(masked.includes("("), false);
  assert.equal(masked.includes(")"), false);
  assert.equal(masked.includes("FROM"), false);
  assert.equal(masked.length, sql.length);
});

test("maskWithSpaces: 入力が null / undefined のとき空文字", () => {
  assert.equal(maskWithSpaces(null), "");
  assert.equal(maskWithSpaces(undefined), "");
});
