// ========================================
// 管理者認証(キー) — 管理者キーの取得/設定と設定有効判定
// adminAuth.gs から分離。バンドル時に連結されるため関数はグローバル。
// FILE_ORDER では settings.gs より前に配置すること。
// ========================================

/**
 * 管理者設定が無効なときは例外を投げる
 */
function EnsureAdminSettingsEnabled_() {
  if (!Nfb_isAdminSettingsEnabled_()) {
    throw new Error("管理者設定は現在のプロパティ保存モードでは利用できません");
  }
}

/**
 * 管理者設定ゲート付きのスクリプトプロパティ getter 共通実装。
 * 管理者設定が無効なモードでは "" を返し、有効なら propKey の値（未設定は ""）を返す。
 * GetAdminKey_ / GetAdminEmail_ が共有する（ExtActionSecret はゲートなしのため対象外）。
 * @param {string} propKey
 * @return {string}
 */
function Nfb_getGatedAdminProperty_(propKey) {
  if (!Nfb_isAdminSettingsEnabled_()) {
    return "";
  }
  return Nfb_getScriptProperties_().getProperty(propKey) || "";
}

/**
 * 管理者専用のスクリプトプロパティ setter 共通実装。
 * EnsureAdminSettingsEnabled_ で保存可否を検証し、値を文字列化して保存、
 * { ok: true, [resultKey]: value } を返す。SetAdminKey_ / SetExtActionSecret_ が共有する
 * （SetAdminEmail_ はロックアウト防止の独自検証があるため対象外）。
 * @param {string} propKey
 * @param {string} resultKey 返却オブジェクトに値を載せるキー名
 * @param {string} newValue
 * @return {Object}
 */
function Nfb_setAdminProperty_(propKey, resultKey, newValue) {
  EnsureAdminSettingsEnabled_();
  var value = String(newValue || "");
  Nfb_getScriptProperties_().setProperty(propKey, value);
  var out = { ok: true };
  out[resultKey] = value;
  return out;
}

/**
 * 管理者キーを取得する
 * @return {string} 管理者キー（未設定の場合は空文字）
 */
function GetAdminKey_() {
  return Nfb_getGatedAdminProperty_(NFB_ADMIN_KEY);
}

/**
 * 管理者キーを設定する
 * @param {string} newKey - 新しい管理者キー（空文字で認証無効化）
 * @return {Object} 結果オブジェクト
 */
function SetAdminKey_(newKey) {
  return Nfb_setAdminProperty_(NFB_ADMIN_KEY, "adminKey", newKey);
}
