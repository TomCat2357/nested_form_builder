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

function nfbGetTemplateDateParts_(date, tz) {
  return {
    year: Number(Utilities.formatDate(date, tz, "yyyy")),
    month: Number(Utilities.formatDate(date, tz, "M")),
    day: Number(Utilities.formatDate(date, tz, "d")),
    hour: Number(Utilities.formatDate(date, tz, "H")),
    minute: Number(Utilities.formatDate(date, tz, "m")),
    second: Number(Utilities.formatDate(date, tz, "s"))
  };
}

function nfbDatePartsIsSameOrAfter_(dateParts, comparison) {
  if (dateParts.year !== comparison.year) return dateParts.year > comparison.year;
  if (dateParts.month !== comparison.month) return dateParts.month > comparison.month;
  return dateParts.day >= comparison.day;
}

function nfbResolveJapaneseEra_(dateParts) {
  var eras = [
    { name: "令和", year: 2019, month: 5, day: 1 },
    { name: "平成", year: 1989, month: 1, day: 8 },
    { name: "昭和", year: 1926, month: 12, day: 25 },
    { name: "大正", year: 1912, month: 7, day: 30 },
    { name: "明治", year: 1868, month: 1, day: 25 }
  ];

  for (var i = 0; i < eras.length; i++) {
    if (nfbDatePartsIsSameOrAfter_(dateParts, eras[i])) {
      return {
        name: eras[i].name,
        year: dateParts.year - eras[i].year + 1
      };
    }
  }

  return {
    name: "",
    year: dateParts.year
  };
}

