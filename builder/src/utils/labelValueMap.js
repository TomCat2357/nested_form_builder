/**
 * フィールドフルパス (`親|子|孫`) → 表示用文字列 / fileUploadMeta 行エントリへの
 * 変換ヘルパ。
 *
 * トップレベル質問は path = leaf label と同値なので従来 `` {`項目名`} `` 構文で
 * 解決される。ネストされた子質問は `親|子` フルパス必須 (葉ラベル単独参照は
 * 廃止)。
 *
 * 新エンジン (alasql 式) は `row[path] = [...]` 形式の配列値を要求するため
 * buildFileUploadRowEntries も併せて提供する。
 */

import { asPlainObject } from "./objectShape.js";

/**
 * 配列内の `{ name }` オブジェクトは name で文字列化する。
 */
export function templateValueToString(value) {
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
 * `{ fid: fullPath }` + `{ fid: meta }` から `{ fullPath: [行エントリ] }` を
 * 構築する。alasql エンジンの FILE_NAMES / FILE_URLS / FOLDER_NAME / FOLDER_URL
 * UDF が `row[fullPath]` を配列として読むので、各 fileUpload meta から
 * `{ name, driveFileUrl, folderName, folderUrl }` 形の配列を作って返す。
 *
 * meta の典型形:
 *   { fileNames: [...], fileUrls: [...], folderName, folderUrl, hideFileExtension }
 *
 * fileNames が無く `responses[fid]` から拾う必要がある場合は呼び出し側で
 * 補完する（このユーティリティは meta 単独のパスのみを担う）。
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
    const names = Array.isArray(meta.fileNames) ? meta.fileNames : [];
    const urls = Array.isArray(meta.fileUrls) ? meta.fileUrls : [];
    const folderName = meta.folderName || "";
    const folderUrl = meta.folderUrl || "";
    const length = Math.max(names.length, urls.length, (folderName || folderUrl) ? 1 : 0);
    if (length === 0) continue;
    const entries = [];
    for (let i = 0; i < length; i++) {
      entries.push({
        name: names[i] || "",
        driveFileUrl: urls[i] || "",
        folderName,
        folderUrl,
      });
    }
    out[path] = entries;
  }
  return out;
}
