import test from "node:test";
import assert from "node:assert/strict";
import { buildSearchTableLayout, createBaseColumns } from "./searchTable.js";
import { computeRowValues, isEmptyCell, collectMultiValueTokens } from "./searchTableValues.js";
import {
  matchesKeyword,
  collectSearchPatterns,
  collectConditionColumns,
  buildRowHitExcerpts,
} from "./searchQueryEngine.js";

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

const buildSpeciesForm = () => ({
  settings: {},
  schema: [
    {
      type: "checkboxes",
      label: "対象種",
      options: [
        { label: "カラス" },
        { label: "キタツネ" },
        { label: "ハト" },
        { label: "エゾシカ" },
        { label: "ヒグマ" },
        { label: "スズメ" },
      ],
    },
  ],
  displayFieldSettings: [{ path: "対象種", type: "checkboxes" }],
});

const buildNestedSpeciesForm = () => ({
  settings: {},
  schema: [
    {
      type: "radio",
      label: "相談大分類",
      options: [{ label: "野生鳥獣" }, { label: "生物多様性" }],
      childrenByValue: {
        野生鳥獣: [
          {
            type: "checkboxes",
            label: "対象種",
            options: [
              { label: "カラス" },
              { label: "キタツネ" },
              { label: "ハト" },
              { label: "エゾシカ" },
            ],
          },
        ],
      },
    },
  ],
  displayFieldSettings: [
    { path: "相談大分類", type: "radio" },
    { path: "相談大分類|野生鳥獣|対象種", type: "checkboxes" },
  ],
});

const buildSpeciesRow = (formBuilder, dataPathPrefix, optionLabels) => {
  const form = formBuilder();
  const { columns } = buildSearchTableLayout(form, { includeOperations: false });
  const data = {};
  optionLabels.forEach((label) => {
    data[`${dataPathPrefix}|${label}`] = true;
  });
  const entry = {
    id: `r_${optionLabels.join("_") || "empty"}`,
    "No.": 1,
    modifiedAtUnixMs: Date.UTC(2026, 0, 1, 0, 0, 0),
    modifiedAt: Date.UTC(2026, 0, 1, 0, 0, 0),
    data,
    dataUnixMs: {},
  };
  const row = { entry, values: computeRowValues(entry, columns) };
  return { row, columns };
};

const buildSingleSpeciesRow = (label) => buildSpeciesRow(buildSpeciesForm, "対象種", label ? [label] : []);
const buildMultiSpeciesRow = (labels) => buildSpeciesRow(buildSpeciesForm, "対象種", labels);
const buildNestedSpeciesRow = (labels) => {
  const form = buildNestedSpeciesForm();
  const { columns } = buildSearchTableLayout(form, { includeOperations: false });
  const data = { 相談大分類: "野生鳥獣" };
  labels.forEach((label) => {
    data[`相談大分類|野生鳥獣|対象種|${label}`] = true;
  });
  const entry = {
    id: `r_nested_${labels.join("_") || "empty"}`,
    "No.": 1,
    modifiedAtUnixMs: Date.UTC(2026, 0, 1, 0, 0, 0),
    modifiedAt: Date.UTC(2026, 0, 1, 0, 0, 0),
    data,
    dataUnixMs: {},
  };
  const row = { entry, values: computeRowValues(entry, columns) };
  return { row, columns };
};

// ────────────────────────────────────────────────────────────
// 1. `=` 厳密一致セマンティクス（multi-value セルは集合分解）
// ────────────────────────────────────────────────────────────

test("=: 単一値セル × 厳密一致でマッチ", () => {
  const { row, columns } = buildSingleSpeciesRow("カラス");
  assert.equal(matchesKeyword(row, columns, "対象種=カラス"), true);
});

test("=: 単一値セル × 異なる値ではマッチしない", () => {
  const { row, columns } = buildSingleSpeciesRow("キタツネ");
  assert.equal(matchesKeyword(row, columns, "対象種=カラス"), false);
});

test("=: 複数値セルでも集合に含まれる値ならマッチ", () => {
  const { row, columns } = buildMultiSpeciesRow(["カラス", "キタツネ"]);
  assert.equal(matchesKeyword(row, columns, "対象種=カラス"), true);
});

test("=: 複数値セルに値が含まれなければマッチしない", () => {
  const { row, columns } = buildMultiSpeciesRow(["キタツネ", "エゾシカ"]);
  assert.equal(matchesKeyword(row, columns, "対象種=カラス"), false);
});

