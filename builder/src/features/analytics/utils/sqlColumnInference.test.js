import test from "node:test";
import assert from "node:assert/strict";
import { inferCompiledColumnsFromSql } from "./sqlColumnInference.js";

test("単純カラム参照と SUM 集計を正しく分類する", () => {
  const typeMap = new Map([["商品名", "string"], ["数量", "number"]]);
  const cols = inferCompiledColumnsFromSql(
    "SELECT [商品名], SUM([数量]) AS [数量合計] FROM [data] GROUP BY [商品名] ORDER BY [数量合計] DESC LIMIT 10",
    typeMap
  );
  assert.deepEqual(cols, [
    { name: "商品名", role: "dimension", type: "string" },
    { name: "数量合計", role: "metric", type: "number", aggType: "sum" },
  ]);
});

test("COUNT(*) AS [count] は number 扱い", () => {
  const cols = inferCompiledColumnsFromSql("SELECT COUNT(*) AS [count] FROM [data]", null);
  assert.deepEqual(cols, [{ name: "count", role: "metric", type: "number", aggType: "count" }]);
});

test("COUNT(DISTINCT [x]) AS [c] は number", () => {
  const cols = inferCompiledColumnsFromSql("SELECT COUNT(DISTINCT [a]) AS [c] FROM [data]", null);
  assert.deepEqual(cols, [{ name: "c", role: "metric", type: "number", aggType: "count" }]);
});

test("AVG/STDEV/VAR は number", () => {
  const typeMap = new Map([["score", "number"]]);
  const cols = inferCompiledColumnsFromSql(
    "SELECT AVG([score]) AS [avg_s], STDEV([score]) AS [sd_s], VAR([score]) AS [v_s] FROM [data]",
    typeMap
  );
  assert.deepEqual(cols.map((c) => c.type), ["number", "number", "number"]);
  assert.deepEqual(cols.map((c) => c.role), ["metric", "metric", "metric"]);
});

test("MIN/MAX は引数列の型を継承する", () => {
  const typeMap = new Map([["販売日", "date"], ["数量", "number"]]);
  const cols = inferCompiledColumnsFromSql(
    "SELECT MIN([販売日]) AS [初日], MAX([数量]) AS [最大数量] FROM [data]",
    typeMap
  );
  assert.deepEqual(cols, [
    { name: "初日", role: "metric", type: "date", aggType: "min" },
    { name: "最大数量", role: "metric", type: "number", aggType: "max" },
  ]);
});

test("AS なしのカラム参照は dimension で aliasName=ref になる", () => {
  const typeMap = new Map([["販売日", "date"]]);
  const cols = inferCompiledColumnsFromSql("SELECT [販売日] FROM [data]", typeMap);
  assert.deepEqual(cols, [{ name: "販売日", role: "dimension", type: "date" }]);
});

test("AS なしの集計はスキップ（出力名が AlaSQL 任せのため）", () => {
  const cols = inferCompiledColumnsFromSql("SELECT [a], COUNT(*) FROM [data] GROUP BY [a]", null);
  assert.deepEqual(cols, [{ name: "a", role: "dimension", type: null }]);
});

test("複合式 ([a] + [b]) は型不明で alias のみ登録", () => {
  const typeMap = new Map([["a", "number"], ["b", "number"]]);
  const cols = inferCompiledColumnsFromSql("SELECT [a] + [b] AS [合計] FROM [data]", typeMap);
  assert.deepEqual(cols, [{ name: "合計", role: null, type: null }]);
});

test("非集計関数 (UPPER) は role/type 共に null で alias 登録", () => {
  const cols = inferCompiledColumnsFromSql("SELECT UPPER([name]) AS [u] FROM [data]", null);
  assert.deepEqual(cols, [{ name: "u", role: null, type: null }]);
});

test("SELECT * は null を返す", () => {
  assert.equal(inferCompiledColumnsFromSql("SELECT * FROM [data]", null), null);
});

