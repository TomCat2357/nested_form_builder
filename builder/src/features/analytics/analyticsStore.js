/**
 * Analytics ストア
 * フォーム records (memory store) → AlaSQL ロード・Question/Dashboard CRUD を一元管理
 */

import { analyticsGasClient } from "./analyticsGasClient.js";
import { questionCache, dashboardCache, emitAnalyticsCacheChanged } from "./analyticsCache.js";
import { deepClone } from "../../core/schema.js";
import { genLocalId, isLocalId } from "../../core/ids.js";
import { enqueueJob, deleteJobsForLocalId } from "../../app/state/uploadQueue.js";
import { kickUploadWorker } from "../../app/state/uploadWorker.js";
import { isV2 as isDashboardV2, assertV2 as assertDashboardV2, getCardType, CARD_TYPE_QUESTION } from "./utils/dashboardSchema.js";
import { registerFormAsTable, dropTables, runAlaSql, applyGlobalWhereToTables, applySourceFilterClauses } from "./analyticsAlaSql.js";
import { buildFormIndex } from "./utils/formIdentifierResolver.js";
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

// クエスチョンのフォーム参照を解決する。参照は fileId（formId）のみで保持する方針のため、
// id 一致だけで解決する。id 変化（コピー/マイグレーション）時の再リンクは中央辞書（論理パス→fileId）に
// 集約した GAS 側の整合エンジン（remap / 保存時 alignReferencesOnSave_）が担う。
function findFormByRef(forms, formId) {
  if (!Array.isArray(forms) || !formId) return null;
  return forms.find((x) => x.id === formId) || null;
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
export async function loadFormsIntoAlaSql(formSources, { defaultFormId, formIndex, injectChildData = false, excludeMetaColumns = false } = {}) {
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
      await registerFormAsTable(canon, src.formId, { form, aliasAlsoAs: extras, injectChildData, excludeMetaColumns });
      aliases.push(canon, ...extras);
    }
    return aliases;
  } catch (err) {
    if (aliases.length > 0) await dropTables(aliases);
    throw err;
  }
}

/**
 * 前処理済み SQL を AlaSQL で実行する共通コア。
 * テーブル登録 → 一時 WHERE / 簡易フィルタ適用 → 実行 → 後片付け（dropTables）までを一本化し、
 * 検索の SQL モード（runSearchSelect）と Question の SQL モード（executeQuestion）で共有する。
 *
 * @param {string} transformedSql preprocessSql 済みの SQL 本文
 * @param {object} args
 * @param {Array<{ formId: string }>} args.formSources 登録対象フォーム
 * @param {string|null} args.defaultFormId
 * @param {object|null} args.formIndex
 * @param {boolean} [args.injectChildData] CHILD_FORM_* 用の子データ注入
 * @param {boolean} [args.excludeMetaColumns] 検索非対象メタ列を落とす（検索 SQL モードのみ true）
 * @param {string} [args.globalWhereExpr] ダッシュボードの一時グローバル WHERE
 * @param {Array} [args.sourceFilterClauses] ダッシュボードの簡易フィルタ
 * @returns {Promise<{ ok: boolean, rows?: any[], columns?: string[], error?: string }>}
 */
