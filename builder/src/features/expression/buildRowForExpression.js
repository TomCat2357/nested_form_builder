/**
 * 任意のオブジェクトから、alasql 式評価器に渡せる row オブジェクトを構築する。
 *
 * - キーは `headerKeyToAlaSqlKey` を通して `__` 化（パイプ列名対応）
 * - 値はそのまま（後段の UDF が型を吸収する）
 * - `fixed` パラメータで予約キー（_id / _record_url / _form_url など）を上書き可能
 * - 現在時刻は alasql UDF `NOW()` で取得する（行に注入しない）
 */
import { headerKeyToAlaSqlKey } from "../analytics/utils/headerToAlaSqlKey.js";

export function buildRowForExpression(source, fixed) {
  const row = {};
  if (source && typeof source === "object") {
    for (const key of Object.keys(source)) {
      if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
      const safeKey = headerKeyToAlaSqlKey(key);
      row[safeKey] = source[key];
    }
  }
  if (fixed && typeof fixed === "object") {
    for (const key of Object.keys(fixed)) {
      const safeKey = headerKeyToAlaSqlKey(key);
      row[safeKey] = fixed[key];
    }
  }
  return row;
}
