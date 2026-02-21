// ========================================
// 管理者キー関連 (Script Properties)
// ========================================
var NFB_ADMIN_KEY = "ADMIN_KEY";

/**
 * 管理者キーを取得する
 * @return {string} 管理者キー（未設定の場合は空文字）
 */
function GetAdminKey_() {
  var props = PropertiesService.getScriptProperties();
  return props.getProperty(NFB_ADMIN_KEY) || "";
}

/**
 * 管理者キーを設定する
 * @param {string} newKey - 新しい管理者キー（空文字で認証無効化）
 * @return {Object} 結果オブジェクト
 */
function SetAdminKey_(newKey) {
  var props = PropertiesService.getScriptProperties();
  var key = String(newKey || "");
  props.setProperty(NFB_ADMIN_KEY, key);
  return { ok: true, adminKey: key };
}

/**
 * 管理者判定を行う
 * @param {string} formParam - URLのformパラメータ
 * @return {boolean} 管理者の場合はtrue
 */
function IsAdmin_(formParam) {
  var adminKey = GetAdminKey_();

  // 管理者キー未設定なら全員管理者
  if (adminKey === "") {
    return true;
  }

  // 一致した場合のみ管理者
  return formParam === adminKey;
}

/**
 * アクセス権限を判定する
 * @param {string} formParam - formパラメータ
 * @param {string} adminkeyParam - adminkeyパラメータ
 * @return {{ isAdmin: boolean, formId: string, authError: string }}
 */
function DetermineAccess_(formParam, adminkeyParam) {
  var adminKey = GetAdminKey_();

  // formパラメータがある場合（form優先）
  if (formParam) {
    // フォームの存在確認
    var fileUrl = GetFormUrl_(formParam);
    if (fileUrl) {
      // フォームが存在する → ユーザーモード
      return { isAdmin: false, formId: formParam, authError: "" };
    } else {
      // フォームが存在しない → エラー
      return { isAdmin: false, formId: "", authError: "form_not_found" };
    }
  }

  // formパラメータがない場合
  if (adminKey === "") {
    // 管理者キー未設定 → 誰でも管理者
    return { isAdmin: true, formId: "", authError: "" };
  }

  // 管理者キー設定済み
  if (adminkeyParam === adminKey) {
    // adminkeyが一致 → 管理者モード
    return { isAdmin: true, formId: "", authError: "" };
  }

  // それ以外 → アクセス拒否
  return { isAdmin: false, formId: "", authError: "access_denied" };
}

/**
 * 管理者キーを取得するAPI（管理者専用）
 * @return {Object} 管理者キー情報
 */
function nfbGetAdminKey() {
  return nfbSafeCall_(function() {
    return { ok: true, adminKey: GetAdminKey_() };
  });
}

/**
 * 管理者キーを設定するAPI（管理者専用）
 * @param {string} newKey - 新しい管理者キー
 * @return {Object} 結果オブジェクト
 */
function nfbSetAdminKey(newKey) {
  return nfbSafeCall_(function() {
    return SetAdminKey_(newKey);
  });
}

