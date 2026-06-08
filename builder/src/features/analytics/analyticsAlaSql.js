/**
 * AlaSQL テーブル登録・クエリ実行・クリーンアップ
 *
 * alasql インスタンス自体の取得 (CDN ランタイムロード + NFB UDF 登録) は
 * features/expression/alasqlRuntime.js に集約されている。
 */
import { getAlaSql } from "../expression/alasqlRuntime.js";
import { unionRowKeys } from "./utils/computeShared.js";
import { dataStore } from "../../app/state/dataStore.js";
import { getRecordsFromCache } from "../../app/state/recordsMemoryStore.js";
import { entriesToViewTableRows } from "./entriesToViewRows.js";
import { bracketIdent } from "../expression/sqlEmit.js";
import { ANALYTICS_SOURCE_TABLE_CACHE_TTL_MS, NON_SEARCHABLE_META_KEYS } from "../../core/constants.js";
import { collectFormLinkFields, buildChildFormInjections } from "../preview/childFormData.js";
import { headerKeyToAlaSqlKey } from "./utils/headerToAlaSqlKey.js";

// alias ごとの利用カウント。並列実行されるカードが同じ alias を共有しても、
// 最後の利用者が dropTables するまでテーブルが残るようにするため。
const tableRefCounts = new Map();

// 元レコードテーブルの React メモリキャッシュ（IndexedDB ではない）。
// key = formId（データ形式は view 形式に一本化）、value = { rows, ts }。
// フィルタの微調整ごとに dataStore.listEntries + 行変換を再実行しないための短期キャッシュ。
// TTL 内はキャッシュ済みの変換済み行配列を再利用し、サーバ同期も変換もスキップする。
const sourceTableCache = new Map();

/**
 * 元レコードテーブルキャッシュをクリアする。
 * 閲覧者の「データ再取得」など、最新データを明示的に取り直したいときに呼ぶ。
 */
export function clearAnalyticsSourceTableCache() {
  sourceTableCache.clear();
}

// TTL 内のキャッシュ済み行を返す。無効（未登録 / 期限切れ）なら null。
function getCachedSourceRows_(cacheKey) {
  const hit = sourceTableCache.get(cacheKey);
  if (!hit) return null;
  if (Date.now() - hit.ts >= ANALYTICS_SOURCE_TABLE_CACHE_TTL_MS) {
    sourceTableCache.delete(cacheKey);
    return null;
  }
  return hit.rows;
}

// 検索の SQL モードで登録テーブルから落とす固定メタ列キーは
// core/constants.js の NON_SEARCHABLE_META_KEYS に一元化（簡易検索の列フィルタと同一ポリシー）。

// 検索非対象メタ列を落とした新しい行配列を返す（キャッシュ済みの pristine 行は破壊しない）。
// registerFormAsTable の excludeMetaColumns で使う。テスト用に export する。
export function stripNonSearchableMetaColumns(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => {
    const out = { ...row };
    for (const key of NON_SEARCHABLE_META_KEYS) delete out[key];
    return out;
  });
}

// 削除済みエントリを除外する（data / view 共通）。
function filterNotDeleted_(entries) {
  return (entries || []).filter((e) => {
    const deleted = e?.deletedAtUnixMs ?? e?.deletedAt;
    return !(deleted && deleted !== "" && deleted !== 0);
  });
}

// フォームが formLink（別フォームを開く）項目を 1 つ以上持つか。
function formHasFormLink_(form) {
  return !!(form && Array.isArray(form.schema) && collectFormLinkFields(form.schema).length > 0);
}

/**
 * view 行の formLink 列へ子フォーム合成オブジェクトを注入する（CHILD_FORM_* UDF 用）。
 * CHILD_FORM_NAME / COUNT 等を含む SQL のときだけ呼ばれる（registerFormAsTable の injectChildData ゲート）。
 * 取得不可（headless 等）なら buildChildFormInjections が [] を返すので何もしない。
 */
async function injectChildFormDataIntoRows_(rows, form) {
  if (!Array.isArray(rows) || rows.length === 0) return;
  const parentIds = rows.map((r) => r && r.id).filter(Boolean);
  const baseUrl = (typeof window !== "undefined" && window.__GAS_WEBAPP_URL__) ? window.__GAS_WEBAPP_URL__ : "";
  const injections = await buildChildFormInjections({ schema: form.schema, parentIds, baseUrl });
  for (const inj of injections) {
    const key = headerKeyToAlaSqlKey(inj.path);
    for (const row of rows) {
      row[key] = inj.byPid.get(String(row.id || "")) || { childFormId: "", childFormName: "", childFormUrl: "", count: 0 };
    }
  }
}

