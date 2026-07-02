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

// --- テンプレートスキャナ / 文字列化（gas/templateEvaluator.gs の nfbTpl* デリゲート先） ---
export {
  scanAndReplace,
  collectBalancedBraces,
  splitTopLevelCommas,
  isFullQueryBody,
  escapeBraces,
  unescapeBraces,
} from "./templateScanner.js";
export { coerceResultToString } from "./coerceResultToString.js";

// --- パスコーデック（gas/pathCodec.gs の Nfb_* デリゲート先） ---
export {
  escapeSegment,
  joinEscaped,
  splitEscaped,
  joinFieldPath,
  splitFieldPath,
  splitFieldKey,
} from "../../utils/pathCodec.js";
export { headerKeyToAlaSqlKey } from "../analytics/utils/headerToAlaSqlKey.js";

// --- ULID（gas/constants.gs の Nfb_encodeUlid* / Nfb_generateUlid_ デリゲート先） ---
export {
  encodeUlidTime,
  encodeUlidRandom,
  incrementBase32,
  createUlid,
  ULID_ALPHABET,
  ULID_RANDOM_LENGTH,
} from "../../core/ids.js";

// --- スキーマ走査（gas/schemaUtils.gs の nfb* walkers デリゲート先） ---
export { resolveOrderedChildKeys, traverseSchema, mapSchema } from "../../core/schemaUtils.js";
export { fieldHasValue, shouldShowUnconditionalChildren } from "../../core/fieldValue.js";
