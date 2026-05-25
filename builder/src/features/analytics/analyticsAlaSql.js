/**
 * AlaSQL テーブル登録・クエリ実行・クリーンアップ
 *
 * alasql インスタンス自体の取得 (CDN ランタイムロード + NFB UDF 登録) は
 * features/expression/alasqlRuntime.js に集約されている。
 */
import { getAlaSql } from "../expression/alasqlRuntime.js";
import { isChoiceMarkerValue } from "../../utils/responses.js";
import { headerKeyToAlaSqlKey } from "./utils/headerToAlaSqlKey.js";
import { unionRowKeys } from "./utils/computeShared.js";
import { dataStore } from "../../app/state/dataStore.js";
import { formatCanonical } from "../../utils/dateTime.js";
import { entriesToViewTableRows } from "./entriesToViewRows.js";
import { bracketIdent } from "../expression/sqlEmit.js";
import { ANALYTICS_SOURCE_TABLE_CACHE_TTL_MS } from "../../core/constants.js";

// 時刻のみ文字列（"HH:mm[:ss[.SSS]]"）の判定（"date" 列型の中で TIME を見分ける）。
const TIME_ONLY_ROW_RE = /^\d{1,2}:\d{2}(?::\d{2})?(?:\.\d{1,3})?$/;
// 旧ワイヤ互換: Sheets の time シリアル基準日 1899-12-30 ＋ 時刻成分を持つ ISO / "YYYY-MM-DD HH:mm" 文字列も
// TIME 扱いにする（旧 GAS シリアライズで残った "1899-12-30T05:50:00.000Z" 等の救済。
// "1899-12-30" 単体の date は誤判定したくないので時刻成分を必須にする）。
const SERIAL_BASE_DATE_TIME_RE = /^1899-12-30[T ]\d{2}:\d{2}/;

/**
 * dataStore.listEntries で得た entries を AlaSQL に渡す行配列に変換する。
 * 列名は AlaSQL 安全なキー（パイプを __ に変換）を使用。
 *
 * フォーム schema 由来の列型情報 (typeMap) を受け取り、保存されている値を
 * 列型に合わせて正規化する（＝「alasql にはフィールド型に合った形式で渡す」）：
 *   - "number": 文字列 → Number（旧データ救済）。空白/null/NaN → null。
 *   - "date": ""/null/undefined → null。それ以外は formatCanonical(v, "date")
 *               で "YYYY/MM/DD" に整形（旧データの ISO / スペース区切り等も吸収）。
 *   - "time": 同様に formatCanonical(v, "time") で "HH:mm:ss.SSS" に整形。
 *   - createdAt / modifiedAt / deletedAt（DATETIME 型）: formatCanonical(v, "datetime")
 *               で "YYYY/MM/DD HH:mm:ss.SSS" に整形（日付はスラッシュ、日付↔時刻は半角スペース）。
 *   - その他 / typeMap 未指定: 値を素通し。
 * canonical 文字列は辞書順 = 時系列順なので AlaSQL の MIN/MAX や `<` `>` `=` がそのまま機能する。
 *
 * 送信時 (collect.js) に既に Number 化されているため typeMap がなくても基本動作するが、
 * 旧データの文字列値混入や、SQL モードで複数フォームを跨ぐケースの安全網になる。
 *
 * typeMap が渡されたときは、まず typeMap の全キー（= フォーム schema の全データ列、
 * 挿入順 = schema 順）を null で初期化してから data / メタ列を上書きする。これにより
 * 回答が無いフィールドでも全行が同じ列を持ち、`SELECT *` が schema の全列を返す。
 *
 * @param {Array} entries
 * @param {object} [options]
 * @param {Map<string, string>} [options.typeMap] - AlaSQL safe key → 列型 ("number"|"date"|"string"|"boolean"|"unknown") のマップ
 */
