/**
 * alasql ランタイムの共有取得モジュール。
 *
 * alasql は CDN ランタイムロード方式 (features/analytics/utils/cdnLoader.js) で取得する。
 * bundle に inline すると alasql ソース内の `<script>` `</head>` 等の文字列リテラルを
 * GAS HTML Service が誤パースして動かないため。
 *
 * 式評価器 (alasqlExpressionEvaluator.js) と analytics の SQL 実行 (analyticsAlaSql.js)
 * が同じ alasql インスタンスを共有し、NFB UDF の登録も一度きりにするため、ロード +
 * 登録のシングルトンをここに集約する。
 */
import { loadAlaSql } from "../analytics/utils/cdnLoader.js";
import { ensureNfbUdfsRegistered } from "./registerNfbUdfs.js";

let alaSqlReady = null;

export async function getAlaSql() {
  if (!alaSqlReady) {
    alaSqlReady = (async () => {
      const alasql = await loadAlaSql();
      ensureNfbUdfsRegistered(alasql);
      return alasql;
    })();
  }
  return alaSqlReady;
}

/**
 * テスト/開発用 — シングルトンをリセットして次回 getAlaSql() で再ロードさせる。
 */
export function _resetAlaSqlForTest() {
  alaSqlReady = null;
}