test("=: 空セルはマッチしない", () => {
  const { row, columns } = buildSingleSpeciesRow(null);
  assert.equal(matchesKeyword(row, columns, "対象種=カラス"), false);
});

test("=: 部分文字列ではマッチしない（厳密一致のため）", () => {
  // "カラスの巣" という単一値（テキスト想定）を radio 風に組む代わりに、
  // checkboxes ではオプションラベルが厳密一致しないとマッチしないことで担保される
  const { row, columns } = buildSingleSpeciesRow("カラス");
  assert.equal(matchesKeyword(row, columns, "対象種=カ"), false);
});

// ────────────────────────────────────────────────────────────
// 2. `:` 含有（回帰）
// ────────────────────────────────────────────────────────────

test(": 単一値セルに部分一致する", () => {
  const { row, columns } = buildSingleSpeciesRow("カラス");
  assert.equal(matchesKeyword(row, columns, "対象種:カ"), true);
});

test(": 複数値セルにも部分一致する", () => {
  const { row, columns } = buildMultiSpeciesRow(["カラス", "キタツネ"]);
  assert.equal(matchesKeyword(row, columns, "対象種:カラス"), true);
});

// ────────────────────────────────────────────────────────────
// 3. `<>` / `!=` 厳密一致以外（multi-value 集合分解）
// ────────────────────────────────────────────────────────────

test("<>: 単一値セルで一致しなければマッチ", () => {
  const { row, columns } = buildSingleSpeciesRow("キタツネ");
  assert.equal(matchesKeyword(row, columns, "対象種<>カラス"), true);
});

test("<>: 単一値セルで一致したらマッチしない", () => {
  const { row, columns } = buildSingleSpeciesRow("カラス");
  assert.equal(matchesKeyword(row, columns, "対象種<>カラス"), false);
});

test("<>: 複数値セルに対象を含む場合はマッチしない（バグ修正の核心）", () => {
  const { row, columns } = buildMultiSpeciesRow(["カラス", "キタツネ"]);
  assert.equal(matchesKeyword(row, columns, "対象種<>カラス"), false);
});

test("<>: 複数値セルに対象を含まない場合はマッチ", () => {
  const { row, columns } = buildMultiSpeciesRow(["キタツネ", "エゾシカ"]);
  assert.equal(matchesKeyword(row, columns, "対象種<>カラス"), true);
});

test("<>: 空セルは「カラスではない」のでマッチ", () => {
  const { row, columns } = buildSingleSpeciesRow(null);
  assert.equal(matchesKeyword(row, columns, "対象種<>カラス"), true);
});

test("!=: <> と同一動作（複数値に対象を含む場合マッチしない）", () => {
  const { row, columns } = buildMultiSpeciesRow(["カラス", "キタツネ"]);
  assert.equal(matchesKeyword(row, columns, "対象種!=カラス"), false);
});

test("!=: <> と同一動作（複数値に対象を含まない場合マッチ）", () => {
  const { row, columns } = buildMultiSpeciesRow(["キタツネ", "エゾシカ"]);
  assert.equal(matchesKeyword(row, columns, "対象種!=カラス"), true);
});

// ────────────────────────────────────────────────────────────
// 4. `in (...)`
// ────────────────────────────────────────────────────────────

test("in: 単一値セルがリストに含まれればマッチ", () => {
  const { row, columns } = buildSingleSpeciesRow("カラス");
  assert.equal(matchesKeyword(row, columns, "対象種 in (カラス, キタツネ)"), true);
});

test("in: 単一値セルがリストに含まれなければマッチしない", () => {
  const { row, columns } = buildSingleSpeciesRow("エゾシカ");
  assert.equal(matchesKeyword(row, columns, "対象種 in (カラス, キタツネ)"), false);
});

test("in: 複数値セルとリストに共通要素があればマッチ", () => {
  const { row, columns } = buildMultiSpeciesRow(["カラス", "ハト"]);
  assert.equal(matchesKeyword(row, columns, "対象種 in (キタツネ, ハト)"), true);
});

test("in: 複数値セルとリストに共通要素が無ければマッチしない", () => {
  const { row, columns } = buildMultiSpeciesRow(["エゾシカ", "ヒグマ"]);
  assert.equal(matchesKeyword(row, columns, "対象種 in (カラス, キタツネ)"), false);
});

test("in: 空セルはマッチしない", () => {
  const { row, columns } = buildSingleSpeciesRow(null);
  assert.equal(matchesKeyword(row, columns, "対象種 in (カラス)"), false);
});

