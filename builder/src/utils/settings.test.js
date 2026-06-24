import assert from "node:assert/strict";
import test from "node:test";
import {
  EXTERNAL_ACTIONS_MAX,
  SAVE_AFTER_ACTIONS,
  applySpreadsheetExclusiveSetting,
  buildPrimarySaveOptions,
  migrateStandardPrintTemplateId,
  normalizeExternalActions,
  resolveSaveAfterAction,
  resolveSettingsCheckboxChecked,
  resolveSettingsFieldValue,
} from "./settings.js";

const REAL_DOC_ID = "1AbcDEF_ghiJKLmnopQRstuvWXyz12345";

test("migrateStandardPrintTemplateId は旧 standardPrintTemplateUrl を素 fileId へ移行し URL キーを落とす", () => {
  const out = migrateStandardPrintTemplateId({
    formTitle: "申請書",
    standardPrintTemplateUrl: `https://docs.google.com/document/d/${REAL_DOC_ID}/edit`,
  });
  assert.equal(out.standardPrintTemplateId, REAL_DOC_ID);
  assert.equal("standardPrintTemplateUrl" in out, false);
  assert.equal(out.formTitle, "申請書");
});

test("migrateStandardPrintTemplateId は既に standardPrintTemplateId があればそれを優先する", () => {
  const out = migrateStandardPrintTemplateId({
    standardPrintTemplateId: REAL_DOC_ID,
    standardPrintTemplateUrl: "https://docs.google.com/document/d/OTHER_id_zzzzzzzzzzzzzzzzzzzz/edit",
  });
  assert.equal(out.standardPrintTemplateId, REAL_DOC_ID);
  assert.equal("standardPrintTemplateUrl" in out, false);
});

test("migrateStandardPrintTemplateId は対象キーが無ければそのまま返す", () => {
  const input = { formTitle: "x" };
  assert.equal(migrateStandardPrintTemplateId(input), input);
});

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

test("normalizeExternalActions は handshakeSecret を保持しない（送信元シークレットは管理者設定へ移行）", () => {
  const out = normalizeExternalActions({
    enabled: true,
    search: [
      { label: "S2", url: "https://b", handshakeSecret: "s3cr3t" }, // 旧フィールドは除去
    ],
  });
  assert.equal("handshakeSecret" in out.search[0], false);
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

// ---- フォーム→スプレッドシートリンクの論理パス/直接URL 排他（後勝ち） ----

test("applySpreadsheetExclusiveSetting は spreadsheetPath 設定で spreadsheetId を空にする", () => {
  const next = applySpreadsheetExclusiveSetting(
    { spreadsheetId: "https://docs.google.com/spreadsheets/d/AAA/edit", sheetName: "Data" },
    "spreadsheetPath",
    "売上/集計2026",
  );
  assert.equal(next.spreadsheetPath, "売上/集計2026");
  assert.equal(next.spreadsheetId, "", "直接 ID/URL はクリア（排他・後勝ち）");
  assert.equal(next.sheetName, "Data", "無関係キーは保持");
});

test("applySpreadsheetExclusiveSetting は spreadsheetId 設定で spreadsheetPath を空にする", () => {
  const next = applySpreadsheetExclusiveSetting(
    { spreadsheetPath: "売上/集計2026" },
    "spreadsheetId",
    "https://docs.google.com/spreadsheets/d/BBB/edit",
  );
  assert.equal(next.spreadsheetId, "https://docs.google.com/spreadsheets/d/BBB/edit");
  assert.equal(next.spreadsheetPath, "", "論理パスはクリア（排他・後勝ち）");
});

test("applySpreadsheetExclusiveSetting は空値クリアでは相手側を消さない", () => {
  const next = applySpreadsheetExclusiveSetting(
    { spreadsheetPath: "売上/集計2026", spreadsheetId: "" },
    "spreadsheetPath",
    "",
  );
  assert.equal(next.spreadsheetPath, "");
  assert.equal(next.spreadsheetId, "", "相手側は触らない（後勝ちは値があるときだけ）");
});

test("applySpreadsheetExclusiveSetting は排他対象外キーをそのまま反映し相手を消さない", () => {
  const next = applySpreadsheetExclusiveSetting(
    { spreadsheetPath: "売上/集計2026" },
    "sheetName",
    "回答",
  );
  assert.equal(next.sheetName, "回答");
  assert.equal(next.spreadsheetPath, "売上/集計2026");
});

test("applySpreadsheetExclusiveSetting は null settings でも安全に新規オブジェクトを返す", () => {
  const next = applySpreadsheetExclusiveSetting(null, "spreadsheetPath", "x/y");
  assert.equal(next.spreadsheetPath, "x/y");
  assert.equal(next.spreadsheetId, "");
});

