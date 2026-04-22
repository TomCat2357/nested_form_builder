/**
 * driveTemplate.gs
 * トークン解決 (GAS 固有のアダプタ層)
 *
 * 純粋計算部分 (変換関数・スキャナ・条件式評価) は pipeEngine.js に集約。
 * このファイルは GAS 固有の機能のみを担う:
 * - Session.getScriptTimeZone / Utilities.formatDate を使う _NOW フォーマット
 * - allowGmailOnlyTokens による _record_url / _form_url のゲート
 * - fileUpload の hideFileExtension 処理
 * - pipeEngine のコールバック (resolveRef / resolveTemplate) のバインド
 */

function nfbBuildFieldLabelValueMap_(context) {
  var responses = (context && context.responses) || {};
  var fieldLabels = (context && context.fieldLabels) || {};
  var fieldValues = (context && context.fieldValues) || {};
  var fileUploadMeta = (context && context.fileUploadMeta) || {};
  var labelValueMap = {};

  for (var fid in fieldLabels) {
    if (!Object.prototype.hasOwnProperty.call(fieldLabels, fid)) continue;
    var label = fieldLabels[fid];
    if (!label || Object.prototype.hasOwnProperty.call(labelValueMap, label)) continue;
    var value = Object.prototype.hasOwnProperty.call(fieldValues, fid) ? fieldValues[fid] : responses[fid];
    var stringValue = nfbTemplateValueToString_(value);
    if (fileUploadMeta[fid] && fileUploadMeta[fid].hideFileExtension && !Object.prototype.hasOwnProperty.call(fieldValues, fid)) {
      var fileParts = stringValue.split(", ");
      for (var i = 0; i < fileParts.length; i++) {
        fileParts[i] = nfbStripFileExtension_(fileParts[i].trim());
      }
      stringValue = fileParts.join(", ");
    }
    labelValueMap[label] = stringValue;
  }

  return labelValueMap;
}

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

function nfbBuildFileUploadMetaByLabel_(context) {
  var fieldLabels = (context && context.fieldLabels) || {};
  var fileUploadMeta = (context && context.fileUploadMeta) || {};
  var out = {};
  for (var fid in fieldLabels) {
    if (!Object.prototype.hasOwnProperty.call(fieldLabels, fid)) continue;
    var label = fieldLabels[fid];
    if (!label) continue;
    if (fileUploadMeta[fid] && !Object.prototype.hasOwnProperty.call(out, label)) {
      out[label] = fileUploadMeta[fid];
    }
  }
  return out;
}

function nfbResolveFieldTemplateToken_(tokenName, context) {
  var labelValueMap = nfbBuildFieldLabelValueMap_(context);
  return Object.prototype.hasOwnProperty.call(labelValueMap, tokenName) ? labelValueMap[tokenName] : "";
}

/** @name 参照を予約トークン優先で解決 (if/ifv の条件式・値位置で使用) */
function nfbResolveRef_(name, context) {
  var reservedValue = nfbResolveReservedTemplateToken_(name, context, { allowGmailOnlyTokens: true });
  if (reservedValue !== null) return reservedValue;
  return nfbResolveFieldTemplateToken_(name, context);
}

function nfbResolveTemplateTokenValue_(tokenName, context, options) {
  var isRef = options && options.isRef === true;
  if (isRef) {
    var reservedValue = nfbResolveReservedTemplateToken_(tokenName, context, options);
    if (reservedValue !== null) return reservedValue;
    return nfbResolveFieldTemplateToken_(tokenName, context);
  }
  return "";
}

/**
 * pipeEngine に渡すコンテキストに GAS 固有のコールバックをバインドする。
 * - resolveRef: @name 解決 (if 条件・値位置)
 * - resolveTemplate: サブテンプレート {...} の再帰解決
 */
function nfbBindPipeCallbacks_(context, options) {
  var bound = Object.assign({}, context || {});
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

function nfbResolveTemplateTokens_(template, context, options) {
  if (!template || typeof template !== "string") return "";

  var escapedOpenBraceToken = "__NFB_ESCAPED_OPEN_BRACE__";
  var escapedCloseBraceToken = "__NFB_ESCAPED_CLOSE_BRACE__";
  var src = String(template)
    .replace(/\\\{/g, escapedOpenBraceToken)
    .replace(/\\\}/g, escapedCloseBraceToken);

  var allowGmail = !!(options && options.allowGmailOnlyTokens === true);
  var hasPipeValue = !!(options && Object.prototype.hasOwnProperty.call(options, "pipeValue"));
  var pipeValue = hasPipeValue ? options.pipeValue : undefined;
  var subContext = context;
  if (hasPipeValue && pipeValue !== undefined) {
    subContext = Object.assign({}, context || {}, { __pipeValue__: pipeValue });
  }
  var resolveOptions = { allowGmailOnlyTokens: allowGmail };
  if (hasPipeValue) resolveOptions.pipeValue = pipeValue;

  var result = nfbScanBalancedTokens_(src, function(tokenBody) {
    return nfbResolveOneTokenBody_(tokenBody, subContext, resolveOptions);
  });

  return result
    .split(escapedOpenBraceToken).join("{")
    .split(escapedCloseBraceToken).join("}");
}

/**
 * Resolve a single token body (contents between matching { and }).
 * Handles {_} / {@_} / {_|...} as pipe-value references when context.__pipeValue__ is set.
 */
function nfbResolveOneTokenBody_(tokenBody, context, options) {
  var rawTokenName = tokenBody || "";
  var isRef = rawTokenName.charAt(0) === "@";
  var tokenName = isRef ? rawTokenName.slice(1) : rawTokenName;
  if (!tokenName) return "";

  var pipeIndex = tokenName.indexOf("|");
  var fieldPart = pipeIndex >= 0 ? tokenName.substring(0, pipeIndex) : tokenName;
  var hasPipeCtx = context && Object.prototype.hasOwnProperty.call(context, "__pipeValue__");

  if (fieldPart === "_" && hasPipeCtx) {
    var pv = nfbTemplateValueToString_(context.__pipeValue__);
    if (pipeIndex >= 0) {
      var pipeCtxForPv = nfbBindPipeCallbacks_(context, {});
      return nfbApplyPipeTransformers_(pv, tokenName.substring(pipeIndex + 1), pipeCtxForPv);
    }
    return pv;
  }

  if (pipeIndex >= 0) {
    var transformersPart = tokenName.substring(pipeIndex + 1);
    var resolvedValue = nfbResolveTemplateTokenValue_(fieldPart, context, {
      allowGmailOnlyTokens: options && options.allowGmailOnlyTokens === true,
      isRef: isRef
    });
    var metaByLabel = nfbBuildFileUploadMetaByLabel_(context);
    var currentFieldMeta = metaByLabel[fieldPart] || null;
    var pipeContext = nfbBindPipeCallbacks_(context, { currentFieldMeta: currentFieldMeta });
    return nfbApplyPipeTransformers_(resolvedValue, transformersPart, pipeContext);
  }

  return nfbResolveTemplateTokenValue_(tokenName, context, {
    allowGmailOnlyTokens: options && options.allowGmailOnlyTokens === true,
    isRef: isRef
  });
}
