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
// § Balanced brace scanner — NfbAlasqlRuntime（builder/src/features/expression/
//   templateScanner.js を esbuild で焼き込んだ共有ランタイム）への薄いデリゲート。
//   スキャナの実装・エスケープ sentinel はフロントと単一ソース。
// ============================================================================

function nfbTplEscape_(text) {
  if (text === undefined || text === null) return "";
  return NfbAlasqlRuntime.escapeBraces(String(text));
}

function nfbTplUnescape_(text) {
  if (text === undefined || text === null) return "";
  return NfbAlasqlRuntime.unescapeBraces(String(text));
}

// full-query モード判定（フロント templateScanner.js isFullQueryBody と同一実装）。
// 本文が先頭 SELECT のトークンはフル SQL クエリ。GAS にはクエリエンジンが無いため、
// nfbEvaluateTemplate_ はこれを評価せずリテラル/フォールバックで残す（クライアント
// が出力前に事前解決する前提。Google Doc 本文など事前解決できない経路では原文が残る）。
function nfbTplIsFullQueryBody_(body) {
  return NfbAlasqlRuntime.isFullQueryBody(body);
}

/**
 * Scan text and call replacer({ body, fullToken, mode, start, end }) for each
 * top-level {{…}} token; non-token characters（単一ブレース `{` を含む）はそのまま流す。
 * 単一ブレース `{...}`（旧・元データ形式）は廃止＝リテラル。
 */
function nfbTplScanAndReplace_(text, replacer) {
  return NfbAlasqlRuntime.scanAndReplace(text, replacer);
}

function nfbTplCollect_(text) {
  return NfbAlasqlRuntime.collectBalancedBraces(text);
}

// トークン body をトップレベルのカンマで分割する（'...' 内・(...)/[...]/{...} 内の
// カンマは保護、各要素 trim、空要素保持）。
function nfbTplSplitTopLevelCommas_(body) {
  return NfbAlasqlRuntime.splitTopLevelCommas(body);
}

// ============================================================================
// § Value coercion (式の戻り値 → テンプレート用文字列)
// ============================================================================

