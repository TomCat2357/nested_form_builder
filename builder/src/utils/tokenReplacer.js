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
 *   {@_record_url}  - レコード URL
 *   {@_form_url}    - フォーム URL
 *
 * fileUpload 欄ごとの参照（欄ラベル + 専用パイプ）:
 *   {@<欄>}                - カンマ区切りファイル名（既定）
 *   {@<欄>|file_names}     - カンマ区切りファイル名
 *   {@<欄>|file_urls}      - カンマ区切りファイル URL
 *   {@<欄>|folder_name}    - 保存フォルダ名
 *   {@<欄>|folder_url}     - 保存フォルダ URL
 *
 * @ 参照（予約トークン優先 → フィールド参照フォールバック）:
 *   {@フィールドラベル}           - 該当フィールドの現在の値
 *   {@フィールドラベル|upper}     - パイプ変換付き
 *   {フィールドラベル}            - @ なしはトークンとして解決されず空文字に置換される
 *
 * エスケープ:
 *   \{ → {  \} → }
 */

import { formatNow, applyPipeTransformers } from "./tokenTransformers.js";

// ---------------------------------------------------------------------------
// Reserved tokens
// ---------------------------------------------------------------------------

// _folder_url / _file_urls は廃止。fileUpload 欄ごとに `{@<欄>|folder_url}` / `|file_urls` を使う
const RESERVED_TOKENS = new Set(["_id", "_NOW", "_record_url", "_form_url"]);

const isReservedToken = (tokenName) => RESERVED_TOKENS.has(tokenName);

const resolveReservedToken = (tokenName, context) => {
  if (tokenName === "_id") return context.recordId || "";
  if (tokenName === "_NOW") return formatNow(context.now || new Date());
  if (tokenName === "_record_url") return context.recordUrl || "";
  if (tokenName === "_form_url") return context.formUrl || "";
  return null;
};

const buildFileUploadMetaByLabel = (context) => {
  const map = {};
  const fileUploadMeta = context?.fileUploadMeta || {};
  const fieldLabels = context?.fieldLabels || {};
  for (const fid of Object.keys(fileUploadMeta)) {
    const label = fieldLabels[fid];
    if (label && !map[label]) map[label] = fileUploadMeta[fid];
  }
  return map;
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
  const fileUploadMetaByLabel = buildFileUploadMetaByLabel(ctx);
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
        } else if (forceField) {
          // \ prefix: labelValueMap 強制参照（エスケープハッチ）
          resolved = (ctx.labelValueMap || {})[fieldPart] ?? "";
        } else {
          // @ なしはトークンとして解決しない
          resolved = "";
        }
        const currentFieldMeta = fileUploadMetaByLabel[fieldPart] || null;
        const pipeCtx = currentFieldMeta ? { ...ctx, currentFieldMeta } : ctx;
        return applyPipeTransformers(resolved, transformersPart, pipeCtx);
      }

      if (isRef) {
        const reservedVal = resolveReservedToken(tokenName, ctx);
        if (reservedVal !== null) return reservedVal;
        return (ctx.labelValueMap || {})[tokenName] ?? "";
      }
      if (forceField) {
        return (ctx.labelValueMap || {})[tokenName] ?? "";
      }
      return "";
    });

  return result.split(ESC_OPEN).join("{").split(ESC_CLOSE).join("}");
};
