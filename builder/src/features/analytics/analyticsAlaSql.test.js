import assert from "node:assert/strict";
import test from "node:test";
import { entriesToAlaSqlRows } from "./analyticsAlaSql.js";

test("entriesToAlaSqlRows はパイプキーを __ に変換し data をそのまま行配列にする", () => {
  const entries = [
    {
      id: "r1",
      data: { "数量": 3, "基本情報|区": "中央" },
      createdAt: "2023-11-15 06:13:20", // 旧スペース区切り入力でも canonical（`_`）に正規化される
      createdAtUnixMs: 1700000000000, // シムは無視され createdAt 文字列が優先される
    },
  ];
  const rows = entriesToAlaSqlRows(entries);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]["数量"], 3);
  assert.equal(rows[0]["基本情報__区"], "中央");
  assert.equal(rows[0].id, "r1");
  assert.equal(rows[0].createdAt, "2023/11/15 06:13:20.000");
});

test("entriesToAlaSqlRows は typeMap=number 列の文字列値を Number に変換する", () => {
  const entries = [
    { id: "r1", data: { "数量": "3" } },
    { id: "r2", data: { "数量": "5" } },
    { id: "r3", data: { "数量": "2" } },
  ];
  const rows = entriesToAlaSqlRows(entries, { typeMap: new Map([["数量", "number"]]) });
  assert.equal(rows[0]["数量"], 3);
  assert.equal(rows[1]["数量"], 5);
  assert.equal(rows[2]["数量"], 2);
  assert.equal(typeof rows[0]["数量"], "number");
});

test("entriesToAlaSqlRows は typeMap=number 列の number 値はそのまま number で返す", () => {
  const entries = [{ id: "r1", data: { "数量": 7 } }];
  const rows = entriesToAlaSqlRows(entries, { typeMap: new Map([["数量", "number"]]) });
  assert.equal(rows[0]["数量"], 7);
  assert.equal(typeof rows[0]["数量"], "number");
});

test("entriesToAlaSqlRows は typeMap=number 列の空文字 / null / 未回答を null にする", () => {
  const entries = [
    { id: "r1", data: { "数量": "" } },
    { id: "r2", data: { "数量": null } },
    { id: "r3", data: {} }, // 未回答でも typeMap にある列は null として持つ
  ];
  const rows = entriesToAlaSqlRows(entries, { typeMap: new Map([["数量", "number"]]) });
  assert.equal(rows[0]["数量"], null);
  assert.equal(rows[1]["数量"], null);
  assert.equal(rows[2]["数量"], null);
});

test("entriesToAlaSqlRows は typeMap が来ると未回答 schema 列も null 列として schema 順で持つ", () => {
  const typeMap = new Map([
    ["氏名", "string"],
    ["数量", "number"],
    ["受付日", "date"],
  ]);
  const entries = [
    { id: "r1", data: { "数量": "3" } }, // 氏名・受付日 未回答
    { id: "r2", data: { "氏名": "佐藤", "受付日": "2026-03-14" } }, // 数量 未回答
  ];
  const rows = entriesToAlaSqlRows(entries, { typeMap });
  // schema 列が schema 順で先頭に並ぶ
  assert.deepEqual(Object.keys(rows[0]).slice(0, 3), ["氏名", "数量", "受付日"]);
  // 未回答フィールドは null、回答済みは coerce 後の値
  assert.equal(rows[0]["氏名"], null);
  assert.equal(rows[0]["受付日"], null);
  assert.equal(rows[0]["数量"], 3);
  assert.equal(rows[1]["数量"], null);
  assert.equal(rows[1]["氏名"], "佐藤");
  assert.equal(rows[1]["受付日"], "2026/03/14");
  // 全行が同じ列集合を持つ
  assert.deepEqual(Object.keys(rows[0]), Object.keys(rows[1]));
});

