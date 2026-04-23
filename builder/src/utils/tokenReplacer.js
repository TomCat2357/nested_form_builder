/**
 * フロントエンド向けテンプレートトークン置換エンジン
 *
 * バックエンド gas/driveTemplate.gs の nfbResolveTemplateTokens_ と同等のロジックを
 * 提供する薄膜ラッパー。純粋計算 (変換関数・スキャナ・条件式評価) は
 * gas/pipeEngine.js に共有されており、フロント/バックで結果が一致することを
 * 構造的に保証する。
 *
 * 予約トークン (@ プレフィックス必須):
 *   {@_id}          レコードID
 *   {@_NOW}         現在日時 ("yyyy-MM-dd HH:mm:ss")。{@_NOW|time:YYYY年MM月DD日} 可
 *   {@_record_url}  レコード URL
 *   {@_form_url}    フォーム URL
 *
 * fileUpload 欄ごとの参照:
 *   {@<欄>}             カンマ区切りファイル名 (既定)
 *   {@<欄>|file_names}  カンマ区切りファイル名
 *   {@<欄>|file_urls}   カンマ区切りファイル URL
 *   {@<欄>|folder_name} 保存フォルダ名
 *   {@<欄>|folder_url}  保存フォルダ URL
 *
 * @ 参照:
 *   {@フィールドラベル}       該当フィールドの現在の値
 *   {@フィールドラベル|upper} パイプ変換付き
 *   {\フィールドラベル}       予約名と衝突するラベルの強制フィールド参照
 *   {フィールドラベル}        @ も \ もなしはトークン解決されず空文字
 *
 * サブテンプレート・{_}/{@_} パイプ値参照も共有エンジン経由でサポート。
 */

import pipeEngine from "../../../gas/pipeEngine.js";

const {
  scanBalancedTokens,
  templateValueToString,
  formatNowLocal,
  evaluateToken,
} = pipeEngine;

// ---------------------------------------------------------------------------
// Reserved tokens (frontend version — GAS 側と同一の 4 種)
// ---------------------------------------------------------------------------

const RESERVED_TOKENS = new Set(["_id", "_NOW", "_record_url", "_form_url"]);

const resolveReservedToken = (tokenName, context) => {
  if (tokenName === "_id") return context.recordId || "";
  if (tokenName === "_NOW") return formatNowLocal(context.now || new Date());
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
    map[label] = templateValueToString(value);
  }
  return map;
};

// ---------------------------------------------------------------------------
// @ 参照の解決: 予約トークン優先 → labelValueMap フォールバック
// ---------------------------------------------------------------------------

const resolveRef = (name, ctx) => {
  const reserved = resolveReservedToken(name, ctx);
  if (reserved !== null) return reserved;
  const map = ctx.labelValueMap || {};
  return Object.prototype.hasOwnProperty.call(map, name) ? map[name] : "";
};

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

const ESC_OPEN = "__NFB_ESC_OB__";
const ESC_CLOSE = "__NFB_ESC_CB__";

const resolveTokensInternal = (template, context, pipeValue) => {
  if (!template || typeof template !== "string") return template || "";
  if (!template.includes("{")) return template;

  const ctx = context || {};
  const fileUploadMetaByLabel = buildFileUploadMetaByLabel(ctx);
  const hasPipeValue = pipeValue !== undefined;

  const src = template.split("\\{").join(ESC_OPEN).split("\\}").join(ESC_CLOSE);

  const replaced = scanBalancedTokens(src, (tokenBody) => {
    const body = tokenBody || "";
    const fieldPart = detectFieldPart(body);
    const currentFieldMeta = fieldPart ? (fileUploadMetaByLabel[fieldPart] || null) : null;
    const evalCtx = bindPipeCallbacks(ctx, currentFieldMeta, pipeValue);
    const res = evaluateToken(body, evalCtx);
    if (res.ok) return res.value;
    if (typeof console !== "undefined" && typeof console.warn === "function") {
      console.warn("[nfb template]", res.error.message, "in", JSON.stringify("{" + body + "}"));
    }
    return res.fallback;
  });

  return replaced.split(ESC_OPEN).join("{").split(ESC_CLOSE).join("}");
};

/**
 * Extract the leading `@<label>` (unquoted) from a token body so the adapter
 * can bind fileUpload meta for `|file_urls` / `|folder_url` pipes. Returns
 * null if the body doesn't start with a simple `@label`.
 */
const detectFieldPart = (body) => {
  if (!body || body.charAt(0) !== "@") return null;
  let i = 1;
  if (body.charAt(i) === "\"" || body.charAt(i) === "'") {
    const quote = body.charAt(i);
    i++;
    let out = "";
    while (i < body.length && body.charAt(i) !== quote) {
      if (body.charAt(i) === "\\" && i + 1 < body.length) { out += body.charAt(i + 1); i += 2; continue; }
      out += body.charAt(i);
      i++;
    }
    return out || null;
  }
  const terminators = new Set(["+", "|", "{", "}", ",", ":", " ", "\t", "\n", "\r"]);
  let out = "";
  while (i < body.length && !terminators.has(body.charAt(i))) {
    if (body.charAt(i) === "\\" && i + 1 < body.length) { out += body.charAt(i + 1); i += 2; continue; }
    out += body.charAt(i);
    i++;
  }
  return out || null;
};

/**
 * pipeEngine に渡すコンテキストに resolveRef / resolveTemplate コールバックを
 * バインドする。if 条件式・値位置・サブテンプレート再帰から呼ばれる。
 */
const bindPipeCallbacks = (ctx, currentFieldMeta, pipeValue) => {
  const bound = { ...ctx };
  bound.resolveRef = (name) => resolveRef(name, ctx);
  bound.resolveTemplate = (subTemplate, subPipeValue) =>
    resolveTokensInternal(subTemplate, ctx, subPipeValue);
  if (currentFieldMeta) bound.currentFieldMeta = currentFieldMeta;
  if (pipeValue !== undefined) bound.__pipeValue__ = pipeValue;
  return bound;
};

/**
 * テンプレートトークンを解決する
 *
 * @param {string} template
 * @param {{
 *   now?: Date,
 *   recordId?: string,
 *   recordUrl?: string,
 *   formUrl?: string,
 *   labelValueMap?: Object,
 *   fieldLabels?: Object,
 *   fileUploadMeta?: Object,
 * }} context
 * @returns {string}
 */
export const resolveTemplateTokens = (template, context) => {
  return resolveTokensInternal(template, context, undefined);
};
