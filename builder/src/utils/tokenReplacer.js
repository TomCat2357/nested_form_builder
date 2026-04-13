/**
 * フロントエンド向けテンプレートトークン置換エンジン
 *
 * バックエンド gas/drive.gs の nfbResolveTemplateTokens_ と同等のロジックを
 * フロントエンドで再現する。質問カードの項目名・選択肢・プレースホルダー等に
 * {ID}, {_NOW|time:YYYY年MM月DD日}, {フィールド名} などのトークンを埋め込み、
 * フォーム表示時に実際の値へ置換する。
 *
 * 予約トークン:
 *   {_ID}          - レコードID
 *   {_NOW}         - 現在日時 ("yyyy-MM-dd HH:mm:ss")。パイプで整形可:
 *                    {_NOW|time:YYYY年MM月DD日}  {_NOW|time:HH時mm分}
 *   {_folder_url}  - Driveフォルダ URL
 *   {_record_url}  - レコード URL
 *   {_form_url}    - フォーム URL
 *   {_file_urls}   - アップロードファイル URL（カンマ区切り）
 *
 * フィールド参照:
 *   {フィールドラベル}           - 該当フィールドの現在の値
 *   {\フィールドラベル}          - バックスラッシュで強制フィールド参照
 *   {フィールドラベル|upper}     - パイプ変換付き
 *
 * エスケープ:
 *   \{ → {  \} → }
 */

import { formatNow, applyPipeTransformers } from "./tokenTransformers.js";

// ---------------------------------------------------------------------------
// Reserved tokens
// ---------------------------------------------------------------------------

const RESERVED_TOKENS = new Set(["_ID", "_NOW", "_folder_url", "_record_url", "_form_url", "_file_urls"]);

const isReservedToken = (tokenName) => RESERVED_TOKENS.has(tokenName);

const resolveReservedToken = (tokenName, context) => {
  if (tokenName === "_ID") return context.recordId || "";
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
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
};

const collectFileUploadFieldIds = (fields, ids) => {
  (fields || []).forEach((f) => {
    if (f?.type === "fileUpload" && f?.id) ids.add(f.id);
    if (f?.childrenByValue) Object.values(f.childrenByValue).forEach((ch) => collectFileUploadFieldIds(ch, ids));
  });
};

const extractFileUrls = (raw) => {
  const files = Array.isArray(raw) ? raw : [];
  return files.map((f) => f?.driveFileUrl || "").filter(Boolean).join(", ");
};

/**
 * @param {Object} fieldLabels  - { fieldId: label }
 * @param {Object} fieldValues  - { fieldId: formattedValue }
 * @param {Object} responses    - { fieldId: rawValue }
 * @param {Array}  [schema]     - フォームスキーマ（fileUpload URL 解決用）
 */
export const buildLabelValueMap = (fieldLabels, fieldValues, responses, schema) => {
  const fileUploadIds = new Set();
  if (schema) collectFileUploadFieldIds(schema, fileUploadIds);

  const map = {};
  for (const fid of Object.keys(fieldLabels || {})) {
    const label = fieldLabels[fid];
    if (!label || Object.prototype.hasOwnProperty.call(map, label)) continue;
    if (fileUploadIds.has(fid)) {
      if (Object.prototype.hasOwnProperty.call(fieldValues || {}, fid)) {
        map[label] = valueToString(fieldValues[fid]);
      } else {
        map[label] = extractFileUrls((responses || {})[fid]);
      }
    } else {
      const value = Object.prototype.hasOwnProperty.call(fieldValues || {}, fid)
        ? fieldValues[fid]
        : (responses || {})[fid];
      map[label] = valueToString(value);
    }
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
      const forceField = raw.startsWith("\\") || raw.startsWith("@");
      const tokenName = forceField ? raw.slice(1) : raw;
      if (!tokenName) return "";

      const pipeIndex = tokenName.indexOf("|");
      if (pipeIndex >= 0) {
        const fieldPart = tokenName.substring(0, pipeIndex);
        const transformersPart = tokenName.substring(pipeIndex + 1);
        let resolved;
        if (!forceField) {
          const reservedVal = resolveReservedToken(fieldPart, ctx);
          resolved = reservedVal !== null ? reservedVal : ((ctx.labelValueMap || {})[fieldPart] ?? "");
        } else {
          resolved = (ctx.labelValueMap || {})[fieldPart] ?? "";
        }
        return applyPipeTransformers(resolved, transformersPart, ctx);
      }

      if (!forceField) {
        const reservedVal = resolveReservedToken(tokenName, ctx);
        if (reservedVal !== null) return reservedVal;
      }
      return (ctx.labelValueMap || {})[tokenName] ?? "";
    });

  return result.split(ESC_OPEN).join("{").split(ESC_CLOSE).join("}");
};
