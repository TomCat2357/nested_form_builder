// ========================================
// 管理者キー関連 (Script Properties)
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
 * 管理者設定はscript propertiesで管理する
 * @return {GoogleAppsScript.Properties.Properties}
 */
function GetAdminProps_() {
  return PropertiesService.getScriptProperties();
}

/**
 * 管理者キーを取得する
 * @return {string} 管理者キー（未設定の場合は空文字）
 */
function GetAdminKey_() {
  if (!Nfb_isAdminSettingsEnabled_()) {
    return "";
  }
  var props = GetAdminProps_();
  return props.getProperty(NFB_ADMIN_KEY) || "";
}

/**
 * 管理者キーを設定する
 * @param {string} newKey - 新しい管理者キー（空文字で認証無効化）
 * @return {Object} 結果オブジェクト
 */
function SetAdminKey_(newKey) {
  EnsureAdminSettingsEnabled_();
  var props = GetAdminProps_();
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
  if (!Nfb_isAdminSettingsEnabled_()) {
    return "";
  }
  var props = GetAdminProps_();
  return props.getProperty(NFB_ADMIN_EMAIL) || "";
}

/**
 * 管理者メール（";"区切り）を設定する
 * @param {string} newEmail - 新しい管理者メール（空文字で制限解除）
 * @return {Object}
 */
function SetAdminEmail_(newEmail) {
  EnsureAdminSettingsEnabled_();
  var props = GetAdminProps_();
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
  if (!Nfb_isAdminSettingsEnabled_()) {
    return false;
  }
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
  if (!Nfb_isAdminSettingsEnabled_()) {
    return false;
  }
  var adminKey = GetAdminKey_();
  if (adminKey !== "" && String(adminKeyParam || "") !== adminKey) {
    return false;
  }
  return IsAdminEmailMatched_(activeUserEmail);
}

/**
 * 個別フォーム限定フラグを取得する
 * @return {boolean}
 */
function GetRestrictToFormOnly_() {
  if (!Nfb_isAdminSettingsEnabled_()) return false;
  var props = GetAdminProps_();
  return props.getProperty(NFB_RESTRICT_TO_FORM_ONLY) === "true";
}

/**
 * 個別フォーム限定フラグを設定する
 * @param {*} value
 * @return {Object}
 */
function SetRestrictToFormOnly_(value) {
  EnsureAdminSettingsEnabled_();
  var props = GetAdminProps_();
  var flag = value === true || value === "true" || value === 1 || value === "1";
  props.setProperty(NFB_RESTRICT_TO_FORM_ONLY, flag ? "true" : "false");
  return { ok: true, restrictToFormOnly: flag };
}

/**
 * アクセス権限を判定する
 * @param {string} formParam - formパラメータ
 * @param {string} adminkeyParam - adminkeyパラメータ
 * @param {string} activeUserEmail - 現在ユーザーのメール
 * @return {{ isAdmin: boolean, formId: string, authError: string }}
 */
function DetermineAccess_(formParam, adminkeyParam, activeUserEmail) {
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

  // userモード時は管理者設定を無効化し、常に通常モードで表示
  if (!Nfb_isAdminSettingsEnabled_()) {
    return { isAdmin: false, formId: "", authError: "" };
  }

  var restrictToFormOnly = GetRestrictToFormOnly_();
  var adminKey = GetAdminKey_();

  // formパラメータがない場合は管理者モード判定
  // 管理者キー設定済みの場合は一致が必須
  if (adminKey !== "" && adminkeyParam !== adminKey) {
    return { isAdmin: false, formId: "", authError: restrictToFormOnly ? "forbidden" : "" };
  }

  // 管理者メール設定済みの場合は一致が必須（大文字小文字は無視）
  if (!IsAdminEmailMatched_(activeUserEmail)) {
    return { isAdmin: false, formId: "", authError: restrictToFormOnly ? "forbidden" : "" };
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

/**
 * 個別フォーム限定フラグを取得するAPI
 * @return {Object}
 */
function nfbGetRestrictToFormOnly() {
  return nfbSafeCall_(function() {
    return { ok: true, restrictToFormOnly: GetRestrictToFormOnly_() };
  });
}

/**
 * 個別フォーム限定フラグを設定するAPI
 * @param {*} value
 * @return {Object}
 */
function nfbSetRestrictToFormOnly(value) {
  return nfbSafeCall_(function() {
    return SetRestrictToFormOnly_(value);
  });
}

