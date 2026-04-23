/**
 * driveTemplate.gs
 * トークン解決 (GAS 固有のアダプタ層)
 *
 * 純粋計算 (変換関数・スキャナ・条件式評価・ラベル値マップ構築・エスケープ処理
 * ・オーケストレーション) は pipeEngine.js に集約。このファイルは GAS 固有の
 * 処理のみを担う:
 * - Session.getScriptTimeZone / Utilities.formatDate を使う _NOW フォーマット
 * - allowGmailOnlyTokens による _record_url / _form_url のゲート
 * - hideFileExtension 処理 (pipeEngine へ applyHideFileExtension=true で注入)
 * - Logger.log 経由のエラーログ
 */

function nfbResolveReservedTemplateToken_(tokenName, context, options) {
  var now = context && context.now ? context.now : new Date();
  var tz = Session.getScriptTimeZone();
  var recordId = context && context.recordId ? String(context.recordId).trim() : "";
  var recordUrl = context && context.recordUrl ? String(context.recordUrl).trim() : "";
  var formUrl = context && context.formUrl ? String(context.formUrl).trim() : "";
  var allowGmailOnlyTokens = options && options.allowGmailOnlyTokens === true;

  if (tokenName === "_id") return recordId;
  if (tokenName === "_NOW") return Utilities.formatDate(now, tz, "yyyy-MM-dd HH:mm:ss");
  if (tokenName === "_record_url") return allowGmailOnlyTokens ? recordUrl : "";
  if (tokenName === "_form_url") return allowGmailOnlyTokens ? formUrl : "";
  return null;
}

function nfbBuildFieldLabelValueMap_(context) {
  var ctx = nfbPlainObject_(context);
  return nfbBuildLabelValueMap_(ctx.fieldLabels, ctx.fieldValues, ctx.responses, {
    fileUploadMeta: ctx.fileUploadMeta,
    applyHideFileExtension: true
  });
}

function nfbResolveRef_(name, context) {
  var reservedValue = nfbResolveReservedTemplateToken_(name, context, { allowGmailOnlyTokens: true });
  if (reservedValue !== null) return reservedValue;
  var labelValueMap = nfbBuildFieldLabelValueMap_(context);
  return Object.prototype.hasOwnProperty.call(labelValueMap, name) ? labelValueMap[name] : "";
}

/**
 * pipeEngine に渡すコンテキストに GAS 固有のコールバックをバインドする。
 * - resolveRef: @name 解決 (if 条件・値位置)
 * - resolveTemplate: サブテンプレート {...} の再帰解決
 */
function nfbBindPipeCallbacks_(context, options) {
  var bound = {};
  var src = context || {};
  for (var k in src) {
    if (Object.prototype.hasOwnProperty.call(src, k)) bound[k] = src[k];
  }
  bound.resolveRef = function(name) { return nfbResolveRef_(name, context); };
  bound.resolveTemplate = function(valueStr, pipeValue) {
    return nfbResolveTemplateTokens_(valueStr, context, {
      allowGmailOnlyTokens: true,
      pipeValue: pipeValue
    });
  };
  var currentFieldMeta = options && options.currentFieldMeta;
  if (currentFieldMeta) bound.currentFieldMeta = currentFieldMeta;
  return bound;
}

function nfbLogTemplateError_(error, fullToken) {
  try {
    if (typeof Logger !== "undefined" && Logger && typeof Logger.log === "function") {
      Logger.log("[nfb template] " + error.message + " in \"" + fullToken + "\"");
    } else if (typeof console !== "undefined" && typeof console.warn === "function") {
      console.warn("[nfb template]", error.message, "in", fullToken);
    }
  } catch (e) {}
}

/**
 * Build the evaluation context + per-token helpers used both by
 * nfbResolveTemplateTokens_ (full-string path) and by driveOutput.gs's Google
 * Doc per-token loop.
 */
function nfbBuildTemplateEvalContext_(context, options) {
  var allowGmail = !!(options && options.allowGmailOnlyTokens === true);
  var hasPipeValue = !!(options && Object.prototype.hasOwnProperty.call(options, "pipeValue"));
  var subContext = context;
  if (hasPipeValue && options.pipeValue !== undefined) {
    var next = {};
    var src = context || {};
    for (var k in src) {
      if (Object.prototype.hasOwnProperty.call(src, k)) next[k] = src[k];
    }
    next.__pipeValue__ = options.pipeValue;
    subContext = next;
  }
  var evalContext = nfbBindPipeCallbacks_(subContext, { allowGmailOnlyTokens: allowGmail });
  var metaByLabel = nfbBuildFileUploadMetaByLabel_(
    (subContext && subContext.fieldLabels) || {},
    (subContext && subContext.fileUploadMeta) || {}
  );
  return {
    evalContext: evalContext,
    rawContext: subContext,
    fileUploadMetaByLabel: metaByLabel,
    allowGmailOnlyTokens: allowGmail
  };
}

function nfbResolveTemplateTokens_(template, context, options) {
  if (!template || typeof template !== "string") return "";
  var bundle = nfbBuildTemplateEvalContext_(context, options);
  return nfbResolveTemplate_(template, bundle.evalContext, {
    fileUploadMetaByLabel: bundle.fileUploadMetaByLabel,
    logError: nfbLogTemplateError_,
    bracketFallbackLiteral: true
  });
}
