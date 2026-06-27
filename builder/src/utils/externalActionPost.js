// 外部アクションボタンの payload を組み立てるユーティリティ。
// 送信自体は本体 GAS のサーバ間リレー（gasClient.sendExternalAction → nfbSendExternalAction）
// が UrlFetchApp で行う。隠しフォーム POST はログインリダイレクトで POST 本文を失う弱点が
// あったため廃止した。
// - GAS 受信側は doPost(e) の e.parameter.payload (JSON 文字列) で全データを受信できる。
// - 機微情報 (spreadsheetId / spreadsheetUrl / sheetName / driveFileUrl / userEmail) は
//   adminOnly && isAdmin のときだけ payload.storage に含める (漏洩防止をここに集約)。

import { asString } from "./strings.js";
import { buildSpreadsheetUrl } from "./externalActionUrl.js";

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
    const spreadsheetId = asString(sf.spreadsheetId);
    const childSpreadsheetId = asString(sf.childSpreadsheetId);
    payload.storage = {
      spreadsheetId,
      spreadsheetUrl: buildSpreadsheetUrl(spreadsheetId),
      sheetName: asString(sf.sheetName),
      driveFileUrl: asString(sf.driveFileUrl),
      userEmail: asString(sf.userEmail),
      // 子フォーム（子テーブル）の保存先スプレッドシート ID / シート名。formLink から解決し、
      // リレー先（choju 等）が子シートへの書き込み/リンク表示に使う。
      childSpreadsheetId,
      childSpreadsheetUrl: buildSpreadsheetUrl(childSpreadsheetId),
      childSheetName: asString(sf.childSheetName),
    };
  }
  return payload;
};

// サーバ間リレー（sendExternalAction）の戻り値 { status, body } を画面表示用に解釈する。
// 受信側が nfbRelay=1 で JSON ({ ok, title, message, openUrl }) を返せばそれを使い、
// JSON でない（旧受信アプリの HTML 等）ときは汎用の成功メッセージにフォールバックする。
// htmlBody: true は応答が HTML（権限付与ページへのリダイレクト等）の可能性を示す。
export const interpretExternalActionResponse = (res) => {
  const status = res && typeof res.status === "number" ? res.status : 0;
  const body = res && typeof res.body === "string" ? res.body : "";
  let data = null;
  try { data = JSON.parse(body); } catch (_e) { data = null; }
  if (data && typeof data === "object") {
    return {
      ok: data.ok !== false,
      status,
      title: asString(data.title),
      message: asString(data.message),
      openUrl: asString(data.openUrl),
      htmlBody: false,
    };
  }
  const htmlBody = body.trimStart().startsWith("<");
  return {
    ok: true,
    status,
    title: "",
    message: htmlBody
      ? "送信先から HTML 応答が返りました。送信先ページで権限の付与が必要な可能性があります。"
      : `外部アクションを送信しました（HTTP ${status}）。`,
    openUrl: "",
    htmlBody,
  };
};
