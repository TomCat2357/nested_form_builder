/**
 * driveTemplate.gs
 * テンプレートトークン解決 (GAS 固有のアダプタ層)
 *
 * 内部実装は `expressionEvaluator.gs` + `templateEvaluator.gs` の alasql 互換式評価器に
 * 統合された。本ファイルは GAS 固有の処理 (_record_url / _form_url のゲート、
 * Logger 経由のエラー報告) を担う。現在時刻は alasql UDF `NOW()`
 * （DATETIME canonical 文字列 "YYYY/MM/DD HH:mm:ss.SSS"）で取得する。
 *
 * 公開シグネチャ:
 *   nfbResolveTemplateTokens_(template, context, options) → string
 */

function nfbLogTemplateError_(error, fullToken) {
  try {
    if (typeof Logger !== "undefined" && Logger && typeof Logger.log === "function") {
      Logger.log("[nfb template] " + (error && error.message ? error.message : String(error)) + " in \"" + fullToken + "\"");
    } else if (typeof console !== "undefined" && typeof console.warn === "function") {
      console.warn("[nfb template]", error && error.message ? error.message : String(error), "in", fullToken);
    }
  } catch (_e) {}
}

function nfbResolveTemplateTokens_(template, context, options) {
  if (template === undefined || template === null) return "";
  var text = String(template);
  if (!text) return "";
  if (text.indexOf("{") < 0) return text;
  var opts = options || {};
  var rows = nfbBuildTemplateRow_(context, {
    allowGmailOnlyTokens: opts.allowGmailOnlyTokens === true
  });
  return nfbEvaluateTemplate_(text, rows.data, {
    logError: nfbLogTemplateError_,
    viewRow: rows.view
    // fallback 未指定: 評価エラー時はトークン原文を残す
  });
}
