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

// ユーザージェスチャ中（クリックハンドラ冒頭）に同期的に空タブを開いて返す。
// 子データ取得など非同期処理を挟んでから POST する場合、このタブへ送信すれば
// transient activation 切れによるポップアップブロックを回避できる。
// 戻り値 { win, name } を submitExternalActionPost の target に渡す。開けなければ null。
var nfbExternalActionWindowSeq_ = 0;
export const openExternalActionWindow = () => {
  if (typeof window === "undefined" || typeof window.open !== "function") return null;
  nfbExternalActionWindowSeq_ += 1;
  const name = "nfbExternalAction_" + nfbExternalActionWindowSeq_;
  let win = null;
  try {
    win = window.open("", name);
  } catch (_e) {
    win = null;
  }
  if (!win) return null;
  try {
    // 取得待ちの間の空白タブに簡易表示（POST 後に上書きされる）。
    win.document.write("<!doctype html><meta charset=\"utf-8\"><title>送信準備中…</title><p style=\"font-family:sans-serif;padding:24px\">送信準備中…</p>");
    win.document.close();
  } catch (_e) { /* クロスオリジン等は無視 */ }
  return { win, name };
};

// 隠しフォームを生成して url へ POST する。
// url が http(s) でなければ false を返す (ページ側で alert する想定)。送信できたら true。
// target に openExternalActionWindow() の戻り値を渡すと、その既存タブへ POST する
// (非同期処理後のポップアップブロック回避)。未指定なら従来どおり target=_blank。
export const submitExternalActionPost = (url, payload, target = null) => {
  if (!isValidExternalActionUrl(url)) {
    // 事前に開いたタブがあれば閉じる（不正 URL で空タブを残さない）。
    if (target && target.win && typeof target.win.close === "function") {
      try { target.win.close(); } catch (_e) { /* noop */ }
    }
    return false;
  }
  if (typeof document === "undefined" || !document.body) return false;
  const form = document.createElement("form");
  form.method = "POST";
  form.action = url.trim();
  form.target = target && target.name ? target.name : "_blank";
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
