/**
 * Analytics ストア
 * フォーム records (memory store) → AlaSQL ロード・Question/Dashboard CRUD を一元管理
 */

import { ensureArray } from "../../utils/arrays.js";
import { analyticsGasClient } from "./analyticsGasClient.js";
import { questionCache, dashboardCache, emitAnalyticsCacheChanged } from "./analyticsCache.js";
import { deepClone } from "../../core/schema.js";
import { genLocalId, isLocalId } from "../../core/ids.js";
import { enqueueOpJob, deleteJobsForLocalId, deleteOpJobsForFolderPrefix } from "../../app/state/uploadQueue.js";
import { kickUploadWorker, enqueueEntitySave } from "../../app/state/uploadWorker.js";
import { registryStore } from "../../app/state/registryStore.js";
import {
  normalizeFolderPath,
  isUnderFolder,
  reassignEntityFolder,
  reparentFolders,
  renameFolderPaths,
  removeFolderSubtree,
} from "../../utils/folderTree.js";
import { isV2 as isDashboardV2, assertV2 as assertDashboardV2, getCardType, CARD_TYPE_QUESTION } from "./utils/dashboardSchema.js";
import { registerFormAsTable, dropTables, runAlaSql, applyGlobalWhereToTables, applySourceFilterClauses } from "./analyticsAlaSql.js";
import { buildFormIndex, resolveFormRef } from "./utils/formIdentifierResolver.js";
import { recoverDeadFormRefs } from "./utils/rewriteSqlFormRefs.js";
import { buildColumnIndex } from "./utils/columnIdentifierResolver.js";
import {
  preprocessSql,
  canonicalDataAlias,
  legacyFormAlias,
} from "./utils/sqlPreprocessor.js";
import { compileStages } from "./utils/compileStages.js";
import { inferCompiledColumnsFromSql } from "./utils/sqlColumnInference.js";
import { formHasSpreadsheet } from "../../app/state/dataStoreHelpers.js";
import { collectFormLinkChildFormIds } from "../preview/childFormData.js";
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
export async function loadFormsIntoAlaSql(formSources, { defaultFormId, formIndex, injectChildData = false, excludeMetaColumns = false, liveRowOverride = null, cacheOnly = false } = {}) {
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
      // ライブ行の上書きは現（default）フォームにのみ適用する。
      const liveRowForThis = src.formId === defaultFormId ? liveRowOverride : null;
      await registerFormAsTable(canon, src.formId, { form, aliasAlsoAs: extras, injectChildData, excludeMetaColumns, liveRowOverride: liveRowForThis, cacheOnly });
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
async function executeSqlCore(transformedSql, { formSources, defaultFormId, formIndex, injectChildData = false, excludeMetaColumns = false, globalWhereExpr, sourceFilterClauses, liveRowOverride = null, cacheOnly = false } = {}) {
  let aliases = [];
  try {
    aliases = await loadFormsIntoAlaSql(formSources, { defaultFormId, formIndex, injectChildData, excludeMetaColumns, liveRowOverride, cacheOnly });
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

  const rawSources = ensureArray(question.query.formSources);
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

    // 読取時 case ①: formSources の formId が現在のフォーム一覧に無い（削除/再作成で fileId 変化）でも、
    // 冗長保存した formPath で現在のフォームを引き直し、SQL 本文の参照 fileId を実行用に貼り替える
    // （in-memory・非永続。保存 JSON の前進補完は次回保存時の formSources 再導出が担う）。
    const recovery = recoverDeadFormRefs(sql, explicitSources, formIndex);
    const effectiveSql = recovery.sql;

    formSources = recovery.formSources.filter((s) => s && formIndex.byId.has(s.formId));
    defaultFormId = formSources.length > 0 ? formSources[0].formId : null;
    const columnIndexCache = new Map();
    const getColumnIndex = (formId) => {
      if (!columnIndexCache.has(formId)) {
        const f = formIndex.byId.get(formId);
        columnIndexCache.set(formId, f ? buildColumnIndex(f) : null);
      }
      return columnIndexCache.get(formId);
    };
    const pre = preprocessSql(effectiveSql, { defaultFormId, formIndex, getColumnIndex });
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
 * 呼び出し側（useSearchPageState）は結果行の `id`（現フォームの id）集合で baseFilteredEntries を
 * 絞り込む。id を持たない射影や別フォームの id は現フォームの id 集合に一致しないため、
 * 「対応するレコードが無い＝0 件」に自然に落ちる（＝メインは SELECT * / SELECT [id] FROM _form 想定）。
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

  const formIndex = buildFormIndex(ensureArray(forms));
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

/**
 * テンプレート full-query モード（`{{SELECT ...}}`）の実行。
 * runSearchSelect と同じ実行基盤（preprocessSql → executeSqlCore）を共有するが、
 * 分析用途のため検索非対象メタ列を除外しない（excludeMetaColumns:false）。
 * 現フォーム = `_form`（defaultFormId）。現レコード ID = `_id` は呼び出し側
 * （prefetchQueryTokens）が substituteCurrentIdLiteral で sql に埋め込み済みの想定。
 *
 * 参照スコープは **自フォーム＋「別フォームを開く（formLink）」で紐づく子フォーム**に制限する
 * （allowedFormIds = {defaultFormId} ∪ {親 schema の childFormId 群}）。それ以外の他フォーム参照は
 * preprocessSql がエラーにする。子フォームは `FROM [子フォーム名]` ＋ `pid` 結合で参照でき、
 * 件数・名前・URL だけなら式トークンの CHILD_FORM_* UDF でも取得できる。
 * liveRowOverride を渡すと、`_form` の現レコード行を入力中のライブ値で上書きして解決する。
 *
 * @param {string} sql `_id` 置換済みの SELECT 文
 * @param {Object} args
 * @param {Array} args.forms 全フォーム（[フォーム名] 解決用）
 * @param {string} args.defaultFormId 現フォームの fileId
 * @param {object} [args.liveRowOverride] 現レコードのライブ view 行（buildLiveViewRow の出力）
 * @returns {Promise<{ ok:boolean, rows?:any[], columns?:string[], error?:string }>}
 */
export async function runFullQuery(sql, { forms, defaultFormId, liveRowOverride = null } = {}) {
  if (!sql || !sql.trim()) return { ok: false, error: "SQL が入力されていません" };
  if (!defaultFormId) return { ok: false, error: "対象フォームが特定できません" };

  const formIndex = buildFormIndex(ensureArray(forms));
  const columnIndexCache = new Map();
  const getColumnIndex = (formId) => {
    if (!columnIndexCache.has(formId)) {
      const f = formIndex.byId.get(formId);
      columnIndexCache.set(formId, f ? buildColumnIndex(f) : null);
    }
    return columnIndexCache.get(formId);
  };

  // 置換 full-query は自フォーム＋「別フォームを開く（formLink）」で紐づく子フォームのみ参照可。
  // それ以外の他フォーム参照は preprocessSql が outOfScopeFormError で弾く（任意フォームの読み取りは不可）。
  // 子フォームの件数・名前・URL だけなら式トークンの CHILD_FORM_* UDF でも取得できる。
  // childFormId だけで判定する（GAS は保存時に formLink の field id を落とすため、listForms 由来の
  // 未正規化 schema では collectFormLinkFields の id 要求に引っかかり子フォームが全て除外される）。
  const parentForm = formIndex.byId.get(defaultFormId);
  const childFormIds = parentForm && Array.isArray(parentForm.schema)
    ? collectFormLinkChildFormIds(parentForm.schema)
    : [];
  const allowedFormIds = new Set([defaultFormId, ...childFormIds]);
  const pre = preprocessSql(sql, { defaultFormId, formIndex, getColumnIndex, allowedFormIds });
  if (!pre.ok) return { ok: false, error: pre.errors.join(" / ") };

  const formSources = [];
  const seen = new Set();
  for (const fid of (pre.referencedFormIds || [])) {
    if (seen.has(fid)) continue;
    seen.add(fid);
    const f = formIndex.byId.get(fid);
    // cache-only 経路（メモリ常駐レコード＋入力中ライブ行で解決）なのでスプレッドシート連携は
    // 要求しない。列解決用 schema を持つフォーム本体がローカルに在ることだけを要求する。
    if (!f) {
      return { ok: false, error: "対象フォームがローカルに見つかりません (form: " + fid + ")" };
    }
    formSources.push({ formId: fid });
  }

  const injectChildData = /CHILD_FORM_/i.test(sql);
  return await executeSqlCore(pre.transformedSql, {
    formSources,
    defaultFormId,
    formIndex,
    injectChildData,
    excludeMetaColumns: false,
    liveRowOverride,
    // フロント常駐データのみで解決（サーバ同期しない＝即時）。
    cacheOnly: true,
  });
}

async function executeGuiQuestion(question, { forms, globalWhereExpr, sourceFilterClauses } = {}) {
  const gui = question.query.gui;
  if (!gui || !gui.formId) {
    return { ok: false, error: "GUI クエリの定義が不正です" };
  }
  // 参照は fileId（formId）のみ。id 一致で解決する（id 変化時の再リンクは GAS 側の整合エンジンが担う）。
  let form = findFormByRef(forms, gui.formId);
  if (!form && typeof gui.formPath === "string" && gui.formPath) {
    // 読取時 case ①: formId が死んでいたら冗長保存した formPath で現在のフォームを引き直す（非永続）。
    form = resolveFormRef(gui.formPath, buildFormIndex(ensureArray(forms)));
  }
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
  // まだ Drive へ上がっていないローカル pending（pendingUpload / 一時 ID = local_…）は
  // サーバ応答に含まれないため、ここで保持マージする。さもないと保存直後のアイテムが
  // サーバ再取得で消える（更新ボタンを押すまで反映されない、の根本原因）。
  // 一時 ID の付け替え（reconcile）後は pendingUpload:false になり次回取得で収束する。
  async function fetchAndStore_(includeArchived) {
    const result = await gas[`list${E}s`]({ includeArchived: true });
    const serverAll = sanitizeList(result[many] || []);
    const cached = await cache.getAll();
    const pendingById = new Map(
      cached.filter((x) => x && (x.pendingUpload || isLocalId(x.id))).map((x) => [x.id, x])
    );
    const serverIds = new Set(serverAll.map((x) => x.id));
    // 既存の編集はローカル pending を上書き勝ちにし、新規（サーバ未知）は先頭へ追加する。
    const all = serverAll.map((s) => (pendingById.has(s.id) ? pendingById.get(s.id) : s));
    for (const [id, item] of pendingById) if (!serverIds.has(id)) all.unshift(item);
    await cache.saveAll(all, { stampSyncTime: true });
    // registry 作業キャッシュをサーバ確定の一覧（serverAll＝実 fileId のみ）で充填／更新する
    // （非ブロッキング・fail-safe）。kind は many（"questions" | "dashboards"）。
    registryStore.fillFromList(many, serverAll, { stampSyncTime: true }).catch(() => {});
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
  async function listSWR({ includeArchived = false, forceRefresh = false, revalidateWhenFresh = false } = {}) {
    const cached = await cache.getAll();
    const { lastSyncedAt } = await cache.getMeta();
    const sanitized = sanitizeList(cached);
    const hasData = sanitized.length > 0;
    const decision = evaluateCacheForAnalytics({ lastSyncedAt, hasData, forceSync: forceRefresh });
    const items = filterArchived_(sanitized, includeArchived);

    if (decision.isFresh) {
      // fresh でも、一覧画面を開いた（マウント）ときは裏で再検証する（起動 / F5 相当）。
      // 楽観的更新のキャッシュ変更イベントでは revalidateWhenFresh を立てず、GAS 往復を避ける。
      return { items, blocking: false, sync: revalidateWhenFresh ? fetchAndStore_(includeArchived) : null };
    }
    // shouldSync かつ手動更新でない場合のみブロックする（24 時間超 or キャッシュ無し）。
    // 手動の forceRefresh では既存表示を残したまま裏で取り直す。
    const blocking = !forceRefresh && decision.shouldSync;
    return { items, blocking, sync: fetchAndStore_(includeArchived) };
  }

  // キャッシュ優先で単一取得。未ヒット時のみ GAS から個別取得。
  // forceRefresh 時はキャッシュ照合をスキップしてサーバ最新を取得する（編集画面用）。
  async function getById(id, { forceRefresh = false } = {}) {
    if (!id) return null;
    if (!forceRefresh) {
      const cached = await cache.getAll();
      const hit = cached.find((item) => item.id === id);
      if (hit) return hit;
    }
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
    return await enqueueEntitySave({
      entityType: one,
      record,
      upsertCache: (r) => cache.upsert(r),
      emit: emitAnalyticsCacheChanged,
    });
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

  // removeBatch と同じだが、プロジェクト内（標準フォルダ配下）のファイルは実体も Drive ゴミ箱へ
  // 移動する。プロジェクト外はリンク解除のみで実体を残す（判定は GAS 側がファイルごとに行う）。
  async function removeBatchWithFiles(ids) {
    if (!ids?.length) return;
    await Promise.all(ids.map((id) => deleteJobsForLocalId(id)));
    const remoteIds = ids.filter((id) => !isLocalId(id));
    if (remoteIds.length) await gas[`delete${E}sWithFiles`](remoteIds);
    for (const id of ids) await cache.remove(id);
    kickUploadWorker();
    emitAnalyticsCacheChanged(one);
  }

  // 楽観的＋遅延: アーカイブ状態をキャッシュ上で即時フリップし、GAS 反映は write-behind の
  // op ジョブへ積む（local_ エンティティは save 完了まで依存で待つ）。verb は "archive" / "unarchive"。
  async function setArchivedOne(verb, id) {
    const archived = verb === "archive";
    const all = await cache.getAll();
    const item = all.find((x) => x.id === id);
    const next = item ? { ...item, archived } : null;
    if (next) await cache.upsert(next);
    await enqueueOpJob({ entityType: one, opType: verb, opPayload: { ids: [id] }, dependsOnLocalIds: isLocalId(id) ? [id] : [] });
    kickUploadWorker();
    emitAnalyticsCacheChanged(one);
    return { [one]: next };
  }

  async function setArchivedBatch(verb, ids) {
    if (!ids?.length) return { ok: true, updated: 0, errors: [], [many]: [] };
    const archived = verb === "archive";
    const all = await cache.getAll();
    const byId = new Map(all.map((x) => [x.id, x]));
    const updated = [];
    for (const id of ids) {
      const item = byId.get(id);
      if (!item) continue;
      const next = { ...item, archived };
      await cache.upsert(next);
      updated.push(next);
    }
    await enqueueOpJob({ entityType: one, opType: verb, opPayload: { ids: ids.slice() }, dependsOnLocalIds: ids.filter(isLocalId) });
    kickUploadWorker();
    emitAnalyticsCacheChanged(one);
    return { ok: true, updated: updated.length, errors: [], [many]: updated };
  }

  // 楽観的＋遅延: キャッシュ上の元エンティティを複製し、新規 save ジョブとしてキューへ積む。
  // 名前に「（コピー）」を付与し、アップロード完了で local_ → 実 fileId へ付け替える。
  async function copy(id) {
    const all = await cache.getAll();
    const source = all.find((x) => x.id === id);
    if (!source) {
      // キャッシュ未ヒット時のみ従来のサーバコピーにフォールバック。
      const result = await gas[`copy${E}`](id);
      if (result?.[one]) await cache.upsert(result[one]);
      return result[one];
    }
    const localId = genLocalId();
    const {
      id: _id,
      createdAt: _createdAt,
      modifiedAt: _modifiedAt,
      driveFileUrl: _driveFileUrl,
      pendingUpload: _pendingUpload,
      ...rest
    } = deepClone(source);
    const clone = {
      ...rest,
      id: localId,
      name: `${source.name || ""}（コピー）`,
      archived: false,
      pendingUpload: true,
      modifiedAt: Date.now(),
    };
    if (validateBeforeSave) validateBeforeSave(clone);
    return await enqueueEntitySave({
      entityType: one,
      record: clone,
      upsertCache: (r) => cache.upsert(r),
      emit: emitAnalyticsCacheChanged,
    });
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

  // 楽観的＋遅延: folders 登録簿（一覧ページ保持）へ追加した配列を返し、GAS 実体作成は op ジョブへ。
  async function createFolder(path, { folders = [] } = {}) {
    const normalized = normalizeFolderPath(path);
    const next = !normalized || folders.some((p) => normalizeFolderPath(p) === normalized)
      ? folders.slice()
      : [...folders, normalized];
    await enqueueOpJob({ entityType: one, opType: "createFolder", opPayload: { path } });
    kickUploadWorker();
    return next;
  }

  // 楽観的＋遅延: エンティティの folder をキャッシュ上で即時書換え、GAS 移動は write-behind の
  // op ジョブへ。folders 登録簿は一覧ページが保持するため引数で受け取り、再親付け後の配列を返す。
  async function moveItems(payload, { folders = [] } = {}) {
    const itemIds = Array.isArray(payload?.itemIds) ? payload.itemIds : [];
    const folderPaths = Array.isArray(payload?.folderPaths) ? payload.folderPaths : [];
    const destPath = payload?.destPath || "";

    const all = await cache.getAll();
    for (const item of all) {
      const nf = reassignEntityFolder(item.folder, "move", { itemId: item.id, itemIds, folderPaths, destPath });
      if (nf !== normalizeFolderPath(item.folder)) await cache.upsert({ ...item, folder: nf });
    }
    await enqueueOpJob({ entityType: one, opType: "move", opPayload: payload, dependsOnLocalIds: itemIds.filter(isLocalId) });
    kickUploadWorker();
    emitAnalyticsCacheChanged(one);
    return { folders: reparentFolders(folders, folderPaths, destPath), movedIds: itemIds };
  }

  async function renameFolder(payload, { folders = [] } = {}) {
    const path = payload?.path || "";
    const newName = payload?.newName || "";

    const all = await cache.getAll();
    for (const item of all) {
      const nf = reassignEntityFolder(item.folder, "rename", { path, newName });
      if (nf !== normalizeFolderPath(item.folder)) await cache.upsert({ ...item, folder: nf });
    }
    await enqueueOpJob({ entityType: one, opType: "renameFolder", opPayload: payload });
    kickUploadWorker();
    emitAnalyticsCacheChanged(one);
    return { folders: renameFolderPaths(folders, path, newName), movedIds: [] };
  }

  async function deleteFolder(path, { folders = [] } = {}) {
    const target = normalizeFolderPath(path);
    const all = await cache.getAll();
    let deletedCount = 0;
    for (const item of all) {
      if (!isUnderFolder(item.folder, target)) continue;
      await deleteJobsForLocalId(item.id);
      await cache.remove(item.id);
      deletedCount += 1;
    }
    await deleteOpJobsForFolderPrefix(one, target);
    await enqueueOpJob({ entityType: one, opType: "deleteFolder", opPayload: { path } });
    kickUploadWorker();
    emitAnalyticsCacheChanged(one);
    return { folders: removeFolderSubtree(folders, target), deletedCount };
  }

  return {
    list,
    listSWR,
    getById,
    save,
    remove,
    removeBatch,
    removeBatchWithFiles,
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
