/**
 * Analytics ストア
 * フォーム records (memory store) → AlaSQL ロード・Question/Dashboard CRUD を一元管理
 */

import { analyticsGasClient } from "./analyticsGasClient.js";
import { questionCache, dashboardCache } from "./analyticsCache.js";
import { deepClone } from "../../core/schema.js";
import { isV2 as isDashboardV2, assertV2 as assertDashboardV2, getCardType, CARD_TYPE_QUESTION } from "./utils/dashboardSchema.js";
import { registerFormAsTable, dropTables, runAlaSql, applyGlobalWhereToTables, applySourceFilterClauses } from "./analyticsAlaSql.js";
import { buildFormIndex, formQualifiedName } from "./utils/formIdentifierResolver.js";
import { normalizeFolderPath } from "../../utils/folderTree.js";
import { buildColumnIndex } from "./utils/columnIdentifierResolver.js";
import {
  preprocessSql,
  canonicalDataAlias,
  legacyFormAlias,
} from "./utils/sqlPreprocessor.js";
import { compileStages } from "./utils/compileStages.js";
import { inferCompiledColumnsFromSql } from "./utils/sqlColumnInference.js";
import { formHasSpreadsheet } from "../../app/state/dataStoreHelpers.js";
import { evaluateCacheForAnalytics } from "../../app/state/cachePolicy.js";
import {
  buildAlaSqlTypeMap,
  getFormColumns,
  getFormViewColumns,
} from "./analyticsSchemaColumns.js";

export { getFormColumns, getFormViewColumns };

export const ERR_NO_SPREADSHEET = "選択したフォームにスプレッドシートが紐付いていません。フォーム設定で spreadsheetId を指定してください。";

// フォームの表示名（＝Drive ファイル名）。
const formTitleOf = (f) => (f && f.settings && f.settings.formTitle) || (f && f.name) || "";

// クエスチョンのフォーム参照を解決する。id（＝Drive fileId）で見つからないときは、
// 保持している formName で標準フォルダ内のフォーム名に一致するものへフォールバックする。
// （コピー/マイグレーションで fileId が変わったケースの自動再リンク。）
function findFormByRef(forms, formId, formName) {
  if (!Array.isArray(forms)) return null;
  let f = formId ? forms.find((x) => x.id === formId) : null;
  if (!f && formName) {
    const raw = String(formName);
    if (raw.indexOf("/") !== -1) {
      // フォルダ込み名 → 厳密一致。
      const key = normalizeFolderPath(raw);
      f = forms.find((x) => formQualifiedName(x) === key) || null;
    } else {
      // バレ名（旧 formName / フォルダ無し）→ 葉タイトルが一意のときのみ採用。
      const matches = forms.filter((x) => formTitleOf(x) === raw);
      f = matches.length === 1 ? matches[0] : null;
    }
  }
  return f || null;
}

// ---- AlaSQL テーブル登録 / Question 実行 ----

/**
 * 複数フォームを AlaSQL テーブルとして登録する。
 *
 * データ形式は view 形式に一本化された。1 フォーム = 1 テーブル（view 形式）を、
 * 互換用の全 alias に貼る：
 *   - canonicalDataAlias(formId) = "data_<id>"（正準）
 *   - legacyFormAlias(formId) = "form_<id>"（後方互換）
 *   - defaultFormId なら bare "data" も同じ rows を指す
 * data/view の variant 区別は廃止（クエリ層は常に view 形式の単一テーブル）。
 */
export async function loadFormsIntoAlaSql(formSources, { defaultFormId, formIndex } = {}) {
  const aliases = [];
  try {
    // 同じ formId を二重に登録しないよう dedup する。
    const seen = new Set();
    for (const src of formSources) {
      if (!src || seen.has(src.formId)) continue;
      seen.add(src.formId);
      const form = formIndex ? formIndex.byId.get(src.formId) : null;

      const canon = canonicalDataAlias(src.formId);
      const extras = [legacyFormAlias(src.formId)];
      if (src.formId === defaultFormId) extras.push("data");
      await registerFormAsTable(canon, src.formId, { form, aliasAlsoAs: extras });
      aliases.push(canon, ...extras);
    }
    return aliases;
  } catch (err) {
    if (aliases.length > 0) await dropTables(aliases);
    throw err;
  }
}

/**
 * 複数フォーム参照の SQL Question 用に、各フォーム schema 由来の typeMap を結合する。
 * 同名キーが衝突した場合は defaultFormId のものを優先する（修飾なし参照は default に解決されるため）。
 */
