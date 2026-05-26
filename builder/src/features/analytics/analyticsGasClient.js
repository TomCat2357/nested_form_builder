/**
 * GAS API クライアント（analytics 系）
 *
 * Question / Dashboard は GAS 関数名（nfb<Verb>Analytics<Entity>[s]）もエラーメッセージも
 * 完全に機械的なので、エンティティ名 1 つから CRUD メソッド一式をファクトリで生成する。
 *
 * 低レベルの google.script.run 呼び出しは services/gasClient.js の callScriptRun を共有
 * （hasScriptRun チェック・エラー正規化・関数名検証付き）。analytics 固有の差は
 * 「エラーメッセージに動詞コンテキストを prefix する」点のみで、その薄いラッパだけここに残す。
 */

import { callScriptRun } from "../../services/gasClient.js";

async function fetchAnalyticsApi_(functionName, payload, errorMessage) {
  let result;
  try {
    result = await callScriptRun(functionName, payload);
  } catch (err) {
    const msg = err?.message || String(err);
    throw new Error(errorMessage + ": " + msg);
  }
  if (!result || !result.ok) {
    throw new Error(result?.error || errorMessage);
  }
  return result;
}

/**
 * "Question" / "Dashboard" から CRUD メソッド群を生成する。
 * メソッド名・GAS 関数名・エラーメッセージはすべて entity から導出。
 */
function makeEntityClient(entity) {
  // GAS 関数名は nfb<Verb>Analytics<Entity>[s]、payloadKey は saveX の引数オブジェクトのキー。
  const E = entity;            // "Question"
  const payloadKey = entity.charAt(0).toLowerCase() + entity.slice(1); // "question"
  const call = (verb, payload, errSuffix) =>
    fetchAnalyticsApi_(`nfb${verb}Analytics${E}`, payload, `${E} ${errSuffix}`);
  const callPlural = (verb, payload, errSuffix) =>
    fetchAnalyticsApi_(`nfb${verb}Analytics${E}s`, payload, `${E} ${errSuffix}`);

  return {
    [`list${E}s`]: (options = {}) => callPlural("List", options, "一覧取得に失敗しました"),
    [`get${E}`]: (id) => call("Get", id, "取得に失敗しました"),
    [`save${E}`]: (data, targetUrl = null) => call("Save", { [payloadKey]: data, targetUrl }, "保存に失敗しました"),
    [`delete${E}`]: (id) => call("Delete", id, "削除に失敗しました"),
    [`delete${E}s`]: (ids) => callPlural("Delete", ids, "削除に失敗しました"),
    [`archive${E}`]: (id) => call("Archive", id, "アーカイブに失敗しました"),
    [`unarchive${E}`]: (id) => call("Unarchive", id, "アーカイブ解除に失敗しました"),
    [`archive${E}s`]: (ids) => callPlural("Archive", ids, "アーカイブに失敗しました"),
    [`unarchive${E}s`]: (ids) => callPlural("Unarchive", ids, "アーカイブ解除に失敗しました"),
    [`copy${E}`]: (id) => call("Copy", id, "コピーに失敗しました"),
    [`import${E}sFromDrive`]: (url) => fetchAnalyticsApi_(`nfbImportAnalytics${E}sFromDrive`, url, `${E} インポートに失敗しました`),
    [`registerImported${E}`]: (payload) => fetchAnalyticsApi_(`nfbRegisterImportedAnalytics${E}`, payload, `${E} 登録に失敗しました`),
    // フォルダ操作
    [`list${E}Folders`]: () => fetchAnalyticsApi_(`nfbListAnalytics${E}Folders`, undefined, `${E} フォルダ一覧取得に失敗しました`),
    [`create${E}Folder`]: (path) => fetchAnalyticsApi_(`nfbCreateAnalytics${E}Folder`, path, `${E} フォルダ作成に失敗しました`),
    [`move${E}s`]: (payload) => fetchAnalyticsApi_(`nfbMoveAnalytics${E}s`, payload, `${E} 移動に失敗しました`),
    [`rename${E}Folder`]: (payload) => fetchAnalyticsApi_(`nfbRenameAnalytics${E}Folder`, payload, `${E} フォルダ名変更に失敗しました`),
    [`delete${E}Folder`]: (path) => fetchAnalyticsApi_(`nfbDeleteAnalytics${E}Folder`, path, `${E} フォルダ削除に失敗しました`),
  };
}

export const analyticsGasClient = {
  ...makeEntityClient("Question"),
  ...makeEntityClient("Dashboard"),
};
