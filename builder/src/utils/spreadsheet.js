export const normalizeSpreadsheetId = (input = "") => {
  const s = String(input).trim();
  if (/^https?:\/\//i.test(s)) {
    const idMatch = s.match(/\/d\/([a-zA-Z0-9-_]+)/);
    return idMatch?.[1] || s.match(/[?&]key=([a-zA-Z0-9-_]+)/)?.[1] || s;
  }
  return s;
};
