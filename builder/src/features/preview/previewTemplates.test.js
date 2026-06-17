import { test } from "node:test";
import assert from "node:assert/strict";
import { collectTemplateTexts, detectFullQuerySubstitution, FULL_QUERY_SUBST_RE } from "./previewTemplates.js";

// テンプレ収集の対象: `{` を含む templateText。ネスト（children / childrenByValue）も巡回する。
const schema = [
  { id: "a", type: "substitution", templateText: "Hello {name}" },
  { id: "b", type: "text", templateText: "no-brace" }, // `{` を含まない → 対象外
  { id: "c", type: "text", templateText: "plain {x}", printTemplateAction: { fileNameTemplate: "file-{id}.pdf" } },
  {
    id: "d",
    type: "radio",
    options: [{ label: "Y" }],
    childrenByValue: { Y: [{ id: "d1", type: "substitution", templateText: "child {{SELECT 1}}" }] },
  },
  { id: "e", type: "group", children: [{ id: "e1", type: "substitution", templateText: "nested {q}" }] },
];

test("collectTemplateTexts: 既定は `{` を含む全 templateText を巡回収集", () => {
  const out = collectTemplateTexts(schema);
  assert.deepEqual(out, ["Hello {name}", "plain {x}", "child {{SELECT 1}}", "nested {q}"]);
});

test("collectTemplateTexts: substitutionOnly は type==='substitution' のみ", () => {
  const out = collectTemplateTexts(schema, { substitutionOnly: true });
  assert.deepEqual(out, ["Hello {name}", "child {{SELECT 1}}", "nested {q}"]);
});

test("collectTemplateTexts: includePrintFileName で printTemplateAction も収集", () => {
  const out = collectTemplateTexts(schema, { includePrintFileName: true });
  assert.deepEqual(out, ["Hello {name}", "plain {x}", "file-{id}.pdf", "child {{SELECT 1}}", "nested {q}"]);
});

test("collectTemplateTexts: 空/非配列 schema は空配列", () => {
  assert.deepEqual(collectTemplateTexts([]), []);
  assert.deepEqual(collectTemplateTexts(null), []);
});

test("detectFullQuerySubstitution: substitution の {{SELECT}} があれば true", () => {
  assert.equal(detectFullQuerySubstitution(schema), true);
});

test("detectFullQuerySubstitution: substitution 以外の {{SELECT}} は無視（false）", () => {
  const onlyNonSubst = [{ id: "x", type: "text", templateText: "{{SELECT 1}}" }];
  assert.equal(detectFullQuerySubstitution(onlyNonSubst), false);
});

test("detectFullQuerySubstitution: full-query が無ければ false", () => {
  const noFq = [{ id: "x", type: "substitution", templateText: "Hello {name}" }];
  assert.equal(detectFullQuerySubstitution(noFq), false);
});

test("FULL_QUERY_SUBST_RE: 大小無視・前後空白許容", () => {
  assert.match("{{ select * }}", FULL_QUERY_SUBST_RE);
  assert.match("{{SELECT 1}}", FULL_QUERY_SUBST_RE);
  assert.doesNotMatch("{{ SUM(x) }}", FULL_QUERY_SUBST_RE);
});
