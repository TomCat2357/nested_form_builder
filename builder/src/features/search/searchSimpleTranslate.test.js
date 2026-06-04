import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildSearchTableLayout, createBaseColumns, buildSimpleSearchColumns } from "./searchTable.js";
import { computeRowValues } from "./searchTableValues.js";
import { matchesKeyword } from "./searchQueryEngine.js";
import { buildSimpleSearchExpression } from "./searchSimpleTranslate.js";
import { buildSearchExpression, stripNonSearchableMetaKeys } from "./searchExpressionBuilder.js";
import { entriesToViewTableRows } from "../analytics/entriesToViewRows.js";
import { preprocessAlaSqlExpression } from "../expression/preprocessAlaSqlExpression.js";
import { ensureNfbUdfsRegistered } from "../expression/registerNfbUdfs.js";

// ────────────────────────────────────────────────────────────
// alasql 本体（リポジトリ同梱の vendor 版）を vm で読み込み、NFB UDF を登録する。
// builder 本番は CDN ロードだが、テストでは同梱版を直接使う（ネットワーク不要）。
// ────────────────────────────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ALASQL_PATH = path.resolve(__dirname, "../../../../gas/vendor/alasql.min.js");

function loadAlaSql() {
  const code = fs.readFileSync(ALASQL_PATH, "utf8");
  const sandbox = { module: {}, exports: {}, window: {}, self: {} };
  sandbox.global = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  const alasql = sandbox.module.exports || sandbox.window.alasql;
  if (typeof alasql !== "function") throw new Error("alasql の読み込みに失敗");
  ensureNfbUdfsRegistered(alasql);
  return alasql;
}
const alasql = loadAlaSql();

// ────────────────────────────────────────────────────────────
// 代表的なフォーム + レコード
// ────────────────────────────────────────────────────────────
const FORM = {
  settings: {},
  schema: [
    { type: "text", label: "氏名" },
    { type: "number", label: "年齢" },
    { type: "checkboxes", label: "対象種", options: [{ label: "カラス" }, { label: "キタツネ" }, { label: "タヌキ" }] },
    { type: "text", label: "備考" },
  ],
  displayFieldSettings: [
    { path: "氏名", type: "text" },
    { path: "年齢", type: "number" },
    { path: "対象種", type: "checkboxes" },
    { path: "備考", type: "text" },
  ],
};

const ENTRIES = [
  {
    id: "1", "No.": 1, modifiedAt: Date.UTC(2026, 0, 1), modifiedAtUnixMs: Date.UTC(2026, 0, 1),
    data: { 氏名: "山田太郎", 年齢: 25, "対象種": "カラス,キタツネ", 備考: "" }, dataUnixMs: {},
  },
  {
    id: "2", "No.": 2, modifiedAt: Date.UTC(2026, 0, 2), modifiedAtUnixMs: Date.UTC(2026, 0, 2),
    data: { 氏名: "田中花子", 年齢: 18, "対象種": "タヌキ", 備考: "メモあり" }, dataUnixMs: {},
  },
  {
    id: "3", "No.": 3, modifiedAt: Date.UTC(2026, 0, 3), modifiedAtUnixMs: Date.UTC(2026, 0, 3),
    data: { 氏名: "山田次郎", 年齢: 40, 備考: "山田の備考" }, dataUnixMs: {},
  },
];

function buildSearchColumns(form) {
  const { columns } = buildSearchTableLayout(form, { includeOperations: false });
  const presentKeys = new Set(columns.map((c) => c.key));
  const hiddenMeta = createBaseColumns().filter((c) => !presentKeys.has(c.key));
  return hiddenMeta.length ? [...columns, ...hiddenMeta] : columns;
}
const SEARCH_COLUMNS = buildSearchColumns(FORM);
const VIEW_ROWS = stripNonSearchableMetaKeys(entriesToViewTableRows(ENTRIES, FORM));
const PROCESSED = ENTRIES.map((entry) => ({ entry, values: computeRowValues(entry, SEARCH_COLUMNS) }));