async function executeSqlCore(transformedSql, { formSources, defaultFormId, formIndex, injectChildData = false, excludeMetaColumns = false, globalWhereExpr, sourceFilterClauses } = {}) {
  let aliases = [];
  try {
    aliases = await loadFormsIntoAlaSql(formSources, { defaultFormId, formIndex, injectChildData, excludeMetaColumns });
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
    return await runAlaSql(transformedSql);
  } finally {
    await dropTables(aliases);
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
  // 参照は fileId（formId）のみ。現在のフォーム一覧に存在する formSources はそのまま使い、
  // 削除済み等で存在しないものは下流で未選択扱いに落とす（[フォーム名] 直接参照は SQL 本文で解決）。
  const explicitSources = rawSources.slice();

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
  // SQL が CHILD_FORM_* UDF を使うときだけ、formLink 列へ子フォーム合成オブジェクトを注入する
  // （件数取得のため子レコードを fetch するので、不要なクエリには負荷をかけないようゲートする）。
  // Question/Dashboard は分析用途のためメタ列を除外しない（全列アクセス可）。
  const injectChildData = /CHILD_FORM_/i.test(sql);
  const result = await executeSqlCore(transformedSql, {
    formSources,
    defaultFormId,
    formIndex,
    injectChildData,
    excludeMetaColumns: false,
    globalWhereExpr,
    sourceFilterClauses,
  });
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
}

/**
 * 検索ページの SQL モード用に、最上位 SQL を実行して結果行を返す。
 *
 * - `_` は対象（自）フォーム（defaultFormId）に解決される。
 * - 本文のサブクエリ / 別フォーム参照（`IN (SELECT ...)` / JOIN）も preprocessSql が解決し、
 *   referencedFormIds のフォームを AlaSQL テーブルとして自動登録する。
 * - Question/Dashboard と違い、検索非対象メタ列（createdBy / modifiedBy / deletedAt / deletedBy）は
 *   テーブル登録時に除外する（excludeMetaColumns）。
 *
 * 呼び出し側（useSearchPageState）は結果行の `id`（自フォームの id）集合で baseFilteredEntries を
 * 絞り込む。id を持たない射影や別フォームの id は自フォームの id 集合に一致しないため、
 * 「対応するレコードが無い＝0 件」に自然に落ちる（＝メインは SELECT * / SELECT [id] FROM _ 想定）。
 *
 * @param {string} sql 検索バーに入力された SELECT 文
 * @param {Object} args
 * @param {Array} args.forms 全フォーム（[フォーム名] 解決用）
 * @param {string} args.defaultFormId 対象（自）フォームの fileId
 * @returns {Promise<{ ok:boolean, rows?:any[], columns?:string[], error?:string }>}
 */
export async function runSearchSelect(sql, { forms, defaultFormId } = {}) {
  if (!sql || !sql.trim()) return { ok: false, error: "SQL が入力されていません" };
  if (!defaultFormId) return { ok: false, error: "対象フォームが特定できません" };

  const formIndex = buildFormIndex(Array.isArray(forms) ? forms : []);
  const columnIndexCache = new Map();
  const getColumnIndex = (formId) => {
    if (!columnIndexCache.has(formId)) {
      const f = formIndex.byId.get(formId);
      columnIndexCache.set(formId, f ? buildColumnIndex(f) : null);
    }
    return columnIndexCache.get(formId);
  };

  const pre = preprocessSql(sql, { defaultFormId, formIndex, getColumnIndex });
  if (!pre.ok) return { ok: false, error: pre.errors.join(" / ") };

  // referencedFormIds（defaultFormId を含む）→ formSources。スプレッドシート未設定はエラー。
  const formSources = [];
  const seen = new Set();
  for (const fid of (pre.referencedFormIds || [])) {
    if (seen.has(fid)) continue;
    seen.add(fid);
    const f = formIndex.byId.get(fid);
    if (!f || !formHasSpreadsheet(f)) {
      return { ok: false, error: ERR_NO_SPREADSHEET + " (form: " + fid + ")" };
    }
    formSources.push({ formId: fid });
  }

  // CHILD_FORM_* を使うときだけ子フォーム合成オブジェクトを注入する（Stage B と同じゲート）。
  // 検索の SQL モードは検索非対象メタ列（createdBy / modifiedBy / deletedAt / deletedBy）を除外する。
  const injectChildData = /CHILD_FORM_/i.test(sql);
  return await executeSqlCore(pre.transformedSql, {
    formSources,
    defaultFormId,
    formIndex,
    injectChildData,
    excludeMetaColumns: true,
  });
}

async function executeGuiQuestion(question, { forms, globalWhereExpr, sourceFilterClauses } = {}) {
  const gui = question.query.gui;
  if (!gui || !gui.formId) {
    return { ok: false, error: "GUI クエリの定義が不正です" };
  }
  // 参照は fileId（formId）のみ。id 一致で解決する（id 変化時の再リンクは GAS 側の整合エンジンが担う）。
  const form = findFormByRef(forms, gui.formId);
  if (!form) {
    return { ok: false, error: "GUI クエリの対象フォームが見つかりません" };
  }
  if (!formHasSpreadsheet(form)) {
    return { ok: false, error: ERR_NO_SPREADSHEET };
  }

  // データ形式は view 形式に一本化。列メタ・型マップは常に view 形式。
  const formColumns = getFormColumns(form);

  const compiled = compileStages(gui, { formColumns });
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

  // オフラインファースト: まず IndexedDB に保存し、Drive へのアップロードはバックグラウンドへ。
  // 新規は一時 ID(local_…) を採番し、アップロード完了時に実 fileId へ付け替える（参照も再リンク）。
  async function save(data) {
    if (validateBeforeSave) validateBeforeSave(data);
    const localId = data.id || genLocalId();
    const record = { ...data, id: localId, pendingUpload: true, modifiedAt: Date.now() };
    await cache.upsert(record);
    await enqueueJob({ entityType: one, localId, payload: record });
    kickUploadWorker();
    emitAnalyticsCacheChanged(one);
    return record;
  }

  async function remove(id) {
    await deleteJobsForLocalId(id);
    if (!isLocalId(id)) await gas[`delete${E}`](id);
    await cache.remove(id);
    kickUploadWorker();
    emitAnalyticsCacheChanged(one);
  }

  async function removeBatch(ids) {
    if (!ids?.length) return;
    await Promise.all(ids.map((id) => deleteJobsForLocalId(id)));
    const remoteIds = ids.filter((id) => !isLocalId(id));
    if (remoteIds.length) await gas[`delete${E}s`](remoteIds);
    for (const id of ids) await cache.remove(id);
    kickUploadWorker();
    emitAnalyticsCacheChanged(one);
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
    // GAS がフォルダ構造を書き換えたので、次回 listSWR でサーバから再取得させる。
    await cache.resetSyncTime();
    emitAnalyticsCacheChanged(one);
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
export const deleteQuestions = questionStore.removeBatch;
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
