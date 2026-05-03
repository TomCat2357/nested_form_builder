/**
 * AlaSQL テーブル登録・クエリ実行・クリーンアップ
 *
 * alasql は CDN ランタイムロード方式 (utils/cdnLoader.js) で取得する。
 * bundle に inline すると alasql ソース内の `<script>` `</head>` 等の
 * 文字列リテラルを GAS HTML Service が誤パースして動かないため。
 */
import { loadAlaSql } from "./utils/cdnLoader.js";
import { snapshotToRows } from "./utils/snapshotToRows.js";

// 日付列はエポック ms / Date / ISO 文字列が混在しうるため、
// SUBSTRING を直接呼ぶと数値に対して .substr が呼ばれて落ちる。
// この UDF で値型を吸収して ISO 文字列の先頭 length 文字を返す。
function registerNfbUdfs(alasql) {
  if (!alasql) return;
  alasql.fn = alasql.fn || {};
  if (alasql.fn.NFB_DATE_BIN) return;
  alasql.fn.NFB_DATE_BIN = function (value, length) {
    if (value === null || value === undefined || value === "") return null;
    var isoStr;
    if (typeof value === "number" && Number.isFinite(value)) {
      isoStr = new Date(value).toISOString();
    } else if (value instanceof Date) {
      isoStr = value.toISOString();
    } else {
      isoStr = String(value);
    }
    var n = Number(length);
    return Number.isFinite(n) && n > 0 ? isoStr.substring(0, n) : isoStr;
  };
}

let alaSqlReady = null;

async function getAlaSql() {
  if (!alaSqlReady) {
    alaSqlReady = (async () => {
      const alasql = await loadAlaSql();
      registerNfbUdfs(alasql);
      return alasql;
    })();
  }
  return alaSqlReady;
}

/**
 * スナップショットを AlaSQL インメモリテーブルとして登録する。
 * @param {string} alias - テーブル名（formSources[i].alias）
 * @param {object} snapshot - GAS から届いたスナップショット
 */
export async function registerSnapshotAsTable(alias, snapshot) {
  if (!alias) throw new Error("alias is required");
  const alasql = await getAlaSql();
  const rows = snapshotToRows(snapshot);
  alasql.tables[alias] = { data: rows };
}

/**
 * AlaSQL テーブルを削除する。
 */
export async function dropTable(alias) {
  const alasql = await getAlaSql();
  if (alasql.tables[alias]) {
    delete alasql.tables[alias];
  }
}

/**
 * 複数テーブルを一括削除する。
 */
export async function dropTables(aliases) {
  const alasql = await getAlaSql();
  for (const alias of aliases) {
    if (alasql.tables[alias]) {
      delete alasql.tables[alias];
    }
  }
}

/**
 * AlaSQL で SQL を実行して結果行配列を返す。
 * @param {string} sql
 * @returns {Promise<{ ok: boolean, rows?: any[], error?: string }>}
 */
export async function runAlaSql(sql) {
  try {
    const alasql = await getAlaSql();
    const rows = alasql(sql);
    return { ok: true, rows: Array.isArray(rows) ? rows : [] };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

/**
 * 登録済みテーブル名の一覧を返す（デバッグ用）
 */
export async function listRegisteredTables() {
  const alasql = await getAlaSql();
  return Object.keys(alasql.tables || {});
}