function mergeTypeMapsForFormSources(formSources, formIndex, defaultFormId) {
  const merged = new Map();
  if (!formIndex || !Array.isArray(formSources)) return merged;
  for (const src of formSources) {
    if (!src || src.formId === defaultFormId) continue;
    const f = formIndex.byId.get(src.formId);
    if (!f) continue;
    for (const [k, v] of buildAlaSqlTypeMap(f)) {
      if (!merged.has(k)) merged.set(k, v);
    }
  }
  if (defaultFormId) {
    const f = formIndex.byId.get(defaultFormId);
    if (f) {
      for (const [k, v] of buildAlaSqlTypeMap(f)) {
        merged.set(k, v); // default を最後に書いて優先
      }
    }
  }
  return merged;
}

/**
 * Question を実行してデータを返す。
 * mode === "gui" のときは compileStages で SQL を合成し、対象フォーム 1 件のみを登録して実行する。
 * mode === "sql" のときは forms 配列に基づいて [フォーム名] / [列パイプパス] / [field.id] を解決する。
 */
export async function executeQuestion(question, { forms, globalWhereExpr, sourceFilterClauses } = {}) {
  if (!question || !question.query) {
    return { ok: false, error: "クエリが定義されていません" };
  }

  const mode = question.query.mode;

  if (mode === "gui") {
    return await executeGuiQuestion(question, { forms, globalWhereExpr, sourceFilterClauses });
  }

  if (mode !== "sql") {
    return { ok: false, error: "未対応のクエリモードです: " + String(mode) };
  }

  const sql = question.query.sql;
  if (!sql || !sql.trim()) {
    return { ok: false, error: "SQL が入力されていません" };
  }

  const rawSources = Array.isArray(question.query.formSources) ? question.query.formSources : [];
  // id（fileId）で見つからない formSources は formName で名前フォールバック解決し、現 fileId に揃える。
  const explicitSources = rawSources.map((s) => {
    const f = findFormByRef(forms, s.formId, s.formName);
    return f && f.id !== s.formId ? { ...s, formId: f.id } : s;
  });

  let transformedSql = sql;
  let formIndex = null;
  // 保存済み formSources のうち、現在のフォーム一覧に存在しない (削除済み等) ものは
  // SQL モードでは未選択扱いで落として実行する。[フォーム名] 直接参照や自己完結 SQL は
  // そのまま動き、削除済みフォーム参照だけが "Form not found" で全体を止めるのを防ぐ。
  // （Question 単体エディタの buildSqlFormSources と同じ方針。Dashboard カードなど保存済み
  //   Question をそのまま実行する経路でも、削除済みフォームでエラーにしない。）
  // forms が渡されない呼び出し（一覧で照合できない）では従来どおり explicitSources を全件使う。
  let formSources = explicitSources.slice();
  let defaultFormId = explicitSources.length > 0 ? explicitSources[0].formId : null;

  if (forms && Array.isArray(forms)) {
    formIndex = buildFormIndex(forms);
    formSources = explicitSources.filter((s) => s && formIndex.byId.has(s.formId));
    defaultFormId = formSources.length > 0 ? formSources[0].formId : null;
    const columnIndexCache = new Map();
    const getColumnIndex = (formId) => {
      if (!columnIndexCache.has(formId)) {
        const f = formIndex.byId.get(formId);
        columnIndexCache.set(formId, f ? buildColumnIndex(f) : null);
      }
      return columnIndexCache.get(formId);
    };
    const pre = preprocessSql(sql, { defaultFormId, formIndex, getColumnIndex });
    if (!pre.ok) {
      return { ok: false, error: pre.errors.join(" / ") };
    }
    transformedSql = pre.transformedSql;
    // referencedFormIds から formSources を再構築（formId 単位で dedup）。
    const seen = new Set(formSources.map((s) => s.formId));
    for (const fid of (pre.referencedFormIds || [])) {
      if (seen.has(fid)) continue;
      seen.add(fid);
      const f = formIndex.byId.get(fid);
      // レコードは formId 経由で取得するため spreadsheetId は不要。設定済みかだけ確認する。
      if (!f || !formHasSpreadsheet(f)) {
        return { ok: false, error: ERR_NO_SPREADSHEET + " (form: " + fid + ")" };
      }
      formSources.push({ formId: fid });
    }
  }

  // SQL モードはフォーム未選択でも可。formSources が空でも、SQL が自己完結
  // （例: SELECT 1）なら実行を許す。未解決テーブル参照は AlaSQL 側の
  // 具体的なエラーで返る。
  let aliases = [];
  try {
    aliases = await loadFormsIntoAlaSql(formSources, { defaultFormId, formIndex });
  } catch (err) {
    return { ok: false, error: "データ取得に失敗しました: " + (err.message || String(err)) };
  }

  try {
    if (globalWhereExpr) {
      const applied = await applyGlobalWhereToTables(aliases, globalWhereExpr);
      if (!applied.ok) return { ok: false, error: "一時フィルターの式が不正です: " + applied.error };
    }
    if (sourceFilterClauses && sourceFilterClauses.length > 0) {
      const applied = await applySourceFilterClauses(aliases, sourceFilterClauses);
      if (!applied.ok) return { ok: false, error: "簡易フィルタの適用に失敗しました: " + applied.error };
    }
    const result = await runAlaSql(transformedSql);
    if (!result.ok) return result;
    const columns = result.columns || [];
    // SQL モードでも UI が型ベースの判定（Y 軸候補・グラフ描画）に必要な
    // compiledColumns を返す。GUI モードと違い AST から直接導けないので、
    // 実行 SQL の SELECT 句を文字列パースして集計関数のエイリアスや単純列を
    // 分類する。フォーム schema 由来の fallbackTypeMap も同梱して、
    // compiledColumns で解決できなかった列を呼び出し側で補完できるようにする。
    const fallbackTypeMap = mergeTypeMapsForFormSources(formSources, formIndex, defaultFormId);
    const compiledColumns = inferCompiledColumnsFromSql(transformedSql, fallbackTypeMap);
    return {
      ok: true,
      rows: result.rows,
      columns,
      compiledColumns,
      fallbackTypeMap,
      compiledSql: transformedSql,
    };
  } finally {
    await dropTables(aliases);
  }
}

