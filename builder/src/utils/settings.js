import { normalizeStyleSettings } from "../core/styleSettings.js";
import { extractDriveFileId } from "./printTemplateAction.js";

// 標準印刷様式の参照を素の fileId（standardPrintTemplateId）へ正規化する後方互換移行。
// 旧 standardPrintTemplateUrl（Doc URL）しか無いデータを読み込んだとき id を立てて URL キーを落とす（前進移行）。
// 物理は素の fileId で保持し、表示/出力では fileId から URL を復元する方針に揃える。
export const migrateStandardPrintTemplateId = (settings) => {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return settings;
  if (!("standardPrintTemplateUrl" in settings)) return settings;
  const { standardPrintTemplateUrl, ...rest } = settings;
  const id = (typeof rest.standardPrintTemplateId === "string" && rest.standardPrintTemplateId.trim())
    ? rest.standardPrintTemplateId.trim()
    : extractDriveFileId(standardPrintTemplateUrl);
  return id ? { ...rest, standardPrintTemplateId: id } : rest;
};

export const SAVE_AFTER_ACTIONS = Object.freeze({
  RETURN_TO_LIST: "returnToList",
  STAY_ON_RECORD: "stayOnRecord",
});

/**
 * settings オブジェクトから theme プロパティを除外する
 * @param {object} settings
 * @returns {object}
 */
export const omitThemeSetting = (settings) => {
  if (!settings || typeof settings !== "object") return {};
  const { theme, ...rest } = settings;
  return rest;
};

export const resolveSaveAfterAction = (settings) => (
  settings?.saveAfterAction === SAVE_AFTER_ACTIONS.STAY_ON_RECORD
    ? SAVE_AFTER_ACTIONS.STAY_ON_RECORD
    : SAVE_AFTER_ACTIONS.RETURN_TO_LIST
);

export const buildPrimarySaveOptions = (settings) => (
  resolveSaveAfterAction(settings) === SAVE_AFTER_ACTIONS.STAY_ON_RECORD
    ? { stayAsView: true }
    : { redirect: true }
);

export const resolveSettingsFieldValue = (field, value) => {
  const isSelect = field?.type === "select" || Array.isArray(field?.options);
  if (isSelect) return value ?? field?.defaultValue ?? "";
  return value ?? "";
};

export const resolveSettingsCheckboxChecked = (field, value) => (
  value !== undefined ? !!value : !!field?.defaultValue
);

// フォーム→スプレッドシートのリンクは「論理パス（spreadsheetPath）」と「直接 ID/URL（spreadsheetId）」を
// 排他にする。一方に値が入ったらもう一方を空にする（後勝ち）。設定変更時に適用する純関数。
// 排他対象外のキー変更はそのまま反映する。
export const applySpreadsheetExclusiveSetting = (settings, key, value) => {
  const next = { ...(settings || {}), [key]: value };
  if (key === "spreadsheetPath" && value) next.spreadsheetId = "";
  if (key === "spreadsheetId" && value) next.spreadsheetPath = "";
  return next;
};

export const EXTERNAL_ACTIONS_MAX = 3;

const EMPTY_EXTERNAL_ACTION = Object.freeze({ label: "", url: "", adminOnly: false });

const sanitizeExternalActionList = (raw) => {
  const list = Array.isArray(raw) ? raw.slice(0, EXTERNAL_ACTIONS_MAX) : [];
  const out = [];
  for (let i = 0; i < EXTERNAL_ACTIONS_MAX; i += 1) {
    const item = list[i];
    const showStyleSettings = typeof item?.showStyleSettings === "boolean"
      ? item.showStyleSettings
      : !!item?.styleSettings;
    const entry = {
      label: typeof item?.label === "string" ? item.label : "",
      url: typeof item?.url === "string" ? item.url : "",
      adminOnly: !!item?.adminOnly,
      showStyleSettings,
    };
    if (showStyleSettings) {
      entry.styleSettings = normalizeStyleSettings(item?.styleSettings || {});
    }
    out.push(entry);
  }
  return out;
};

export const createEmptyExternalActions = () => ({
  enabled: false,
  search: sanitizeExternalActionList([]),
});

export const normalizeExternalActions = (raw) => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return createEmptyExternalActions();
  }
  // 旧 record（レコード画面ボタン）は 外部アクション 質問カードに移行したため読み捨てる。
  return {
    enabled: !!raw.enabled,
    search: sanitizeExternalActionList(raw.search),
  };
};

export { EMPTY_EXTERNAL_ACTION };
