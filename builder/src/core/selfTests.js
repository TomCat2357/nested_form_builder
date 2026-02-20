import { buildSafeRegex, hasValidationErrors, validateByPattern } from "./validate.js";
import { collectResponses } from "./collect.js";
import { computeSchemaHash, normalizeSchemaIDs } from "./schema.js";

export const runSelfTests = () => {
  try {
    console.assert(buildSafeRegex("^[0-9]+$").error === null, "regex valid should have no error");
    console.assert(buildSafeRegex("(").error !== null, "regex invalid should have error");

    const regexField = { type: "regex", pattern: "^[a-z]+$", required: false };
    console.assert(validateByPattern(regexField, "abc").ok === true, "pattern should accept alpha");
    console.assert(validateByPattern(regexField, "123").ok === false, "pattern should reject digits");
    console.assert(validateByPattern(regexField, "").ok === true, "empty ok when not required");

    const schema = normalizeSchemaIDs([
      { type: "radio", label: "色", options: [{ label: "赤" }, { label: "青" }] },
      { type: "text", label: "名前" },
    ]);
    const responses = { [schema[0].id]: "赤", [schema[1].id]: "太郎" };
    const output = collectResponses(schema, responses);
    console.assert(output["色|赤"] === "●" && output["名前"] === "太郎", "collectResponses basic");

    console.assert(typeof computeSchemaHash(schema) === "string", "schema hash returns string");

    // 必須チェック: テキスト
    const requiredText = normalizeSchemaIDs([{ type: "text", label: "氏名", required: true }]);
    console.assert(hasValidationErrors(requiredText, {}) === true, "required text should error when empty");
    console.assert(hasValidationErrors(requiredText, { [requiredText[0].id]: "山田" }) === false, "required text should pass when filled");

    // 必須チェック: セレクト + 子要素
    const selectWithChild = normalizeSchemaIDs([
      {
        type: "select",
        label: "カラー",
        required: true,
        options: [{ label: "赤" }, { label: "青" }],
        childrenByValue: {
          赤: [{ type: "text", label: "理由", required: true }],
        },
      },
    ]);
    const selectId = selectWithChild[0].id;
    const reasonId = selectWithChild[0].childrenByValue["赤"][0].id;
    console.assert(hasValidationErrors(selectWithChild, {}) === true, "required select should error when empty");
    console.assert(hasValidationErrors(selectWithChild, { [selectId]: "赤" }) === true, "child required should error when empty");
    console.assert(hasValidationErrors(selectWithChild, { [selectId]: "赤", [reasonId]: "好き" }) === false, "child required should pass when filled");
  } catch (err) {
    console.warn("[SelfTests] error:", err);
  }
};
