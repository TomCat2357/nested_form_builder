// ========================================
// 管理者認証(グループメンバーキャッシュ) — Google Group メンバー一覧の
// Script Properties キャッシュ保存・再構築・鮮度管理。
// adminAuth.gs から分離。バンドル時に連結されるため関数はグローバル。
// ========================================

/**
 * 解決済みグループメンバーをキャッシュに保存する
 * @param {Object} resolvedGroups - グループメール→メンバー配列のマップ
 */
function SaveResolvedGroupCache_(resolvedGroups) {
  var props = Nfb_getScriptProperties_();
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
  var props = Nfb_getScriptProperties_();
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
    var props = Nfb_getScriptProperties_();
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
    var props = Nfb_getScriptProperties_();
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
