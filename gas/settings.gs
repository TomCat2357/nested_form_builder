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
 * オブジェクトが自己所有キーを1つでも持つか判定する
 * @param {Object|null|undefined} obj
 * @return {boolean}
 */
function nfbHasOwnKeys_(obj) {
  if (!obj) return false;
  for (var k in obj) {
    if (obj.hasOwnProperty(k)) return true;
  }
  return false;
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
  var emails = ParseAdminEmails_(newEmail);
  // メールリストが空でない場合は、現在のユーザーが含まれているか確認する
  // （誤って誰も管理者画面に入れなくなることを防ぐ）
  if (emails.length > 0) {
    var currentUserEmail = NormalizeEmail_(Session.getActiveUser().getEmail() || "");
    if (!currentUserEmail) {
      var errMissing = new Error(
        "現在のアカウント（不明）が管理者リストに含まれていないため保存できません。" +
        "自分自身をロックアウトしないよう、現在のメールアドレスまたは所属グループをリストに含めてください。"
      );
      errMissing.reason = "missing_current_user_email";
      throw errMissing;
    }
    // 共通メンバーシップ解決フロー（直接一致 → ライブ解決 → キャッシュフォールバック）
    var result = Admin_ResolveMembership_(currentUserEmail, emails);
    if (!result.isMember) {
      var errNotMember = new Error(
        "現在のアカウント（" + currentUserEmail + "）が管理者リストに含まれていないため保存できません。" +
        "自分自身をロックアウトしないよう、現在のメールアドレスまたは所属グループをリストに含めてください。"
      );
      errNotMember.reason = result.reason;
      if (nfbHasOwnKeys_(result.groupErrors)) errNotMember.groupErrors = result.groupErrors;
      throw errNotMember;
    }
    // 直接一致ケース: props保存後にキャッシュを再構築（旧挙動を維持）
    if (result.reason === "direct_match") {
      var propsDirect = GetAdminProps_();
      var normalizedDirect = emails.join(";");
      propsDirect.setProperty(NFB_ADMIN_EMAIL, normalizedDirect);
      try { RefreshGroupMemberCache_(); } catch (e) { /* 非致命的 */ }
      return { ok: true, adminEmail: normalizedDirect };
    }
    // group_match / cached_group_match: ライブ解決で取得したメンバー一覧でキャッシュを更新
    // （旧実装では foundInGroup 成立時に常に SaveResolvedGroupCache_ を呼んでいたため挙動を維持）
    SaveResolvedGroupCache_(result.resolvedGroups);
  }
  var props = GetAdminProps_();
  var normalized = emails.join(";");
  props.setProperty(NFB_ADMIN_EMAIL, normalized);
  return { ok: true, adminEmail: normalized };
}

/**
 * Google Groupのメンバーシップを確認する
 * グループでないメール、権限不足などの場合はfalseを返す
 * @param {string} userEmail - 確認対象のユーザーメール（正規化済み）
 * @param {string} groupEmail - グループメール（正規化済み）
 * @return {boolean}
 */
function IsUserInAdminGroup_(userEmail, groupEmail) {
  try {
    var group = GroupsApp.getGroupByEmail(groupEmail);
    return group.hasUser(userEmail);
  } catch (e) {
    return false;
  }
}

/**
 * Google Groupのメンバーを全員取得する
 * 成功時は { members: [...] }、失敗時は { error: '...' } を返す
 * @param {string} groupEmail - グループメール（正規化済み）
 * @return {{members?: string[], error?: string}}
 */
function ResolveGroupMembers_(groupEmail) {
  try {
    var group = GroupsApp.getGroupByEmail(groupEmail);
    var users = group.getUsers();
    var members = [];
    for (var i = 0; i < users.length; i++) {
      var email = NormalizeEmail_(users[i].getEmail());
      if (email) members.push(email);
    }
    return { members: members };
  } catch (e) {
    return { error: (e && e.message) ? e.message : String(e) };
  }
}

/**
 * 全管理者メールに対してグループメンバーを解決する
 * @param {string[]} emails - 正規化済み管理者メール配列
 * @return {{resolved: Object, errors: Object}} 成功したグループのメンバー一覧と、失敗したグループの例外メッセージ
 */
function ResolveAllGroupMembers_(emails) {
  var resolved = {};
  var errors = {};
  for (var i = 0; i < emails.length; i++) {
    var result = ResolveGroupMembers_(emails[i]);
    if (result && result.members) {
      resolved[emails[i]] = result.members;
    } else if (result && result.error) {
      errors[emails[i]] = result.error;
    }
  }
  return { resolved: resolved, errors: errors };
}

/**
 * 解決済みグループメンバーをキャッシュに保存する
 * @param {Object} resolvedGroups - グループメール→メンバー配列のマップ
 */