/**
 * フォームを AlaSQL インメモリテーブルとして登録する（唯一のデータ形式＝view 形式）。
 * dataStore.listEntries で最新のメモリ常駐 records を取り出し、削除済みを除外し、
 * entriesToViewTableRows で view 形式行へ整形して登録する。
 * 同一 alias で複数回呼ぶと内部リファレンスカウントが増える。dropTables で同じ回数 decrement されるまでテーブルは破棄されない。
 * @param {string} alias - テーブル名
 * @param {string} formId
 * @param {object} [options]
 * @param {object} [options.form] - スキーマ走査用フォーム本体（radio/checkbox の整形に使う）
 * @param {string[]} [options.aliasAlsoAs] - 同一テーブルに貼る追加 alias（data_<id> / form_<id> / "data" など）
 * @param {boolean} [options.injectChildData] - formLink 列へ子フォーム合成オブジェクトを注入する
 *   （CHILD_FORM_* UDF 用）。SQL に CHILD_FORM_ が含まれるときだけ呼び出し側が立てる。
 * @param {boolean} [options.excludeMetaColumns] - 検索非対象の固定メタ列（createdBy / modifiedBy /
 *   deletedAt / deletedBy）を登録テーブルから落とす。検索の SQL モード（runSearchSelect）だけ true。
 *   Question/Dashboard は分析用途のため false（全列アクセス可）。
 * @param {object} [options.liveRowOverride] - 置換 full-query 用。現レコードの「入力中のライブ行」
 *   （buildLiveViewRow の出力）。登録テーブルから同 id の行を除き、この行で置換する（id 未存在なら追加）。
 *   キャッシュ（sourceTableCache）は汚さない（新配列で適用）。呼び出し側が default フォームのときだけ渡す。
 * @param {boolean} [options.cacheOnly] - テンプレ full-query 用。true のときサーバ同期せず
 *   getRecordsFromCache（メモリ常駐レコード）から基底行を取得する。sourceTableCache も使わず
 *   毎回現状態を反映する。検索 / Question / Dashboard は false のまま（dataStore.listEntries で同期）。
 */
export async function registerFormAsTable(alias, formId, options = {}) {
  if (!alias) throw new Error("alias is required");
  if (!formId) throw new Error("formId is required");
  const alasql = await getAlaSql();
  // 子データ注入の有無で view 行の形が変わるため、キャッシュキーを分ける（注入版/非注入版を混同しない）。
  const wantChild = options.injectChildData === true && formHasFormLink_(options.form);
  // 元レコードテーブルは formId 単位でキャッシュ（TTL 内はサーバ同期も行変換もスキップ）。
  const cacheKey = wantChild ? formId + "#child" : formId;
  let rows;
  if (options.cacheOnly === true) {
    // cache-only（テンプレ full-query）: サーバ同期（dataStore.listEntries → syncRecordsProxy）を
    // せず、メモリ常駐レコードだけを読む。sourceTableCache は使わず毎回現状態を反映する
    // （TTL 由来の陳腐化を避け、別経路の同期がメモリ常駐へ反映した結果は次回呼び出しで自然に拾う）。
    const cache = await getRecordsFromCache(formId);
    const entries = filterNotDeleted_(cache?.entries);
    rows = entriesToViewTableRows(entries, options.form);
    if (wantChild) await injectChildFormDataIntoRows_(rows, options.form);
  } else {
    rows = getCachedSourceRows_(cacheKey);
    if (!rows) {
      const result = await dataStore.listEntries(formId);
      const entries = filterNotDeleted_(result?.entries);
      rows = entriesToViewTableRows(entries, options.form);
      if (wantChild) await injectChildFormDataIntoRows_(rows, options.form);
      sourceTableCache.set(cacheKey, { rows, ts: Date.now() });
    }
  }
  // 置換 full-query の現レコード行を「入力中のライブ値」で上書きする。filter+concat で
  // 新配列を作るためキャッシュ（上で set した rows 参照）は汚れない。id 一致行を除いて末尾に足す。
  const liveRowOverride = options.liveRowOverride;
  if (liveRowOverride && liveRowOverride.id != null) {
    const ovId = String(liveRowOverride.id);
    rows = rows.filter((r) => String(r && r.id) !== ovId).concat([liveRowOverride]);
  }
  // 検索の SQL モードは検索非対象メタ列を落とす（Question/Dashboard は false で全列のまま）。
  // strip は新オブジェクトを生成するのでキャッシュ済み rows は汚さない。
  const tableRows = options.excludeMetaColumns === true ? stripNonSearchableMetaColumns(rows) : rows;
  // 既に同一 alias で登録済みなら参照カウントだけ進めて rows は使い回す。
  // 同じテーブルに別 alias を貼る場合（data_<id> と form_<id> など）の追加登録は
  // 呼び出し側で aliasAlsoAs を渡してこの関数で一括処理する。
  // 登録は slice() コピーで行い、applyGlobalWhereToTables 等の table.data 再代入から
  // キャッシュ配列（pristine rows）を保護する。
  alasql.tables[alias] = { data: tableRows.slice() };
  tableRefCounts.set(alias, (tableRefCounts.get(alias) || 0) + 1);
  if (Array.isArray(options.aliasAlsoAs)) {
    for (const extra of options.aliasAlsoAs) {
      if (!extra || extra === alias) continue;
      alasql.tables[extra] = { data: tableRows.slice() };
      tableRefCounts.set(extra, (tableRefCounts.get(extra) || 0) + 1);
    }
  }
}

