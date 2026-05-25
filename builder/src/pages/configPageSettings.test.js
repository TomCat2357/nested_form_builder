import assert from "node:assert/strict";
import test from "node:test";
import { SAVE_AFTER_ACTIONS } from "../utils/settings.js";
import { getConfigPageSaveAfterActionField } from "./configPageSettings.js";

test("getConfigPageSaveAfterActionField は ConfigPage 用の保存後動作定義を返す", () => {
  const field = getConfigPageSaveAfterActionField();

  assert.ok(field);
  assert.equal(field.key, "saveAfterAction");
  assert.equal(field.defaultValue, SAVE_AFTER_ACTIONS.RETURN_TO_LIST);
  assert.deepEqual(field.options, [
    { value: SAVE_AFTER_ACTIONS.RETURN_TO_LIST, label: "一覧に戻る" },
    { value: SAVE_AFTER_ACTIONS.STAY_ON_RECORD, label: "レコード画面に留まる" },
  ]);
});
