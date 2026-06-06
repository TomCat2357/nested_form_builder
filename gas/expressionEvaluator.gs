/**
 * expressionEvaluator.gs
 * GAS 側の単行式評価器 — フロントエンドと同じ alasql + 同じ UDF を使う薄いラッパー。
 *
 * 以前は alasql 互換の独自パーサ / AST 評価器を持っていたが、フロント (alasql) との
 * 二重実装を解消するため alasql 本体に統一した。
 *
 * 依存（bundle.js の FILE_ORDER で本ファイルより前に配置）:
 *   gas/vendor/alasql.min.js        — alasql 本体（グローバル `alasql`）
 *   gas/generated/nfbAlasqlUdfs.gs  — builder ESM ソースから esbuild 生成（グローバル `NfbAlasqlRuntime`）
 *                                     ensureNfbUdfsRegistered / preprocessAlaSqlExpression /
 *                                     formatCanonical / toMsUnixTime / parseJstString / formatJstString
 *
 * 公開:
 *   nfbEvaluateExpression_(expr, row)  単行式を `SELECT (<expr>) FROM ?` として評価
 *   nfbDt_formatCanonical_(v, kind)    canonical 文字列化（sheetsDatetime / sheetsRowOps / templateEvaluator 用）
 *   nfbDt_toMsUnixTime_(v)             unix ms 化
 */

// alasql + UDF の遅延初期化。GAS は 1 リクエスト 1 プロセスなので初回のみ実行される。
var NFB_ALASQL_READY_ = false;
function nfbEnsureAlasqlReady_() {
  if (NFB_ALASQL_READY_) return alasql;
  if (typeof alasql === "undefined") {
    throw new Error("alasql is not loaded — gas/vendor/alasql.min.js missing from bundle");
  }
  if (typeof NfbAlasqlRuntime === "undefined") {
    throw new Error("NfbAlasqlRuntime is not loaded — gas/generated/nfbAlasqlUdfs.gs missing from bundle (run `npm run build:gas-udfs`)");
  }
  NfbAlasqlRuntime.ensureNfbUdfsRegistered(alasql);
  NFB_ALASQL_READY_ = true;
  return alasql;
}

// 式文字列 → コンパイル済み alasql 関数のキャッシュ（プロセス内）。
var NFB_EXPR_COMPILED_ = {};
function nfbExprCompile_(rawExpr) {
  if (Object.prototype.hasOwnProperty.call(NFB_EXPR_COMPILED_, rawExpr)) {
    return NFB_EXPR_COMPILED_[rawExpr];
  }
  var aq = nfbEnsureAlasqlReady_();
  var prepared = NfbAlasqlRuntime.preprocessAlaSqlExpression(rawExpr);
  var sql = "SELECT (" + prepared + ") AS __r FROM ? AS r";
  var fn = aq.compile(sql);
  NFB_EXPR_COMPILED_[rawExpr] = fn;
  return fn;
}

// 行キー（"/" 連結・legacy "|" も受理）を `__` に寄せる（フロント headerKeyToAlaSqlKey と同じ。冪等）。
function nfbExprNormalizeRowKeys_(row) {
  if (!row || typeof row !== "object") return {};
  var out = {};
  for (var k in row) {
    if (Object.prototype.hasOwnProperty.call(row, k)) {
      out[Nfb_headerKeyToAlaSqlKey_(String(k))] = row[k];
    }
  }
  return out;
}

/**
 * 単行式を評価する。row はキー → 値の平坦オブジェクト。
 * 構文エラー / 関数エラーは throw する（呼び出し側でキャッチ）。
 */
function nfbEvaluateExpression_(expr, row) {
  if (expr === null || expr === undefined) return null;
  var s = String(expr);
  if (!s) return null;
  var fn = nfbExprCompile_(s);
  var rows = fn([[nfbExprNormalizeRowKeys_(row)]]);
  if (rows && rows.length > 0 && rows[0] && typeof rows[0] === "object") return rows[0].__r;
  return undefined;
}

// ── 日付ユーティリティ（旧 nfbDt_* 群の置き換え。bundle 内 dateTime.js に委譲） ──
function nfbDt_formatCanonical_(v, kind) {
  if (typeof NfbAlasqlRuntime === "undefined") return null;
  return NfbAlasqlRuntime.formatCanonical(v, kind);
}
function nfbDt_toMsUnixTime_(v) {
  if (typeof NfbAlasqlRuntime === "undefined") return null;
  return NfbAlasqlRuntime.toMsUnixTime(v);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    evaluate: nfbEvaluateExpression_,
    ensureReady: nfbEnsureAlasqlReady_
  };
}