test("entriesToAlaSqlRows は typeMap=number 列の数値化不能な文字列を null にする", () => {
  const entries = [{ id: "r1", data: { "数量": "abc" } }];
  const rows = entriesToAlaSqlRows(entries, { typeMap: new Map([["数量", "number"]]) });
  assert.equal(rows[0]["数量"], null);
});

test("entriesToAlaSqlRows は typeMap=number 列の Infinity/NaN も null にする", () => {
  const entries = [
    { id: "r1", data: { "数量": Infinity } },
    { id: "r2", data: { "数量": NaN } },
  ];
  const rows = entriesToAlaSqlRows(entries, { typeMap: new Map([["数量", "number"]]) });
  assert.equal(rows[0]["数量"], null);
  assert.equal(rows[1]["数量"], null);
});

test("entriesToAlaSqlRows は typeMap=date 列を canonical 文字列に整形し空白系は null 化する", () => {
  const entries = [
    { id: "r1", data: { "受付日": "2026-03-14" } },
    { id: "r2", data: { "受付日": "" } },
    { id: "r3", data: { "受付日": null } },
    { id: "r4", data: { "受付日": 1700000000000 } }, // Unix ms → その瞬間の JST 日付（"YYYY-MM-DD"）
    { id: "r5", data: { "受付日": "2026-03-14 23:59:59" } }, // 日時が混じっても日付成分だけ
  ];
  const rows = entriesToAlaSqlRows(entries, { typeMap: new Map([["受付日", "date"]]) });
  assert.equal(rows[0]["受付日"], "2026/03/14");
  assert.equal(rows[1]["受付日"], null);
  assert.equal(rows[2]["受付日"], null);
  assert.equal(rows[3]["受付日"], "2023/11/15"); // 1700000000000ms = JST 2023-11-15 07:13:20
  assert.equal(rows[4]["受付日"], "2026/03/14");
});

test("entriesToAlaSqlRows は typeMap=date 列でも時刻のみ文字列は TIME canonical で渡す", () => {
  const entries = [{ id: "r1", data: { "受付時刻": "9:05" } }];
  // time フィールドは analytics 列型上 "date" に正規化されるが、値が時刻のみなら HH:mm:ss
  const rows = entriesToAlaSqlRows(entries, { typeMap: new Map([["受付時刻", "date"]]) });
  assert.equal(rows[0]["受付時刻"], "09:05:00.000");
});

test("entriesToAlaSqlRows は旧ワイヤの 1899-12-30 基準日 ISO 文字列も TIME として扱う", () => {
  // 旧 GAS シリアライズで time 値が "1899-12-30T05:50:00.000Z"（= 1899-12-30 14:50 JST）に
  // なっていた stale キャッシュ救済。"date" 列型でも HH:mm:ss.sss に整形する。
  const entries = [
    { id: "r1", data: { "対応時間【出】": "1899-12-30T05:50:00.000Z" } },
    { id: "r2", data: { "対応時間【出】": "1899-12-30 05:50:00" } }, // スペース区切り（JST 壁時計扱い）
    { id: "r3", data: { "対応時間【出】": "14:50:00" } }, // 修正後ワイヤ（時刻のみ canonical）
  ];
  const rows = entriesToAlaSqlRows(entries, { typeMap: new Map([["対応時間【出】", "date"]]) });
  assert.equal(rows[0]["対応時間【出】"], "14:50:00.000");
  assert.equal(rows[1]["対応時間【出】"], "05:50:00.000");
  assert.equal(rows[2]["対応時間【出】"], "14:50:00.000");
});

test("entriesToAlaSqlRows は 1899-12-30 単体（時刻なし）は DATE のまま", () => {
  // 時刻成分が無い "1899-12-30" は誤って TIME 判定せず、DATE として整形する。
  const entries = [{ id: "r1", data: { "受付日": "1899-12-30" } }];
  const rows = entriesToAlaSqlRows(entries, { typeMap: new Map([["受付日", "date"]]) });
  assert.equal(rows[0]["受付日"], "1899/12/30");
});