// 旧エンジン（matchesKeyword）のヒット id 集合（オラクル）。
function oldMatchedIds(keyword) {
  return PROCESSED.filter((row) => matchesKeyword(row, SEARCH_COLUMNS, keyword)).map((r) => r.entry.id).sort();
}
// 新エンジン（翻訳器 → alasql）のヒット id 集合。
function newMatchedIds(keyword) {
  const { expr } = buildSimpleSearchExpression(keyword, SEARCH_COLUMNS);
  if (!expr) return ENTRIES.map((e) => e.id).sort();
  const whereExpr = preprocessAlaSqlExpression(expr);
  // alasql は vm サンドボックス realm で動くため、戻り値配列の prototype が
  // メインrealmと異なる。Array.from でメインrealm配列へ正規化してから比較する
  // （本番は同一 realm なので不要。テスト固有の事情）。
  const res = Array.from(alasql("SELECT * FROM ? WHERE " + whereExpr, [VIEW_ROWS]));
  return res.map((r) => r.id).filter((id) => id != null && id !== "").sort();
}

// ────────────────────────────────────────────────────────────
// パリティ: 翻訳器（alasql）== 旧カスタムエンジン（matchesKeyword）
// ────────────────────────────────────────────────────────────
const PARITY_QUERIES = [
  "山田",                         // 裸単語（全列正規表現 OR）
  "氏名:^山田",                   // 列指定 正規表現アンカー
  "氏名:山田|田中",               // 列指定 正規表現 交替
  "対象種=カラス",                // 複数値 集合分解 =
  "対象種<>カラス",               // 複数値 集合分解 <>
  "対象種 in (タヌキ, カラス)",   // 複数値 in
  "対象種 not in (カラス)",       // 複数値 not in
  "対象種:true",                  // 真偽（checkboxes）
  "対象種:false",
  '備考=""',                      // 空欄
  '備考<>""',                     // 非空
  "年齢>=20",                     // 数値 順序比較
  "年齢<20",
  "氏名:山田 and 年齢>=20",       // AND
  "氏名:山田 or 対象種=タヌキ",   // OR
  "not(対象種=カラス)",           // NOT
  "山田 メモ",                    // 暗黙 AND（どちらもヒットしない交差）
];

for (const q of PARITY_QUERIES) {
  test(`パリティ（翻訳器 == matchesKeyword）: ${q}`, () => {
    assert.deepEqual(newMatchedIds(q), oldMatchedIds(q), `query=${q}`);
  });
}

// ────────────────────────────────────────────────────────────
// emit 文字列（仕様表のスナップショット）
// ────────────────────────────────────────────────────────────
test("emit: 裸単語は全検索対象列への REGEXP_LIKE OR（大小無視）", () => {
  const cols = [
    { key: "display:氏名", path: "氏名", sourceType: "text", searchable: true },
    { key: "display:備考", path: "備考", sourceType: "text", searchable: true },
  ];
  const { expr } = buildSimpleSearchExpression("田中", cols);
  assert.equal(expr, "((REGEXP_LIKE(`氏名` || '', '田中', 'i')) OR (REGEXP_LIKE(`備考` || '', '田中', 'i')))");
});

test("emit: 列指定の正規表現 / 真偽 / 空欄 / 比較 / 集合分解", () => {
  const cols = [
    { key: "display:氏名", path: "氏名", sourceType: "text", searchable: true },
    { key: "display:年齢", path: "年齢", sourceType: "number", searchable: true },
    { key: "display:対象種", path: "対象種", sourceType: "checkboxes", searchable: true },
    { key: "display:区分", path: "区分", sourceType: "radio", searchable: true },
    { key: "display:備考", path: "備考", sourceType: "text", searchable: true },
  ];
  const emit = (q) => buildSimpleSearchExpression(q, cols).expr;
  assert.equal(emit("氏名:^山田"), "REGEXP_LIKE(`氏名` || '', '^山田', 'i')");
  assert.equal(emit("区分:true"), "TO_BOOL(`区分`) = TRUE");
  assert.equal(emit("区分:false"), "TO_BOOL(`区分`) = FALSE");
  assert.equal(emit('備考=""'), "(`備考` IS NULL OR `備考` = '')");
  assert.equal(emit('備考<>""'), "(`備考` IS NOT NULL AND `備考` <> '')");
  assert.equal(emit("年齢>=20"), "TO_NUMBER(`年齢`) >= 20");
  assert.equal(emit("対象種=カラス"), "MV_EQ(`対象種`, 'カラス')");
  assert.equal(emit("対象種<>カラス"), "NOT MV_EQ(`対象種`, 'カラス')");
  assert.equal(emit("対象種 in (タヌキ, カラス)"), "MV_IN(`対象種`, 'タヌキ', 'カラス')");
  assert.equal(emit("対象種 not in (カラス)"), "NOT MV_IN(`対象種`, 'カラス')");
});