test('in: 引用付き値も正しくパースされる', () => {
  const { row, columns } = buildSingleSpeciesRow("カラス");
  assert.equal(matchesKeyword(row, columns, '対象種 in ("カラス", \'キタツネ\')'), true);
});

test("in: 値リスト中の余白を許容する", () => {
  const { row, columns } = buildSingleSpeciesRow("キタツネ");
  assert.equal(matchesKeyword(row, columns, "対象種 in ( カラス , キタツネ )"), true);
});

// ────────────────────────────────────────────────────────────
// 5. `not in (...)`
// ────────────────────────────────────────────────────────────

test("not in: 複数値セルにリスト要素が含まれていればマッチしない", () => {
  const { row, columns } = buildMultiSpeciesRow(["カラス", "キタツネ"]);
  assert.equal(matchesKeyword(row, columns, "対象種 not in (カラス)"), false);
});

test("not in: 複数値セルにリスト要素が全く含まれなければマッチ", () => {
  const { row, columns } = buildMultiSpeciesRow(["エゾシカ", "ヒグマ"]);
  assert.equal(matchesKeyword(row, columns, "対象種 not in (カラス, キタツネ)"), true);
});

test("not in: 空セルはマッチ（空はリストに含まれない）", () => {
  const { row, columns } = buildSingleSpeciesRow(null);
  assert.equal(matchesKeyword(row, columns, "対象種 not in (カラス)"), true);
});

// ────────────────────────────────────────────────────────────
// 6. `not(...)` AST否定との等価性（回帰）
// ────────────────────────────────────────────────────────────

test("not(対象種=カラス) は 対象種<>カラス と一致（単一値）", () => {
  const a = buildSingleSpeciesRow("カラス");
  const b = buildSingleSpeciesRow("キタツネ");
  const empty = buildSingleSpeciesRow(null);
  for (const { row, columns } of [a, b, empty]) {
    assert.equal(
      matchesKeyword(row, columns, "not(対象種=カラス)"),
      matchesKeyword(row, columns, "対象種<>カラス"),
    );
  }
});

test("not(対象種=カラス) は 対象種<>カラス と一致（複数値）", () => {
  const cases = [
    buildMultiSpeciesRow(["カラス", "キタツネ"]),
    buildMultiSpeciesRow(["キタツネ", "エゾシカ"]),
  ];
  for (const { row, columns } of cases) {
    assert.equal(
      matchesKeyword(row, columns, "not(対象種=カラス)"),
      matchesKeyword(row, columns, "対象種<>カラス"),
    );
  }
});

test("not(対象種 in (...)) は 対象種 not in (...) と一致", () => {
  const cases = [
    buildSingleSpeciesRow("カラス"),
    buildMultiSpeciesRow(["カラス", "キタツネ"]),
    buildMultiSpeciesRow(["エゾシカ", "ヒグマ"]),
    buildSingleSpeciesRow(null),
  ];
  for (const { row, columns } of cases) {
    assert.equal(
      matchesKeyword(row, columns, "not(対象種 in (カラス, キタツネ))"),
      matchesKeyword(row, columns, "対象種 not in (カラス, キタツネ)"),
    );
  }
});

// ────────────────────────────────────────────────────────────
// 7. マルチヘッダーパス（パイプ区切り）× 否定 / in（バグ再現テスト）
// ────────────────────────────────────────────────────────────

test("マルチヘッダーパス × <>: 複数値セルに対象を含む行は除外される", () => {
  const { row, columns } = buildNestedSpeciesRow(["カラス", "キタツネ"]);
  assert.equal(
    matchesKeyword(row, columns, "相談大分類|野生鳥獣|対象種<>カラス"),
    false,
  );
});

test("マルチヘッダーパス × <>: カラスを含まない複数値セルは残る", () => {
  const { row, columns } = buildNestedSpeciesRow(["キタツネ", "エゾシカ"]);
  assert.equal(
    matchesKeyword(row, columns, "相談大分類|野生鳥獣|対象種<>カラス"),
    true,
  );
});

test("マルチヘッダーパス × in: 集合に含まれる行はマッチ", () => {
  const { row, columns } = buildNestedSpeciesRow(["カラス", "ハト"]);
  assert.equal(
    matchesKeyword(row, columns, "相談大分類|野生鳥獣|対象種 in (カラス)"),
    true,
  );
});

test("マルチヘッダーパス × not in: 集合にリスト要素を含まなければマッチ", () => {
  const { row, columns } = buildNestedSpeciesRow(["エゾシカ"]);
  assert.equal(
    matchesKeyword(row, columns, "相談大分類|野生鳥獣|対象種 not in (カラス, キタツネ)"),
    true,
  );
});