async function executeGuiQuestion(question, { forms, globalWhereExpr, sourceFilterClauses } = {}) {
  const gui = question.query.gui;
  if (!gui || !gui.formId) {
    return { ok: false, error: "GUI クエリの定義が不正です" };
  }
  // id（fileId）で見つからなければ formName で名前フォールバック解決する。
  const form = findFormByRef(forms, gui.formId, gui.formName);
  if (!form) {
    return { ok: false, error: "GUI クエリの対象フォームが見つかりません" };
  }
  if (!formHasSpreadsheet(form)) {
    return { ok: false, error: ERR_NO_SPREADSHEET };
  }

  // 名前フォールバックで別 fileId のフォームに解決された場合に備え、実行用 gui の formId を
  // 解決後フォームの id（＝fileId）に揃える。これで compileStages が生成する SQL の参照テーブル
  // alias（data_<id>）と、下で登録するテーブル alias（form.id 由来）が一致する。
  const resolvedGui = form.id === gui.formId ? gui : { ...gui, formId: form.id };

  // データ形式は view 形式に一本化。列メタ・型マップは常に view 形式。
  const formColumns = getFormColumns(form);

  const compiled = compileStages(resolvedGui, { formColumns });
  if (!compiled.ok) {
    return { ok: false, error: compiled.errors.join(" / ") };
  }

  // register が成功してから aliases に push する。register 前から alias を確定させると、
  // register が throw した場合でも finally の dropTables が走り、同 alias を共有する
  // 他カードの参照カウントを巻き添えで 0 にして tables[alias] を消してしまうため。
  const aliases = [];
  const typeMap = buildAlaSqlTypeMap(form);
  try {
    // compileStages は単一の data_<id> alias を参照する。canonical（＋ legacy）を
    // 同一 view 形式テーブルに貼っておく。
    const canon = canonicalDataAlias(form.id);
    const extras = [legacyFormAlias(form.id)];
    await registerFormAsTable(canon, form.id, { form, aliasAlsoAs: extras });
    aliases.push(canon, ...extras);
    if (globalWhereExpr) {
      const applied = await applyGlobalWhereToTables(aliases, globalWhereExpr);
      if (!applied.ok) return { ok: false, error: "一時フィルターの式が不正です: " + applied.error };
    }
    if (sourceFilterClauses && sourceFilterClauses.length > 0) {
      const applied = await applySourceFilterClauses(aliases, sourceFilterClauses);
      if (!applied.ok) return { ok: false, error: "簡易フィルタの適用に失敗しました: " + applied.error };
    }
    const result = await runAlaSql(compiled.sql);
    if (!result.ok) return result;
    const columns = result.columns || [];
    return {
      ok: true,
      rows: result.rows,
      columns,
      compiledColumns: compiled.columns,
      fallbackTypeMap: typeMap,
      compiledSql: compiled.sql,
    };
  } finally {
    if (aliases.length > 0) await dropTables(aliases);
  }
}

