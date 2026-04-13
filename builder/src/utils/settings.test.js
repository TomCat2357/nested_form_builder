import assert from "node:assert/strict";
import test from "node:test";
import {
  SAVE_AFTER_ACTIONS,
  buildPrimarySaveOptions,
  resolveSaveAfterAction,
  resolveSettingsCheckboxChecked,
  resolveSettingsFieldValue,
} from "./settings.js";

test("resolveSaveAfterAction は未設定時に一覧へ戻るを返す", () => {
  assert.equal(resolveSaveAfterAction({}), SAVE_AFTER_ACTIONS.RETURN_TO_LIST);
  assert.equal(resolveSaveAfterAction(null), SAVE_AFTER_ACTIONS.RETURN_TO_LIST);
});

test("resolveSaveAfterAction は stayOnRecord をそのまま返す", () => {
  assert.equal(
    resolveSaveAfterAction({ saveAfterAction: SAVE_AFTER_ACTIONS.STAY_ON_RECORD }),
    SAVE_AFTER_ACTIONS.STAY_ON_RECORD,
  );
});

test("buildPrimarySaveOptions は未設定時に一覧へ戻る挙動を返す", () => {
  assert.deepEqual(buildPrimarySaveOptions({}), { redirect: true });
});

test("buildPrimarySaveOptions は stayOnRecord 設定時にレコード画面維持挙動を返す", () => {
  assert.deepEqual(
    buildPrimarySaveOptions({ saveAfterAction: SAVE_AFTER_ACTIONS.STAY_ON_RECORD }),
    { stayAsView: true },
  );
});

test("resolveSettingsFieldValue は select の defaultValue を表示値に使う", () => {
  const field = {
    key: "saveAfterAction",
    type: "select",
    defaultValue: SAVE_AFTER_ACTIONS.RETURN_TO_LIST,
    options: [
      { value: SAVE_AFTER_ACTIONS.RETURN_TO_LIST, label: "一覧に戻る" },
      { value: SAVE_AFTER_ACTIONS.STAY_ON_RECORD, label: "レコード画面に留まる" },
    ],
  };

  assert.equal(resolveSettingsFieldValue(field, undefined), SAVE_AFTER_ACTIONS.RETURN_TO_LIST);
  assert.equal(resolveSettingsFieldValue(field, SAVE_AFTER_ACTIONS.STAY_ON_RECORD), SAVE_AFTER_ACTIONS.STAY_ON_RECORD);
});

test("resolveSettingsCheckboxChecked は defaultValue を checked に反映する", () => {
  const field = { key: "showRecordNo", type: "checkbox", defaultValue: true };

  assert.equal(resolveSettingsCheckboxChecked(field, undefined), true);
  assert.equal(resolveSettingsCheckboxChecked(field, false), false);
});

