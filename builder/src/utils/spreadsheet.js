import { DEFAULT_SHEET_NAME } from "../core/constants.js";

export const normalizeSpreadsheetId = (input = "") => {
  const s = String(input).trim();
  if (/^https?:\/\//i.test(s)) {
    const idMatch = s.match(/\/d\/([a-zA-Z0-9-_]+)/);
    return idMatch?.[1] || s.match(/[?&]key=([a-zA-Z0-9-_]+)/)?.[1] || s;
  }
  return s;
};

// 子フォーム定義（formLink 先）の保存先スプレッドシート ID を正規化して取り出す。
// settings.spreadsheetId は ID も URL も入り得るため normalizeSpreadsheetId を通す。未設定なら ""。
export const childFormSpreadsheetId = (childForm) =>
  normalizeSpreadsheetId(childForm?.settings?.spreadsheetId || "");

// 子フォーム定義の保存先シート名。未設定なら既定の "Data"。
export const childFormSheetName = (childForm) =>
  (childForm?.settings?.sheetName ? String(childForm.settings.sheetName) : DEFAULT_SHEET_NAME);