function SaveResolvedGroupCache_(resolvedGroups) {
  var props = GetAdminProps_();
  var hasAny = false;
  for (var k in resolvedGroups) {
    if (resolvedGroups.hasOwnProperty(k)) { hasAny = true; break; }
  }
  if (!hasAny) {
    props.deleteProperty(NFB_GROUP_MEMBER_CACHE);
    return;
  }
  var json = JSON.stringify({ updatedAt: Date.now(), groups: resolvedGroups });
  if (json.length > 9000) {
    props.deleteProperty(NFB_GROUP_MEMBER_CACHE);
    return;
  }
  props.setProperty(NFB_GROUP_MEMBER_CACHE, json);
}

/**
 * 解決済みグループマップ内にユーザーが含まれるか確認する
 * @param {string} userEmail - 正規化済みユーザーメール
 * @param {Object} resolvedGroups - グループメール→メンバー配列のマップ
 * @return {boolean}
 */
function IsUserInResolvedGroups_(userEmail, resolvedGroups) {
  for (var groupEmail in resolvedGroups) {
    if (!resolvedGroups.hasOwnProperty(groupEmail)) continue;
    var members = resolvedGroups[groupEmail];
    for (var j = 0; j < members.length; j++) {
      if (members[j] === userEmail) return true;
    }
  }
  return false;
}

/**
 * 管理者グループのメンバーをScript Propertiesにキャッシュする
 * 管理者権限で呼び出すことでGroupsApp照合が可能
 * @return {Object}
 */
function RefreshGroupMemberCache_() {
  var adminEmails = ParseAdminEmails_(GetAdminEmail_());
  var cache = {};
  var hasAnyGroup = false;
  for (var i = 0; i < adminEmails.length; i++) {
    var result = ResolveGroupMembers_(adminEmails[i]);
    if (result && result.members) {
      cache[adminEmails[i]] = result.members;
      hasAnyGroup = true;
    }
  }
  var props = GetAdminProps_();
  props.setProperty(NFB_GROUP_CACHE_LAST_ATTEMPT_AT, String(Date.now()));
  if (hasAnyGroup) {
    var json = JSON.stringify({ updatedAt: Date.now(), groups: cache });
    if (json.length > 9000) {
      props.deleteProperty(NFB_GROUP_MEMBER_CACHE);
      return { ok: true, cached: false, reason: "too_large" };
    }
    props.setProperty(NFB_GROUP_MEMBER_CACHE, json);
  } else {
    props.deleteProperty(NFB_GROUP_MEMBER_CACHE);
  }
  return { ok: true, cached: hasAnyGroup, updatedAt: hasAnyGroup ? Date.now() : null };
}

/**
 * キャッシュされたグループメンバー情報を取得する
 * @return {Object|null}
 */
