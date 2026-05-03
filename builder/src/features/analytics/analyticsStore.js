/**
 * Analytics ストア
 * スナップショット取得・AlaSQL ロード・Question/Dashboard CRUD を一元管理
 */

import { analyticsGasClient } from "./analyticsGasClient.js";
import {
  saveSnapshotToCache, getSnapshotFromCache, getSnapshotMeta,
  updateSnapshotMetaCheckedAt, shouldSkipVersionCheck,
  saveQuestionsToCache, getQuestionsFromCache, upsertQuestionInCache, deleteQuestionFromCache,
  saveDashboardsToCache, getDashboardsFromCache, upsertDashboardInCache, deleteDashboardFromCache,
} from "./analyticsCache.js";
import { registerSnapshotAsTable, dropTables, runAlaSql } from "./analyticsAlaSql.js";
import { headerKeyToAlaSqlKey } from "./utils/headerToAlaSqlKey.js";

// ---- Snapshot ----

/**
 * フォームのスナップショットを取得する（キャッシュ優先）。
 */
export async function getSnapshot({ formId, spreadsheetId, sheetName }) {
  const meta = await getSnapshotMeta(formId);

  if (shouldSkipVersionCheck(meta)) {
    const cached = await getSnapshotFromCache(formId);
    if (cached) return cached;
  }

  let versionResult;
  try {
    versionResult = await analyticsGasClient.checkSnapshotVersion({ formId, spreadsheetId, sheetName });
  } catch (_err) {
    const cached = await getSnapshotFromCache(formId);
    if (cached) return cached;
    throw _err;
  }

  if (meta && meta.snapshotVersion === versionResult.snapshotVersion) {
    await updateSnapshotMetaCheckedAt(formId);
    const cached = await getSnapshotFromCache(formId);
    if (cached) return cached;
  }

  const snapshot = await analyticsGasClient.getSnapshot({ formId, spreadsheetId, sheetName });
  await saveSnapshotToCache(snapshot);
  return snapshot;
}

/**
 * 複数フォームのスナップショットを AlaSQL テーブルとして登録する。
 */
export async function loadSnapshotsIntoAlaSql(formSources) {
  const aliases = [];
  for (const src of formSources) {
    const snapshot = await getSnapshot({
      formId: src.formId,
      spreadsheetId: src.spreadsheetId,
      sheetName: src.sheetName,
    });
    const alias = src.alias || "form_" + src.formId.replace(/[^A-Za-z0-9_]/g, "_");
    await registerSnapshotAsTable(alias, snapshot);
    aliases.push(alias);
  }
  return aliases;
}

/**
 * Question を実行してデータを返す。
 */
export async function executeQuestion(question) {
  if (!question || !question.query) {
    return { ok: false, error: "クエリが定義されていません" };
  }

  const formSources = question.query.formSources || [];
  if (formSources.length === 0) {
    return { ok: false, error: "データソースが指定されていません" };
  }

  let aliases = [];
  try {
    aliases = await loadSnapshotsIntoAlaSql(formSources);
  } catch (err) {
    return { ok: false, error: "データ取得に失敗しました: " + (err.message || String(err)) };
  }

  try {
    const sql = question.query.sql;
    if (!sql || !sql.trim()) {
      return { ok: false, error: "SQL が入力されていません" };
    }
    const result = await runAlaSql(sql);
    if (!result.ok) return result;

    const columns = result.rows.length > 0 ? Object.keys(result.rows[0]) : [];
    return { ok: true, rows: result.rows, columns };
  } finally {
    await dropTables(aliases);
  }
}

/**
 * スナップショットのカラム一覧を返す（フィールド選択 UI 用）
 */
export async function getSnapshotColumns({ formId, spreadsheetId, sheetName }) {
  const snapshot = await getSnapshot({ formId, spreadsheetId, sheetName });
  return (snapshot.columns || []).map((col) => ({
    key: col.key,
    alaSqlKey: headerKeyToAlaSqlKey(col.key),
    path: col.path,
    label: col.path[col.path.length - 1] || col.key,
  }));
}

// ---- Questions ----

export async function listQuestions({ forceRefresh = false } = {}) {
  if (!forceRefresh) {
    const cached = await getQuestionsFromCache();
    if (cached.length > 0) return cached;
  }
  const result = await analyticsGasClient.listQuestions();
  await saveQuestionsToCache(result.questions || []);
  return result.questions || [];
}

export async function saveQuestion(question) {
  const result = await analyticsGasClient.saveQuestion(question);
  await upsertQuestionInCache(result.question);
  return result.question;
}

export async function deleteQuestion(questionId) {
  await analyticsGasClient.deleteQuestion(questionId);
  await deleteQuestionFromCache(questionId);
}

// ---- Dashboards ----

export async function listDashboards({ forceRefresh = false } = {}) {
  if (!forceRefresh) {
    const cached = await getDashboardsFromCache();
    if (cached.length > 0) return cached;
  }
  const result = await analyticsGasClient.listDashboards();
  await saveDashboardsToCache(result.dashboards || []);
  return result.dashboards || [];
}

export async function saveDashboard(dashboard) {
  const result = await analyticsGasClient.saveDashboard(dashboard);
  await upsertDashboardInCache(result.dashboard);
  return result.dashboard;
}

export async function deleteDashboard(dashboardId) {
  await analyticsGasClient.deleteDashboard(dashboardId);
  await deleteDashboardFromCache(dashboardId);
}
