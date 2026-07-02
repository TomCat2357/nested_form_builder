/**
 * Analytics クエリエンジン
 * フォーム records (memory store) → AlaSQL ロード・SQL/GUI Question 実行・検索 SQL モード・
 * テンプレート full-query 実行の共通基盤（analyticsStore.js から分離）。
 */

import { ensureArray } from "../../utils/arrays.js";
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
import {
  buildAlaSqlTypeMap,
  getFormColumns,
} from "./analyticsSchemaColumns.js";

export const ERR_NO_SPREADSHEET = "選択したフォームにスプレッドシートが紐付いていません。フォーム設定で spreadsheetId を指定してください。";

// クエスチョンのフォーム参照を解決する。参照は fileId（formId）のみで保持する方針のため、
// id 一致だけで解決する。id 変化（コピー/マイグレーション）時の再リンクは中央辞書（論理パス→fileId）に
// 集約した GAS 側の整合エンジン（remap / 保存時 alignReferencesOnSave_）が担う。
export function findFormByRef(forms, formId) {
  if (!Array.isArray(forms) || !formId) return null;
  return forms.find((x) => x.id === formId) || null;
}

/**
 * formIndex 上の列インデックスを formId 単位でメモ化して返す resolver を作る。
 * preprocessSql の getColumnIndex オプションにそのまま渡す。
 */
function makeColumnIndexResolver(formIndex) {
  const columnIndexCache = new Map();
  return (formId) => {
    if (!columnIndexCache.has(formId)) {
      const f = formIndex.byId.get(formId);
      columnIndexCache.set(formId, f ? buildColumnIndex(f) : null);
    }
    return columnIndexCache.get(formId);
  };
}

/**
 * preprocessSql が返す referencedFormIds を formSources（[{ formId }]）へ展開する。
 * seed に既存の formSources を渡すと dedup した上で後ろに追加する。
 *
 * requireSpreadsheet:
 *   true  … スプレッドシート未設定のフォームはエラー（Question / 検索 SQL モード）
 *   false … フォーム本体がローカルに在ることだけを要求（テンプレート full-query の cache-only 経路）
 *
 * @returns {{ ok: true, formSources: Array<{formId: string}> } | { ok: false, error: string }}
 */
function collectFormSources(referencedFormIds, formIndex, { seed = [], requireSpreadsheet = true } = {}) {
  const formSources = seed.slice();
  const seen = new Set(formSources.map((s) => s.formId));
  for (const fid of (referencedFormIds || [])) {
    if (seen.has(fid)) continue;
    seen.add(fid);
    const f = formIndex.byId.get(fid);
    if (requireSpreadsheet) {
      // レコードは formId 経由で取得するため spreadsheetId は不要。設定済みかだけ確認する。
      if (!f || !formHasSpreadsheet(f)) {
        return { ok: false, error: ERR_NO_SPREADSHEET + " (form: " + fid + ")" };
      }
    } else if (!f) {
      return { ok: false, error: "対象フォームがローカルに見つかりません (form: " + fid + ")" };
    }
    formSources.push({ formId: fid });
  }
  return { ok: true, formSources };
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
    const pre = preprocessSql(effectiveSql, { defaultFormId, formIndex, getColumnIndex: makeColumnIndexResolver(formIndex) });
    if (!pre.ok) {
      return { ok: false, error: pre.errors.join(" / ") };
    }
    transformedSql = pre.transformedSql;
    // referencedFormIds から formSources を再構築（formId 単位で dedup）。
    const collected = collectFormSources(pre.referencedFormIds, formIndex, { seed: formSources });
    if (!collected.ok) return collected;
    formSources = collected.formSources;
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
  const pre = preprocessSql(sql, { defaultFormId, formIndex, getColumnIndex: makeColumnIndexResolver(formIndex) });
  if (!pre.ok) return { ok: false, error: pre.errors.join(" / ") };

  // referencedFormIds（defaultFormId を含む）→ formSources。スプレッドシート未設定はエラー。
  const collected = collectFormSources(pre.referencedFormIds, formIndex);
  if (!collected.ok) return collected;

  // CHILD_FORM_* を使うときだけ子フォーム合成オブジェクトを注入する（Stage B と同じゲート）。
  // 検索の SQL モードは検索非対象メタ列（createdBy / modifiedBy / deletedAt / deletedBy）を除外する。
  const injectChildData = /CHILD_FORM_/i.test(sql);
  return await executeSqlCore(pre.transformedSql, {
    formSources: collected.formSources,
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
  const pre = preprocessSql(sql, { defaultFormId, formIndex, getColumnIndex: makeColumnIndexResolver(formIndex), allowedFormIds });
  if (!pre.ok) return { ok: false, error: pre.errors.join(" / ") };

  // cache-only 経路（メモリ常駐レコード＋入力中ライブ行で解決）なのでスプレッドシート連携は
  // 要求しない。列解決用 schema を持つフォーム本体がローカルに在ることだけを要求する。
  const collected = collectFormSources(pre.referencedFormIds, formIndex, { requireSpreadsheet: false });
  if (!collected.ok) return collected;

  const injectChildData = /CHILD_FORM_/i.test(sql);
  return await executeSqlCore(pre.transformedSql, {
    formSources: collected.formSources,
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