// ────────────────────────────────────────────────────────────
// 8. AND/OR との複合
// ────────────────────────────────────────────────────────────

test("AND複合: 厳密一致 × 単純テキスト", () => {
  const form = {
    settings: {},
    schema: [
      {
        type: "checkboxes",
        label: "対象種",
        options: [{ label: "カラス" }, { label: "キタツネ" }],
      },
      { type: "text", label: "備考" },
    ],
    displayFieldSettings: [
      { path: "対象種", type: "checkboxes" },
      { path: "備考", type: "text" },
    ],
  };
  const { columns } = buildSearchTableLayout(form, { includeOperations: false });
  const entry = {
    id: "r_compound_and",
    "No.": 1,
    modifiedAtUnixMs: Date.UTC(2026, 0, 1, 0, 0, 0),
    modifiedAt: Date.UTC(2026, 0, 1, 0, 0, 0),
    data: { "対象種|カラス": true, "対象種|キタツネ": true, 備考: "市街地" },
    dataUnixMs: {},
  };
  const row = { entry, values: computeRowValues(entry, columns) };

  assert.equal(matchesKeyword(row, columns, "対象種=カラス and 備考:市街地"), true);
  assert.equal(matchesKeyword(row, columns, "対象種=カラス and 備考:山間部"), false);
});

test("OR複合: in と = の OR 結合", () => {
  const a = buildSingleSpeciesRow("ハト");
  const b = buildSingleSpeciesRow("エゾシカ");
  assert.equal(
    matchesKeyword(a.row, a.columns, "対象種 in (カラス, キタツネ) or 対象種=ハト"),
    true,
  );
  assert.equal(
    matchesKeyword(b.row, b.columns, "対象種 in (カラス, キタツネ) or 対象種=ハト"),
    false,
  );
});

// ────────────────────────────────────────────────────────────
// 6. 空欄判定ヘルパー / 引用付き空文字検索
// ────────────────────────────────────────────────────────────

test("isEmptyCell: null / undefined / 空文字を空欄とみなす", () => {
  assert.equal(isEmptyCell(null), true);
  assert.equal(isEmptyCell(undefined), true);
  assert.equal(isEmptyCell(""), true);
  assert.equal(isEmptyCell(0), false);
  assert.equal(isEmptyCell("0"), false);
  assert.equal(isEmptyCell(false), false);
  assert.equal(isEmptyCell(" "), false);
});

test("collectMultiValueTokens: candidate 配列を「,」で平坦化", () => {
  assert.deepEqual(collectMultiValueTokens(["カラス,キタツネ", "ハト"]), ["カラス", "キタツネ", "ハト"]);
  assert.deepEqual(collectMultiValueTokens([]), []);
  assert.deepEqual(collectMultiValueTokens([""]), []);
  assert.deepEqual(collectMultiValueTokens(null), []);
});

test('field="": 引用付き空文字検索は空セルにヒット', () => {
  const empty = buildSingleSpeciesRow(null);
  const filled = buildSingleSpeciesRow("カラス");
  assert.equal(matchesKeyword(empty.row, empty.columns, '対象種=""'), true);
  assert.equal(matchesKeyword(filled.row, filled.columns, '対象種=""'), false);
});

test('field<>"": 引用付き空文字 not-equal は空でない行にヒット', () => {
  const empty = buildSingleSpeciesRow(null);
  const filled = buildSingleSpeciesRow("カラス");
  assert.equal(matchesKeyword(empty.row, empty.columns, '対象種<>""'), false);
  assert.equal(matchesKeyword(filled.row, filled.columns, '対象種<>""'), true);
});

// ────────────────────────────────────────────────────────────
// 7. 正規表現一本化（自由文 = 正規表現）
// ────────────────────────────────────────────────────────────

const buildTextRow = (values) => {
  const form = {
    settings: {},
    schema: [
      { type: "text", label: "氏名" },
      { type: "text", label: "備考" },
    ],
    displayFieldSettings: [
      { path: "氏名", type: "text" },
      { path: "備考", type: "text" },
    ],
  };
  const { columns } = buildSearchTableLayout(form, { includeOperations: false });
  const entry = {
    id: "r_text",
    "No.": 1,
    modifiedAtUnixMs: Date.UTC(2026, 0, 1, 0, 0, 0),
    modifiedAt: Date.UTC(2026, 0, 1, 0, 0, 0),
    data: { ...values },
    dataUnixMs: {},
  };
  const row = { entry, values: computeRowValues(entry, columns) };
  return { row, columns };
};

