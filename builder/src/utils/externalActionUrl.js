// 外部アクションボタンの URL を解決するユーティリティ。
// - {id} / {formId} / {formName} を encodeURIComponent して置換する
// - 機微トークン ({spreadsheetId} / {spreadsheetUrl} / {sheetName} / {driveFileUrl} / {userEmail})
//   は adminOnly && isAdmin のときのみ展開。それ以外では URL 全体を null 化して早期失敗させる
// - http:// または https:// で始まらない URL は null を返す (javascript: 等のXSS対策)

const TOKEN_PATTERN = /\{(id|formId|formName|spreadsheetId|spreadsheetUrl|sheetName|driveFileUrl|userEmail)\}/g;

const HTTP_URL_PATTERN = /^https?:\/\//i;

const SENSITIVE_TOKENS = new Set([
  "spreadsheetId",
  "spreadsheetUrl",
  "sheetName",
  "driveFileUrl",
  "userEmail",
]);

const buildSpreadsheetUrl = (spreadsheetId) => (
  spreadsheetId ? `https://docs.google.com/spreadsheets/d/${spreadsheetId}` : ""
);

export const isValidExternalActionUrl = (url) => {
  if (typeof url !== "string") return false;
  return HTTP_URL_PATTERN.test(url.trim());
};

export const resolveExternalActionUrl = (url, context, gate) => {
  if (typeof url !== "string") return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  const ctx = context && typeof context === "object" ? context : {};
  const { adminOnly = false, isAdmin = false } = gate && typeof gate === "object" ? gate : {};
  const sensitiveAllowed = adminOnly === true && isAdmin === true;
  let blocked = false;
  const replaced = trimmed.replace(TOKEN_PATTERN, (_match, name) => {
    if (SENSITIVE_TOKENS.has(name) && !sensitiveAllowed) {
      blocked = true;
      return "";
    }
    let raw;
    if (name === "spreadsheetUrl") {
      raw = buildSpreadsheetUrl(ctx.spreadsheetId);
    } else {
      raw = ctx[name];
    }
    if (raw === undefined || raw === null) return "";
    return encodeURIComponent(String(raw));
  });
  if (blocked) return null;
  if (!HTTP_URL_PATTERN.test(replaced)) return null;
  return replaced;
};
