import assert from "node:assert/strict";
import test from "node:test";
import {
  collectBalancedBraces,
  scanAndReplace,
  findBalancedCloseIndex,
  escapeBraces,
  unescapeBraces,
  splitTopLevelCommas,
} from "./templateScanner.js";

// ---------------------------------------------------------------------------
// findBalancedCloseIndex
// ---------------------------------------------------------------------------

test("findBalancedCloseIndex: 単純な {}", () => {
  assert.equal(findBalancedCloseIndex("{abc}", 0), 4);
});

test("findBalancedCloseIndex: ネストした {} を 1 段目で正しく閉じる", () => {
  assert.equal(findBalancedCloseIndex("{a{b}c}", 0), 6);
});

test("findBalancedCloseIndex: 入れ子 2 段", () => {
  assert.equal(findBalancedCloseIndex("{a{b{c}d}e}", 0), 10);
});

test("findBalancedCloseIndex: 未閉じは -1", () => {
  assert.equal(findBalancedCloseIndex("{abc", 0), -1);
});

test("findBalancedCloseIndex: 開き位置の文字が { でなければ -1", () => {
  assert.equal(findBalancedCloseIndex("a{}", 0), -1);
});

test("findBalancedCloseIndex: 中間位置の {", () => {
  assert.equal(findBalancedCloseIndex("xy{abc}z", 2), 6);
});

test("findBalancedCloseIndex: [] は無視されて } のみマッチ", () => {
  assert.equal(findBalancedCloseIndex("{a[b]c}", 0), 6);
});

test("findBalancedCloseIndex: 空 {}", () => {
  assert.equal(findBalancedCloseIndex("{}", 0), 1);
});

// ---------------------------------------------------------------------------
// collectBalancedBraces
// ---------------------------------------------------------------------------

test("collectBalancedBraces: 単一", () => {
  const tokens = collectBalancedBraces("{abc}");
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].body, "abc");
  assert.equal(tokens[0].fullToken, "{abc}");
  assert.equal(tokens[0].start, 0);
  assert.equal(tokens[0].end, 5);
});

test("collectBalancedBraces: 複数のトップレベル", () => {
  const tokens = collectBalancedBraces("{a}-{b}");
  assert.equal(tokens.length, 2);
  assert.equal(tokens[0].body, "a");
  assert.equal(tokens[1].body, "b");
});

test("collectBalancedBraces: ネストはトップレベルのみ拾う", () => {
  const tokens = collectBalancedBraces("{a{b}c}");
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].body, "a{b}c");
});

test("collectBalancedBraces: 空入力で空配列", () => {
  assert.deepEqual(collectBalancedBraces(""), []);
  assert.deepEqual(collectBalancedBraces(null), []);
  assert.deepEqual(collectBalancedBraces(undefined), []);
});

test("collectBalancedBraces: { が無いと空配列", () => {
  assert.deepEqual(collectBalancedBraces("plain text"), []);
});

test("collectBalancedBraces: 未閉じ { 以降は収集打ち切り", () => {
  const tokens = collectBalancedBraces("{a}-{b");
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].body, "a");
});

test("collectBalancedBraces: トップレベル } はスキップされる", () => {
  const tokens = collectBalancedBraces("}{abc}");
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].body, "abc");
});

test("collectBalancedBraces: 文字列リテラル含む式（{ は文字列内にない）", () => {
  const tokens = collectBalancedBraces("{UPPER('hi')}");
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].body, "UPPER('hi')");
});

test("collectBalancedBraces: 連続トークン", () => {
  const tokens = collectBalancedBraces("{a}{b}{c}");
  assert.equal(tokens.length, 3);
  assert.deepEqual(tokens.map((t) => t.body), ["a", "b", "c"]);
});

test("collectBalancedBraces: テキストとトークンが混在", () => {
  const tokens = collectBalancedBraces("Hello {name}, your age is {age}!");
  assert.equal(tokens.length, 2);
  assert.equal(tokens[0].body, "name");
  assert.equal(tokens[1].body, "age");
});

test("collectBalancedBraces: 深いネスト 3 段", () => {
  const tokens = collectBalancedBraces("{a{b{c{d}e}f}g}");
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].body, "a{b{c{d}e}f}g");
});

test("collectBalancedBraces: 空のトークン", () => {
  const tokens = collectBalancedBraces("{}");
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].body, "");
});

// ---------------------------------------------------------------------------
// scanAndReplace
// ---------------------------------------------------------------------------

test("scanAndReplace: シンプル置換", () => {
  const out = scanAndReplace("Hello {name}!", (tok) => `<${tok.body}>`);
  assert.equal(out, "Hello <name>!");
});

