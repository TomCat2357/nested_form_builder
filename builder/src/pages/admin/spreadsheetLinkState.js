// フォーム→スプレッドシート連結状態の純関数ヘルパー（副作用なし）。
// AdminFormEditorPage から「連結済みか判定」「未選択（自動作成）で連結解除」のロジックを切り出す。

// レコード保存先スプレッドシートが連結済みか。物理 ID（spreadsheetId）か論理パス（spreadsheetPath）の
// どちらかが trim 後に非空なら連結済みとみなす。null / undefined / {} は false。
export function isFormSpreadsheetLinked(settings) {
  if (!settings || typeof settings !== "object") return false;
  const id = typeof settings.spreadsheetId === "string" ? settings.spreadsheetId.trim() : "";
  const path = typeof settings.spreadsheetPath === "string" ? settings.spreadsheetPath.trim() : "";
  return Boolean(id || path);
}

// 「未選択（自動作成）」を選んだときの連結解除。物理 ID と論理パスを両方空にして返す
// （他キー = sheetName 等は保持）。保存時にバックエンドの「両方空 → 04_spreadsheets へ新規作成」
// 経路を発火させるための明示ジェスチャ。入力は非破壊。applySpreadsheetExclusiveSetting は
// 空値クリアで相手側を消さない契約のため、ここでは通さず直接両フィールドを空にする。
export function applyUnlinkSpreadsheetForRecreate(settings) {
  const base = settings && typeof settings === "object" ? settings : {};
  return { ...base, spreadsheetPath: "", spreadsheetId: "" };
}
