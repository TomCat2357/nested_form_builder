/**
 * フィールドフルパス (`親|子|孫`) → 表示用文字列 / fileUploadMeta 行エントリへの
 * 変換ヘルパ。
 *
 * トップレベル質問は path = leaf label と同値なので従来 `` {`項目名`} `` 構文で
 * 解決される。ネストされた子質問は `親|子` フルパス必須 (葉ラベル単独参照は
 * 廃止)。
 *
 * fileUpload 項目は統一契約で `row[path] = 保存 JSON 文字列` を要求するため
 * buildFileUploadRowEntries も併せて提供する（素参照=JSON、FILE_NAMES / FOLDER_URL
 * などの UDF がこの文字列を parse する）。
 */

import { asPlainObject } from "./objectShape.js";

/**
 * 配列内の `{ name }` オブジェクトは name で文字列化する。
 */
function templateValueToString(value) {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) {
    const parts = [];
    for (let i = 0; i < value.length; i++) {
      const item = value[i];
      if (item === undefined || item === null) continue;
      if (typeof item === "object" && item.name) {
        parts.push(String(item.name));
      } else {
        parts.push(String(item));
      }
    }
    return parts.join(", ");
  }
  if (typeof value === "object") {
    if (value.name) return String(value.name);
    try { return JSON.stringify(value); } catch (_e) { return ""; }
  }
  return String(value);
}

/**
 * `{ fid: fullPath }` + `{ fid: 表示用文字列 }` + `{ fid: rawValue }` から
 * `{ fullPath: 表示用文字列 }` を構築する。fieldValues がある fid は fieldValues
 * を優先、無ければ responses から文字列化する。
 */
export function buildLabelValueMap(fieldPaths, fieldValues, responses) {
  const paths = asPlainObject(fieldPaths);
  const values = asPlainObject(fieldValues);
  const resp = asPlainObject(responses);
  const map = {};
  for (const fid in paths) {
    if (!Object.prototype.hasOwnProperty.call(paths, fid)) continue;
    const path = paths[fid];
    if (!path) continue;
    const fromFieldValues = Object.prototype.hasOwnProperty.call(values, fid);
    const raw = fromFieldValues ? values[fid] : resp[fid];
    map[path] = templateValueToString(raw);
  }
  return map;
}

/**
 * `{ fid: fullPath }` + `{ fid: meta }` から `{ fullPath: 保存 JSON 文字列 }` を
 * 構築する。統一契約: fileUpload の行値は全経路で「保存 JSON 文字列」
 * （serializeFileUploadValue の出力）に統一する。素の参照 `{{`項目名`}}` はこの文字列
 * （= JSON）をそのまま返し、FILE_NAMES / FILE_URLS / FOLDER_NAME / FOLDER_URL UDF が
 * これを parse して各パーツを取り出す。
 *
 * meta.storageValue（collectFileUploadMeta が serializeFileUploadValue で用意）を
 * そのまま path に載せる。空文字は載せない（`collectResponses` が空 fileUpload パスを
 * 省くのと一致させ、view 行＝保存文字列 と完全一致させる）。
 */
export function buildFileUploadRowEntries(fieldPaths, fileUploadMeta) {
  const paths = asPlainObject(fieldPaths);
  const metaByFid = asPlainObject(fileUploadMeta);
  const out = {};
  for (const fid in paths) {
    if (!Object.prototype.hasOwnProperty.call(paths, fid)) continue;
    const path = paths[fid];
    if (!path) continue;
    const meta = metaByFid[fid];
    if (!meta) continue;
    const storageValue = typeof meta.storageValue === "string" ? meta.storageValue : "";
    if (!storageValue) continue;
    out[path] = storageValue;
  }
  return out;
}

/**
 * `{ fid: fullPath }` + `{ fid: childObj }` から `{ fullPath: childObj }` を構築する。
 * CHILD_FORM_NAME / CHILD_FORM_ID / CHILD_FORM_URL / CHILD_FORM_COUNT UDF が
 * `row[fullPath]` を合成オブジェクト（{ childFormId, childFormName, childFormUrl,
 * count, records }）として読むので、formLink 項目のパスにそのまま載せる。
 */
export function buildChildFormRowEntries(fieldPaths, childFormMeta) {
  const paths = asPlainObject(fieldPaths);
  const metaByFid = asPlainObject(childFormMeta);
  const out = {};
  for (const fid in paths) {
    if (!Object.prototype.hasOwnProperty.call(paths, fid)) continue;
    const path = paths[fid];
    if (!path) continue;
    const obj = metaByFid[fid];
    if (!obj || typeof obj !== "object") continue;
    out[path] = obj;
  }
  return out;
}
