/**
 * フロントエンド向けテンプレートトークン置換エンジン (アダプタ層)
 *
 * 純粋計算 (変換関数・スキャナ・条件式評価・ラベル値マップ構築・エスケープ処理
 * ・オーケストレーション) は gas/pipeEngine.js に集約されており、GAS バック
 * エンド (gas/driveTemplate.gs) と結果が一致することを構造的に保証する。この
 * アダプタはフロント固有のもの (Date ベースの _NOW、console.warn ログ、React
 * コンポーネントが渡す context 形状) のみを担う。
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
 */

import pipeEngine from "../../../gas/pipeEngine.js";

const {
  buildFileUploadMetaByLabel,
  buildLabelValueMap: sharedBuildLabelValueMap,
  formatNowLocal,
  resolveTemplate,
} = pipeEngine;

// ---------------------------------------------------------------------------
// Reserved tokens (frontend 版 — GAS と同じ 4 種、_NOW だけ formatNowLocal)
// ---------------------------------------------------------------------------

const resolveReservedToken = (tokenName, context) => {
  if (tokenName === "_id") return context.recordId || "";
  if (tokenName === "_NOW") return formatNowLocal(context.now || new Date());
  if (tokenName === "_record_url") return context.recordUrl || "";
  if (tokenName === "_form_url") return context.formUrl || "";
  return null;
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * fieldLabels + fieldValues + responses から { label: 表示用文字列 } マップを構築。
 * GAS 側の hideFileExtension は使わない (フロントは fieldValues 経由で整形済み)。
 */
export const buildLabelValueMap = (fieldLabels, fieldValues, responses) =>
  sharedBuildLabelValueMap(fieldLabels, fieldValues, responses);

const logTemplateError = (error, fullToken) => {
  if (typeof console !== "undefined" && typeof console.warn === "function") {
    console.warn("[nfb template]", error.message, "in", JSON.stringify(fullToken));
  }
};

/**
 * pipeEngine に渡すコンテキストに resolveRef / resolveTemplate コールバックを
 * バインドする。if 条件式・値位置・サブテンプレート再帰から呼ばれる。
 */
const bindPipeCallbacks = (ctx, pipeValue) => {
  const bound = { ...ctx };
  bound.resolveRef = (name) => {
    const reserved = resolveReservedToken(name, ctx);
    if (reserved !== null) return reserved;
    const map = ctx.labelValueMap || {};
    return Object.prototype.hasOwnProperty.call(map, name) ? map[name] : "";
  };
  bound.resolveTemplate = (subTemplate, subPipeValue) =>
    resolveTokensInternal(subTemplate, ctx, subPipeValue);
  if (pipeValue !== undefined) bound.__pipeValue__ = pipeValue;
  return bound;
};

const resolveTokensInternal = (template, context, pipeValue) => {
  if (!template || typeof template !== "string") return template || "";
  if (!template.includes("{") && !template.includes("[")) return template;

  const ctx = context || {};
  const evalContext = bindPipeCallbacks(ctx, pipeValue);
  const metaByLabel = buildFileUploadMetaByLabel(
    ctx.fieldLabels || {},
    ctx.fileUploadMeta || {},
  );
  return resolveTemplate(template, evalContext, {
    fileUploadMetaByLabel: metaByLabel,
    logError: logTemplateError,
    bracketFallbackLiteral: true,
  });
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
export const resolveTemplateTokens = (template, context) =>
  resolveTokensInternal(template, context, undefined);
