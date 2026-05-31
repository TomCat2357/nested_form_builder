/**
 * GAS ランタイム用エントリ。esbuild で `gas/generated/nfbAlasqlUdfs.gs` に IIFE バンドルされ、
 * GAS 側 (Bundle.gs) で `NfbAlasqlRuntime.*` として参照される。
 *
 * フロントエンドと GAS で「同じ alasql + 同じ UDF + 同じ日付ユーティリティ」を共有するための
 * 単一ソース。GAS 側の独自式評価器・独自 nfbDt_* 群は廃止し、すべてここに集約する。
 */
export { ensureNfbUdfsRegistered } from "./registerNfbUdfs.js";
export { preprocessAlaSqlExpression } from "./preprocessAlaSqlExpression.js";
export {
  formatCanonical,
  toMsUnixTime,
  parseJstString,
  formatJstString,
} from "../../utils/dateTime.js";
export { joinMultiValue, splitMultiValue, MULTI_VALUE_SEP } from "../../utils/multiValue.js";
