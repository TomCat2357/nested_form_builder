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
 * 管理者キーを取得する
 * @return {string} 管理者キー（未設定の場合は空文字）
 */
function GetAdminKey_() {
  if (!Nfb_isAdminSettingsEnabled_()) {
    return "";
  }
  var props = Nfb_getScriptProperties_();
  return props.getProperty(NFB_ADMIN_KEY) || "";
}

/**
 * 管理者キーを設定する
 * @param {string} newKey - 新しい管理者キー（空文字で認証無効化）
 * @return {Object} 結果オブジェクト
 */
function SetAdminKey_(newKey) {
  EnsureAdminSettingsEnabled_();
  var props = Nfb_getScriptProperties_();
  var key = String(newKey || "");
  props.setProperty(NFB_ADMIN_KEY, key);
  return { ok: true, adminKey: key };
}
