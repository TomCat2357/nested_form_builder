/**
 * templateEvaluator.gs
 * テンプレート文字列内の `{{ ... }}`（ビュー形式）を expressionEvaluator.gs で評価する。
 * 単一ブレース `{ ... }`（旧・元データ形式）は廃止され、リテラルとして出力される。
 *
 * - balanced brace scanner（`{ }` のネストを数えてトップレベルトークンを切り出す）
 * - エスケープ: `\{` `\}` をリテラル `{` `}` に戻す（scan 直前に sentinels 化）
 * - カンマ列リスト構文 `{ e1, e2, ... }`: トップレベルのカンマで分割し、各式を
 *   評価して `,` 連結する（文字列リテラル `'...'` 内・関数引数 `(...)` 内のカンマは
 *   保護される）。フロント側 templateScanner.js splitTopLevelCommas と挙動を揃える。
 * - 評価エラー時は元のトークン文字列をそのまま残す（fallback 未指定時）。
 *   フロント側双子 builder/src/features/expression/templateEvaluator.js の fallback 既定値は
 *   `""`（表示・印刷プレビュー用途）。GAS 側はトークン原文を残して問題に気づけるようにする
 *   ための意図的な差異。
 *
 * 公開関数:
 *   nfbEvaluateTemplate_(template, row)
 *     - row は { path: value } 平坦オブジェクト。fileUpload 系 UDF が要求する
 *       配列も同じキーに直接入れる。
 *   nfbBuildTemplateRow_(context, options)
 *     - context (fieldPaths, fieldValues, responses, fileUploadMeta,
 *       recordId, recordUrl, formUrl, now) を expressionEvaluator が読める row に
 *       変換する。allowGmailOnlyTokens=false のときは _record_url / _form_url を
 *       空文字に差し替える。
 */

// ============================================================================
// § Balanced brace scanner
// ============================================================================

var NFB_TPL_ESC_OPEN_  = "__NFB_TPL_ESC_OB__";
var NFB_TPL_ESC_CLOSE_ = "__NFB_TPL_ESC_CB__";

function nfbTplEscape_(text) {
  if (text === undefined || text === null) return "";
  return String(text)
    .split("\\{").join(NFB_TPL_ESC_OPEN_)
    .split("\\}").join(NFB_TPL_ESC_CLOSE_);
}

function nfbTplUnescape_(text) {
  if (text === undefined || text === null) return "";
  return String(text)
    .split(NFB_TPL_ESC_OPEN_).join("{")
    .split(NFB_TPL_ESC_CLOSE_).join("}");
}

function nfbTplFindBalancedClose_(text, openIndex) {
  if (text.charAt(openIndex) !== "{") return -1;
  var n = text.length;
  var depth = 1;
  var j = openIndex + 1;
  while (j < n) {
    var c = text.charAt(j);
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return j; }
    j++;
  }
  return -1;
}

/**
 * 開き位置 i が連続二重ブレース `{{ ... }}`（ビュー形式トークン）かを判定する。
 * 単一ブレース `{ ... }`（旧・元データ形式）は廃止され、トークンと認識せず null を返す
 * （呼び出し側でリテラル `{` 扱い）。`}}` で閉じない / 未閉じも null。
 * フロント側 templateScanner.js describeToken と等価。
 */
function nfbTplDescribeToken_(text, i) {
  if (text.charAt(i) !== "{" || text.charAt(i + 1) !== "{") return null;
  var close = nfbTplFindBalancedClose_(text, i);
  if (close < 0) return null;
  if (!(close - 1 > i + 1 && text.charAt(close - 1) === "}")) return null;
  return {
    mode: "view",
    body: text.substring(i + 2, close - 1),
    fullToken: text.substring(i, close + 1),
    start: i,
    end: close + 1
  };
}

/**
 * Scan text and call replacer({ body, fullToken, mode, start, end }) for each
 * top-level {{…}} token; non-token characters（単一ブレース `{` を含む）はそのまま流す。
 * 単一ブレース `{...}`（旧・元データ形式）は廃止＝リテラル。
 */
function nfbTplScanAndReplace_(text, replacer) {
  if (!text) return "";
  var out = "";
  var i = 0;
  var n = text.length;
  while (i < n) {
    var ch = text.charAt(i);
    if (ch !== "{") { out += ch; i++; continue; }
    var tok = nfbTplDescribeToken_(text, i);
    if (!tok) { out += ch; i++; continue; }
    out += replacer(tok);
    i = tok.end;
  }
  return out;
}

