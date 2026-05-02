import assert from "node:assert/strict";
import test from "node:test";
import {
  DASHBOARD_SCHEMA_VERSION,
  createEmptyDashboard,
  normalizeDashboard,
  sanitizeImportedDashboard,
} from "./dashboardSchema.js";

test("normalizeDashboard は必須フィールドにデフォルト値を埋める", () => {
  const result = normalizeDashboard({ id: "dsh_test" });
  assert.equal(result.id, "dsh_test");
  assert.equal(result.schemaVersion, DASHBOARD_SCHEMA_VERSION);
  assert.equal(result.description, "");
  assert.equal(result.templateUrl, "");
  assert.deepEqual(result.dataSources, []);
  assert.deepEqual(result.queries, []);
  assert.deepEqual(result.widgets, []);
  assert.deepEqual(result.layout, []);
  assert.equal(result.archived, false);
  assert.equal(result.readOnly, false);
  assert.equal(result.settings.title, "");
});

test("normalizeDashboard は不正な型を拒否する", () => {
  assert.throws(() => normalizeDashboard(null), /ダッシュボード定義が不正/);
  assert.throws(() => normalizeDashboard([]), /ダッシュボード定義が不正/);
  assert.throws(() => normalizeDashboard("string"), /ダッシュボード定義が不正/);
});

test("normalizeDashboard は配列でない dataSources/queries/widgets/layout を空配列に置換する", () => {
  const result = normalizeDashboard({
    id: "dsh_x",
    dataSources: "not-an-array",
    queries: { not: "array" },
    widgets: null,
    layout: undefined,
  });
  assert.deepEqual(result.dataSources, []);
  assert.deepEqual(result.queries, []);
  assert.deepEqual(result.widgets, []);
  assert.deepEqual(result.layout, []);
});

test("normalizeDashboard は archived/readOnly を boolean に正規化", () => {
  const result = normalizeDashboard({ id: "dsh_x", archived: 1, readOnly: "yes" });
  assert.equal(result.archived, true);
  assert.equal(result.readOnly, true);
});

test("normalizeDashboard は settings をクローンする (参照を切る)", () => {
  const original = { title: "T1", custom: "V1" };
  const result = normalizeDashboard({ id: "dsh_x", settings: original });
  result.settings.title = "T2";
  assert.equal(original.title, "T1");
  assert.equal(result.settings.custom, "V1");
});

test("normalizeDashboard はタイムスタンプの数値以外を null に正規化", () => {
  const result = normalizeDashboard({ id: "dsh_x", createdAtUnixMs: "abc", modifiedAtUnixMs: NaN });
  assert.equal(result.createdAtUnixMs, null);
  assert.equal(result.modifiedAtUnixMs, null);
});

test("createEmptyDashboard は新しい id を発行する", () => {
  const a = createEmptyDashboard();
  const b = createEmptyDashboard();
  assert.notEqual(a.id, b.id);
  assert.match(a.id, /^dsh_/);
});

test("createEmptyDashboard は明示 id を尊重する", () => {
  const result = createEmptyDashboard({ id: "dsh_explicit" });
  assert.equal(result.id, "dsh_explicit");
});

test("sanitizeImportedDashboard は不正データなら null", () => {
  assert.equal(sanitizeImportedDashboard(null), null);
  assert.equal(sanitizeImportedDashboard("string"), null);
  assert.equal(sanitizeImportedDashboard([]), null);
});

test("sanitizeImportedDashboard は有効データを正規化して返す", () => {
  const result = sanitizeImportedDashboard({ id: "dsh_imp", settings: { title: "imported" } });
  assert.ok(result);
  assert.equal(result.id, "dsh_imp");
  assert.equal(result.settings.title, "imported");
});
