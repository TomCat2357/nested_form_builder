import { buildSafeRegex, hasValidationErrors, validateByPattern } from "./validate.js";
import { collectResponses } from "./collect.js";
import { computeSchemaHash, normalizeSchemaIDs } from "./schema.js";
import { buildSearchColumns, buildColumnsFromHeaderMatrix } from "../features/search/searchTable.js";

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

    // 表示フラグ正規化: 未指定は false
    const displayDefault = normalizeSchemaIDs([{ type: "text", label: "表示デフォルト" }]);
    console.assert(displayDefault[0].isDisplayed === false, "isDisplayed default should be false");

    // 旧表示キー移行: isDisplayed > displayMode > important の優先順で正規化
    const migratedDisplay = normalizeSchemaIDs([
      { type: "text", label: "none", displayMode: "none" },
      { type: "text", label: "compact", displayMode: "compact" },
      { type: "text", label: "important", important: true },
      { type: "text", label: "priority", isDisplayed: false, displayMode: "normal", important: true },
    ]);
    console.assert(migratedDisplay[0].isDisplayed === false, "displayMode none should migrate to false");
    console.assert(migratedDisplay[1].isDisplayed === true, "displayMode not none should migrate to true");
    console.assert(migratedDisplay[2].isDisplayed === true, "important true should migrate to true");
    console.assert(migratedDisplay[3].isDisplayed === false, "isDisplayed should have highest priority");
    console.assert(!Object.prototype.hasOwnProperty.call(migratedDisplay[1], "displayMode"), "displayMode should be removed");
    console.assert(!Object.prototype.hasOwnProperty.call(migratedDisplay[2], "important"), "important should be removed");

    // 選択系表示は常に縮退列1本に統合される
    const choiceSchema = normalizeSchemaIDs([
      {
        type: "select",
        label: "色",
        isDisplayed: true,
        options: [{ label: "赤" }, { label: "青" }],
      },
    ]);
    const baseColumns = buildSearchColumns({ schema: choiceSchema }, { includeOperations: false });
    const matrixColumns = buildColumnsFromHeaderMatrix(
      [
        ["No.", "modifiedAt", "色", "色"],
        ["", "", "赤", "青"],
      ],
      baseColumns,
    );
    const choiceColumns = matrixColumns.filter((column) => column?.path === "色");
    console.assert(choiceColumns.length === 1, "choice columns should be collapsed into one display column");

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