function nfbIsReservedTemplateToken_(tokenName) {
  return tokenName === "_id"
    || tokenName === "_NOW"
    || tokenName === "_record_url"
    || tokenName === "_form_url";
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
  var result = String(template)
    .replace(/\\\{/g, escapedOpenBraceToken)
    .replace(/\\\}/g, escapedCloseBraceToken)
    .replace(/\{([^{}]+)\}/g, function(match, tokenBody) {
      var rawTokenName = tokenBody || "";
      var isRef = rawTokenName.charAt(0) === "@";
      var tokenName = isRef ? rawTokenName.slice(1) : rawTokenName;
      if (!tokenName) return "";

      var pipeIndex = tokenName.indexOf("|");
      if (pipeIndex >= 0) {
        var fieldPart = tokenName.substring(0, pipeIndex);
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
    });

  return result
    .split(escapedOpenBraceToken).join("{")
    .split(escapedCloseBraceToken).join("}");
}

function nfbResolveTemplate_(template, context, options) {
  return nfbResolveTemplateTokens_(template, context, options);
}

// ---------------------------------------------------------------------------
// Pipe transformer system: {field|transform:args|transform2:args2}
// ---------------------------------------------------------------------------

function nfbSplitEscaped_(str, delimiter) {
  var SENTINEL = "__NFB_ESC_" + delimiter.charCodeAt(0) + "__";
  var escaped = str.split("\\" + delimiter).join(SENTINEL);
  var parts = escaped.split(delimiter);
  for (var i = 0; i < parts.length; i++) {
    parts[i] = parts[i].split(SENTINEL).join(delimiter);
  }
  return parts;
}

function nfbParsePipeTransformers_(transformerString) {
  var parts = nfbSplitEscaped_(transformerString, "|");
  var result = [];
  for (var i = 0; i < parts.length; i++) {
    var segment = parts[i];
    var colonIndex = segment.indexOf(":");
    if (colonIndex >= 0) {
      result.push({ name: segment.substring(0, colonIndex), args: segment.substring(colonIndex + 1) });
    } else {
      result.push({ name: segment, args: "" });
    }
  }
  return result;
}

function nfbApplyPipeTransformers_(value, transformerString, context) {
  var transformers = nfbParsePipeTransformers_(transformerString);
  var current = value === undefined || value === null ? "" : String(value);
  for (var i = 0; i < transformers.length; i++) {
    current = nfbApplyOneTransformer_(current, transformers[i].name, transformers[i].args, context);
  }
  return current;
}

function nfbTransformNoext_(value) {
  if (!value) return "";
  var parts = value.split(", ");
  for (var i = 0; i < parts.length; i++) {
    var trimmed = parts[i].replace(/^\s+|\s+$/g, "");
    var dotIndex = trimmed.lastIndexOf(".");
    parts[i] = dotIndex > 0 ? trimmed.substring(0, dotIndex) : trimmed;
  }
  return parts.join(", ");
}

function nfbJoinList_(list) {
  if (!list || !list.length) return "";
  var parts = [];
  for (var i = 0; i < list.length; i++) {
    if (list[i] === undefined || list[i] === null) continue;
    var s = String(list[i]);
    if (s) parts.push(s);
  }
  return parts.join(", ");
}

function nfbTransformFileNames_(_value, _args, context) {
  return nfbJoinList_(context && context.currentFieldMeta && context.currentFieldMeta.fileNames);
}

function nfbTransformFileUrls_(_value, _args, context) {
  return nfbJoinList_(context && context.currentFieldMeta && context.currentFieldMeta.fileUrls);
}

function nfbTransformFolderName_(_value, _args, context) {
  return String((context && context.currentFieldMeta && context.currentFieldMeta.folderName) || "");
}

function nfbTransformFolderUrl_(_value, _args, context) {
  return String((context && context.currentFieldMeta && context.currentFieldMeta.folderUrl) || "");
}

var NFB_TRANSFORMERS_ = {
  "noext":       nfbTransformNoext_,
  "time":        nfbTransformTime_,
  "left":        nfbTransformLeft_,
  "right":       nfbTransformRight_,
  "mid":         nfbTransformMid_,
  "pad":         nfbTransformPad_,
  "padRight":    nfbTransformPadRight_,
  "upper":       nfbTransformUpper_,
  "lower":       nfbTransformLower_,
  "trim":        nfbTransformTrim_,
  "default":     nfbTransformDefault_,
  "replace":     nfbTransformReplace_,
  "match":       nfbTransformMatch_,
  "number":      nfbTransformNumber_,
  "if":          nfbTransformIf_,
  "ifv":         nfbTransformIfv_,
  "map":         nfbTransformMap_,
  "kana":        nfbTransformKana_,
  "zen":         nfbTransformZen_,
  "han":         nfbTransformHan_,
  "file_names":  nfbTransformFileNames_,
  "file_urls":   nfbTransformFileUrls_,
  "folder_name": nfbTransformFolderName_,
  "folder_url":  nfbTransformFolderUrl_
};

function nfbApplyOneTransformer_(value, name, args, context) {
  var fn = NFB_TRANSFORMERS_[name];
  return fn ? fn(value, args, context) : value;
}

function nfbParseDateString_(value) {
  var str = String(value).replace(/^\s+|\s+$/g, "");
  var m = str.match(/^(\d{4})[\-\/](\d{1,2})[\-\/](\d{1,2})/);
  if (m) return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  var m2 = str.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m2) return { year: Number(m2[1]), month: Number(m2[2]), day: Number(m2[3]) };
  return null;
}

var NFB_DAY_OF_WEEK_SHORT_ = ["日", "月", "火", "水", "木", "金", "土"];
var NFB_DAY_OF_WEEK_LONG_ = ["日曜日", "月曜日", "火曜日", "水曜日", "木曜日", "金曜日", "土曜日"];

function nfbReplaceFormatTokens_(formatStr, replacements) {
  var result = formatStr;
  for (var i = 0; i < replacements.length; i++) {
    result = result.split(replacements[i][0]).join(replacements[i][1]);
  }
  return result;
}

function nfbTransformLeft_(value, args) {
  var n = parseInt(args, 10);
  if (isNaN(n) || n < 0) return value;
  return value.substring(0, n);
}

function nfbTransformRight_(value, args) {
  var n = parseInt(args, 10);
  if (isNaN(n) || n < 0) return value;
  return n >= value.length ? value : value.substring(value.length - n);
}

