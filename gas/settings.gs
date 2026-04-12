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
  var emails = ParseAdminEmails_(newEmail);
  // メールリストが空でない場合は、現在のユーザーが含まれているか確認する
  // （誤って誰も管理者画面に入れなくなることを防ぐ）
  if (emails.length > 0) {
    var currentUserEmail = NormalizeEmail_(Session.getActiveUser().getEmail() || "");
    if (!currentUserEmail) {
      throw new Error(
        "現在のアカウント（不明）が管理者リストに含まれていないため保存できません。" +
        "自分自身をロックアウトしないよう、現在のメールアドレスまたは所属グループをリストに含めてください。"
      );
    }
    // 直接一致を試す
    var directMatch = false;
    for (var i = 0; i < emails.length; i++) {
      if (emails[i] === currentUserEmail) { directMatch = true; break; }
    }
    if (directMatch) {
      // 直接一致 → 保存してからキャッシュ更新
      var props = GetAdminProps_();
      var normalized = emails.join(";");
      props.setProperty(NFB_ADMIN_EMAIL, normalized);
      try { RefreshGroupMemberCache_(); } catch (e) { /* 非致命的 */ }
      return { ok: true, adminEmail: normalized };
    }
    // グループメンバーを解決して所属判定（キャッシュも同時構築）
    var resolved = ResolveAllGroupMembers_(emails);
    var foundInGroup = IsUserInResolvedGroups_(currentUserEmail, resolved);
    // ライブ解決でもダメならキャッシュフォールバック
    if (!foundInGroup) {
      for (var i = 0; i < emails.length; i++) {
        if (IsUserInCachedGroup_(currentUserEmail, emails[i])) { foundInGroup = true; break; }
      }
    }
    if (!foundInGroup) {
      throw new Error(
        "現在のアカウント（" + currentUserEmail + "）が管理者リストに含まれていないため保存できません。" +
        "自分自身をロックアウトしないよう、現在のメールアドレスまたは所属グループをリストに含めてください。"
      );
    }
    // 解決済みグループをキャッシュに保存
    SaveResolvedGroupCache_(resolved);
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
 * グループでないメール、権限不足などの場合はnullを返す
 * @param {string} groupEmail - グループメール（正規化済み）
 * @return {string[]|null}
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
    return members;
  } catch (e) {
    return null;
  }
}

/**
 * 全管理者メールに対してグループメンバーを解決する
 * @param {string[]} emails - 正規化済み管理者メール配列
 * @return {Object} グループメール→メンバー配列のマップ（グループでないメールは含まない）
 */
function ResolveAllGroupMembers_(emails) {
  var resolved = {};
  for (var i = 0; i < emails.length; i++) {
    var members = ResolveGroupMembers_(emails[i]);
    if (members !== null) {
      resolved[emails[i]] = members;
    }
  }
  return resolved;
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
    var members = ResolveGroupMembers_(adminEmails[i]);
    if (members !== null) {
      cache[adminEmails[i]] = members;
      hasAnyGroup = true;
    }
  }
  var props = GetAdminProps_();
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
 * 管理者メールリストに対して、個人メール一致またはグループメンバーシップで判定する
 * 1st pass: 完全一致（APIコール不要、高速）
 * 2nd pass: グループメンバーシップ照合（APIコールあり）
 * @param {string} normalizedUserEmail - 正規化済みユーザーメール
 * @param {string[]} adminEmails - 正規化済み管理者メール配列
 * @return {boolean}
 */
function IsAdminEmailOrGroupMatched_(normalizedUserEmail, adminEmails) {
  // 1st pass: 完全一致（APIコール不要、高速）
  for (var i = 0; i < adminEmails.length; i++) {
    if (adminEmails[i] === normalizedUserEmail) return true;
  }
  // 2nd pass: ライブGroupsApp照合（アクセスユーザーの権限で実行）
  for (var i = 0; i < adminEmails.length; i++) {
    if (IsUserInAdminGroup_(normalizedUserEmail, adminEmails[i])) return true;
  }
  // 3rd pass: キャッシュフォールバック（管理者が保存時に解決したメンバーリスト）
  for (var i = 0; i < adminEmails.length; i++) {
    if (IsUserInCachedGroup_(normalizedUserEmail, adminEmails[i])) return true;
  }
  return false;
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
    if (adminEmails.length === 0) return { ok: true, isMember: true };
    if (!userEmail) return { ok: true, isMember: false };
    // 直接一致
    for (var i = 0; i < adminEmails.length; i++) {
      if (adminEmails[i] === userEmail) return { ok: true, isMember: true };
    }
    // グループメンバー解決チェック（getUsers で全メンバー取得）
    var resolved = ResolveAllGroupMembers_(adminEmails);
    if (IsUserInResolvedGroups_(userEmail, resolved)) return { ok: true, isMember: true };
    // キャッシュフォールバック
    for (var i = 0; i < adminEmails.length; i++) {
      if (IsUserInCachedGroup_(userEmail, adminEmails[i])) return { ok: true, isMember: true };
    }
    return { ok: true, isMember: false };
  });
}

/**
 * グループメンバーキャッシュを手動更新するAPI（管理者専用）
 * @return {Object}
 */
function nfbRefreshGroupCache() {
  return nfbSafeCall_(function() {
    return RefreshGroupMemberCache_();
  });
}

/**
 * グループメンバーキャッシュのステータスを取得するAPI（管理者専用）
 * @return {Object}
 */
function nfbGetGroupCacheStatus() {
  return nfbSafeCall_(function() {
    var cache = GetGroupMemberCache_();
    var groupNames = [];
    if (cache && cache.groups) {
      for (var key in cache.groups) {
        if (cache.groups.hasOwnProperty(key)) groupNames.push(key);
      }
    }
    return {
      ok: true,
      hasCachedGroups: groupNames.length > 0,
      groupEmails: groupNames,
      updatedAt: cache ? cache.updatedAt : null
    };
  });
}