test("正規表現: 列指定 ^ 先頭一致", () => {
  const a = buildTextRow({ 氏名: "山田太郎" });
  const b = buildTextRow({ 氏名: "中山田子" });
  assert.equal(matchesKeyword(a.row, a.columns, "氏名:^山田"), true);
  assert.equal(matchesKeyword(b.row, b.columns, "氏名:^山田"), false);
});

test("正規表現: 列指定の交替 (a|b)", () => {
  const a = buildTextRow({ 氏名: "田中" });
  const b = buildTextRow({ 氏名: "佐藤" });
  assert.equal(matchesKeyword(a.row, a.columns, "氏名:山田|田中"), true);
  assert.equal(matchesKeyword(b.row, b.columns, "氏名:山田|田中"), false);
});

test("正規表現: 裸単語は全列を正規表現で横断", () => {
  const a = buildTextRow({ 氏名: "鈴木", 備考: "市街地で目撃" });
  assert.equal(matchesKeyword(a.row, a.columns, "市.地"), true);
  assert.equal(matchesKeyword(a.row, a.columns, "山.地"), false);
});

test("正規表現: プレーン語は従来どおり部分一致", () => {
  const a = buildTextRow({ 氏名: "山田太郎" });
  assert.equal(matchesKeyword(a.row, a.columns, "氏名:山田"), true);
  assert.equal(matchesKeyword(a.row, a.columns, "山田"), true);
});

test("正規表現: 旧スラッシュ構文は後方互換で動く", () => {
  const a = buildTextRow({ 氏名: "山田太郎" });
  const b = buildTextRow({ 氏名: "中山田" });
  assert.equal(matchesKeyword(a.row, a.columns, "氏名:/^山田/"), true);
  assert.equal(matchesKeyword(b.row, b.columns, "氏名:/^山田/"), false);
});

test("正規表現: 不正な式はリテラル扱いにフォールバック", () => {
  const a = buildTextRow({ 備考: "区分[A]" });
  // "備考:[" は不正な正規表現 → "[" をリテラルとして検索しヒット
  assert.equal(matchesKeyword(a.row, a.columns, "備考:["), true);
});

// ────────────────────────────────────────────────────────────
// 8. ヒット抜粋 API（③ 表示モード用）
// ────────────────────────────────────────────────────────────

test("collectSearchPatterns: 裸単語と列指定を収集", () => {
  assert.deepEqual(collectSearchPatterns("山田 氏名:^田中"), [
    { column: null, source: "山田" },
    { column: "氏名", source: "^田中" },
  ]);
});

test("collectSearchPatterns: 厳密モードは空配列", () => {
  assert.deepEqual(collectSearchPatterns("SEARCH `氏名` LIKE '%田%'"), []);
});

test("buildRowHitExcerpts: ヒット列にセグメントとラベルを返す", () => {
  const { row, columns } = buildTextRow({ 氏名: "山田太郎", 備考: "市街地" });
  const hits = buildRowHitExcerpts(row, columns, "氏名:山田");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].columnLabel, "氏名");
  const hitText = hits[0].segments.filter((s) => s.hit).map((s) => s.text).join("");
  assert.equal(hitText, "山田");
});

test("buildRowHitExcerpts: 裸単語は複数列にヒットしうる", () => {
  const { row, columns } = buildTextRow({ 氏名: "市川", 備考: "市街地" });
  const hits = buildRowHitExcerpts(row, columns, "市");
  assert.equal(hits.length, 2);
});

test("buildRowHitExcerpts: 表示列に無い entry.data フィールドのヒットもラベル付きで返す", () => {
  // メモ は schema/表示列に無く entry.data だけに存在する非表示フィールド。
  const { row, columns } = buildTextRow({ 氏名: "山田太郎" });
  row.entry.data.メモ = "重要な連絡事項あり";
  const hits = buildRowHitExcerpts(row, columns, "連絡");
  const memoHit = hits.find((h) => h.columnLabel === "メモ");
  assert.ok(memoHit, "非表示フィールド メモ の抜粋が返るべき");
  const hitText = memoHit.segments.filter((s) => s.hit).map((s) => s.text).join("");
  assert.equal(hitText, "連絡");
});

