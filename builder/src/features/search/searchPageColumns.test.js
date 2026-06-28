import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSearchScopeColumns,
  isHitColumnActive,
  buildDisplayColumns,
  buildDependentSubstColumns,
  buildSameRecordBackfillFieldIds,
  buildFullQueryTemplates,
} from "./searchPageColumns.js";

test("buildSearchScopeColumns: appends hidden meta columns not already present", () => {
  // Only "氏名" displayed; all 4 meta columns (id/No./createdAt/modifiedAt) should be appended.
  const columns = [{ key: "氏名" }];
  const out = buildSearchScopeColumns(columns);
  const keys = out.map((c) => c.key);
  assert.ok(keys.includes("氏名"));
  ["id", "No.", "createdAt", "modifiedAt"].forEach((k) => assert.ok(keys.includes(k), `missing ${k}`));
  // original column stays first (superset appends hidden meta after)
  assert.equal(out[0].key, "氏名");
});

test("buildSearchScopeColumns: returns same array reference when all meta present", () => {
  const columns = [
    { key: "id" },
    { key: "No." },
    { key: "createdAt" },
    { key: "modifiedAt" },
    { key: "氏名" },
  ];
  const out = buildSearchScopeColumns(columns);
  assert.equal(out, columns);
});

test("isHitColumnActive: active for plain keyword, inactive when empty or SQL mode", () => {
  assert.equal(isHitColumnActive("田中"), true);
  assert.equal(isHitColumnActive("  "), false);
  assert.equal(isHitColumnActive(""), false);
  assert.equal(isHitColumnActive(null), false);
  // SQL mode (leading SELECT) suppresses the hit column
  assert.equal(isHitColumnActive("SELECT * FROM _form"), false);
});

test("buildDisplayColumns: prepends hit excerpt column only when active", () => {
  const columns = [{ key: "氏名" }];
  const inactive = buildDisplayColumns(false, columns);
  assert.equal(inactive, columns);

  const active = buildDisplayColumns(true, columns);
  assert.equal(active.length, 2);
  assert.equal(active[0].key, "__hit");
  assert.equal(active[1].key, "氏名");
});

test("buildDependentSubstColumns: returns [] when no dependent substitutions", () => {
  const out = buildDependentSubstColumns({
    hasDependentSubstitutions: false,
    substitutionChildRefs: { byFieldId: {} },
    normalizedSchema: [],
    displayColumns: [{ key: "氏名", path: "氏名" }],
  });
  assert.deepEqual(out, []);
});

test("buildSameRecordBackfillFieldIds: returns null when no dependent substitutions", () => {
  const out = buildSameRecordBackfillFieldIds({
    hasDependentSubstitutions: false,
    normalizedSchema: [],
    substitutionChildRefs: { byFieldId: {} },
  });
  assert.equal(out, null);
});

test("buildFullQueryTemplates: empty string when flag is false", () => {
  assert.equal(buildFullQueryTemplates([{ type: "substitution", templateText: "x" }], false), "");
});

test("buildFullQueryTemplates: joins only full-query substitution templates", () => {
  const schema = [
    { type: "substitution", templateText: "件数: {{SELECT COUNT(*) FROM _form}}" },
    { type: "substitution", templateText: "no-query" },
    { type: "text", templateText: "{{SELECT 1}}" },
  ];
  const out = buildFullQueryTemplates(schema, true);
  assert.equal(out, "件数: {{SELECT COUNT(*) FROM _form}}");
});