export function entriesToAlaSqlRows(entries, options = {}) {
  const typeMap = options.typeMap || null;
  if (!Array.isArray(entries) || entries.length === 0) return [];
  return entries.map((entry, idx) => {
    const row = {};
    if (typeMap) {
      // boolean 列（choice 系の選択肢列）は未回答行でも false で埋める。
      // それ以外は null（SELECT * が schema の全列を返すための pre-seed）。
      for (const k of typeMap.keys()) row[k] = typeMap.get(k) === "boolean" ? false : null;
    }
    const data = (entry && typeof entry.data === "object") ? entry.data : {};
    for (const k of Object.keys(data)) {
      const safeKey = headerKeyToAlaSqlKey(k);
      let v = data[k];
      const colType = typeMap ? typeMap.get(safeKey) : null;
      if (colType === "number") {
        if (typeof v !== "number") {
          if (v === "" || v == null) {
            v = null;
          } else {
            const n = Number(v);
            v = Number.isFinite(n) ? n : null;
          }
        } else if (!Number.isFinite(v)) {
          v = null;
        }
      } else if (colType === "date") {
        // analytics の "date" 列型は date / datetime / time フィールドをまとめて指す。
        // 時刻のみ文字列（"HH:mm:ss"）は TIME として、それ以外（"YYYY-MM-DD" / 日時 / Date /
        // unix ms）は DATE として canonical 化し「型に合った形式」で alasql に渡す。
        if (v === "" || v == null) {
          v = null;
        } else {
          const trimmed = typeof v === "string" ? v.trim() : v;
          const isTime = typeof trimmed === "string"
            && (TIME_ONLY_ROW_RE.test(trimmed) || SERIAL_BASE_DATE_TIME_RE.test(trimmed));
          v = formatCanonical(v, isTime ? "time" : "date") ?? null;
        }
      } else if (colType === "boolean") {
        // スプレッドシートの選択肢マーカー（`●`/1/true）→ true、それ以外（空白/0/null）→ false。
        v = isChoiceMarkerValue(v);
      }
      row[safeKey] = v;
    }
    row.id = entry?.id || "";
    row["No_"] = entry?.["No."] ?? "";
    // createdAt / modifiedAt / deletedAt は DATETIME 型 = canonical 文字列
    // "YYYY/MM/DD HH:mm:ss.SSS"。`*UnixMs` シムより文字列を優先する。
    // 旧データ（ハイフン/`_` / ISO `Z` 付き）も formatCanonical でスラッシュ形式に寄せる。
    row.createdAt = formatCanonical(entry?.createdAt, "datetime") ?? null;
    row.modifiedAt = formatCanonical(entry?.modifiedAt, "datetime") ?? null;
    row.deletedAt = formatCanonical(entry?.deletedAt, "datetime") ?? null;
    row.createdBy = entry?.createdBy ?? "";
    row.modifiedBy = entry?.modifiedBy ?? "";
    row.deletedBy = entry?.deletedBy ?? "";
    row._row = idx + 1;
    return row;
  });
}

// alias ごとの利用カウント。並列実行されるカードが同じ alias を共有しても、
// 最後の利用者が dropTables するまでテーブルが残るようにするため。
const tableRefCounts = new Map();

// 元レコードテーブルの React メモリキャッシュ（IndexedDB ではない）。
// key = `${formId}|${variant}`（variant: "data" | "view"）、value = { rows, ts }。
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

// 削除済みエントリを除外する（data / view 共通）。
function filterNotDeleted_(entries) {
  return (entries || []).filter((e) => {
    const deleted = e?.deletedAtUnixMs ?? e?.deletedAt;
    return !(deleted && deleted !== "" && deleted !== 0);
  });
}

/**
 * フォームを AlaSQL インメモリテーブルとして登録する。
 * dataStore.listEntries で最新のメモリ常駐 records を取り出し、削除済みを除外して登録する。
 * 同一 alias で複数回呼ぶと内部リファレンスカウントが増える。dropTables で同じ回数 decrement されるまでテーブルは破棄されない。
 * @param {string} alias - テーブル名
 * @param {string} formId
 * @param {object} [options]
 * @param {Map<string, string>} [options.typeMap] - 列の AlaSQL safe key → 列型 のマップ（entriesToAlaSqlRows へ素通し）
 */