test("emit: 日付列の COMPARE はリテラルを canonical（ハイフン日付・`_` 区切り）へ正規化する", () => {
  const cols = [
    { key: "display:販売日", path: "販売日", sourceType: "date", searchable: true },
  ];
  const emit = (q) => buildSimpleSearchExpression(q, cols).expr;
  // スラッシュ入力 → ハイフン canonical（表示列も canonical 文字列なので生文字列比較で一致する）
  assert.equal(emit("販売日>=2026/04/01"), "`販売日` >= '2026-04-01'");
  // 日付 + 時刻 → 区切りはアンダースコア
  assert.equal(emit("販売日>=2026/04/01 09:00"), "`販売日` >= '2026-04-01_09:00'");
  // ハイフン入力はそのまま canonical
  assert.equal(emit("販売日>=2026-04-01"), "`販売日` >= '2026-04-01'");
});

test("emit: AND / OR / NOT の構造", () => {
  const cols = [
    { key: "display:氏名", path: "氏名", sourceType: "text", searchable: true },
    { key: "display:年齢", path: "年齢", sourceType: "number", searchable: true },
  ];
  assert.equal(
    buildSimpleSearchExpression("氏名:山田 and 年齢>=20", cols).expr,
    "(REGEXP_LIKE(`氏名` || '', '山田', 'i')) AND (TO_NUMBER(`年齢`) >= 20)",
  );
});

test("emit: 不正な正規表現はリテラル（エスケープ）へフォールバック", () => {
  const cols = [{ key: "display:備考", path: "備考", sourceType: "text", searchable: true }];
  // '[' は不正パターン → escapeRegExp 済みリテラル '\[' で REGEXP_LIKE
  assert.equal(buildSimpleSearchExpression("備考:[", cols).expr, "REGEXP_LIKE(`備考` || '', '\\[', 'i')");
});

test("emit: 旧スラッシュ構文 /.../ は剥がして同義", () => {
  const cols = [{ key: "display:氏名", path: "氏名", sourceType: "text", searchable: true }];
  assert.equal(buildSimpleSearchExpression("氏名:/^山田/", cols).expr, "REGEXP_LIKE(`氏名` || '', '^山田', 'i')");
});

test("emit: No. メタ列は alasql 行キー No_ にマップされる", () => {
  const cols = [{ key: "No.", segments: ["No."], searchable: true, sortable: true }];
  assert.equal(buildSimpleSearchExpression("No.>=10", cols).expr, "TO_NUMBER(`No_`) >= 10");
});

// ────────────────────────────────────────────────────────────
// buildSearchExpression のルーティング（簡易 / 厳密）
// ────────────────────────────────────────────────────────────
test("buildSearchExpression: 簡易は翻訳器、厳密は preprocessor へ振り分ける", () => {
  const cols = [{ key: "display:氏名", path: "氏名", sourceType: "text", searchable: true }];
  // 簡易: REGEXP_LIKE（翻訳器）
  assert.equal(buildSearchExpression("氏名:^山田", cols).expr, "REGEXP_LIKE(`氏名` || '', '^山田', 'i')");
  // 厳密: alasql 標準（LIKE）— preprocessor 経路
  const strict = buildSearchExpression("WHERE `氏名` LIKE '%山田%'", cols);
  assert.equal(strict.expr, "`氏名` LIKE '%山田%'");
});