/**
 * 互換ラッパ: 旧 registerFormViewAsTable。view 形式が唯一の形式になったため
 * registerFormAsTable に委譲する。
 */
export async function registerFormViewAsTable(alias, formId, form) {
  return registerFormAsTable(alias, formId, { form });
}

/**
 * 複数テーブルを一括削除する（リファレンスカウントを decrement し、0 になった時点で実削除）。
 */
export async function dropTables(aliases) {
  const alasql = await getAlaSql();
  for (const alias of aliases) {
    const next = (tableRefCounts.get(alias) || 0) - 1;
    if (next <= 0) {
      tableRefCounts.delete(alias);
      if (alasql.tables[alias]) {
        delete alasql.tables[alias];
      }
    } else {
      tableRefCounts.set(alias, next);
    }
  }
}

/**
 * AlaSQL で SQL を実行して結果行配列を返す。
 * columns は全結果行のキーの和集合（初出順）。不均質な行でも列を取りこぼさない。
 * @param {string} sql
 * @returns {Promise<{ ok: boolean, rows?: any[], columns?: string[], error?: string }>}
 */
export async function runAlaSql(sql) {
  try {
    const alasql = await getAlaSql();
    const rows = alasql(sql);
    const resultRows = Array.isArray(rows) ? rows : [];
    return { ok: true, rows: resultRows, columns: unionRowKeys(resultRows) };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

/**
 * 登録済みの alasql テーブルに対し、ダッシュボードの一時グローバル WHERE 式を適用してデータを差し替える。
 *
 * 式中の `[識別子]` をすべて抽出し、テーブルの列に存在しない識別子が 1 つでも含まれていれば
 * そのテーブルはスキップ（フィルタ未適用＝全件のまま）。すべての参照識別子が列として存在する
 * テーブルだけ `SELECT * FROM ? WHERE <expr>` を実行して `.data` を結果で置換する。
 *
 * 列存在判定は `data[0]` のキー集合で行う。行が空のテーブルは何もしない（フィルタ後も空のまま）。
 *
 * @param {string[]} aliases - 登録済みテーブル名
 * @param {string} whereExpr - 例: "[受付日] > '2025-01-01'"
 * @returns {Promise<{ ok: boolean, error?: string }>} 構文エラーは ok:false を返す（呼び出し側でエラー表示）
 */
export async function applyGlobalWhereToTables(aliases, whereExpr) {
  if (!whereExpr || typeof whereExpr !== "string" || whereExpr.trim() === "") return { ok: true };
  if (!Array.isArray(aliases) || aliases.length === 0) return { ok: true };
  const alasql = await getAlaSql();
  const identRe = /\[([^\]]+)\]/g;
  const refIdents = new Set();
  let m;
  while ((m = identRe.exec(whereExpr)) !== null) {
    refIdents.add(m[1]);
  }
  if (refIdents.size === 0) {
    // 列参照が無い式（例: 定数だけ）。AlaSQL に渡して構文だけ検証する余地はあるが、
    // 「列が無いテーブルは無視」というユーザ仕様の単純化のため何もしない。
    return { ok: true };
  }
  const seen = new Set();
  for (const alias of aliases) {
    if (seen.has(alias)) continue;
    seen.add(alias);
    const table = alasql.tables[alias];
    if (!table || !Array.isArray(table.data) || table.data.length === 0) continue;
    const cols = new Set(Object.keys(table.data[0] || {}));
    let allPresent = true;
    for (const id of refIdents) {
      if (!cols.has(id)) { allPresent = false; break; }
    }
    if (!allPresent) continue;
    try {
      const filtered = alasql("SELECT * FROM ? WHERE " + whereExpr, [table.data]);
      table.data = Array.isArray(filtered) ? filtered : [];
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  }
  return { ok: true };
}

/**
 * ダッシュボード簡易フィルタを元レコードテーブルへ適用する。
 * applyGlobalWhereToTables と同じソーステーブル絞り込み方式だが、値をパラメータ化し、
 * かつ **列ごとに独立して** 適用する（その列を持つテーブルにだけ効く）。
 * 列を持たないテーブルは何もせず素通し（＝そのカードには適用されない）。
 *
 * @param {string[]} aliases - 登録済みテーブルの alias 配列
 * @param {Array<{ col: string, comparator: string, value: any }>} clauses
 *   comparator は ">=" | "<=" を想定。
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function applySourceFilterClauses(aliases, clauses) {
  if (!Array.isArray(clauses) || clauses.length === 0) return { ok: true };
  if (!Array.isArray(aliases) || aliases.length === 0) return { ok: true };
  const alasql = await getAlaSql();
  const seen = new Set();
  for (const alias of aliases) {
    if (seen.has(alias)) continue;
    seen.add(alias);
    const table = alasql.tables[alias];
    if (!table || !Array.isArray(table.data) || table.data.length === 0) continue;
    const cols = new Set(Object.keys(table.data[0] || {}));
    for (const clause of clauses) {
      if (!clause || !clause.col || !cols.has(clause.col)) continue;
      const comparator = clause.comparator === "<=" ? "<=" : ">=";
      try {
        const sql = "SELECT * FROM ? WHERE " + bracketIdent(clause.col) + " " + comparator + " ?";
        const filtered = alasql(sql, [table.data, clause.value]);
        table.data = Array.isArray(filtered) ? filtered : [];
      } catch (err) {
        return { ok: false, error: err.message || String(err) };
      }
    }
  }
  return { ok: true };
}

/**
 * 任意の行配列に対して `?` パラメータ経由で AlaSQL を実行する。
 * テーブル登録不要で、ダッシュボード共通フィルタの「結果行への二次フィルタ」に利用する。
 * 例: runAlaSqlOnArray(rows, "SELECT * FROM ? WHERE [date] >= ?", [from])
 * @param {Array<object>} rows
 * @param {string} sql - "FROM ?" を含む SQL
 * @param {Array<any>} [extraParams] - 追加パラメータ ($1 以降は rows の後に渡る)
 */
export async function runAlaSqlOnArray(rows, sql, extraParams = []) {
  try {
    const alasql = await getAlaSql();
    const params = [Array.isArray(rows) ? rows : [], ...extraParams];
    const out = alasql(sql, params);
    const resultRows = Array.isArray(out) ? out : [];
    const columns = unionRowKeys(resultRows);
    return { ok: true, rows: resultRows, columns };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

/**
 * 行配列に対して WHERE 式を適用してマッチした行だけを返す。
 * ダッシュボード詳細フィルター（applyGlobalWhereToTables）と同じ
 * `SELECT * FROM ? WHERE <expr>` 評価エンジンを、テーブル登録不要で使うための薄いラッパ。
 * 検索画面の strict（WHERE/SEARCH）モードがこれを共有する。
 *
 * @param {Array<object>} rows
 * @param {string} whereExpr - 前処理済み（バッククォート/UDF 解決済み）の WHERE 式本体
 * @returns {Promise<{ ok: boolean, rows?: any[], error?: string }>}
 */
export async function filterRowsByExpr(rows, whereExpr) {
  const list = Array.isArray(rows) ? rows : [];
  if (!whereExpr || typeof whereExpr !== "string" || whereExpr.trim() === "") {
    return { ok: true, rows: list };
  }
  return runAlaSqlOnArray(list, "SELECT * FROM ? WHERE " + whereExpr);
}
