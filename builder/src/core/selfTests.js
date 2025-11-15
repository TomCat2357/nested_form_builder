import { buildSafeRegex, validateByPattern } from "./validate.js";
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
  } catch (err) {
    console.warn("[SelfTests] error:", err);
  }
};