test("buildRowHitExcerpts: 長文中央ヒットは budget 内に収め両端を … で省略", () => {
  const long = "あ".repeat(50) + "目印" + "い".repeat(50);
  const { row, columns } = buildTextRow({ 氏名: "x", 備考: long });
  const hits = buildRowHitExcerpts(row, columns, "備考:目印", { cellDisplayLimit: 20 });
  const hit = hits.find((h) => h.columnLabel === "備考");
  assert.ok(hit);
  const visible = hit.segments.filter((s) => s.text !== "…").map((s) => s.text).join("");
  assert.ok(visible.length <= 20, `可視長 ${visible.length} は budget 20 以内であるべき`);
  assert.equal(hit.segments[0].text, "…");
  assert.equal(hit.segments[hit.segments.length - 1].text, "…");
  assert.ok(hit.segments.some((s) => s.hit && s.text === "目印"));
});

test("buildRowHitExcerpts: cellDisplayLimit 未指定なら既定 40 字で抑制", () => {
  const long = "x".repeat(100) + "鍵" + "y".repeat(100);
  const { row, columns } = buildTextRow({ 氏名: "a", 備考: long });
  const hits = buildRowHitExcerpts(row, columns, "備考:鍵");
  const hit = hits.find((h) => h.columnLabel === "備考");
  assert.ok(hit);
  const visible = hit.segments.filter((s) => s.text !== "…").map((s) => s.text).join("");
  assert.ok(visible.length <= 40, `可視長 ${visible.length} は既定 40 以内であるべき`);
});

// ────────────────────────────────────────────────────────────
// 自由文検索は値のみを対象にする（質問名にはマッチしない）
// ────────────────────────────────────────────────────────────

test("PARTIAL: 選択肢フィールドの質問名にはマッチしない（値のみ対象）", () => {
  const { row, columns } = buildSingleSpeciesRow("カラス");
  // 質問名 "対象種" の部分文字列 "対象" は値ではないのでマッチしない
  assert.equal(matchesKeyword(row, columns, "対象"), false);
  // 選択肢の値 "カラス" は従来どおりマッチ
  assert.equal(matchesKeyword(row, columns, "カラス"), true);
});

test("buildRowHitExcerpts: 非表示の選択肢フィールドは選択肢ラベルで抜粋表示する", () => {
  const { row, columns } = buildSingleSpeciesRow("カラス");
  // 表示列に無い選択肢フィールド（マーカー値）を entry.data に追加。
  row.entry.data["キャンペーン適用|あり"] = true;
  const hits = buildRowHitExcerpts(row, columns, "あり");
  // 選択肢マーカーは親フィールドへ集約され、ラベルは親フィールド名「キャンペーン適用」になる。
  const hit = hits.find((h) => h.columnLabel === "キャンペーン適用");
  assert.ok(hit, "非表示選択肢フィールドの抜粋が親フィールド名で返るべき（(他の項目に一致) にしない）");
  const hitText = hit.segments.filter((s) => s.hit).map((s) => s.text).join("");
  assert.equal(hitText, "あり");
});

test("buildRowHitExcerpts: 表示列の選択肢マーカーは重複ヒットを出さない", () => {
  // entry.data は { "対象種|カラス": true } のみ。対象種 は表示列で display="カラス"。
  const { row, columns } = buildSingleSpeciesRow("カラス");
  const hits = buildRowHitExcerpts(row, columns, "カラス");
  // 表示列「対象種」でヒットする。「対象種 / カラス」のような個別マーカー重複は出さない。
  assert.ok(hits.some((h) => h.columnLabel === "対象種"), "表示列「対象種」のヒットがあるべき");
  assert.ok(
    !hits.some((h) => String(h.columnKey).includes("|")),
    "個別オプションキー（data:対象種|カラス）のヒットは出さない",
  );
});

test("buildRowHitExcerpts: 複数選択でも表示列に集約し個別マーカーの重複を出さない", () => {
  const { row, columns } = buildMultiSpeciesRow(["カラス", "キタツネ"]);
  const hits = buildRowHitExcerpts(row, columns, "キタツネ");
  assert.ok(hits.some((h) => h.columnLabel === "対象種"), "表示列「対象種」のヒットがあるべき");
  assert.ok(
    !hits.some((h) => String(h.columnKey).includes("|")),
    "個別オプションキー（data:対象種|キタツネ）のヒットは出さない",
  );
});

test("PARTIAL: 選択肢マーカー値（●/true）自体は検索対象にしない", () => {
  const { row, columns } = buildSingleSpeciesRow("カラス");
  // マーカー値そのもの（"●" / "true"）ではマッチしない。選択肢ラベルでのみマッチする。
  assert.equal(matchesKeyword(row, columns, "●"), false);
  assert.equal(matchesKeyword(row, columns, "true"), false);
  assert.equal(matchesKeyword(row, columns, "カラス"), true);
});

