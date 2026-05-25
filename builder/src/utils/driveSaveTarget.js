/**
 * Question / Dashboard 定義の「Google Drive 保存先 URL」入力値を検証する。
 *
 * ルール:
 *  - 空 → ok（既定フォルダ）
 *  - フォルダ URL → ok（そのフォルダに保存）
 *  - ファイル URL: 新規作成時は不可。編集時は「元のファイル URL」と一致する場合のみ可。
 *  - 上記以外の形式 → エラー
 *
 * @param {string|null|undefined} rawUrl 入力欄の生値
 * @param {{ isEdit: boolean, originalFileUrl?: string, itemLabel: string }} opts
 *        itemLabel は "Question" / "Dashboard" などエラーメッセージ用。
 * @returns {{ ok: true, targetUrl: string|null } | { ok: false, error: string }}
 */
export function validateDriveSaveTarget(rawUrl, { isEdit, originalFileUrl, itemLabel } = {}) {
  const targetUrl = (typeof rawUrl === "string" ? rawUrl.trim() : "") || null;
  if (!targetUrl) return { ok: true, targetUrl: null };

  const isFileUrl = /\/file\/d\/[a-zA-Z0-9_-]+/.test(targetUrl);
  const isFolderUrl = /\/folders\/[a-zA-Z0-9_-]+/.test(targetUrl);

  if (!isEdit && isFileUrl) {
    return { ok: false, error: "新規作成時はファイルURLは指定できません。フォルダURLまたは空白にしてください。" };
  }
  if (isEdit && isFileUrl && targetUrl !== originalFileUrl) {
    return { ok: false, error: `既存 ${itemLabel} の保存先には、元のファイルURL以外のファイルURLは指定できません。フォルダURLまたは空白にしてください。` };
  }
  if (!isFileUrl && !isFolderUrl) {
    return { ok: false, error: "Drive 保存先 URL の形式が不正です。" };
  }
  return { ok: true, targetUrl };
}
