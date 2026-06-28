/**
 * 外部アクション送信時に呼ぶ、子フォームデータ / 保存先メタの on-demand リゾルバ群。
 *
 * useSearchPageState の useCallback 本体から切り出した、React に依存しない async 関数。
 * 呼び出し側（フック）が依存値を束ねて渡し、useCallback でメモ化する。挙動は元の実装と同一。
 */

import { hasScriptRun, listRecordsByPids } from "../../services/gasClient.js";
import { buildChildFormUrl } from "../../utils/formShareUrl.js";
import { childFormSpreadsheetId, childFormSheetName } from "../../utils/spreadsheet.js";
import { buildChildDataObject, distributeChildRecordsByPid, getChildFormCached_ } from "../preview/childFormData.js";

const getBaseUrl = () =>
  (typeof window !== "undefined" && window.__GAS_WEBAPP_URL__) ? window.__GAS_WEBAPP_URL__ : "";

// 外部アクション送信時に呼ぶ on-demand リゾルバ。対象行ぶんの子データを子フォームごとに
// 1 回の listRecordsByPids でバッチ取得し、entries と同順で「各行 = { fieldId: 子フォーム合成
// オブジェクト }」を返す。これを buildRecordFromEntry が childDataByFieldId として読み、formLink
// 項目を items にインライン展開する（編集画面と同形）。表示用に既に eager 取得済み
// （searchChildDataByField）の子フォームはそれを再利用する。
// 子 SS / シート名は機微情報なので、ここでは載せず storage（admin ゲート・resolveSearchChildStorageMeta）
// 経由でのみ渡す（子データ本体 items には SS を含めない＝漏洩経路を持たない）。
export const resolveSearchChildFormsForRows = async (entries, {
  externalActionChildFormFields,
  searchChildDataByField,
}) => {
  const rows = Array.isArray(entries) ? entries.filter(Boolean) : [];
  if (rows.length === 0 || externalActionChildFormFields.length === 0) return null;
  const pids = Array.from(new Set(rows.map((e) => String(e && e.id != null ? e.id : "")).filter(Boolean)));
  if (pids.length === 0) return null;
  const baseUrl = getBaseUrl();
  const canFetch = typeof listRecordsByPids === "function" && hasScriptRun();
  // fieldId → { [pid]: 合成オブジェクト }
  const byField = {};
  for (const field of externalActionChildFormFields) {
    // 表示用に eager 取得済みなら再利用（同じ子フォーム・同じ pid 集合を満たす範囲で）。
    const cached = searchChildDataByField[field.id];
    if (cached && cached.byPid && pids.every((pid) => cached.byPid[pid] !== undefined)) {
      byField[field.id] = cached.byPid;
      continue;
    }
    if (!canFetch) continue;
    try {
      const [childForm, records] = await Promise.all([
        getChildFormCached_(field.childFormId),
        listRecordsByPids({ formId: field.childFormId, pids }),
      ]);
      const childSchema = childForm && childForm.schema ? childForm.schema : [];
      const grouped = distributeChildRecordsByPid(records);
      const byPid = {};
      grouped.forEach((recs, pid) => {
        byPid[pid] = buildChildDataObject({
          childFormId: field.childFormId,
          childFormName: field.childFormName,
          childFormUrl: buildChildFormUrl(baseUrl, field.childFormId, pid),
          childSchema,
          records: recs,
        });
      });
      byField[field.id] = byPid;
    } catch (_e) {
      // 取得失敗時はその子フォームを欠落させる（無言）。
    }
  }
  return rows.map((entry) => {
    const key = String(entry && entry.id != null ? entry.id : "");
    const byFieldId = {};
    for (const field of externalActionChildFormFields) {
      const byPid = byField[field.id];
      const obj = byPid ? byPid[key] : null;
      if (obj) byFieldId[field.id] = obj;
    }
    return byFieldId;
  });
};

// 外部アクション（検索リレー）の storage.childSpreadsheetId 用に、子フォームの保存先
// スプレッドシート ID / シート名を formLink 子フォーム定義から直接解決する。
// 「最初の非空 ID を採る」方針（単票パス PreviewPage.jsx と同じ）。
export const resolveSearchChildStorageMeta = async ({ externalActionChildFormFields }) => {
  for (const field of externalActionChildFormFields) {
    try {
      const cf = await getChildFormCached_(field.childFormId);
      const sid = childFormSpreadsheetId(cf);
      if (sid) {
        return { childSpreadsheetId: sid, childSheetName: childFormSheetName(cf) };
      }
    } catch (_e) { /* 取得失敗の子フォームはスキップ（無言） */ }
  }
  return { childSpreadsheetId: "", childSheetName: "" };
};
