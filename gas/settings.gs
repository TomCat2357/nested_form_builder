// ========================================
// 一般設定 — 個別フォーム限定フラグ / アクセス判定 / 公開 API ラッパー
// （管理者キー / メール / グループメンバーシップは adminAuth.gs）
// ========================================

/**
 * 個別フォーム限定フラグを取得する
 * @return {boolean}
 */
function GetRestrictToFormOnly_() {
  if (!Nfb_isAdminSettingsEnabled_()) return false;
  var props = Nfb_getScriptProperties_();
  return props.getProperty(NFB_RESTRICT_TO_FORM_ONLY) === "true";
}

/**
 * 個別フォーム限定フラグを設定する
 * @param {*} value
 * @return {Object}
 */
function SetRestrictToFormOnly_(value) {
  EnsureAdminSettingsEnabled_();
  var props = Nfb_getScriptProperties_();
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

/**
 * 指定ユーザーが管理者メールリスト（グループ含む）に含まれるか確認するAPI
 * フロントエンドのロックアウトチェック用
 * @param {Object} payload - { userEmail: string, adminEmails: string }
 * @return {Object}
 */
function nfbCheckAdminEmailMembership(payload) {
  return nfbSafeCall_(function() {
    var userEmail = NormalizeEmail_(payload && payload.userEmail || "");
    var adminEmailsRaw = String(payload && payload.adminEmails || "");
    var adminEmails = ParseAdminEmails_(adminEmailsRaw);
    if (adminEmails.length === 0) return { ok: true, isMember: true, reason: "no_restriction" };
    if (!userEmail) return { ok: true, isMember: false, reason: "missing_current_user_email" };
    // 共通メンバーシップ解決フロー（直接一致 → ライブ解決 → キャッシュフォールバック）
    var result = Admin_ResolveMembership_(userEmail, adminEmails);
    if (result.isMember) {
      return { ok: true, isMember: true, reason: result.reason };
    }
    var response = { ok: true, isMember: false, reason: result.reason };
    if (nfbHasOwnKeys_(result.groupErrors)) response.groupErrors = result.groupErrors;
    return response;
  });
}
