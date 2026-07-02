/**
 * Analytics ストア（集約ファサード）
 *
 * - クエリ実行基盤（AlaSQL ロード・SQL/GUI Question・検索 SQL・full-query）
 *   → queryEngine.js
 * - Question / Dashboard / CrossSearch の CRUD ファクトリ → entityStore.js
 * 本ファイルはストアの生成・公開 API の再 export・resolveDashboardLinks のみを持つ。
 * 既存の import 先（`from "./analyticsStore.js"`）はすべてここ経由で不変。
 */

import { analyticsGasClient } from "./analyticsGasClient.js";
import { questionCache, dashboardCache } from "./analyticsCache.js";
import { isV2 as isDashboardV2, assertV2 as assertDashboardV2, getCardType, CARD_TYPE_QUESTION } from "./utils/dashboardSchema.js";
import { makeEntityStore } from "./entityStore.js";
import { getFormColumns, getFormViewColumns } from "./analyticsSchemaColumns.js";

export { getFormColumns, getFormViewColumns };
export { makeEntityStore };
export {
  ERR_NO_SPREADSHEET,
  findFormByRef,
  loadFormsIntoAlaSql,
  executeQuestion,
  runSearchSelect,
  runFullQuery,
} from "./queryEngine.js";

function filterV2Dashboards_(items) {
  const out = [];
  let skipped = 0;
  for (const d of items) {
    if (isDashboardV2(d)) {
      out.push(d);
    } else {
      skipped += 1;
    }
  }
  if (skipped > 0) {
    console.warn("[analyticsStore] Skipped " + skipped + " legacy (non-v2) dashboards");
  }
  return out;
}

const questionStore = makeEntityStore({
  one: "question",
  many: "questions",
  cache: questionCache,
  gas: analyticsGasClient,
});

const dashboardStore = makeEntityStore({
  one: "dashboard",
  many: "dashboards",
  cache: dashboardCache,
  gas: analyticsGasClient,
  sanitizeList: filterV2Dashboards_,
  validateBeforeSave: assertDashboardV2,
});

export const listQuestions = questionStore.list;
export const listQuestionsSWR = questionStore.listSWR;
export const getQuestionById = questionStore.getById;
export const saveQuestion = questionStore.save;
export const deleteQuestions = questionStore.removeBatch;
export const deleteQuestionsWithFiles = questionStore.removeBatchWithFiles;
export const archiveQuestions = questionStore.archiveBatch;
export const unarchiveQuestions = questionStore.unarchiveBatch;
export const copyQuestion = questionStore.copy;
export const importQuestionsFromDrive = questionStore.importFromDrive;
export const registerImportedQuestion = questionStore.registerImported;
export const exportQuestions = questionStore.exportItems;
export const listQuestionFolders = questionStore.listFolders;
export const createQuestionFolder = questionStore.createFolder;
export const moveQuestions = questionStore.moveItems;
export const renameQuestionFolder = questionStore.renameFolder;
export const deleteQuestionFolder = questionStore.deleteFolder;

export const listDashboards = dashboardStore.list;
export const listDashboardsSWR = dashboardStore.listSWR;
export const saveDashboard = dashboardStore.save;
export const deleteDashboards = dashboardStore.removeBatch;
export const deleteDashboardsWithFiles = dashboardStore.removeBatchWithFiles;
export const archiveDashboards = dashboardStore.archiveBatch;
export const unarchiveDashboards = dashboardStore.unarchiveBatch;
export const copyDashboard = dashboardStore.copy;
export const importDashboardsFromDrive = dashboardStore.importFromDrive;
export const registerImportedDashboard = dashboardStore.registerImported;
export const exportDashboards = dashboardStore.exportItems;
export const listDashboardFolders = dashboardStore.listFolders;
export const createDashboardFolder = dashboardStore.createFolder;
export const moveDashboards = dashboardStore.moveItems;
export const renameDashboardFolder = dashboardStore.renameFolder;
export const deleteDashboardFolder = dashboardStore.deleteFolder;

/**
 * ダッシュボードの question カードのうち、questionId が現在の Question 一覧で解決できない
 * （= リンク切れ）ものを、標準フォルダ 02_questions から「ファイル名(name) → id」の順で
 * 探して再リンクする。解決できたカードは questionId / questionName を最新化する。
 *
 * 戻り: { dashboard, changed }。changed=true のとき、呼び出し側で保存し直すと修復が永続化される
 * （保存は管理者のみ可能。閲覧者はメモリ上の修復で描画だけ正しくなる）。
 */
export async function resolveDashboardLinks(dashboard) {
  if (!dashboard || !Array.isArray(dashboard.cards)) return { dashboard, changed: false };

  // 既知の Question を 1 度だけ取得（壊れ判定と name バックフィルに使う）。
  // アーカイブ済みも有効なリンク先なので含める。
  let known = [];
  try {
    known = await listQuestions({ includeArchived: true });
  } catch (err) {
    console.warn("[resolveDashboardLinks] listQuestions failed:", err);
  }
  const byId = new Map(known.map((q) => [q.id, q]));

  let changed = false;
  const nextCards = [];
  for (const card of dashboard.cards) {
    if (getCardType(card) !== CARD_TYPE_QUESTION) {
      nextCards.push(card);
      continue;
    }

    const existing = card.questionId ? byId.get(card.questionId) : null;
    if (existing) {
      // 解決済み。参照は questionId のみで保持するため questionName のバックフィルはしない
      // （旧 questionName は編集保存時に剥がれる）。
      nextCards.push(card);
      continue;
    }

    // リンク切れ → サーバで questionId（＝fileId）から解決を試みる。id 失敗時の復旧は
    // 中央辞書（論理パス→fileId）に集約した GAS 側（folder + 名前アンカー / remap）が担う。
    try {
      const res = await analyticsGasClient.resolveQuestionRef({
        questionId: card.questionId || "",
      });
      const q = res && res.question;
      if (q && q.id) {
        await questionCache.upsert(q);
        byId.set(q.id, q);
        const { questionName: _staleQuestionName, ...rest } = card;
        nextCards.push({ ...rest, questionId: q.id });
        changed = true;
        continue;
      }
    } catch (err) {
      console.warn("[resolveDashboardLinks] resolveQuestionRef failed:", err);
    }

    nextCards.push(card);
  }

  return { dashboard: changed ? { ...dashboard, cards: nextCards } : dashboard, changed };
}
