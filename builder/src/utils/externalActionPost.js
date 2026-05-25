// 外部アクションボタンのデータを外部 GAS へ POST 送信するユーティリティ。
// - 隠しフォームを自動生成し method=POST / target=_blank で送信する (GET の URL 長制限・CORS を回避)
// - GAS 側は doPost(e) の e.parameter.payload (JSON 文字列) で全データを受信できる
// - 機微情報 (spreadsheetId / spreadsheetUrl / sheetName / driveFileUrl / userEmail) は
//   adminOnly && isAdmin のときだけ payload.storage に含める (漏洩防止をここに集約)

import { isValidExternalActionUrl } from "./externalActionUrl.js";

const buildSpreadsheetUrl = (spreadsheetId) => (
  spreadsheetId ? `https://docs.google.com/spreadsheets/d/${spreadsheetId}` : ""
);

// payload を組み立てる。base は context 固有データ (一覧 list / レコード record)。
// storageFields は機微情報の供給元。gate で管理者ゲーティングを判定する。
export const buildExternalActionPayload = ({
  context,
  formId,
  formName,
  base = {},
  storageFields = {},
  gate = {},
} = {}) => {
  const { adminOnly = false, isAdmin = false } = gate && typeof gate === "object" ? gate : {};
  const payload = {
    context,
    formId: formId || "",
    formName: formName || "",
    generatedAt: new Date().toISOString(),
    ...(base && typeof base === "object" ? base : {}),
  };
  if (adminOnly === true && isAdmin === true) {
    const sf = storageFields && typeof storageFields === "object" ? storageFields : {};
    const spreadsheetId = typeof sf.spreadsheetId === "string" ? sf.spreadsheetId : "";
    payload.storage = {
      spreadsheetId,
      spreadsheetUrl: buildSpreadsheetUrl(spreadsheetId),
      sheetName: typeof sf.sheetName === "string" ? sf.sheetName : "",
      driveFileUrl: typeof sf.driveFileUrl === "string" ? sf.driveFileUrl : "",
      userEmail: typeof sf.userEmail === "string" ? sf.userEmail : "",
    };
  }
  return payload;
};

// 隠しフォームを生成して url へ POST する。
// url が http(s) でなければ false を返す (ページ側で alert する想定)。送信できたら true。
export const submitExternalActionPost = (url, payload) => {
  if (!isValidExternalActionUrl(url)) return false;
  if (typeof document === "undefined" || !document.body) return false;
  const form = document.createElement("form");
  form.method = "POST";
  form.action = url.trim();
  form.target = "_blank";
  form.style.display = "none";

  const input = document.createElement("input");
  input.type = "hidden";
  input.name = "payload";
  input.value = JSON.stringify(payload);
  form.appendChild(input);

  document.body.appendChild(form);
  try {
    form.submit();
  } finally {
    document.body.removeChild(form);
  }
  return true;
};