// ────────────────────────────────────────────────────────────
// 表示列に設定していない深いネスト（条件分岐）フィールドへの簡易検索到達
//   - 表示列ベースだと裸単語 / リーフ名 `列名:値` が届かない（行キー fallthrough のフルパスのみ）
//   - buildSimpleSearchColumns（全フィールド superset）で参照実装 matchesKeyword とパリティ
// 実フォーム例: 相談大分類(radio)→野生鳥獣→相談種類(radio)→餌付け→特定餌付け(radio,該当)
// ────────────────────────────────────────────────────────────
const NESTED_FORM = {
  settings: {},
  schema: [
    {
      id: "f_daibunrui", type: "radio", label: "相談大分類", isDisplayed: true,
      options: [{ label: "野生鳥獣" }],
      childrenByValue: {
        "野生鳥獣": [
          {
            id: "f_shurui", type: "radio", label: "相談種類",
            options: [{ label: "餌付け" }],
            childrenByValue: {
              "餌付け": [
                // isDisplayed なし = 検索結果テーブルの表示列に出ない深いネストフィールド
                { id: "f_tokutei", type: "radio", label: "特定餌付け", options: [{ label: "該当" }] },
              ],
            },
          },
        ],
      },
    },
  ],
};
// 元データ方式（選択肢ごとのマーカー列 `親path|選択肢`: ●）。
const NESTED_ENTRIES = [
  {
    id: "A", "No.": 1, modifiedAt: Date.UTC(2026, 0, 1), modifiedAtUnixMs: Date.UTC(2026, 0, 1),
    data: {
      "相談大分類|野生鳥獣": "●",
      "相談大分類|野生鳥獣|相談種類|餌付け": "●",
      "相談大分類|野生鳥獣|相談種類|餌付け|特定餌付け|該当": "●",
    },
    dataUnixMs: {},
  },
  {
    // 相談大分類だけ選択（特定餌付け未回答）。該当 / 餌付け にはヒットしない対照。
    id: "B", "No.": 2, modifiedAt: Date.UTC(2026, 0, 2), modifiedAtUnixMs: Date.UTC(2026, 0, 2),
    data: { "相談大分類|野生鳥獣": "●" },
    dataUnixMs: {},
  },
];
const NESTED_DISPLAY_COLUMNS = buildSearchColumns(NESTED_FORM); // 表示列（+メタ）のみ
const NESTED_SIMPLE_COLUMNS = buildSimpleSearchColumns(NESTED_FORM, NESTED_DISPLAY_COLUMNS); // 全フィールド superset
const NESTED_VIEW_ROWS = stripNonSearchableMetaKeys(entriesToViewTableRows(NESTED_ENTRIES, NESTED_FORM));
const NESTED_PROCESSED = NESTED_ENTRIES.map((entry) => ({ entry, values: computeRowValues(entry, NESTED_DISPLAY_COLUMNS) }));

function nestedMatchedIds(keyword, cols) {
  const { expr } = buildSimpleSearchExpression(keyword, cols);
  if (!expr) return NESTED_ENTRIES.map((e) => e.id).sort();
  const whereExpr = preprocessAlaSqlExpression(expr);
  const res = Array.from(alasql("SELECT * FROM ? WHERE " + whereExpr, [NESTED_VIEW_ROWS]));
  return res.map((r) => r.id).filter((id) => id != null && id !== "").sort();
}
function nestedOracleIds(keyword) {
  return NESTED_PROCESSED.filter((row) => matchesKeyword(row, NESTED_DISPLAY_COLUMNS, keyword)).map((r) => r.entry.id).sort();
}

test("回帰: 表示列のみだと深いネスト非表示フィールドに簡易検索が届かない（バグの記録）", () => {
  // 表示列ベース: 裸 `該当` も リーフ `特定餌付け:該当` も新エンジンでは不一致…
  assert.deepEqual(nestedMatchedIds("該当", NESTED_DISPLAY_COLUMNS), []);
  assert.deepEqual(nestedMatchedIds("特定餌付け:該当", NESTED_DISPLAY_COLUMNS), []);
  // …が参照実装（matchesKeyword）はヒットする = パリティ崩れだった
  assert.deepEqual(nestedOracleIds("該当"), ["A"]);
  assert.deepEqual(nestedOracleIds("特定餌付け:該当"), ["A"]);
  // フルパス指定 <>"" は表示列ベースでも行キー fallthrough でヒットしていた
  assert.deepEqual(nestedMatchedIds('相談大分類|野生鳥獣|相談種類|餌付け|特定餌付け<>""', NESTED_DISPLAY_COLUMNS), ["A"]);
});

test("修正: 全フィールド superset で簡易検索が深いネスト非表示フィールドへ届く", () => {
  assert.deepEqual(nestedMatchedIds("該当", NESTED_SIMPLE_COLUMNS), ["A"]);
  assert.deepEqual(nestedMatchedIds("特定餌付け:該当", NESTED_SIMPLE_COLUMNS), ["A"]);
  assert.deepEqual(nestedMatchedIds("相談種類:餌付け", NESTED_SIMPLE_COLUMNS), ["A"]);
  // フルパス <>"" は従来どおりヒット（superset でも実列に解決して同一 safeKey）
  assert.deepEqual(nestedMatchedIds('相談大分類|野生鳥獣|相談種類|餌付け|特定餌付け<>""', NESTED_SIMPLE_COLUMNS), ["A"]);
});

test("修正: 全フィールド superset は参照実装（matchesKeyword）とパリティする", () => {
  for (const q of ["該当", "餌付け", "特定餌付け:該当", "相談種類:餌付け", "特定餌付け:非該当"]) {
    assert.deepEqual(nestedMatchedIds(q, NESTED_SIMPLE_COLUMNS), nestedOracleIds(q), `query=${q}`);
  }
});
