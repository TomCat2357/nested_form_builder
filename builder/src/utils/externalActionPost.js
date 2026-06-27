// 外部アクションボタンの payload を組み立てるユーティリティ。
// 送信自体は本体 GAS のサーバ間リレー（gasClient.sendExternalAction → nfbSendExternalAction）
// が UrlFetchApp で行う。隠しフォーム POST はログインリダイレクトで POST 本文を失う弱点が
// あったため廃止した。
// - GAS 受信側は doPost(e) の e.parameter.payload (JSON 文字列) で全データを受信できる。
// - 機微情報 (spreadsheetId / spreadsheetUrl / sheetName / driveFileUrl / userEmail) は
//   adminOnly && isAdmin のときだけ payload.storage に含める (漏洩防止をここに集約)。

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
    const childSpreadsheetId = typeof sf.childSpreadsheetId === "string" ? sf.childSpreadsheetId : "";
    payload.storage = {
      spreadsheetId,
      spreadsheetUrl: buildSpreadsheetUrl(spreadsheetId),
      sheetName: typeof sf.sheetName === "string" ? sf.sheetName : "",
      driveFileUrl: typeof sf.driveFileUrl === "string" ? sf.driveFileUrl : "",
      userEmail: typeof sf.userEmail === "string" ? sf.userEmail : "",
      // 子フォーム（子テーブル）の保存先スプレッドシート ID / シート名。formLink から解決し、
      // リレー先（choju 等）が子シートへの書き込み/リンク表示に使う。
      childSpreadsheetId,
      childSpreadsheetUrl: buildSpreadsheetUrl(childSpreadsheetId),
      childSheetName: typeof sf.childSheetName === "string" ? sf.childSheetName : "",
    };
  }
  return payload;
};

// サーバ間リレー（sendExternalAction）の戻り値 { status, body } を画面表示用に解釈する。
// 受信側が nfbRelay=1 で JSON ({ ok, title, message, openUrl }) を返せばそれを使い、
// JSON でない（旧受信アプリの HTML 等）ときは汎用の成功メッセージにフォールバックする。
export const interpretExternalActionResponse = (res) => {
  const status = res && typeof res.status === "number" ? res.status : 0;
  const body = res && typeof res.body === "string" ? res.body : "";
  let data = null;
  try { data = JSON.parse(body); } catch (_e) { data = null; }
  if (data && typeof data === "object") {
    return {
      ok: data.ok !== false,
      title: typeof data.title === "string" ? data.title : "",
      message: typeof data.message === "string" ? data.message : "",
      openUrl: typeof data.openUrl === "string" ? data.openUrl : "",
    };
  }
  return { ok: true, title: "", message: `外部アクションを送信しました（HTTP ${status}）。`, openUrl: "" };
};