function nfbTransformMid_(value, args) {
  var parts = args.split(",");
  var start = parseInt(parts[0], 10);
  var length = parts.length > 1 ? parseInt(parts[1], 10) : undefined;
  if (isNaN(start) || start < 0) return value;
  if (length !== undefined && (isNaN(length) || length < 0)) return value;
  return length !== undefined ? value.substr(start, length) : value.substring(start);
}

function nfbTransformPad_(value, args) {
  var parts = args.split(",");
  var length = parseInt(parts[0], 10);
  var padChar = parts.length > 1 ? parts[1] : "0";
  if (isNaN(length) || length <= 0) return value;
  return value.padStart(length, padChar);
}

function nfbTransformPadRight_(value, args) {
  var parts = args.split(",");
  var length = parseInt(parts[0], 10);
  var padChar = parts.length > 1 ? parts[1] : " ";
  if (isNaN(length) || length <= 0) return value;
  return value.padEnd(length, padChar);
}

function nfbTransformReplace_(value, args) {
  var commaIndex = args.indexOf(",");
  if (commaIndex < 0) return value;
  var from = args.substring(0, commaIndex);
  var to = args.substring(commaIndex + 1);
  return value.split(from).join(to);
}

function nfbTransformUpper_(value) {
  return value.toUpperCase();
}

function nfbTransformLower_(value) {
  return value.toLowerCase();
}

function nfbTransformTrim_(value) {
  return value.replace(/^\s+|\s+$/g, "");
}

function nfbTransformDefault_(value, args, context) {
  if (value) return value;
  return nfbResolveIfValue_(String(args), context, value);
}

// ---------------------------------------------------------------------------
// time transformer: {field|time:HH時mm分ss秒}
// ---------------------------------------------------------------------------