test("scanAndReplace: 複数トークン", () => {
  const out = scanAndReplace("{a} and {b}", (tok) => tok.body.toUpperCase());
  assert.equal(out, "A and B");
});

test("scanAndReplace: トークン無しはそのまま", () => {
  const out = scanAndReplace("plain", () => "X");
  assert.equal(out, "plain");
});

test("scanAndReplace: 空入力", () => {
  assert.equal(scanAndReplace("", () => "X"), "");
  assert.equal(scanAndReplace(null, () => "X"), "");
});

test("scanAndReplace: 未閉じ { はそのまま残る", () => {
  const out = scanAndReplace("a{b", () => "X");
  assert.equal(out, "a{b");
});

test("scanAndReplace: replacer が空文字列を返したら削除と等価", () => {
  const out = scanAndReplace("a{x}b", () => "");
  assert.equal(out, "ab");
});

test("scanAndReplace: ネストトークンも 1 つの fullToken として渡される", () => {
  let received = null;
  scanAndReplace("{a{b}c}", (tok) => { received = tok; return ""; });
  assert.equal(received.body, "a{b}c");
  assert.equal(received.fullToken, "{a{b}c}");
});

test("scanAndReplace: トークン位置情報", () => {
  const collected = [];
  scanAndReplace("aa{x}bb{yy}", (tok) => { collected.push({ start: tok.start, end: tok.end }); return ""; });
  assert.deepEqual(collected, [
    { start: 2, end: 5 },
    { start: 7, end: 11 },
  ]);
});

test("scanAndReplace: 連続トークンの置換", () => {
  const out = scanAndReplace("{1}{2}{3}", (tok) => `[${tok.body}]`);
  assert.equal(out, "[1][2][3]");
});

test("scanAndReplace: 複雑な式テキスト", () => {
  const out = scanAndReplace("{UPPER(`氏名`)}", (tok) => `<<${tok.body}>>`);
  assert.equal(out, "<<UPPER(`氏名`)>>");
});

// ---------------------------------------------------------------------------
// escapeBraces / unescapeBraces
// ---------------------------------------------------------------------------

test("escapeBraces: \\{ と \\} を中間表現に置換", () => {
  const e = escapeBraces("\\{not a token\\}");
  assert.equal(e.indexOf("\\{"), -1);
  assert.equal(e.indexOf("\\}"), -1);
  // round-trip 通せばリテラルに戻る
  assert.equal(unescapeBraces(e), "{not a token}");
});

test("escapeBraces + unescapeBraces: round trip", () => {
  const original = "\\{not\\}-{real}-\\{other";
  const escaped = escapeBraces(original);
  // 実トークンは依然 scanAndReplace で処理可能
  const replaced = scanAndReplace(escaped, (tok) => `<${tok.body}>`);
  assert.equal(unescapeBraces(replaced), "{not}-<real>-{other");
});

test("escapeBraces: 空入力", () => {
  assert.equal(escapeBraces(""), "");
  assert.equal(escapeBraces(null), "");
});

test("unescapeBraces: 空入力", () => {
  assert.equal(unescapeBraces(""), "");
  assert.equal(unescapeBraces(null), "");
});

// ---------------------------------------------------------------------------
// 統合シナリオ
// ---------------------------------------------------------------------------

test("統合: テキスト + 複数トークン + ネスト", () => {
  const input = "[start] {a} {b{c}d} [end]";
  const tokens = collectBalancedBraces(input);
  assert.deepEqual(tokens.map((t) => t.body), ["a", "b{c}d"]);
});

test("統合: 文字列内の { と } を含む式 (バッククォート識別子)", () => {
  // 注意: シングルクォート文字列内の } はトークン区切りになる。
  //       本実装は文字列リテラル考慮を行わない（構造的に式評価器が処理する責務）。
  const tokens = collectBalancedBraces("{`a` || 'x'}");
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].body, "`a` || 'x'");
});

// ---------------------------------------------------------------------------
// 二重ブレース {{ ... }} (view モード) / 単一ブレース { ... } (data モード)
// ---------------------------------------------------------------------------

test("collectBalancedBraces: 単一ブレースは mode=data", () => {
  const tokens = collectBalancedBraces("{`氏名`}");
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].mode, "data");
  assert.equal(tokens[0].body, "`氏名`");
  assert.equal(tokens[0].fullToken, "{`氏名`}");
});

test("collectBalancedBraces: 連続二重ブレースは mode=view、body は内側", () => {
  const tokens = collectBalancedBraces("{{`氏名`}}");
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].mode, "view");
  assert.equal(tokens[0].body, "`氏名`");
  assert.equal(tokens[0].fullToken, "{{`氏名`}}");
});