export async function registerFormAsTable(alias, formId, options = {}) {
  if (!alias) throw new Error("alias is required");
  if (!formId) throw new Error("formId is required");
  const alasql = await getAlaSql();
  // 元レコードテーブルは formId|data 単位でキャッシュ（TTL 内はサーバ同期も行変換もスキップ）。
  const cacheKey = formId + "|data";
  let rows = getCachedSourceRows_(cacheKey);
  if (!rows) {
    const result = await dataStore.listEntries(formId);
    const entries = filterNotDeleted_(result?.entries);
    rows = entriesToAlaSqlRows(entries, { typeMap: options.typeMap });
    sourceTableCache.set(cacheKey, { rows, ts: Date.now() });
  }
  // 既に同一 alias で登録済みなら参照カウントだけ進めて rows は使い回す。
  // 同じテーブルに別 alias を貼る場合（data_<id> と form_<id> など）の追加登録は
  // 呼び出し側で aliasAlsoAs を渡してこの関数で一括処理する。
  // 登録は slice() コピーで行い、applyGlobalWhereToTables 等の table.data 再代入から
  // キャッシュ配列（pristine rows）を保護する。
  alasql.tables[alias] = { data: rows.slice() };
  tableRefCounts.set(alias, (tableRefCounts.get(alias) || 0) + 1);
  if (Array.isArray(options.aliasAlsoAs)) {
    for (const extra of options.aliasAlsoAs) {
      if (!extra || extra === alias) continue;
      alasql.tables[extra] = { data: rows.slice() };
      tableRefCounts.set(extra, (tableRefCounts.get(extra) || 0) + 1);
    }
  }
}

/**
 * 検索結果一覧 (view) 形式でフォームを AlaSQL に登録する。
 * dataStore.listEntries で取得した entries を entriesToViewTableRows で整形して登録する。
 *
 * @param {string} alias - テーブル名（通常 canonicalViewAlias の出力）
 * @param {string} formId
 * @param {object} form - スキーマ走査用フォーム本体（必須：radio/checkbox の整形に使う）
 */
export async function registerFormViewAsTable(alias, formId, form) {
  if (!alias) throw new Error("alias is required");
  if (!formId) throw new Error("formId is required");
  const alasql = await getAlaSql();
  // 元レコードテーブルは formId|view 単位でキャッシュ（TTL 内はサーバ同期も行変換もスキップ）。
  const cacheKey = formId + "|view";
  let rows = getCachedSourceRows_(cacheKey);
  if (!rows) {
    const result = await dataStore.listEntries(formId);
    const entries = filterNotDeleted_(result?.entries);
    rows = entriesToViewTableRows(entries, form);
    sourceTableCache.set(cacheKey, { rows, ts: Date.now() });
  }
  // slice() コピーで登録し、フィルタの table.data 再代入からキャッシュを保護する。
  alasql.tables[alias] = { data: rows.slice() };
  tableRefCounts.set(alias, (tableRefCounts.get(alias) || 0) + 1);
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
 * @param {object} [options]
 * @param {"data"|"view"} [options.variant] - 指定時、その variant のテーブルにのみ適用する。
 *   "view" は alias が `view_` で始まるテーブル、"data" はそれ以外（data_ / legacy / SQL モード）。
 *   未指定なら全テーブルに適用（後方互換）。variant 不一致のテーブルは素通し（フィルタ未適用）。
 * @returns {Promise<{ ok: boolean, error?: string }>} 構文エラーは ok:false を返す（呼び出し側でエラー表示）
 */
export async function applyGlobalWhereToTables(aliases, whereExpr, { variant } = {}) {
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
    if (variant === "view" && !alias.startsWith("view_")) continue;
    if (variant === "data" && alias.startsWith("view_")) continue;
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