function nfbTplCollect_(text) {
  var results = [];
  if (!text) return results;
  // nfbTplScanAndReplace_ と同じ scan ループをそのまま再利用し、各トークンを
  // results に push する。replacer の戻り値（連結後の文字列）は捨てる。
  // 未閉じ `{` で scan が打ち切られる挙動も自動的に揃う。
  nfbTplScanAndReplace_(text, function(tok) {
    results.push({ body: tok.body, fullToken: tok.fullToken });
    return tok.fullToken;
  });
  return results;
}

/**
 * トークン body をトップレベルのカンマで分割する。
 * - 文字列リテラル `'...'` 内のカンマは無視（`''` でエスケープされた quote も保護）。
 * - `(` `[` `{` のネスト深度を数え、深度 > 0 のカンマは無視（関数引数内のカンマを保護）。
 * - 各要素は前後の空白を trim する。
 * - 末尾カンマ・連続カンマで空要素を保持する（`{`A`,}` → `["`A`", ""]`）。
 * - カンマが 1 つも無ければ `[trim(body)]` を返す（既存単一式パスと整合）。
 * フロント側 builder/src/features/expression/templateScanner.js splitTopLevelCommas と等価。
 */
function nfbTplSplitTopLevelCommas_(body) {
  var text = String(body === undefined || body === null ? "" : body);
  var n = text.length;
  var parts = [];
  var buf = "";
  var depth = 0;
  var i = 0;
  var hasComma = false;
  while (i < n) {
    var c = text.charAt(i);
    if (c === "'") {
      buf += c;
      i++;
      while (i < n) {
        var cc = text.charAt(i);
        buf += cc;
        if (cc === "'") {
          if (i + 1 < n && text.charAt(i + 1) === "'") {
            buf += text.charAt(i + 1);
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (c === "(" || c === "[" || c === "{") { depth++; buf += c; i++; continue; }
    if (c === ")" || c === "]" || c === "}") { if (depth > 0) depth--; buf += c; i++; continue; }
    if (c === "," && depth === 0) {
      hasComma = true;
      parts.push(buf.replace(/^\s+|\s+$/g, ""));
      buf = "";
      i++;
      continue;
    }
    buf += c;
    i++;
  }
  if (!hasComma) return [buf.replace(/^\s+|\s+$/g, "")];
  parts.push(buf.replace(/^\s+|\s+$/g, ""));
  return parts;
}

// ============================================================================
// § Value coercion (式の戻り値 → テンプレート用文字列)
// ============================================================================

// フロント側の双子は builder/src/features/expression/templateEvaluator.js の
// coerceResultToString。振る舞いを変える場合は両側を揃えること。等価性は
// tests/coerce-to-string-equivalence.test.cjs で担保。
function nfbTplCoerceToString_(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Object.prototype.toString.call(value) === "[object Date]") {
    var t = value.getTime();
    return isFinite(t) ? String(t) : "";
  }
  if (Object.prototype.toString.call(value) === "[object Array]") {
    var parts = [];
    for (var i = 0; i < value.length; i++) {
      var s = nfbTplCoerceToString_(value[i]);
      if (s !== "") parts.push(s);
    }
    return parts.join(", ");
  }
  if (typeof value === "object") {
    if (typeof value.name === "string") return value.name;
    try { return JSON.stringify(value); } catch (_e) { return ""; }
  }
  return String(value);
}

// ============================================================================
// § Public: nfbEvaluateTemplate_
// ============================================================================

/**
 * テンプレート文字列内の `{ expr }` / `{ e1, e2, ... }` を評価して連結した文字列を返す。
 * カンマ列リストはトップレベルのカンマで分割し、各式を評価して `,` で連結する。
 * 評価エラー時は対応するトークンの原文をそのまま残す（options.fallback 未指定時）。
 *
 * @param {string} template
 * @param {Object} row `{{...}}`（ビュー形式）評価の平坦行。バッククォート
 *                     識別子は row[ident] で引かれる。
 * @param {Object=} options
 *   - logError(error, fullToken)
 *   - fallback   評価エラー時の置換値（既定: 原文 fullToken）
 */
function nfbEvaluateTemplate_(template, row, options) {
  if (template === undefined || template === null) return "";
  var text = String(template);
  if (!text) return "";
  if (text.indexOf("{") < 0) return text;
  var opts = options || {};
  var logError = typeof opts.logError === "function" ? opts.logError : null;
  var hasFallback = Object.prototype.hasOwnProperty.call(opts, "fallback");
  var theRow = row || {};

  function tokenFallback(err, fullToken) {
    if (logError) logError(err, fullToken);
    return hasFallback ? opts.fallback : fullToken;
  }

  var escaped = nfbTplEscape_(text);
  var replaced = nfbTplScanAndReplace_(escaped, function(tok) {
    var tokRow = theRow;
    var parts = nfbTplSplitTopLevelCommas_(tok.body);
    if (parts.length <= 1) {
      var trimmed = parts[0];
      if (!trimmed) return "";
      var value;
      try {
        value = nfbEvaluateExpression_(trimmed, tokRow);
      } catch (e) {
        return tokenFallback(e, tok.fullToken);
      }
      return nfbTplCoerceToString_(value);
    }
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var expr = parts[i];
      if (!expr) { out.push(""); continue; }
      var partValue;
      try {
        partValue = nfbEvaluateExpression_(expr, tokRow);
      } catch (e2) {
        return tokenFallback(e2, tok.fullToken);
      }
      out.push(nfbTplCoerceToString_(partValue));
    }
    return out.join(",");
  });
  return nfbTplUnescape_(replaced);
}

/**
 * テンプレート内の `{...}` トップレベルトークンを `[{ body, fullToken }, ...]` で
 * 返す。Google Doc の per-token 経路 (driveOutput.gs replaceText) で利用する。
 */
function nfbEvaluateTemplateCollect_(template) {
  if (template === undefined || template === null) return [];
  var escaped = nfbTplEscape_(String(template));
  var collected = nfbTplCollect_(escaped);
  // body / fullToken の sentinel を解除して返す
  for (var i = 0; i < collected.length; i++) {
    collected[i].body = nfbTplUnescape_(collected[i].body);
    collected[i].fullToken = nfbTplUnescape_(collected[i].fullToken);
  }
  return collected;
}

// ============================================================================
// § Row builders — context / driveSettings → 平坦 row
// ============================================================================

function nfbPlainObject_(value) {
  if (value && typeof value === "object" && Object.prototype.toString.call(value) !== "[object Array]") return value;
  return {};
}

function nfbStripFileExtension_(name) {
  if (!name || typeof name !== "string") return name || "";
  var dotIndex = name.lastIndexOf(".");
  return dotIndex > 0 ? name.substring(0, dotIndex) : name;
}

/**
 * `{ fid: path }` + `{ fid: meta }` から `{ path: [meta-shaped 行エントリ] }` を作る。
 * NFB_FILE_NAMES / NFB_FILE_URLS / NFB_FOLDER_NAME / NFB_FOLDER_URL UDF が
 * row[path] を配列として読むので、各 fileUpload meta から
 * `{ name, driveFileUrl, folderName, folderUrl }` 形の配列を組む。
 */
function nfbTplBuildFileUploadRowEntries_(fieldPaths, fileUploadMeta) {
  var paths = nfbPlainObject_(fieldPaths);
  var metaByFid = nfbPlainObject_(fileUploadMeta);
  var out = {};
  for (var fid in paths) {
    if (!Object.prototype.hasOwnProperty.call(paths, fid)) continue;
    var path = paths[fid];
    if (!path || Object.prototype.hasOwnProperty.call(out, path)) continue;
    var meta = metaByFid[fid];
    if (!meta) continue;
    var names = Object.prototype.toString.call(meta.fileNames) === "[object Array]" ? meta.fileNames : [];
    var urls  = Object.prototype.toString.call(meta.fileUrls) === "[object Array]" ? meta.fileUrls : [];
    var folderName = meta.folderName || "";
    var folderUrl = meta.folderUrl || "";
    var length = Math.max(names.length, urls.length, (folderName || folderUrl) ? 1 : 0);
    if (length === 0) continue;
    var entries = [];
    for (var i = 0; i < length; i++) {
      entries.push({
        name: names[i] || "",
        driveFileUrl: urls[i] || "",
        folderName: folderName,
        folderUrl: folderUrl
      });
    }
    out[path] = entries;
  }
  return out;
}

/**
 * `{ fid: path }` + `{ fid: rawValue }` + meta から `{ path: value }` を組む。
 * fieldValues に値がある fid は応答整形済み、ない fid だけが responses から来る。
 * 数値・真偽値はそのまま（式の `+` / 比較で型が保たれるように — フロント
 * buildRowForExpression と同じ方針）。それ以外（Date / 配列 / オブジェクト / null）は
 * テンプレ用文字列に整形し、hideFileExtension が立っていれば拡張子を落とす。
 */
function nfbTplBuildLabelValueMap_(fieldPaths, fieldValues, responses, fileUploadMeta) {
  var paths = nfbPlainObject_(fieldPaths);
  var values = nfbPlainObject_(fieldValues);
  var resp = nfbPlainObject_(responses);
  var metaMap = nfbPlainObject_(fileUploadMeta);
  var map = {};
  for (var fid in paths) {
    if (!Object.prototype.hasOwnProperty.call(paths, fid)) continue;
    var path = paths[fid];
    if (!path || Object.prototype.hasOwnProperty.call(map, path)) continue;
    var fromFieldValues = Object.prototype.hasOwnProperty.call(values, fid);
    var raw = fromFieldValues ? values[fid] : resp[fid];
    var value;
    if (typeof raw === "number" || typeof raw === "boolean") {
      value = raw;
    } else {
      value = nfbTplCoerceToString_(raw);
      if (!fromFieldValues && metaMap[fid] && metaMap[fid].hideFileExtension) {
        var parts = value.split(", ");
        for (var i = 0; i < parts.length; i++) {
          parts[i] = nfbStripFileExtension_(parts[i].replace(/^\s+|\s+$/g, ""));
        }
        value = parts.join(", ");
      }
    }
    map[path] = value;
  }
  return map;
}

/**
 * context (fieldPaths / fieldValues / dataValues / responses / fileUploadMeta /
 * recordId / recordUrl / formUrl / now) を expressionEvaluator 用の平坦 row 1 本に変換する。
 *
 * 元データ形式（`{...}`）は廃止され、評価対象は統一 view 行のみ。
 * - 基底は ctx.dataValues（クライアント buildDataValueMap が返す typed view マップ：選択肢は
 *   ラベル連結、number は数値型、日付は canonical）を優先。無い旧コンテキストでは
 *   fieldValues 由来の labelValueMap にフォールバック。
 *
 * options:
 *   allowGmailOnlyTokens   true のとき _record_url / _form_url を含める。
 *                          false のときは空文字（Gmail 以外の出力経路でのゲート挙動）。
 *
 * @returns {Object} 平坦 row
 */
function nfbBuildTemplateRow_(context, options) {
  var ctx = context || {};
  var opts = options || {};
  var allowGmailOnly = opts.allowGmailOnlyTokens === true;

  var labelValueMap = nfbTplBuildLabelValueMap_(
    ctx.fieldPaths,
    ctx.fieldValues,
    ctx.responses,
    ctx.fileUploadMeta
  );
  var dataValues = nfbPlainObject_(ctx.dataValues);
  var hasDataValues = false;
  for (var dk in dataValues) {
    if (Object.prototype.hasOwnProperty.call(dataValues, dk)) { hasDataValues = true; break; }
  }
  var baseMap = hasDataValues ? dataValues : labelValueMap;
  var fileEntries = nfbTplBuildFileUploadRowEntries_(ctx.fieldPaths, ctx.fileUploadMeta);

  var row = {};
  for (var k in baseMap) {
    if (Object.prototype.hasOwnProperty.call(baseMap, k)) row[k] = baseMap[k];
  }
  for (var k2 in fileEntries) {
    if (Object.prototype.hasOwnProperty.call(fileEntries, k2)) row[k2] = fileEntries[k2];
  }
  // 予約値（現在時刻は alasql UDF NOW() を使うので行に注入しない）
  row._id = ctx.recordId ? String(ctx.recordId) : "";
  row._record_url = allowGmailOnly && ctx.recordUrl ? String(ctx.recordUrl) : "";
  row._form_url = allowGmailOnly && ctx.formUrl ? String(ctx.formUrl) : "";
  return row;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    evaluateTemplate: nfbEvaluateTemplate_,
    collectTokens: nfbEvaluateTemplateCollect_,
    buildRow: nfbBuildTemplateRow_,
    scanAndReplace: nfbTplScanAndReplace_
  };
}