function GetGroupMemberCache_() {
  try {
    var props = GetAdminProps_();
    var raw = props.getProperty(NFB_GROUP_MEMBER_CACHE);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

/**
 * キャッシュが古い/空であれば裏で再構築する
 * - ロックが取れない（他プロセスが更新中）場合は何もしない
 * - 直近試行から NFB_GROUP_CACHE_RETRY_INTERVAL_MS 以内は連続実行を避ける
 */
function MaybeRefreshGroupCacheIfStale_() {
  try {
    var props = GetAdminProps_();
    var adminEmailsRaw = props.getProperty(NFB_ADMIN_EMAIL) || "";
    if (!adminEmailsRaw) return;
    var cache = GetGroupMemberCache_();
    var now = Date.now();
    var stale = !cache || !cache.updatedAt || (now - cache.updatedAt) > NFB_GROUP_CACHE_TTL_MS;
    if (!stale) return;
    var lastAttemptRaw = props.getProperty(NFB_GROUP_CACHE_LAST_ATTEMPT_AT);
    var lastAttempt = lastAttemptRaw ? Number(lastAttemptRaw) : 0;
    if (lastAttempt && (now - lastAttempt) < NFB_GROUP_CACHE_RETRY_INTERVAL_MS) return;
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(0)) return;
    try { RefreshGroupMemberCache_(); } finally { lock.releaseLock(); }
  } catch (e) { /* 非致命的 */ }
}

/**
 * キャッシュからグループメンバーシップを確認する
 * @param {string} userEmail - 正規化済みユーザーメール
 * @param {string} groupEmail - 正規化済みグループメール
 * @return {boolean}
 */
function IsUserInCachedGroup_(userEmail, groupEmail) {
  var cache = GetGroupMemberCache_();
  if (!cache || !cache.groups || !cache.groups[groupEmail]) return false;
  var members = cache.groups[groupEmail];
  if (!Array.isArray(members)) return false;
  for (var i = 0; i < members.length; i++) {
    if (members[i] === userEmail) return true;
  }
  return false;
}

/**
 * 管理者メンバーシップ解決の共通フロー（軽量版）
 * リクエスト毎のauth gate用。GroupsApp.hasUser()による個別判定のみを使用するため
 * メンバー一覧を取得しない（キャッシュ保存・UI通知不要のケース向け）。
 * 1st pass: 完全一致（APIコール不要、高速）
 * 2nd pass: ライブGroupsApp.hasUser()照合
 * 3rd pass: キャッシュフォールバック
 * @param {string} normalizedUserEmail - 正規化済みユーザーメール
 * @param {string[]} adminEmails - 正規化済み管理者メール配列
 * @return {boolean}
 */
function Admin_CheckMembershipLite_(normalizedUserEmail, adminEmails) {
  for (var i = 0; i < adminEmails.length; i++) {
    if (adminEmails[i] === normalizedUserEmail) return true;
  }
  for (var j = 0; j < adminEmails.length; j++) {
    if (IsUserInAdminGroup_(normalizedUserEmail, adminEmails[j])) return true;
  }
  for (var k = 0; k < adminEmails.length; k++) {
    if (IsUserInCachedGroup_(normalizedUserEmail, adminEmails[k])) return true;
  }
  return false;
}

/**
 * 管理者メンバーシップ解決の共通フロー（解決版）
 * 保存時セルフロックアウト防止・UI事前チェック用。
 * ライブ解決時はgetUsers()でメンバー一覧を取得し、呼び出し側がキャッシュ保存や
 * groupErrorsによるエラーメッセージを組み立てられるように返す。
 * 1st pass: 完全一致
 * 2nd pass: ResolveAllGroupMembers_ + IsUserInResolvedGroups_
 * 3rd pass: キャッシュフォールバック
 *
 * 呼び出し側の前提:
 * - adminEmails.length === 0 と !normalizedUserEmail は事前に処理済み
 *
 * @param {string} normalizedUserEmail - 正規化済みユーザーメール
 * @param {string[]} adminEmails - 正規化済み管理者メール配列
 * @return {{isMember: boolean, reason: string, resolvedGroups: Object, groupErrors: Object}}
 *   reason: "direct_match" | "group_match" | "cached_group_match" | "group_fetch_failed" | "not_member"
 *   resolvedGroups/groupErrorsはライブ解決パスに到達しない場合は {}
 */
function Admin_ResolveMembership_(normalizedUserEmail, adminEmails) {
  // 1st pass: 完全一致（APIコール不要、高速）
  for (var i = 0; i < adminEmails.length; i++) {
    if (adminEmails[i] === normalizedUserEmail) {
      return { isMember: true, reason: "direct_match", resolvedGroups: {}, groupErrors: {} };
    }
  }
  // 2nd pass: ライブ解決（メンバー一覧取得 → キャッシュ保存にも使える）
  var resolveResult = ResolveAllGroupMembers_(adminEmails);
  var resolvedGroups = resolveResult.resolved;
  var groupErrors = resolveResult.errors;
  if (IsUserInResolvedGroups_(normalizedUserEmail, resolvedGroups)) {
    return { isMember: true, reason: "group_match", resolvedGroups: resolvedGroups, groupErrors: groupErrors };
  }
  // 3rd pass: キャッシュフォールバック
  for (var j = 0; j < adminEmails.length; j++) {
    if (IsUserInCachedGroup_(normalizedUserEmail, adminEmails[j])) {
      return { isMember: true, reason: "cached_group_match", resolvedGroups: resolvedGroups, groupErrors: groupErrors };
    }
  }
  // 不一致: groupErrorsの有無でreasonを分岐
  var reason = nfbHasOwnKeys_(groupErrors) ? "group_fetch_failed" : "not_member";
  return { isMember: false, reason: reason, resolvedGroups: resolvedGroups, groupErrors: groupErrors };
}

/**
 * 管理者メールリストに対して、個人メール一致またはグループメンバーシップで判定する
 * @param {string} normalizedUserEmail - 正規化済みユーザーメール
 * @param {string[]} adminEmails - 正規化済み管理者メール配列
 * @return {boolean}
 */
function IsAdminEmailOrGroupMatched_(normalizedUserEmail, adminEmails) {
  return Admin_CheckMembershipLite_(normalizedUserEmail, adminEmails);
}

/**
 * 管理者メール制限に一致しているか判定する
 * 個人メール一致に加え、Google Groupメンバーシップも確認する
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
  MaybeRefreshGroupCacheIfStale_();
  return IsAdminEmailOrGroupMatched_(normalizedUserEmail, adminEmails);
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