// builder/src/features/expression/coerceResultToString.js と単一ソース。
function nfbTplCoerceToString_(value) {
  return NfbAlasqlRuntime.coerceResultToString(value);
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
    // full-query トークン（先頭 SELECT）は GAS にクエリエンジンが無いため評価しない。
    // クライアントが出力前に事前解決する想定。未解決で届いた場合（Google Doc 本文など
    // クライアント payload を通らない経路）は原文/フォールバックのまま残す（式評価に渡すと
    // SELECT (SELECT ...) で throw するため、リテラル化して問題に気づけるようにする）。
    if (nfbTplIsFullQueryBody_(tok.body)) {
      return hasFallback ? opts.fallback : tok.fullToken;
    }
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
 * builder/src/core/collect.js `serializeFileUploadValue` の GAS ツイン。
 * files（[{ name, driveFileId, driveFileUrl }]）＋ folderUrl / folderName を
 * 保存 JSON 文字列へ。空→"" / フォルダ無し→裸配列 JSON / フォルダあり→オブジェクト JSON。
 */
function nfbSerializeFileUploadValue_(files, folderUrl, folderName) {
  var list = Object.prototype.toString.call(files) === "[object Array]" ? files : [];
  var clean = [];
  for (var i = 0; i < list.length; i++) {
    var e = list[i];
    if (!e || typeof e !== "object") continue;
    var name = typeof e.name === "string" ? e.name : "";
    var driveFileId = typeof e.driveFileId === "string" ? e.driveFileId : "";
    var driveFileUrl = typeof e.driveFileUrl === "string" ? e.driveFileUrl : "";
    if (!name && !driveFileId && !driveFileUrl) continue;
    clean.push({ name: name, driveFileId: driveFileId, driveFileUrl: driveFileUrl });
  }
  var trimmedFolderUrl = typeof folderUrl === "string" ? folderUrl.replace(/^\s+|\s+$/g, "") : "";
  var trimmedFolderName = typeof folderName === "string" ? folderName.replace(/^\s+|\s+$/g, "") : "";
  if (clean.length === 0 && !trimmedFolderUrl && !trimmedFolderName) return "";
  if (!trimmedFolderUrl && !trimmedFolderName) return JSON.stringify(clean);
  var obj = { files: clean };
  if (trimmedFolderUrl) obj.folderUrl = trimmedFolderUrl;
  if (trimmedFolderName) obj.folderName = trimmedFolderName;
  return JSON.stringify(obj);
}

/**
 * meta（{ rawFileNames, fileUrls, folderName, folderUrl }）から保存 JSON 文字列を組む。
 * クライアント storageValue が無い旧 payload、または URL 復旧後の再構築用
 * （driveFileId は meta に無いので空になる＝復旧ケースのみ許容）。
 */
function nfbBuildFileUploadStorageFromMeta_(meta) {
  var m = meta || {};
  var rawNames = Object.prototype.toString.call(m.rawFileNames) === "[object Array]" ? m.rawFileNames : [];
  var urls = Object.prototype.toString.call(m.fileUrls) === "[object Array]" ? m.fileUrls : [];
  var length = Math.max(rawNames.length, urls.length);
  var files = [];
  for (var i = 0; i < length; i++) {
    files.push({ name: rawNames[i] || "", driveFileId: "", driveFileUrl: urls[i] || "" });
  }
  return nfbSerializeFileUploadValue_(files, m.folderUrl || "", m.folderName || "");
}

/**
 * `{ fid: path }` + `{ fid: meta }` から `{ path: 保存 JSON 文字列 }` を作る。
 * 統一契約: fileUpload の行値は全経路で「保存 JSON 文字列」に統一する。素の参照
 * `{{`項目名`}}` はこの JSON をそのまま返し、FILE_NAMES / FILE_URLS / FOLDER_NAME /
 * FOLDER_URL UDF が parse して各パーツを取り出す。
 * クライアント送出 storageValue を優先（driveFileId 込みでクライアント/view とバイト一致）。
 * 無い/空のときは meta 配列から再構築する（コピー/移動後の URL 復旧値は
 * Nfb_resolveFileUploadMetaUrls_ が storageValue を再構築済み）。
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
    var storageValue = typeof meta.storageValue === "string" ? meta.storageValue : "";
    if (!storageValue) storageValue = nfbBuildFileUploadStorageFromMeta_(meta);
    if (!storageValue) continue;
    out[path] = storageValue;
  }
  return out;
}

/**
 * `{ fid: path }` + `{ fid: childObj }` から `{ path: childObj }` を作る。
 * CHILD_FORM_NAME / CHILD_FORM_ID / CHILD_FORM_URL / CHILD_FORM_COUNT UDF が
 * row[path] を合成オブジェクト（{ childFormId, childFormName, childFormUrl, count, records }）
 * として読むので、formLink 項目のパスにそのまま載せる。
 */
function nfbTplBuildChildFormRowEntries_(fieldPaths, childFormMeta) {
  var paths = nfbPlainObject_(fieldPaths);
  var metaByFid = nfbPlainObject_(childFormMeta);
  var out = {};
  for (var fid in paths) {
    if (!Object.prototype.hasOwnProperty.call(paths, fid)) continue;
    var path = paths[fid];
    if (!path || Object.prototype.hasOwnProperty.call(out, path)) continue;
    var obj = metaByFid[fid];
    if (!obj || typeof obj !== "object") continue;
    out[path] = obj;
  }
  return out;
}

/**
 * `{ fid: path }` + `{ fid: rawValue }` + meta から `{ path: value }` を組む。
 * fieldValues に値がある fid は応答整形済み、ない fid だけが responses から来る。
 * 数値・真偽値はそのまま（式の `+` / 比較で型が保たれるように — フロント
 * buildRowForExpression と同じ方針）。それ以外（Date / 配列 / オブジェクト / null）は
 * テンプレ用文字列に整形する。
 *
 * ※ fileUpload パスはこの baseMap の後に nfbTplBuildFileUploadRowEntries_ の
 *   「保存 JSON 文字列」で上書きされる（統一契約）。よって hideFileExtension による
 *   拡張子除去はここでは行わない（拡張子を落としたいときは NOEXT UDF を使う）。
 */
function nfbTplBuildLabelValueMap_(fieldPaths, fieldValues, responses, fileUploadMeta) {
  var paths = nfbPlainObject_(fieldPaths);
  var values = nfbPlainObject_(fieldValues);
  var resp = nfbPlainObject_(responses);
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
  var childEntries = nfbTplBuildChildFormRowEntries_(ctx.fieldPaths, ctx.childFormMeta);

  var row = {};
  for (var k in baseMap) {
    if (Object.prototype.hasOwnProperty.call(baseMap, k)) row[k] = baseMap[k];
  }
  for (var k2 in fileEntries) {
    if (Object.prototype.hasOwnProperty.call(fileEntries, k2)) row[k2] = fileEntries[k2];
  }
  // 子フォーム合成オブジェクトはオブジェクトのまま載せる（CHILD_FORM_* UDF が読む）。
  for (var k3 in childEntries) {
    if (Object.prototype.hasOwnProperty.call(childEntries, k3)) row[k3] = childEntries[k3];
  }
  // 予約値（現在時刻は alasql UDF NOW() を使うので行に注入しない）
  row._id = ctx.recordId ? String(ctx.recordId) : "";
  row._record_url = allowGmailOnly && ctx.recordUrl ? String(ctx.recordUrl) : "";
  row._form_url = allowGmailOnly && ctx.formUrl ? String(ctx.formUrl) : "";
  // 外部アクション と予約メタトークン語彙を統一（非機微）。機微トークン（_spreadsheet_id 等）は
  // 印刷経路では非公開のまま。
  row._form_id = ctx.formId ? String(ctx.formId) : "";
  row._form_name = ctx.formTitle ? String(ctx.formTitle) : "";
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
