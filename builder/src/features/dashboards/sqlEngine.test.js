import assert from "node:assert/strict";
import test from "node:test";
import {
  substituteParams,
  resetDatabase,
  registerTable,
  executeQuery,
  executeQueries,
} from "./sqlEngine.js";

test("substituteParams は数値・文字列・null・boolean を SQL リテラルに変換する", () => {
  const sql = "SELECT * FROM t WHERE n = @n AND s = @s AND b = @b AND x = @x";
  const result = substituteParams(sql, { n: 42, s: "hello", b: true, x: null });
  assert.equal(result, "SELECT * FROM t WHERE n = 42 AND s = 'hello' AND b = TRUE AND x = NULL");
});

test("substituteParams は文字列リテラル中のシングルクォートをエスケープ (SQL injection 対策)", () => {
  const sql = "SELECT * FROM t WHERE name = @name";
  const result = substituteParams(sql, { name: "O'Reilly" });
  assert.equal(result, "SELECT * FROM t WHERE name = 'O''Reilly'");
});

test("substituteParams は未指定パラメータでエラー", () => {
  assert.throws(
    () => substituteParams("SELECT @missing", {}),
    /パラメータ "missing"/,
  );
});

test("substituteParams は同じパラメータを複数回置換", () => {
  const result = substituteParams("a = @x AND b = @x", { x: 7 });
  assert.equal(result, "a = 7 AND b = 7");
});

test("registerTable は不正なエイリアス名を拒否する", () => {
  resetDatabase("test_db");
  assert.throws(() => registerTable("bad-name", []), /不正なテーブルエイリアス/);
  assert.throws(() => registerTable("123abc", []), /不正なテーブルエイリアス/);
  assert.throws(() => registerTable("a; DROP TABLE", []), /不正なテーブルエイリアス/);
});

test("executeQuery は GROUP BY + SUM を実行できる", () => {
  resetDatabase("test_db_groupby");
  registerTable("sales", [
    { day: "2026-03-01", amount: 100, month: 3 },
    { day: "2026-03-01", amount: 50, month: 3 },
    { day: "2026-03-02", amount: 200, month: 3 },
    { day: "2026-04-01", amount: 999, month: 4 },
  ]);
  const result = executeQuery(
    "SELECT day, SUM(amount) AS total_amount FROM sales WHERE month = @m GROUP BY day ORDER BY day",
    { m: 3 },
  );
  assert.deepEqual(JSON.parse(JSON.stringify(result)), [
    { day: "2026-03-01", total_amount: 150 },
    { day: "2026-03-02", total_amount: 200 },
  ]);
});

test("executeQueries は複数クエリを順次実行し、エラーを蓄積する", () => {
  resetDatabase("test_db_multi");
  registerTable("a", [{ x: 1 }, { x: 2 }]);
  registerTable("b", [{ y: 10 }]);
  const { results, errors } = executeQueries([
    { id: "q1", sql: "SELECT SUM(x) AS s FROM a" },
    { id: "q2", sql: "SELECT * FROM nonexistent_table" },
    { id: "q3", sql: "SELECT * FROM b" },
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(results.q1)), [{ s: 3 }]);
  assert.deepEqual(results.q2, []);
  assert.deepEqual(JSON.parse(JSON.stringify(results.q3)), [{ y: 10 }]);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].queryId, "q2");
});

test("executeQueries は param.default を補完する", () => {
  resetDatabase("test_db_defaults");
  registerTable("t", [{ n: 1 }, { n: 2 }, { n: 3 }]);
  const { results } = executeQueries(
    [{ id: "q", sql: "SELECT SUM(n) AS s FROM t WHERE n >= @threshold", params: [{ name: "threshold", default: 2 }] }],
    {},
  );
  assert.deepEqual(JSON.parse(JSON.stringify(results.q)), [{ s: 5 }]);
});

test("executeQueries は呼び出し側の params を default より優先する", () => {
  resetDatabase("test_db_override");
  registerTable("t", [{ n: 1 }, { n: 2 }, { n: 3 }]);
  const { results } = executeQueries(
    [{ id: "q", sql: "SELECT SUM(n) AS s FROM t WHERE n >= @threshold", params: [{ name: "threshold", default: 2 }] }],
    { threshold: 3 },
  );
  assert.deepEqual(JSON.parse(JSON.stringify(results.q)), [{ s: 3 }]);
});

test("executeQuery は INNER JOIN を実行できる", () => {
  resetDatabase("test_db_join");
  registerTable("sales", [
    { customerId: "c1", amount: 100 },
    { customerId: "c2", amount: 200 },
    { customerId: "c1", amount: 50 },
  ]);
  registerTable("cust", [
    { customerId: "c1", region: "East" },
    { customerId: "c2", region: "West" },
  ]);
  const result = executeQuery(
    "SELECT cust.region AS region, SUM(sales.amount) AS total_amount FROM sales INNER JOIN cust ON sales.customerId = cust.customerId GROUP BY cust.region ORDER BY cust.region",
  );
  assert.deepEqual(JSON.parse(JSON.stringify(result)), [
    { region: "East", total_amount: 150 },
    { region: "West", total_amount: 200 },
  ]);
});
