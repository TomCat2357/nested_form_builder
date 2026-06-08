/**
 * フォーム文脈ごとの pid（親レコード ID）レジストリ。
 *
 * 既定では pid は GAS 注入の `window.__PID__` グローバル（1 タブ＝1 フォーム＝1 pid）から
 * 引く。しかし子フォームを同一 SPA のオーバーレイで開く場合、「親フォームと子フォームが
 * 同時にマウントされ、それぞれ別の pid 文脈でデータ層（gasClient）を叩く」ため、グローバル
 * 1 個では混線する（親の裏更新に子の pid が紛れ込む等）。
 *
 * このモジュールは `formId → pid` の明示マップを保持し、gasClient の withUrlPid が
 * `payload.formId` をキーに pid を解決できるようにする。登録が無い formId は従来どおり
 * URL グローバルへフォールバックするため、既存の新規タブ子フォームは無改修で動く。
 *
 * 注意: これはモジュールレベルの可変状態だが、キーが formId なので「どのフォームへの
 * 呼び出しか」で一意に解決でき、親子が同時にマウントされていても混線しない。
 */

const formPidMap = new Map();

const normalizeId = (value) => String(value === undefined || value === null ? "" : value).trim();

/**
 * formId に pid を登録する（オーバーレイ表示中のみ）。pid が空なら登録解除と同義。
 */
export const registerFormPid = (formId, pid) => {
  const id = normalizeId(formId);
  if (!id) return;
  const value = normalizeId(pid);
  if (value) formPidMap.set(id, value);
  else formPidMap.delete(id);
};

/**
 * formId の登録を解除する。
 */
export const unregisterFormPid = (formId) => {
  const id = normalizeId(formId);
  if (id) formPidMap.delete(id);
};

/**
 * formId に登録された pid を返す。未登録なら "".
 */
export const getRegisteredFormPid = (formId) => {
  const id = normalizeId(formId);
  if (!id) return "";
  return formPidMap.get(id) || "";
};
