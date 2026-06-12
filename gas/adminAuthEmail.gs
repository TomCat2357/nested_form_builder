// ========================================
// 管理者認証(メール/グループ解決/判定) — 管理者メールの取得/設定、
// Google Group メンバーシップのライブ解決、管理者アクセス判定。
// adminAuth.gs から分離。バンドル時に連結されるため関数はグローバル。
// グループメンバーの永続キャッシュは adminAuthGroupCache.gs を参照。
// ========================================

/**
 * メールアドレスを比較用に正規化する
 * @param {string} value
 * @return {string}
 */
function NormalizeEmail_(value) {
  return String(value || "").trim().toLowerCase();
}

// nfbHasOwnKeys_ は standardFoldersAlignRefs.gs に定義（バンドル連結でグローバル）。

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
  var props = Nfb_getScriptProperties_();
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
      var propsDirect = Nfb_getScriptProperties_();
      var normalizedDirect = emails.join(";");
      propsDirect.setProperty(NFB_ADMIN_EMAIL, normalizedDirect);
      try { RefreshGroupMemberCache_(); } catch (e) { /* 非致命的 */ }
      return { ok: true, adminEmail: normalizedDirect };
    }
    // group_match / cached_group_match: ライブ解決で取得したメンバー一覧でキャッシュを更新
    // （旧実装では foundInGroup 成立時に常に SaveResolvedGroupCache_ を呼んでいたため挙動を維持）
    SaveResolvedGroupCache_(result.resolvedGroups);
  }
  var props = Nfb_getScriptProperties_();
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
  return Admin_CheckMembershipLite_(normalizedUserEmail, adminEmails);
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