// ---- Question / Dashboard CRUD ----
//
// Question と Dashboard はキャッシュ更新を伴う CRUD ラッパが完全に機械的なので、
// エンティティ名 (単数 one / 複数 many) と cache・gasClient・任意フックから一式を生成する。
// analyticsGasClient.js / analyticsCache.js のファクトリ方式を踏襲。

function filterArchived_(items, includeArchived) {
  if (includeArchived) return items;
  return items.filter((item) => !item?.archived);
}

function stripExportFields_(item) {
  const clone = deepClone(item || {});
  delete clone.id;
  delete clone.driveFileUrl;
  delete clone.archived;
  delete clone.createdAt;
  delete clone.modifiedAt;
  return clone;
}

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

/**
 * @param {object} cfg
 * @param {string} cfg.one  結果オブジェクトのキー (例: "question")。先頭大文字版が GAS メソッド名の元になる
 * @param {string} cfg.many 結果リストのキー (例: "questions")
 * @param {{ saveAll, getAll, upsert, remove }} cfg.cache
 * @param {object} cfg.gas  analyticsGasClient（list<E>s / get<E> / save<E> / ... を持つ）
 * @param {(items: any[]) => any[]} [cfg.sanitizeList] GAS / キャッシュから読んだ配列を整形（既定: 恒等）
 * @param {(data: any) => void} [cfg.validateBeforeSave] save 前の検証フック（既定: なし）
 */