// ────────────────────────────────────────────────────────────
// 要望3: 日付関連型の COMPARE は「表示文字列 vs リテラル」の単純な文字列比較
//（canonical 化・前方一致補正・時刻ゼロ埋めはしない。型を揃えたいときは DATE()/TIME() を明示）
// ────────────────────────────────────────────────────────────

const buildTimeFieldRow = (precision, storedValue) => {
  const form = {
    settings: {},
    schema: [{ type: "time", label: "受付時刻", timePrecision: precision }],
    displayFieldSettings: [{ path: "受付時刻", type: "time" }],
  };
  const { columns } = buildSearchTableLayout(form, { includeOperations: false });
  const entry = {
    id: "r_time",
    "No.": 1,
    modifiedAtUnixMs: Date.UTC(2026, 0, 1, 0, 0, 0),
    modifiedAt: Date.UTC(2026, 0, 1, 0, 0, 0),
    data: { 受付時刻: storedValue },
    dataUnixMs: {},
  };
  const row = { entry, values: computeRowValues(entry, columns) };
  return { row, columns };
};

test("COMPARE: 最終更新日時(datetime) は表示文字列 vs リテラルの単純な文字列比較", () => {
  const { row, columns } = buildSingleSpeciesRow("カラス"); // modifiedAt 表示 = "2026/01/01 09:00:00"
  assert.equal(matchesKeyword(row, columns, "最終更新日時>=2026"), true);
  assert.equal(matchesKeyword(row, columns, "最終更新日時>=2027"), false);
  assert.equal(matchesKeyword(row, columns, "最終更新日時<2027"), true);
});

test("COMPARE: 時刻列も単純な文字列比較（自動整形・ゼロ埋めはしない）", () => {
  const { row, columns } = buildTimeFieldRow("second", "12:34:56"); // 表示 = "12:34:56"
  // 比較可能な形式（同じ桁・ゼロ埋め）を渡せば文字列比較で時系列どおりになる
  assert.equal(matchesKeyword(row, columns, "受付時刻>=12:30"), true);
  assert.equal(matchesKeyword(row, columns, "受付時刻>=12:40"), false);
  // 自動整形しないため、非ゼロ埋め "9:00" は辞書順で "1..." < "9..." となり false（仕様どおり）。
  // 正しく比較したい場合は "09:00:00" のように桁を揃えるか、厳密モードで TIME() を使う。
  assert.equal(matchesKeyword(row, columns, "受付時刻>=9:00"), false);
  assert.equal(matchesKeyword(row, columns, "受付時刻>=09:00:00"), true);
});

// ────────────────────────────────────────────────────────────
// 要望1/2: 非表示メタ列・entry.id も検索対象＆ヒット箇所に表示（「(他の項目に一致)」を出さない）
// ────────────────────────────────────────────────────────────

// 表示列から id を外しても（showSearchId:false 相当）、entry.id にヒットすれば ID ラベルで抜粋を返す。
test("buildRowHitExcerpts: 表示列に ID が無くても entry.id ヒットは ID ラベルで返す", () => {
  const { row, columns } = buildSingleSpeciesRow("カラス"); // entry.id = "r_カラス"
  const columnsWithoutId = columns.filter((c) => c.key !== "id");
  const hits = buildRowHitExcerpts(row, columnsWithoutId, "r_カラス");
  const idHit = hits.find((h) => h.columnLabel === "ID");
  assert.ok(idHit, "entry.id ヒットが ID ラベルで返るべき（(他の項目に一致) にしない）");
});

// 非表示メタ列（最終更新日時）を superset（useSearchPageState の searchColumns 相当）へ補えば
// 検索でき、ヒット箇所にも「最終更新日時」ラベルで表示される。
test("メタ列が非表示でも superset 補完で検索＆ヒット表示できる", () => {
  const { row, columns } = buildSingleSpeciesRow("カラス"); // modifiedAt = 2026/01/01
  // 表示列から最終更新日時(modifiedAt)を外した状態を作る
  const displayColumns = columns.filter((c) => c.key !== "modifiedAt");
  const presentKeys = new Set(displayColumns.map((c) => c.key));
  const hiddenMeta = createBaseColumns().filter((c) => !presentKeys.has(c.key));
  const searchColumns = [...displayColumns, ...hiddenMeta];

  assert.equal(matchesKeyword(row, searchColumns, "2026"), true, "非表示の最終更新日時にヒットすべき");
  const hits = buildRowHitExcerpts(row, searchColumns, "2026");
  assert.ok(
    hits.some((h) => h.columnLabel === "最終更新日時"),
    "非表示メタ列のヒットが「最終更新日時」ラベルで返るべき",
  );
});

