/**
 * driveTemplate.gs
 * テンプレートトークン解決・パイプ変換システム
 */

function nfbTemplateValueToString_(value) {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) {
    var parts = [];
    for (var i = 0; i < value.length; i++) {
      if (value[i] === undefined || value[i] === null) continue;
      if (typeof value[i] === "object" && value[i].name) {
        parts.push(String(value[i].name));
      } else {
        parts.push(String(value[i]));
      }
    }
    return parts.join(", ");
  }
  if (typeof value === "object") {
    if (value.name) return String(value.name);
    return JSON.stringify(value);
  }
  return String(value);
}

function nfbStripFileExtension_(name) {
  if (!name || typeof name !== "string") return name || "";
  var dotIndex = name.lastIndexOf(".");
  return dotIndex > 0 ? name.substring(0, dotIndex) : name;
}

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

function nfbResolveTemplateTokenValue_(tokenName, context, options) {
  var isRef = options && options.isRef === true;
  if (isRef) {
    // @ prefix: 予約トークン優先 → フィールド参照フォールバック
    var reservedValue = nfbResolveReservedTemplateToken_(tokenName, context, options);
    if (reservedValue !== null) return reservedValue;
    return nfbResolveFieldTemplateToken_(tokenName, context);
  }
  // @ なし: トークンとして解決しない（空文字を返す）
  return "";
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
 * Given the index of a "{" in text, return the index of its matching "}",
 * tracking nested braces. Returns -1 if the brace is never closed.
 */
function nfbFindBalancedCloseIndex_(text, openIndex) {
  var n = text.length;
  var depth = 1;
  var j = openIndex + 1;
  while (j < n && depth > 0) {
    var c = text.charAt(j);
    if (c === "{") {
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0) return j;
    }
    j++;
  }
  return -1;
}

/**
 * Scan a template string and replace each balanced {...} token via the replacer.
 * Supports nested braces (inner {...} are passed as part of the body, not stripped).
 * Unclosed braces are left literal.
 */
function nfbScanBalancedTokens_(text, replacer) {
  var out = "";
  var i = 0;
  var n = text.length;
  while (i < n) {
    var ch = text.charAt(i);
    if (ch !== "{") {
      out += ch;
      i++;
      continue;
    }
    var close = nfbFindBalancedCloseIndex_(text, i);
    if (close < 0) {
      out += text.substring(i);
      return out;
    }
    out += replacer(text.substring(i + 1, close));
    i = close + 1;
  }
  return out;
}

/**
 * Collect every top-level balanced {...} occurrence from text.
 * Returns [{fullToken, body}, ...]. Unclosed braces terminate the scan.
 * Used by the Google Doc path, which needs the original token string for replaceText.
 */
function nfbCollectBalancedTokens_(text) {
  var results = [];
  if (!text) return results;
  var n = text.length;
  var i = 0;
  while (i < n) {
    if (text.charAt(i) !== "{") { i++; continue; }
    var close = nfbFindBalancedCloseIndex_(text, i);
    if (close < 0) return results;
    results.push({ fullToken: text.substring(i, close + 1), body: text.substring(i + 1, close) });
    i = close + 1;
  }
  return results;
}

/**
 * Resolve a single token body (the contents between matching { and }).
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

  // Pipe-value reference: {_} / {@_} / {_|...} / {@_|...}
  if (fieldPart === "_" && hasPipeCtx) {
    var pv = nfbTemplateValueToString_(context.__pipeValue__);
    if (pipeIndex >= 0) {
      return nfbApplyPipeTransformers_(pv, tokenName.substring(pipeIndex + 1), context);
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
    var pipeContext = currentFieldMeta
      ? Object.assign({}, context || {}, { currentFieldMeta: currentFieldMeta })
      : context;
    return nfbApplyPipeTransformers_(resolvedValue, transformersPart, pipeContext);
  }

  return nfbResolveTemplateTokenValue_(tokenName, context, {
    allowGmailOnlyTokens: options && options.allowGmailOnlyTokens === true,
    isRef: isRef
  });
}