test("SELECT alias.* は null を返す", () => {
  assert.equal(inferCompiledColumnsFromSql("SELECT t.* FROM [data] AS t", null), null);
});

test("バッククォート識別子も解釈する", () => {
  const typeMap = new Map([["商品名", "string"]]);
  const cols = inferCompiledColumnsFromSql("SELECT `商品名` FROM `data`", typeMap);
  assert.deepEqual(cols, [{ name: "商品名", role: "dimension", type: "string" }]);
});

test("修飾付き参照 alias.[col] も dimension として扱う", () => {
  const typeMap = new Map([["販売日", "date"]]);
  const cols = inferCompiledColumnsFromSql("SELECT t.[販売日] FROM [data] AS t", typeMap);
  assert.deepEqual(cols, [{ name: "販売日", role: "dimension", type: "date" }]);
});

test("文字列リテラル内の SELECT/FROM/AS/カンマは無視される", () => {
  // 文字列内のキーワードに惑わされず、外側の構造を解釈
  const cols = inferCompiledColumnsFromSql(
    "SELECT [a], 'AS x, SELECT FROM' AS [literal] FROM [data]",
    null
  );
  // 'AS x, SELECT FROM' は文字列リテラルなので AS alias マッチで [literal] が拾われる
  assert.deepEqual(cols, [
    { name: "a", role: "dimension", type: null },
    { name: "literal", role: null, type: null },
  ]);
});

test("サブクエリの SELECT は外側 FROM を超えて誤マッチしない", () => {
  // 外側: SELECT [x], (SELECT COUNT(*) FROM [t]) AS [cnt] FROM [data]
  const cols = inferCompiledColumnsFromSql(
    "SELECT [x], (SELECT COUNT(*) FROM [t]) AS [cnt] FROM [data]",
    null
  );
  // 外側 SELECT 句は 2 つ。サブクエリ込みの式は alias のみ登録される
  assert.equal(cols?.length, 2);
  assert.equal(cols[0].name, "x");
  assert.equal(cols[1].name, "cnt");
});

test("パイプ含むカラム名 (基本情報|区) は headerKeyToAlaSqlKey 変換後にマッチする", () => {
  const typeMap = new Map([["基本情報__区", "string"]]);
  // preprocessSql 通過後は __ になる想定
  const cols = inferCompiledColumnsFromSql("SELECT [基本情報__区] FROM [data]", typeMap);
  assert.deepEqual(cols, [{ name: "基本情報__区", role: "dimension", type: "string" }]);
});

test("空文字列・null・FROM 無し（実用外）は null", () => {
  assert.equal(inferCompiledColumnsFromSql("", null), null);
  assert.equal(inferCompiledColumnsFromSql(null, null), null);
});

test("FROM 不在の SELECT 句（AlaSQL 拡張: SELECT 1 など）は最後まで読む", () => {
  const cols = inferCompiledColumnsFromSql("SELECT COUNT(*) AS [c]", null);
  assert.deepEqual(cols, [{ name: "c", role: "metric", type: "number", aggType: "count" }]);
});

test("fallbackTypeMap がプレーンオブジェクトでも引ける", () => {
  const cols = inferCompiledColumnsFromSql(
    "SELECT [a] FROM [data]",
    { a: "number" }
  );
  assert.deepEqual(cols, [{ name: "a", role: "dimension", type: "number" }]);
});

test("対応外集計 (COUNT_DISTINCT は SQL 非標準なので解釈しない) は alias のみ登録", () => {
  const cols = inferCompiledColumnsFromSql("SELECT COUNT_DISTINCT([a]) AS [c] FROM [data]", null);
  // 仕様上 NUMBER_AGGS にも INHERIT_AGGS にもない関数名は非集計関数扱い
  assert.deepEqual(cols, [{ name: "c", role: null, type: null }]);
});

