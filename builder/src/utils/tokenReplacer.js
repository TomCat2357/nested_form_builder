/**
 * フロントエンド向けテンプレートトークン置換エンジン
 *
 * バックエンド gas/driveTemplate.gs の nfbResolveTemplateTokens_ と同等のロジックを
 * フロントエンドで再現する。質問カードの項目名・選択肢・プレースホルダー等に
 * {@_id}, {@_NOW|time:YYYY年MM月DD日}, {フィールド名} などのトークンを埋め込み、
 * フォーム表示時に実際の値へ置換する。
 *
 * 予約トークン（@ プレフィックス必須）:
 *   {@_id}          - レコードID
 *   {@_NOW}         - 現在日時 ("yyyy-MM-dd HH:mm:ss")。パイプで整形可:
 *                     {@_NOW|time:YYYY年MM月DD日}  {@_NOW|time:HH時mm分}
 *   {@_folder_url}  - Driveフォルダ URL
 *   {@_record_url}  - レコード URL
 *   {@_form_url}    - フォーム URL
 *   {@_file_urls}   - アップロードファイル URL（カンマ区切り）
 *
 * @ 参照（予約トークン優先 → フィールド参照フォールバック）:
 *   {@フィールドラベル}           - 該当フィールドの現在の値
 *   {@フィールドラベル|upper}     - パイプ変換付き
 *   {フィールドラベル}            - @ なし: フィールド参照のみ（予約トークン無視）
 *
 * if条件での予約トークン:
 *   {aaa|if:@_folder_url,bbb}   - _folder_urlが存在すれば"aaa"、なければ"bbb"
 *
 * エスケープ:
 *   \{ → {  \} → }
 */

import { formatNow, applyPipeTransformers } from "./tokenTransformers.js";

// ---------------------------------------------------------------------------
// Reserved tokens
// ---------------------------------------------------------------------------

const RESERVED_TOKENS = new Set(["_id", "_NOW", "_folder_url", "_record_url", "_form_url", "_file_urls"]);

const isReservedToken = (tokenName) => RESERVED_TOKENS.has(tokenName);

const resolveReservedToken = (tokenName, context) => {
  if (tokenName === "_id") return context.recordId || "";
  if (tokenName === "_NOW") return formatNow(context.now || new Date());
  if (tokenName === "_folder_url") return context.folderUrl || "";
  if (tokenName === "_record_url") return context.recordUrl || "";
  if (tokenName === "_form_url") return context.formUrl || "";
  if (tokenName === "_file_urls") return context.fileUrls || "";
  return null;
};

// ---------------------------------------------------------------------------
// Field label → value map
// ---------------------------------------------------------------------------

const valueToString = (value) => {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) {
    return value
      .filter((v) => v !== undefined && v !== null)
      .map((v) => (typeof v === "object" && v.name ? String(v.name) : String(v)))
      .join(", ");
  }
  if (typeof value === "object") {
    if (value.name) return String(value.name);
    return JSON.stringify(value);
  }
  return String(value);
};

export const collectFileUploadFieldIds = (fields, ids) => {
  (fields || []).forEach((f) => {
    if (f?.type === "fileUpload" && f?.id) ids.add(f.id);
    if (f?.childrenByValue) Object.values(f.childrenByValue).forEach((ch) => collectFileUploadFieldIds(ch, ids));
  });
};

export const extractFileUrls = (raw) => {
  const files = Array.isArray(raw) ? raw : [];
  return files.map((f) => f?.driveFileUrl || "").filter(Boolean).join(", ");
};

/**
 * @param {Object} fieldLabels  - { fieldId: label }
 * @param {Object} fieldValues  - { fieldId: formattedValue }
 * @param {Object} responses    - { fieldId: rawValue }
 */
export const buildLabelValueMap = (fieldLabels, fieldValues, responses) => {
  const map = {};
  for (const fid of Object.keys(fieldLabels || {})) {
    const label = fieldLabels[fid];
    if (!label || Object.prototype.hasOwnProperty.call(map, label)) continue;
    const value = Object.prototype.hasOwnProperty.call(fieldValues || {}, fid)
      ? fieldValues[fid]
      : (responses || {})[fid];
    map[label] = valueToString(value);
  }
  return map;
};

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

/**
 * テンプレートトークンを解決する
 *
 * @param {string} template - トークンを含むテンプレート文字列
 * @param {{ now?: Date, recordId?: string, folderUrl?: string, recordUrl?: string, formUrl?: string, fileUrls?: string, labelValueMap?: Object }} context
 * @returns {string} 解決済みの文字列
 */
export const resolveTemplateTokens = (template, context) => {
  if (!template || typeof template !== "string") return template || "";
  if (!template.includes("{")) return template;

  const ctx = context || {};
  const ESC_OPEN = "__NFB_ESC_OB__";
  const ESC_CLOSE = "__NFB_ESC_CB__";

  const result = template
    .split("\\{").join(ESC_OPEN)
    .split("\\}").join(ESC_CLOSE)
    .replace(/\{([^{}]+)\}/g, (_match, tokenBody) => {
      const raw = tokenBody || "";
      const isRef = raw.startsWith("@");
      const forceField = raw.startsWith("\\");
      const tokenName = (isRef || forceField) ? raw.slice(1) : raw;
      if (!tokenName) return "";

      const pipeIndex = tokenName.indexOf("|");
      if (pipeIndex >= 0) {
        const fieldPart = tokenName.substring(0, pipeIndex);
        const transformersPart = tokenName.substring(pipeIndex + 1);
        let resolved;
        if (isRef) {
          // @ prefix: 予約トークン優先 → labelValueMap フォールバック
          const reservedVal = resolveReservedToken(fieldPart, ctx);
          resolved = reservedVal !== null ? reservedVal : ((ctx.labelValueMap || {})[fieldPart] ?? "");
        } else {
          // @ なし / \ prefix: labelValueMap のみ
          resolved = (ctx.labelValueMap || {})[fieldPart] ?? "";
        }
        return applyPipeTransformers(resolved, transformersPart, ctx);
      }

      if (isRef) {
        const reservedVal = resolveReservedToken(tokenName, ctx);
        if (reservedVal !== null) return reservedVal;
      }
      return (ctx.labelValueMap || {})[tokenName] ?? "";
    });

  return result.split(ESC_OPEN).join("{").split(ESC_CLOSE).join("}");
};