test("entriesToAlaSqlRows は typeMap 未指定なら値を素通しする（後方互換）", () => {
  const entries = [{ id: "r1", data: { "数量": "3" } }];
  const rows = entriesToAlaSqlRows(entries);
  assert.equal(rows[0]["数量"], "3");
  assert.equal(typeof rows[0]["数量"], "string");
});

test("entriesToAlaSqlRows は typeMap 対象外の列は型変換しない", () => {
  const entries = [{ id: "r1", data: { "数量": "3", "備考": "メモ" } }];
  const rows = entriesToAlaSqlRows(entries, { typeMap: new Map([["数量", "number"]]) });
  assert.equal(rows[0]["数量"], 3);
  assert.equal(rows[0]["備考"], "メモ");
});

test("entriesToAlaSqlRows はパイプ列のキーが typeMap の __ 形式と一致するときに変換する", () => {
  // headerKeyToAlaSqlKey で "明細|金額" → "明細__金額" に変換される
  const entries = [{ id: "r1", data: { "明細|金額": "1500" } }];
  const rows = entriesToAlaSqlRows(entries, { typeMap: new Map([["明細__金額", "number"]]) });
  assert.equal(rows[0]["明細__金額"], 1500);
  assert.equal(typeof rows[0]["明細__金額"], "number");
});

test("entriesToAlaSqlRows は string/unknown 型は素通し、boolean 型は ●/空白 を true/false に coerce", () => {
  const entries = [{ id: "r1", data: { name: "foo", flag: "●", off: "", note: "memo" } }];
  const rows = entriesToAlaSqlRows(entries, {
    typeMap: new Map([
      ["name", "string"],
      ["flag", "boolean"],
      ["off", "boolean"],
      ["note", "unknown"],
    ]),
  });
  assert.equal(rows[0].name, "foo");
  assert.equal(rows[0].flag, true);
  assert.equal(rows[0].off, false);
  assert.equal(rows[0].note, "memo");
});

test("entriesToAlaSqlRows は boolean 列を未回答行でも false で pre-seed する", () => {
  const entries = [{ id: "r1", data: {} }];
  const rows = entriesToAlaSqlRows(entries, {
    typeMap: new Map([["好きな果物__りんご", "boolean"]]),
  });
  assert.equal(rows[0]["好きな果物__りんご"], false);
});

test("entriesToAlaSqlRows は entries が空配列のとき空配列を返す", () => {
  assert.deepEqual(entriesToAlaSqlRows([]), []);
  assert.deepEqual(entriesToAlaSqlRows([], { typeMap: new Map([["数量", "number"]]) }), []);
});

test("entriesToAlaSqlRows は入力順 1-based の _row を付与する（クエリで参照可能）", () => {
  const entries = [
    { id: "r1", data: { "数量": 1 } },
    { id: "r2", data: { "数量": 2 } },
    { id: "r3", data: { "数量": 3 } },
  ];
  const rows = entriesToAlaSqlRows(entries);
  assert.equal(rows[0]._row, 1);
  assert.equal(rows[1]._row, 2);
  assert.equal(rows[2]._row, 3);
});

test("entriesToAlaSqlRows は typeMap に _row が無くても _row 列を出力に含める", () => {
  // typeMap で schema 列が null 初期化されるが、_row はメタ列として後付けされ schema 順の外。
  const entries = [{ id: "r1", data: { "数量": 5 } }];
  const rows = entriesToAlaSqlRows(entries, { typeMap: new Map([["数量", "number"]]) });
  assert.equal(rows[0]._row, 1);
});

test("entriesToAlaSqlRows: ユーザー定義の _row 列があってもメタ列同様後勝ちで上書きされる", () => {
  const entries = [{ id: "r1", data: { _row: "ユーザー値" } }];
  const rows = entriesToAlaSqlRows(entries);
  assert.equal(rows[0]._row, 1);
});