export function makeEntityStore({ one, many, cache, gas, sanitizeList = (items) => items, validateBeforeSave }) {
  const E = one.charAt(0).toUpperCase() + one.slice(1);
  const upsertAll = async (items) => {
    for (const item of items || []) await cache.upsert(item);
  };

  // サーバから全件取得してキャッシュへ保存し、フィルタ済み配列を返す。
  // lastSyncedAt はこの経路でのみ更新する（stampSyncTime: true）。
  async function fetchAndStore_(includeArchived) {
    const result = await gas[`list${E}s`]({ includeArchived: true });
    const all = sanitizeList(result[many] || []);
    await cache.saveAll(all, { stampSyncTime: true });
    return filterArchived_(all, includeArchived);
  }

  async function list({ forceRefresh = false, includeArchived = false } = {}) {
    if (!forceRefresh) {
      const cached = await cache.getAll();
      if (cached.length > 0) return filterArchived_(sanitizeList(cached), includeArchived);
    }
    return await fetchAndStore_(includeArchived);
  }

  /**
   * SWR 版の一覧取得。キャッシュを即座に返しつつ、鮮度に応じて再取得を仕掛ける。
   * 鮮度判定は evaluateCacheForAnalytics（1 時間で fresh、24 時間で要再取得）に従う。
   *
   * @returns {Promise<{ items: any[], blocking: boolean, sync: Promise<any[]>|null }>}
   *   - items: 即時表示用のキャッシュ済み（フィルタ済み）配列
   *   - blocking: キャッシュが古すぎて信用できず、items を表示せず取得完了を待つべきか
   *   - sync: バックグラウンド/同期の再取得 Promise（不要なら null）。解決値は最新のフィルタ済み配列
   */
  async function listSWR({ includeArchived = false, forceRefresh = false } = {}) {
    const cached = await cache.getAll();
    const { lastSyncedAt } = await cache.getMeta();
    const sanitized = sanitizeList(cached);
    const hasData = sanitized.length > 0;
    const decision = evaluateCacheForAnalytics({ lastSyncedAt, hasData, forceSync: forceRefresh });
    const items = filterArchived_(sanitized, includeArchived);

    if (decision.isFresh) {
      return { items, blocking: false, sync: null };
    }
    // shouldSync かつ手動更新でない場合のみブロックする（24 時間超 or キャッシュ無し）。
    // 手動の forceRefresh では既存表示を残したまま裏で取り直す。
    const blocking = !forceRefresh && decision.shouldSync;
    return { items, blocking, sync: fetchAndStore_(includeArchived) };
  }

  // キャッシュ優先で単一取得。未ヒット時のみ GAS から個別取得。
  async function getById(id) {
    if (!id) return null;
    const cached = await cache.getAll();
    const hit = cached.find((item) => item.id === id);
    if (hit) return hit;
    const result = await gas[`get${E}`](id);
    if (result?.[one]) await cache.upsert(result[one]);
    return result?.[one] || null;
  }

  async function save(data, targetUrl = null) {
    if (validateBeforeSave) validateBeforeSave(data);
    const result = await gas[`save${E}`](data, targetUrl);
    await cache.upsert(result[one]);
    return result[one];
  }

  async function remove(id) {
    await gas[`delete${E}`](id);
    await cache.remove(id);
  }

  async function removeBatch(ids) {
    if (!ids?.length) return;
    await gas[`delete${E}s`](ids);
    for (const id of ids) await cache.remove(id);
  }

  async function setArchivedOne(verb, id) {
    const result = await gas[`${verb}${E}`](id);
    if (result?.[one]) await cache.upsert(result[one]);
    return result;
  }

  async function setArchivedBatch(verb, ids) {
    if (!ids?.length) return { ok: true, updated: 0, errors: [], [many]: [] };
    const result = await gas[`${verb}${E}s`](ids);
    await upsertAll(result?.[many]);
    return result;
  }

  async function copy(id) {
    const result = await gas[`copy${E}`](id);
    if (result?.[one]) await cache.upsert(result[one]);
    return result[one];
  }

  async function registerImported(payload) {
    const result = await gas[`registerImported${E}`](payload);
    if (result?.[one]) await cache.upsert(result[one]);
    return result[one];
  }

  async function exportItems(ids) {
    const all = await list({ forceRefresh: false, includeArchived: true });
    const idSet = new Set(ids);
    return all.filter((item) => idSet.has(item.id)).map(stripExportFields_);
  }

  async function listFolders() {
    const result = await gas[`list${E}Folders`]();
    return result.folders || [];
  }

  async function createFolder(path) {
    const result = await gas[`create${E}Folder`](path);
    return result.folders || [];
  }

  async function moveItems(payload) {
    const result = await gas[`move${E}s`](payload);
    return { folders: result.folders || [], movedIds: result.movedIds || [] };
  }

  async function renameFolder(payload) {
    const result = await gas[`rename${E}Folder`](payload);
    return { folders: result.folders || [], movedIds: result.movedIds || [] };
  }

  async function deleteFolder(path) {
    const result = await gas[`delete${E}Folder`](path);
    return { folders: result.folders || [], deletedCount: result.deletedCount || 0 };
  }

  return {
    list,
    listSWR,
    getById,
    save,
    remove,
    removeBatch,
    archiveOne: (id) => setArchivedOne("archive", id),
    unarchiveOne: (id) => setArchivedOne("unarchive", id),
    archiveBatch: (ids) => setArchivedBatch("archive", ids),
    unarchiveBatch: (ids) => setArchivedBatch("unarchive", ids),
    copy,
    importFromDrive: (url) => gas[`import${E}sFromDrive`](url),
    registerImported,
    exportItems,
    listFolders,
    createFolder,
    moveItems,
    renameFolder,
    deleteFolder,
  };
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
export const deleteQuestion = questionStore.remove;
export const deleteQuestions = questionStore.removeBatch;
export const archiveQuestion = questionStore.archiveOne;
export const unarchiveQuestion = questionStore.unarchiveOne;
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
export const getDashboardById = dashboardStore.getById;
export const saveDashboard = dashboardStore.save;
export const deleteDashboard = dashboardStore.remove;
export const deleteDashboards = dashboardStore.removeBatch;
export const archiveDashboard = dashboardStore.archiveOne;
export const unarchiveDashboard = dashboardStore.unarchiveOne;
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
      // 解決済み。name が変わっていれば questionName をバックフィル/更新する。
      if (card.questionName !== existing.name) {
        nextCards.push({ ...card, questionName: existing.name });
        changed = true;
      } else {
        nextCards.push(card);
      }
      continue;
    }

    // リンク切れ → サーバで名前/id の順に解決を試みる。
    try {
      const res = await analyticsGasClient.resolveQuestionRef({
        questionId: card.questionId || "",
        name: card.questionName || "",
      });
      const q = res && res.question;
      if (q && q.id) {
        await questionCache.upsert(q);
        byId.set(q.id, q);
        nextCards.push({ ...card, questionId: q.id, questionName: q.name || card.questionName || "" });
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
