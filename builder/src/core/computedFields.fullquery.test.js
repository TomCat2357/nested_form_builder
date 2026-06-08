import assert from "node:assert/strict";
import test from "node:test";
import { evaluateAllComputedFields } from "./computedFields.js";
import { collectResponses, buildDataValueMap } from "./collect.js";
import { escapeBraces, collectBalancedBraces } from "../features/expression/templateScanner.js";

// 置換フィールドの full-query 値が「保存できない」回帰のコアロジック検証。
// full-query トークンは非同期 prefetch（queryTokenValues Map）で解決される。
// - prefetch 済み（map にあり）→ computedValues に入り、collectResponses が永続化する。
// - prefetch 未解決（空 map）→ fallback "" になり、collectResponses の空値ガードで保存されない。
// （= 保存時に prefetch を await して値を確定させる必要がある、というバグの再現と修正の根拠。）

const TPL = "{{SELECT [種類] FROM _form WHERE [id]=_id}}";

function queryMapFor(template, value) {
  const tok = collectBalancedBraces(escapeBraces(template))[0];
  return new Map([[tok.fullToken, value]]);
}

const schema = [
  { id: "f1", type: "radio", label: "種類", options: [{ label: "許可" }, { label: "不許可" }] },
  { id: "f2", type: "substitution", label: "置換", templateText: TPL },
];

test("full-query 置換: prefetch 済み値が computedValues に入り collectResponses で永続化される", () => {
  const responses = { f1: "許可" };
  const queryTokenValues = queryMapFor(TPL, "許可");
  const { computedValues } = evaluateAllComputedFields(
    schema,
    responses,
    buildDataValueMap(schema, responses),
    { queryTokenValues, queryTokensReady: true },
  );
  assert.equal(computedValues.f2, "許可");

  const out = collectResponses(schema, { ...responses, ...computedValues });
  assert.equal(out["置換"], "許可"); // substitution パスが保存される
});

test("full-query 置換: prefetch 未解決（空 map）だと空値で、collectResponses は保存しない", () => {
  const responses = { f1: "許可" };
  const { computedValues } = evaluateAllComputedFields(
    schema,
    responses,
    buildDataValueMap(schema, responses),
    { queryTokenValues: new Map(), queryTokensReady: false },
  );
  assert.equal(computedValues.f2, ""); // fallback（= 警告も出さない）

  const out = collectResponses(schema, { ...responses, ...computedValues });
  assert.equal(Object.prototype.hasOwnProperty.call(out, "置換"), false); // 空はガードで保存されない
});
