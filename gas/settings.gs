// ========================================
// 管理者キー関連 (Script Properties)
// ========================================
var NFB_ADMIN_KEY = "ADMIN_KEY";
var NFB_ADMIN_EMAIL = "ADMIN_EMAIL";

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
 * メールアドレスを比較用に正規化する
 * @param {string} value
 * @return {string}
 */
function NormalizeEmail_(value) {
  return String(value || "").trim().toLowerCase();
}

/**
 * 管理者メール設定値（";"区切り）を配列化して返す
 * @param {string} raw
 * @return {string[]}
 */
function ParseAdminEmails_(raw) {
  var text = String(raw || "");
  if (!text) return [];
  var seen = {};
  var result = [];
  var parts = text.split(";");
  for (var i = 0; i < parts.length; i += 1) {
    var normalized = NormalizeEmail_(parts[i]);
    if (!normalized) continue;
    if (seen[normalized]) continue;
    seen[normalized] = true;
    result.push(normalized);
  }
  return result;
}

/**
 * 管理者メール（";"区切り）を取得する
 * @return {string}
 */
function GetAdminEmail_() {
  var props = PropertiesService.getScriptProperties();
  return props.getProperty(NFB_ADMIN_EMAIL) || "";
}

/**
 * 管理者メール（";"区切り）を設定する
 * @param {string} newEmail - 新しい管理者メール（空文字で制限解除）
 * @return {Object}
 */
function SetAdminEmail_(newEmail) {
  var props = PropertiesService.getScriptProperties();
  var normalized = ParseAdminEmails_(newEmail).join(";");
  props.setProperty(NFB_ADMIN_EMAIL, normalized);
  return { ok: true, adminEmail: normalized };
}

/**
 * 管理者メール制限に一致しているか判定する
 * @param {string} activeUserEmail
 * @return {boolean}
 */
function IsAdminEmailMatched_(activeUserEmail) {
  var adminEmails = ParseAdminEmails_(GetAdminEmail_());
  if (adminEmails.length === 0) {
    // 管理者メール未設定の場合は制限しない
    return true;
  }
  var normalizedUserEmail = NormalizeEmail_(activeUserEmail);
  if (!normalizedUserEmail) {
    return false;
  }
  return adminEmails.indexOf(normalizedUserEmail) !== -1;
}

/**
 * 管理者判定を行う
 * @param {string} adminKeyParam - URLのadminkeyパラメータ
 * @param {string} activeUserEmail - 現在ユーザーのメール
 * @return {boolean} 管理者の場合はtrue
 */
function IsAdmin_(adminKeyParam, activeUserEmail) {
  var adminKey = GetAdminKey_();
  if (adminKey !== "" && String(adminKeyParam || "") !== adminKey) {
    return false;
  }
  return IsAdminEmailMatched_(activeUserEmail);
}

/**
 * アクセス権限を判定する
 * @param {string} formParam - formパラメータ
 * @param {string} adminkeyParam - adminkeyパラメータ
 * @param {string} activeUserEmail - 現在ユーザーのメール
 * @return {{ isAdmin: boolean, formId: string, authError: string }}
 */
function DetermineAccess_(formParam, adminkeyParam, activeUserEmail) {
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

  // formパラメータがない場合は管理者モード判定
  // 管理者キー設定済みの場合は一致が必須
  if (adminKey !== "" && adminkeyParam !== adminKey) {
    return { isAdmin: false, formId: "", authError: "access_denied" };
  }

  // 管理者メール設定済みの場合は一致が必須（大文字小文字は無視）
  if (!IsAdminEmailMatched_(activeUserEmail)) {
    return { isAdmin: false, formId: "", authError: "access_denied" };
  }

  return { isAdmin: true, formId: "", authError: "" };
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

/**
 * 管理者メールを取得するAPI
 * @return {Object}
 */
function nfbGetAdminEmail() {
  return nfbSafeCall_(function() {
    return { ok: true, adminEmail: GetAdminEmail_() };
  });
}

/**
 * 管理者メールを設定するAPI
 * @param {string} newEmail - 新しい管理者メール（";"区切り）
 * @return {Object}
 */
function nfbSetAdminEmail(newEmail) {
  return nfbSafeCall_(function() {
    return SetAdminEmail_(newEmail);
  });
}