test("SUM の引数列が typeMap に無くても type=number は確定する", () => {
  const cols = inferCompiledColumnsFromSql("SELECT SUM([unknown]) AS [s] FROM [data]", null);
  assert.deepEqual(cols, [{ name: "s", role: "metric", type: "number", aggType: "sum" }]);
});

test("CAST(MONTH(...) AS NUMBER) AS [m] は type=number, role=dimension", () => {
  const cols = inferCompiledColumnsFromSql(
    "SELECT CAST(MONTH([受付日]) AS NUMBER) AS [発生月] FROM [data]",
    null
  );
  assert.deepEqual(cols, [{ name: "発生月", role: "dimension", type: "number" }]);
});

test("CAST([x] AS STRING) AS [s] は type=string", () => {
  const cols = inferCompiledColumnsFromSql("SELECT CAST([x] AS STRING) AS [s] FROM [data]", null);
  assert.deepEqual(cols, [{ name: "s", role: "dimension", type: "string" }]);
});

test("CAST([d] AS DATE) AS [dd] は type=date", () => {
  const cols = inferCompiledColumnsFromSql("SELECT CAST([d] AS DATE) AS [dd] FROM [data]", null);
  assert.deepEqual(cols, [{ name: "dd", role: "dimension", type: "date" }]);
});

test("小文字 cast([x] as integer) as [i] も type=number", () => {
  const cols = inferCompiledColumnsFromSql("SELECT cast([x] as integer) as [i] FROM [data]", null);
  assert.deepEqual(cols, [{ name: "i", role: "dimension", type: "number" }]);
});

test("VARCHAR(255) のようなパラメータ付き型名も認識する", () => {
  const cols = inferCompiledColumnsFromSql("SELECT CAST([x] AS VARCHAR(255)) AS [v] FROM [data]", null);
  assert.deepEqual(cols, [{ name: "v", role: "dimension", type: "string" }]);
});

test("未知の CAST 型 (WIDGET) は複合式扱いで type=null", () => {
  const cols = inferCompiledColumnsFromSql("SELECT CAST([x] AS WIDGET) AS [w] FROM [data]", null);
  assert.deepEqual(cols, [{ name: "w", role: null, type: null }]);
});

test("CAST(... AS NUMBER) + 1 のような複合式は CAST として認識しない (type=null)", () => {
  const cols = inferCompiledColumnsFromSql("SELECT CAST([x] AS NUMBER) + 1 AS [y] FROM [data]", null);
  assert.deepEqual(cols, [{ name: "y", role: null, type: null }]);
});

test("ユーザー提示の SELECT (CAST + SUM CASE + COUNT) を一括分類する", () => {
  const cols = inferCompiledColumnsFromSql(
    "SELECT CAST(MONTH(`受付日`) AS NUMBER) AS `発生月`, " +
    "SUM(CASE WHEN `相談大分類|野生鳥獣` = '●' THEN 1 ELSE 0 END) AS `野生鳥獣`, " +
    "SUM(CASE WHEN `相談大分類|生物多様性` = '●' THEN 1 ELSE 0 END) AS `生物多様性`, " +
    "SUM(CASE WHEN `相談大分類|環境アセス` = '●' THEN 1 ELSE 0 END) AS `環境アセス`, " +
    "SUM(CASE WHEN `相談大分類|その他` = '●' THEN 1 ELSE 0 END) AS `その他`, " +
    "COUNT(*) AS `全体` FROM form_x",
    null
  );
  assert.deepEqual(cols, [
    { name: "発生月", role: "dimension", type: "number" },
    { name: "野生鳥獣", role: "metric", type: "number", aggType: "sum" },
    { name: "生物多様性", role: "metric", type: "number", aggType: "sum" },
    { name: "環境アセス", role: "metric", type: "number", aggType: "sum" },
    { name: "その他", role: "metric", type: "number", aggType: "sum" },
    { name: "全体", role: "metric", type: "number", aggType: "count" },
  ]);
});
