import assert from "node:assert/strict";
import test from "node:test";
import {
  EXTERNAL_ACTIONS_MAX,
  SAVE_AFTER_ACTIONS,
  buildPrimarySaveOptions,
  normalizeExternalActions,
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

test("normalizeExternalActions は undefined / null に空オブジェクトを返す", () => {
  const out = normalizeExternalActions(undefined);
  assert.equal(out.enabled, false);
  assert.equal(out.search.length, EXTERNAL_ACTIONS_MAX);
  assert.equal(out.record, undefined);
  out.search.forEach((a) => {
    assert.equal(a.label, "");
    assert.equal(a.url, "");
    assert.equal(a.adminOnly, false);
  });
  assert.deepEqual(normalizeExternalActions(null).search, out.search);
});

test("normalizeExternalActions は adminOnly フィールド無しを false に正規化する (後方互換)", () => {
  const out = normalizeExternalActions({
    enabled: true,
    search: [{ label: "S1", url: "https://a" }],
  });
  assert.equal(out.search[0].adminOnly, false);
  assert.equal(out.record, undefined);
});

test("normalizeExternalActions は adminOnly: true を保持する", () => {
  const out = normalizeExternalActions({
    enabled: true,
    search: [{ label: "S1", url: "https://a", adminOnly: true }],
    record: [],
  });
  assert.equal(out.search[0].adminOnly, true);
});

test("normalizeExternalActions は handshakeSecret を文字列のみ保持し既定は空", () => {
  const out = normalizeExternalActions({
    enabled: true,
    search: [
      { label: "S1", url: "https://a" },                           // 未指定 → ""
      { label: "S2", url: "https://b", handshakeSecret: "s3cr3t" }, // 文字列保持
      { label: "S3", url: "https://c", handshakeSecret: 123 },      // 非文字列 → ""
    ],
  });
  assert.equal(out.search[0].handshakeSecret, "");
  assert.equal(out.search[1].handshakeSecret, "s3cr3t");
  assert.equal(out.search[2].handshakeSecret, "");
});

test("normalizeExternalActions は truthy/falsy を boolean に正規化する", () => {
  const out = normalizeExternalActions({
    enabled: true,
    search: [
      { label: "S1", url: "https://a", adminOnly: "yes" },
      { label: "S2", url: "https://b", adminOnly: 0 },
      { label: "S3", url: "https://c", adminOnly: 1 },
    ],
    record: [],
  });
  assert.equal(out.search[0].adminOnly, true);
  assert.equal(out.search[1].adminOnly, false);
  assert.equal(out.search[2].adminOnly, true);
});

test("normalizeExternalActions は 4 個目以降を切り捨てる (既存仕様)", () => {
  const out = normalizeExternalActions({
    enabled: true,
    search: [
      { label: "S1", url: "https://1", adminOnly: true },
      { label: "S2", url: "https://2" },
      { label: "S3", url: "https://3" },
      { label: "S4", url: "https://4" },
    ],
    record: [],
  });
  assert.equal(out.search.length, EXTERNAL_ACTIONS_MAX);
  assert.equal(out.search[0].label, "S1");
  assert.equal(out.search[0].adminOnly, true);
  assert.equal(out.search[2].label, "S3");
});