// ────────────────────────────────────────────────────────────
// 比較・IN・真偽などの「列条件」もヒット箇所に一致列を出す
//（COMPARE 等は collectSearchPatterns に拾われず、従来「(他の項目に一致)」になっていた回帰）
// ────────────────────────────────────────────────────────────

const buildDateFieldRow = (storedDisplay) => {
  const form = {
    settings: {},
    schema: [{ type: "date", label: "実施年月日" }],
    displayFieldSettings: [{ path: "実施年月日", type: "date" }],
  };
  const { columns } = buildSearchTableLayout(form, { includeOperations: false });
  const entry = {
    id: "r_date",
    "No.": 1,
    modifiedAtUnixMs: Date.UTC(2026, 0, 1, 0, 0, 0),
    modifiedAt: Date.UTC(2026, 0, 1, 0, 0, 0),
    data: { 実施年月日: storedDisplay },
    dataUnixMs: {},
  };
  const row = { entry, values: computeRowValues(entry, columns) };
  return { row, columns };
};

test("collectConditionColumns: COMPARE / IN / BOOL を列条件として収集", () => {
  const cols = collectConditionColumns("実施年月日>=2026/05/01 種類:ヒグマ 人数 in (10, 20) 公開=true");
  // 部分一致（COLUMN_PARTIAL / PARTIAL）は含めず、列条件のみ。
  assert.deepEqual(
    cols.map((c) => [c.type, c.column]),
    [
      ["COMPARE", "実施年月日"],
      ["COLUMN_IN", "人数"],
      ["COLUMN_BOOL", "公開"],
    ],
  );
});

test("collectConditionColumns: 厳密モード(SEARCH/WHERE)は対象外", () => {
  assert.deepEqual(collectConditionColumns("SEARCH 実施年月日>=2026/05/01"), []);
});

test("buildRowHitExcerpts: 比較条件が一致した列を値付きで返す（(他の項目に一致) にしない）", () => {
  const { row, columns } = buildDateFieldRow("2026/05/11");
  const hits = buildRowHitExcerpts(row, columns, "実施年月日>=2026/05/01");
  const hit = hits.find((h) => h.columnLabel === "実施年月日");
  assert.ok(hit, "比較条件が一致した実施年月日列の抜粋が返るべき");
  const text = hit.segments.map((s) => s.text).join("");
  assert.equal(text, "2026/05/11", "セル値全体が抜粋として返るべき");
});

test("buildRowHitExcerpts: 比較が不成立の列は抜粋に出さない", () => {
  const { row, columns } = buildDateFieldRow("2026/04/11");
  // 行自体は条件に一致しない（matchesKeyword=false）が、抜粋でも該当列を出さない。
  assert.equal(matchesKeyword(row, columns, "実施年月日>=2026/05/01"), false);
  const hits = buildRowHitExcerpts(row, columns, "実施年月日>=2026/05/01");
  assert.ok(!hits.some((h) => h.columnLabel === "実施年月日"), "不成立の列は抜粋に含めない");
});

test("buildRowHitExcerpts: 厳密一致(=)条件も一致列を値付きで返す", () => {
  const { row, columns } = buildSingleSpeciesRow("カラス");
  const hits = buildRowHitExcerpts(row, columns, "対象種=カラス");
  const hit = hits.find((h) => h.columnLabel === "対象種");
  assert.ok(hit, "= 条件が一致した対象種列の抜粋が返るべき");
  const text = hit.segments.map((s) => s.text).join("");
  assert.equal(text, "カラス");
});

test("buildRowHitExcerpts: 非表示 entry.data フィールドの比較条件も一致列を返す", () => {
  const { row, columns } = buildTextRow({ 氏名: "山田太郎" });
  // 表示列・schema に無い数値フィールドを entry.data だけに持たせる。
  row.entry.data.年齢 = "42";
  const hits = buildRowHitExcerpts(row, columns, "年齢>=40");
  const hit = hits.find((h) => h.columnLabel === "年齢");
  assert.ok(hit, "非表示フィールド 年齢 の比較ヒットが返るべき（(他の項目に一致) にしない）");
  const text = hit.segments.map((s) => s.text).join("");
  assert.equal(text, "42");
});
