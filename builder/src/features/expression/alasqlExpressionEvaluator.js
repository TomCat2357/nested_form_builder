/**
 * 単一レコードを暗黙コンテキストとする alasql 式の評価器。
 *
 * SELECT/FROM/WHERE/GROUP BY/SELECT を書かず、式部分だけを渡す:
 *   evalExpression("YEAR(`受付日`) = 2025", row)
 *   evalExpression("UPPER(`氏名`) || '-' || `年齢`", row)
 *
 * 内部では `SELECT (<expr>) AS v FROM ? AS r` を alasql.compile でプリコンパイルし、
 * 結果関数を式文字列キーで Map にキャッシュして同期 eval を可能にする。
 * 検索フィルタ / テンプレート展開 / 計算フィールドのホットパスで利用する想定。
 */
import { getAlaSql } from "./alasqlRuntime.js";
import { preprocessAlaSqlExpression } from "./preprocessAlaSqlExpression.js";

const compiledCache = new Map();

// 置換 `{...}` / `{{...}}` を共通 alasql エンジンで表現する中核。
// `SELECT (<expr>) AS v FROM ? AS r` の `?` には「対象レコード 1 行」を渡す。
// これは概念的に `SELECT <expr> FROM <テーブル> WHERE [id] = <対象レコード>` と等価だが、
// 全テーブルを読み込んで id で絞るより単一行を直接渡す方が高速（置換は毎レコードのホットパス）。
// `{...}` は data 表現の行、`{{...}}` は view 表現の行を渡す（テンプレ評価器が切替）— これが
// 「単一ブレース=データ / 二重ブレース=ビュー（テーブルを view モードに変えるだけ）」の実体。
// 検索（filterRowsByExpr）/ クエリー（runAlaSql）と同じ alasql 実行基盤に揃えている。
// GAS 双子 gas/expressionEvaluator.gs も同形（`SELECT (<expr>) AS __r FROM ? AS r`）。
function buildSelectSql(expr) {
  return "SELECT (" + preprocessAlaSqlExpression(expr) + ") AS v FROM ? AS r";
}

function compileFor(alasql, expr) {
  if (compiledCache.has(expr)) return compiledCache.get(expr);
  const sql = buildSelectSql(expr);
  let fn;
  try {
    fn = alasql.compile(sql);
  } catch (err) {
    const error = new Error("alasql compile failed: " + (err && err.message ? err.message : String(err)));
    error.cause = err;
    error.expr = expr;
    throw error;
  }
  const wrapper = (row) => {
    const rows = fn([[row || {}]]);
    if (Array.isArray(rows) && rows.length > 0) {
      const head = rows[0];
      if (head && typeof head === "object") return head.v;
    }
    return undefined;
  };
  compiledCache.set(expr, wrapper);
  return wrapper;
}

/**
 * 式文字列をプリコンパイルしてキャッシュ。失敗したら throw。
 * 既にキャッシュ済みなら alasql ロードを待たずに即返す。
 */
export async function compileExpression(expr) {
  if (compiledCache.has(expr)) return compiledCache.get(expr);
  const alasql = await getAlaSql();
  return compileFor(alasql, expr);
}

/**
 * 複数式を一括プリコンパイル。検索フィルタ前 / テンプレート評価前にまとめて呼ぶ。
 * 全てキャッシュ済みなら alasql ロードを待たずに早期 return する。
 */
export async function precompileExpressions(exprs) {
  if (!Array.isArray(exprs) || exprs.length === 0) return;
  const pending = exprs.filter((e) => e && !compiledCache.has(e));
  if (pending.length === 0) return;
  const alasql = await getAlaSql();
  for (const expr of pending) {
    if (compiledCache.has(expr)) continue;
    try {
      compileFor(alasql, expr);
    } catch (err) {
      // プリコンパイル時のエラーは握りつぶし、評価時に検出させる
      if (typeof console !== "undefined") {
        console.warn("[expression] precompile failed for:", expr, err && err.message);
      }
    }
  }
}

// fallback の解決を一本化（opts に fallback プロパティがあればその値、無ければ null）。
function resolveFallback_(opts) {
  return opts && Object.prototype.hasOwnProperty.call(opts, "fallback") ? opts.fallback : null;
}

// コンパイル済みラッパ関数を実行し、undefined / 例外時は fallback を返す共通評価部。
// evalExpression（async）と evalExpressionSync（sync）が共有する。
function runCompiledWithFallback_(fn, expr, row, fallback) {
  try {
    const v = fn(row);
    return v === undefined ? fallback : v;
  } catch (err) {
    if (typeof console !== "undefined") {
      console.warn("[expression] eval failed:", expr, err && err.message);
    }
    return fallback;
  }
}

/**
 * 非同期版。コンパイル + 評価。エラー時は fallback を返す。
 */
export async function evalExpression(expr, row, opts) {
  const fallback = resolveFallback_(opts);
  if (!expr) return fallback;
  let fn;
  try {
    fn = await compileExpression(expr);
  } catch (err) {
    if (typeof console !== "undefined") {
      console.warn("[expression] eval failed:", expr, err && err.message);
    }
    return fallback;
  }
  return runCompiledWithFallback_(fn, expr, row, fallback);
}

/**
 * 内部用 — 式に対する precompile 済みラッパー関数を返す。
 * 未 precompile なら null。
 */
export function getCompiledExpressionSync(expr) {
  if (!expr) return null;
  return compiledCache.get(expr) || null;
}

/**
 * 同期版。プリコンパイル済み前提で、Map から関数を引いて即評価。
 * キャッシュにない式が来たら fallback を返す（検索/テンプレ系では precompile を必ず先行）。
 */
export function evalExpressionSync(expr, row, opts) {
  const fallback = resolveFallback_(opts);
  if (!expr) return fallback;
  const fn = compiledCache.get(expr);
  if (!fn) {
    if (typeof console !== "undefined") {
      console.warn("[expression] not precompiled:", expr);
    }
    return fallback;
  }
  return runCompiledWithFallback_(fn, expr, row, fallback);
}

/**
 * テスト/開発用のキャッシュクリア。
 */
export function _clearExpressionCacheForTest() {
  compiledCache.clear();
}

/**
 * テスト用 — 任意の式に対して評価関数を直接登録する。
 * 実際の alasql ロードを必要としないユニットテストで使う。
 * wrapper の引数は row、戻り値が式の値となる。
 */
export function _registerCompiledForTest(expr, wrapper) {
  if (typeof wrapper !== "function") throw new Error("wrapper must be a function");
  compiledCache.set(expr, wrapper);
}

/**
 * デバッグ用 — alasql を強制的にロードしてから返す。
 */
export async function _getAlaSqlForTest() {
  return getAlaSql();
}