test("collectBalancedBraces: data と view の混在", () => {
  const tokens = collectBalancedBraces("{`a`}/{{`b`}}");
  assert.deepEqual(tokens.map((t) => [t.mode, t.body]), [
    ["data", "`a`"],
    ["view", "`b`"],
  ]);
});

test("collectBalancedBraces: 空の二重ブレース {{}}", () => {
  const tokens = collectBalancedBraces("{{}}");
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].mode, "view");
  assert.equal(tokens[0].body, "");
});

test("collectBalancedBraces: 空白を挟むと二重ブレースにならない（data + ネスト）", () => {
  // `{ {x} }` は連続していないので data モード（内側に { を含む 1 トークン）
  const tokens = collectBalancedBraces("{ {x} }");
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].mode, "data");
  assert.equal(tokens[0].body, " {x} ");
});

test("scanAndReplace: mode を replacer に渡す", () => {
  const out = scanAndReplace("{`a`}-{{`b`}}", (tok) => `${tok.mode}:${tok.body}`);
  assert.equal(out, "data:`a`-view:`b`");
});

// ---------------------------------------------------------------------------
// splitTopLevelCommas
// ---------------------------------------------------------------------------

test("splitTopLevelCommas: カンマ無しは単要素配列", () => {
  assert.deepEqual(splitTopLevelCommas("`A`"), ["`A`"]);
  assert.deepEqual(splitTopLevelCommas("`売上数量` + `売掛数量`"), ["`売上数量` + `売掛数量`"]);
});

test("splitTopLevelCommas: 空入力は単一の空文字要素", () => {
  assert.deepEqual(splitTopLevelCommas(""), [""]);
  assert.deepEqual(splitTopLevelCommas(null), [""]);
  assert.deepEqual(splitTopLevelCommas(undefined), [""]);
});

test("splitTopLevelCommas: 単純なカンマ分割と前後 trim", () => {
  assert.deepEqual(splitTopLevelCommas("`A`,`B`"), ["`A`", "`B`"]);
  assert.deepEqual(splitTopLevelCommas("`A`, `B`"), ["`A`", "`B`"]);
  assert.deepEqual(splitTopLevelCommas("  `A`  ,   `B`  "), ["`A`", "`B`"]);
});

test("splitTopLevelCommas: 末尾カンマで空要素を保持", () => {
  assert.deepEqual(splitTopLevelCommas("`A`,"), ["`A`", ""]);
});

test("splitTopLevelCommas: 連続カンマで空要素を保持", () => {
  assert.deepEqual(splitTopLevelCommas("`A`,,`B`"), ["`A`", "", "`B`"]);
});

test("splitTopLevelCommas: 関数引数のカンマは深度で保護", () => {
  assert.deepEqual(splitTopLevelCommas("IIF(`a`>0, 'pos', 'neg'), `b`"), [
    "IIF(`a`>0, 'pos', 'neg')",
    "`b`",
  ]);
});

test("splitTopLevelCommas: () [] {} のネストは深度で保護", () => {
  assert.deepEqual(splitTopLevelCommas("F(a, [1, 2], {x:1, y:2}), g"), [
    "F(a, [1, 2], {x:1, y:2})",
    "g",
  ]);
});

test("splitTopLevelCommas: 文字列リテラル内のカンマは保護", () => {
  assert.deepEqual(splitTopLevelCommas("'a,b', `c`"), ["'a,b'", "`c`"]);
});

test("splitTopLevelCommas: '' エスケープされた quote 内も保護", () => {
  assert.deepEqual(splitTopLevelCommas("'a''b,c', `d`"), ["'a''b,c'", "`d`"]);
});

test("統合: 30+ ケースを通せること", () => {
  const cases = [
    ["", []],
    ["plain", []],
    ["{a}", ["a"]],
    ["{a}{b}", ["a", "b"]],
    ["{a{b}c}", ["a{b}c"]],
    ["text {x} text", ["x"]],
    ["{}", [""]],
    ["{a{b{c}d}e}", ["a{b{c}d}e"]],
    ["{x}{y}{z}", ["x", "y", "z"]],
    ["{a}{b{c}d}", ["a", "b{c}d"]],
    ["{未閉じ", []],
    ["{a}{未閉じ", ["a"]],
    ["{`field`}", ["`field`"]],
    ["{UPPER(`a`)}", ["UPPER(`a`)"]],
    ["{a + b}", ["a + b"]],
  ];
  for (const [input, expected] of cases) {
    const tokens = collectBalancedBraces(input);
    assert.deepEqual(tokens.map((t) => t.body), expected, `case: ${JSON.stringify(input)}`);
  }
});