function nfbParseTimeString_(value) {
  var str = String(value).replace(/^\s+|\s+$/g, "");
  // Try datetime format first (2024-01-15 14:30:00 or 2024-01-15T14:30:00)
  var dtMatch = str.match(/[\sT](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (dtMatch) {
    return { hour: Number(dtMatch[1]), minute: Number(dtMatch[2]), second: dtMatch[3] ? Number(dtMatch[3]) : 0 };
  }
  // Bare time format (14:30 or 14:30:00)
  var tMatch = str.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (tMatch) {
    return { hour: Number(tMatch[1]), minute: Number(tMatch[2]), second: tMatch[3] ? Number(tMatch[3]) : 0 };
  }
  return null;
}

/**
 * 統合 time パイプ: 日付トークンと時刻トークンの両方に対応
 * 旧 date パイプの機能を統合（後方互換不要）
 */
function nfbTransformTime_(value, formatStr) {
  var dateParts = nfbParseDateString_(value);
  var timeParts = nfbParseTimeString_(value);
  if (!dateParts && !timeParts) return value;

  var result = formatStr;
  if (dateParts) {
    var era = nfbResolveJapaneseEra_(dateParts);
    var dow = new Date(dateParts.year, dateParts.month - 1, dateParts.day).getDay();
    // Longer tokens first to avoid partial replacement (e.g. "MM" before "M")
    result = nfbReplaceFormatTokens_(result, [
      ["dddd", NFB_DAY_OF_WEEK_LONG_[dow]],
      ["ddd",  NFB_DAY_OF_WEEK_SHORT_[dow]],
      ["gg",   era.name],
      ["YYYY", String(dateParts.year)],
      ["YY",   ("0" + dateParts.year).slice(-2)],
      ["MM",   ("0" + dateParts.month).slice(-2)],
      ["DD",   ("0" + dateParts.day).slice(-2)],
      ["ee",   ("0" + era.year).slice(-2)],
      ["M",    String(dateParts.month)],
      ["D",    String(dateParts.day)],
      ["e",    String(era.year)]
    ]);
  }
  if (timeParts) {
    result = nfbReplaceFormatTokens_(result, [
      ["HH", ("0" + timeParts.hour).slice(-2)],
      ["mm", ("0" + timeParts.minute).slice(-2)],
      ["ss", ("0" + timeParts.second).slice(-2)],
      ["H",  String(timeParts.hour)],
      ["m",  String(timeParts.minute)],
      ["s",  String(timeParts.second)]
    ]);
  }

  return result;
}

// ---------------------------------------------------------------------------
// match transformer: {field|match:PATTERN,GROUP}
// ---------------------------------------------------------------------------

function nfbTransformMatch_(value, args) {
  var lastComma = args.lastIndexOf(",");
  var pattern, groupIndex;
  if (lastComma >= 0) {
    var possibleGroup = args.substring(lastComma + 1).replace(/^\s+|\s+$/g, "");
    if (/^\d+$/.test(possibleGroup)) {
      pattern = args.substring(0, lastComma);
      groupIndex = parseInt(possibleGroup, 10);
    } else {
      pattern = args;
      groupIndex = 0;
    }
  } else {
    pattern = args;
    groupIndex = 0;
  }
  try {
    var re = new RegExp(pattern);
    var m = value.match(re);
    return m && m[groupIndex] !== undefined ? m[groupIndex] : "";
  } catch (e) {
    return value;
  }
}

// ---------------------------------------------------------------------------
// number transformer: {field|number:#,##0.00}
// ---------------------------------------------------------------------------

function nfbTransformNumber_(value, formatStr) {
  var num = parseFloat(String(value).replace(/^\s+|\s+$/g, ""));
  if (isNaN(num)) return value;

  var isNeg = num < 0;
  num = Math.abs(num);

  // Parse format: find prefix, numeric part, suffix
  var fmtMatch = formatStr.match(/^([^#0,.]*)([#0,.]+)(.*)$/);
  if (!fmtMatch) return value;
  var prefix = fmtMatch[1];
  var numFmt = fmtMatch[2];
  var suffix = fmtMatch[3];

  // Determine decimal places from format
  var dotIndex = numFmt.indexOf(".");
  var decimalPlaces = 0;
  var useThousands = numFmt.indexOf(",") >= 0;
  if (dotIndex >= 0) {
    decimalPlaces = numFmt.length - dotIndex - 1;
  }

  // Format the number
  var fixed = num.toFixed(decimalPlaces);
  var intPart, decPart;
  if (decimalPlaces > 0) {
    var parts = fixed.split(".");
    intPart = parts[0];
    decPart = parts[1];
  } else {
    intPart = fixed.split(".")[0];
    decPart = "";
  }

  // Add thousands separator
  if (useThousands) {
    var formatted = "";
    for (var i = intPart.length - 1, count = 0; i >= 0; i--, count++) {
      if (count > 0 && count % 3 === 0) formatted = "," + formatted;
      formatted = intPart.charAt(i) + formatted;
    }
    intPart = formatted;
  }

  var result = (isNeg ? "-" : "") + prefix + intPart;
  if (decimalPlaces > 0) result += "." + decPart;
  result += suffix;

  return result;
}

// ---------------------------------------------------------------------------
// if transformer: {trueValue|if:condition,elseValue}
// ---------------------------------------------------------------------------

/** @参照を解決: 予約トークン優先 → フィールド参照フォールバック（if条件用） */
function nfbResolveRef_(name, context) {
  // allowGmailOnlyTokens: true で真偽判定が全コンテキストで動作するようにする
  var reservedValue = nfbResolveReservedTemplateToken_(name, context, { allowGmailOnlyTokens: true });
  if (reservedValue !== null) return reservedValue;
  return nfbResolveFieldTemplateToken_(name, context);
}

function nfbResolveConditionOperand_(operand, context, pipeValue) {
  var s = operand.replace(/^\s+|\s+$/g, "");
  if (s === "_" && pipeValue !== undefined) return pipeValue;
  if (s.charAt(0) === "@" && s.length > 1) {
    return context ? nfbResolveRef_(s.substring(1), context) : "";
  }
  if (s.length >= 2 && s.charAt(0) === '"' && s.charAt(s.length - 1) === '"') {
    return s.substring(1, s.length - 1);
  }
  return s;
}

function nfbCompare_(left, right, operator) {
  if (operator === "==") return left === right;
  if (operator === "!=") return left !== right;
  if (operator === "in") return right.indexOf(left) >= 0;

  var numLeft = parseFloat(left);
  var numRight = parseFloat(right);
  var useNumeric = !isNaN(numLeft) && !isNaN(numRight)
    && String(left).replace(/^\s+|\s+$/g, "") !== ""
    && String(right).replace(/^\s+|\s+$/g, "") !== "";

  if (useNumeric) {
    if (operator === ">")  return numLeft > numRight;
    if (operator === ">=") return numLeft >= numRight;
    if (operator === "<")  return numLeft < numRight;
    if (operator === "<=") return numLeft <= numRight;
  } else {
    if (operator === ">")  return left > right;
    if (operator === ">=") return left >= right;
    if (operator === "<")  return left < right;
    if (operator === "<=") return left <= right;
  }
  return false;
}

function nfbEvaluateIfCondition_(conditionStr, context, pipeValue) {
  var str = conditionStr.replace(/^\s+|\s+$/g, "");

  var negate = false;
  if (str.length >= 4 && str.substring(0, 4) === "not ") {
    negate = true;
    str = str.substring(4).replace(/^\s+/, "");
  }

  // Check for " in " operator first (space-delimited)
  var inIdx = str.indexOf(" in ");
  if (inIdx >= 0) {
    var inLeft = nfbResolveConditionOperand_(str.substring(0, inIdx), context, pipeValue);
    var inRight = nfbResolveConditionOperand_(str.substring(inIdx + 4), context, pipeValue);
    var inResult = nfbCompare_(inLeft, inRight, "in");
    return negate ? !inResult : inResult;
  }

  // Check for comparison operators
  var opMatch = str.match(/^(.+?)\s*(==|!=|>=|<=|>|<)\s*(.+)$/);
  var result;
  if (opMatch) {
    var leftVal = nfbResolveConditionOperand_(opMatch[1], context, pipeValue);
    var rightVal = nfbResolveConditionOperand_(opMatch[3], context, pipeValue);
    result = nfbCompare_(leftVal, rightVal, opMatch[2]);
  } else {
    var val = nfbResolveConditionOperand_(str, context, pipeValue);
    result = !!val;
  }

  return negate ? !result : result;
}

function nfbResolveIfValue_(valueStr, context, pipeValue) {
  if (valueStr === "") return "";
  if (valueStr === "_") return pipeValue;
  if (valueStr === "\\_") return "_";
  if (valueStr.charAt(0) === "@" && valueStr.length > 1) {
    return context ? nfbResolveRef_(valueStr.substring(1), context) : "";
  }
  return valueStr;
}

function nfbTransformIf_(value, args, context) {
  var firstComma = args.indexOf(",");
  if (firstComma < 0) return value;
  var conditionStr = args.substring(0, firstComma);
  var elseValueStr = args.substring(firstComma + 1);

  var matched = nfbEvaluateIfCondition_(conditionStr, context, value);
  if (matched) return value;
  return nfbResolveIfValue_(elseValueStr, context, value);
}

// ---------------------------------------------------------------------------
// ifv transformer: {field|ifv:condition,trueValue,falseValue}
// 3引数版 if — 真の場合も任意の値を返せる
// ---------------------------------------------------------------------------

function nfbTransformIfv_(value, args, context) {
  var firstComma = args.indexOf(",");
  if (firstComma < 0) return value;
  var conditionStr = args.substring(0, firstComma);
  var rest = args.substring(firstComma + 1);
  var secondComma = rest.indexOf(",");
  if (secondComma < 0) return value;
  var trueValueStr = rest.substring(0, secondComma);
  var falseValueStr = rest.substring(secondComma + 1);

  var matched = nfbEvaluateIfCondition_(conditionStr, context, value);
  if (matched) return nfbResolveIfValue_(trueValueStr, context, value);
  return nfbResolveIfValue_(falseValueStr, context, value);
}

// ---------------------------------------------------------------------------
// map transformer: {field|map:A=X;B=Y;*=Z}
// ---------------------------------------------------------------------------

function nfbTransformMap_(value, args) {
  var entries = args.split(";");
  var fallback = value;
  for (var i = 0; i < entries.length; i++) {
    var eqIndex = entries[i].indexOf("=");
    if (eqIndex < 0) continue;
    var key = entries[i].substring(0, eqIndex);
    var val = entries[i].substring(eqIndex + 1);
    if (key === "*") { fallback = val; continue; }
    if (value === key) return val;
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// kana/zen/han transformers
// ---------------------------------------------------------------------------

function nfbTransformKana_(value) {
  var result = "";
  for (var i = 0; i < value.length; i++) {
    var code = value.charCodeAt(i);
    // Hiragana U+3041-U+3096 → Katakana U+30A1-U+30F6
    if (code >= 0x3041 && code <= 0x3096) {
      result += String.fromCharCode(code + 0x60);
    } else {
      result += value.charAt(i);
    }
  }
  return result;
}

var NFB_HALFWIDTH_KANA_MAP_ = {
  "\uFF66": "\u30F2", "\uFF67": "\u30A1", "\uFF68": "\u30A3", "\uFF69": "\u30A5",
  "\uFF6A": "\u30A7", "\uFF6B": "\u30A9", "\uFF6C": "\u30E3", "\uFF6D": "\u30E5",
  "\uFF6E": "\u30E7", "\uFF6F": "\u30C3", "\uFF70": "\u30FC",
  "\uFF71": "\u30A2", "\uFF72": "\u30A4", "\uFF73": "\u30A6", "\uFF74": "\u30A8",
  "\uFF75": "\u30AA", "\uFF76": "\u30AB", "\uFF77": "\u30AD", "\uFF78": "\u30AF",
  "\uFF79": "\u30B1", "\uFF7A": "\u30B3", "\uFF7B": "\u30B5", "\uFF7C": "\u30B7",
  "\uFF7D": "\u30B9", "\uFF7E": "\u30BB", "\uFF7F": "\u30BD", "\uFF80": "\u30BF",
  "\uFF81": "\u30C1", "\uFF82": "\u30C4", "\uFF83": "\u30C6", "\uFF84": "\u30C8",
  "\uFF85": "\u30CA", "\uFF86": "\u30CB", "\uFF87": "\u30CC", "\uFF88": "\u30CD",
  "\uFF89": "\u30CE", "\uFF8A": "\u30CF", "\uFF8B": "\u30D2", "\uFF8C": "\u30D5",
  "\uFF8D": "\u30D8", "\uFF8E": "\u30DB", "\uFF8F": "\u30DE", "\uFF90": "\u30DF",
  "\uFF91": "\u30E0", "\uFF92": "\u30E1", "\uFF93": "\u30E2", "\uFF94": "\u30E4",
  "\uFF95": "\u30E6", "\uFF96": "\u30E8", "\uFF97": "\u30E9", "\uFF98": "\u30EA",
  "\uFF99": "\u30EB", "\uFF9A": "\u30EC", "\uFF9B": "\u30ED", "\uFF9C": "\u30EF",
  "\uFF9D": "\u30F3"
};

// Dakuten map: base char → dakuten form
var NFB_DAKUTEN_MAP_ = {
  "\u30AB": "\u30AC", "\u30AD": "\u30AE", "\u30AF": "\u30B0", "\u30B1": "\u30B2", "\u30B3": "\u30B4",
  "\u30B5": "\u30B6", "\u30B7": "\u30B8", "\u30B9": "\u30BA", "\u30BB": "\u30BC", "\u30BD": "\u30BE",
  "\u30BF": "\u30C0", "\u30C1": "\u30C2", "\u30C4": "\u30C5", "\u30C6": "\u30C7", "\u30C8": "\u30C9",
  "\u30CF": "\u30D0", "\u30D2": "\u30D3", "\u30D5": "\u30D6", "\u30D8": "\u30D9", "\u30DB": "\u30DC",
  "\u30A6": "\u30F4"
};

// Handakuten map: base char → handakuten form
var NFB_HANDAKUTEN_MAP_ = {
  "\u30CF": "\u30D1", "\u30D2": "\u30D4", "\u30D5": "\u30D7", "\u30D8": "\u30DA", "\u30DB": "\u30DD"
};

function nfbTransformZen_(value) {
  var result = "";
  for (var i = 0; i < value.length; i++) {
    var ch = value.charAt(i);
    var code = value.charCodeAt(i);

    // ASCII half-width (0x21-0x7E) → full-width (0xFF01-0xFF5E)
    if (code >= 0x21 && code <= 0x7E) {
      result += String.fromCharCode(code + 0xFEE0);
      continue;
    }
    // Space → full-width space
    if (code === 0x20) {
      result += "\u3000";
      continue;
    }

    // Half-width katakana → full-width katakana
    var mapped = NFB_HALFWIDTH_KANA_MAP_[ch];
    if (mapped) {
      // Check for dakuten/handakuten combining mark
      var next = i + 1 < value.length ? value.charAt(i + 1) : "";
      if (next === "\uFF9E" && NFB_DAKUTEN_MAP_[mapped]) {
        result += NFB_DAKUTEN_MAP_[mapped];
        i++;
      } else if (next === "\uFF9F" && NFB_HANDAKUTEN_MAP_[mapped]) {
        result += NFB_HANDAKUTEN_MAP_[mapped];
        i++;
      } else {
        result += mapped;
      }
      continue;
    }

    result += ch;
  }
  return result;
}

// Build reverse map for han (full-width → half-width)
var NFB_FULLWIDTH_KANA_TO_HALF_ = {};
var NFB_DAKUTEN_TO_HALF_ = {};
var NFB_HANDAKUTEN_TO_HALF_ = {};

(function() {
  var k;
  for (k in NFB_HALFWIDTH_KANA_MAP_) {
    if (Object.prototype.hasOwnProperty.call(NFB_HALFWIDTH_KANA_MAP_, k)) {
      NFB_FULLWIDTH_KANA_TO_HALF_[NFB_HALFWIDTH_KANA_MAP_[k]] = k;
    }
  }
  for (k in NFB_DAKUTEN_MAP_) {
    if (Object.prototype.hasOwnProperty.call(NFB_DAKUTEN_MAP_, k)) {
      // Find the half-width base for the undakuten form
      var halfBase = NFB_FULLWIDTH_KANA_TO_HALF_[k];
      if (halfBase) {
        NFB_DAKUTEN_TO_HALF_[NFB_DAKUTEN_MAP_[k]] = halfBase + "\uFF9E";
      }
    }
  }
  for (k in NFB_HANDAKUTEN_MAP_) {
    if (Object.prototype.hasOwnProperty.call(NFB_HANDAKUTEN_MAP_, k)) {
      var halfBase2 = NFB_FULLWIDTH_KANA_TO_HALF_[k];
      if (halfBase2) {
        NFB_HANDAKUTEN_TO_HALF_[NFB_HANDAKUTEN_MAP_[k]] = halfBase2 + "\uFF9F";
      }
    }
  }
})();

function nfbTransformHan_(value) {
  var result = "";
  for (var i = 0; i < value.length; i++) {
    var ch = value.charAt(i);
    var code = value.charCodeAt(i);

    // Full-width ASCII (0xFF01-0xFF5E) → half-width (0x21-0x7E)
    if (code >= 0xFF01 && code <= 0xFF5E) {
      result += String.fromCharCode(code - 0xFEE0);
      continue;
    }
    // Full-width space → half-width space
    if (code === 0x3000) {
      result += " ";
      continue;
    }

    // Dakuten/handakuten katakana → half-width + combining mark
    if (NFB_DAKUTEN_TO_HALF_[ch]) {
      result += NFB_DAKUTEN_TO_HALF_[ch];
      continue;
    }
    if (NFB_HANDAKUTEN_TO_HALF_[ch]) {
      result += NFB_HANDAKUTEN_TO_HALF_[ch];
      continue;
    }
    // Plain full-width katakana → half-width katakana
    if (NFB_FULLWIDTH_KANA_TO_HALF_[ch]) {
      result += NFB_FULLWIDTH_KANA_TO_HALF_[ch];
      continue;
    }

    result += ch;
  }
  return result;
}
