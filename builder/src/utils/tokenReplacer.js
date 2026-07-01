/**
 * フロントエンド向けテンプレートトークン置換エンジン (アダプタ層)
 *
 * 内部実装は alasql 式評価器 (`features/expression/templateEvaluator.js`) に統合
 * された。本モジュールは React コンポーネントが使う形の context (now / recordId
 * / fieldPaths / fileUploadMeta / labelValueMap など) を、新エンジンが要求する
 * 平坦な row オブジェクトに組み直すアダプタ層。
 *
 * 構文:
 *   `{ <alasql-expression> }`  内側は単行 alasql 式
 *   フィールド参照は `` `<fullPath>` ``（バッククォート識別子）。トップレベル
 *     質問は path = leaf label と同値、ネストされた子質問は `親|子` 形式必須。
 *   予約参照: `` `_id` `` / `` `_record_url` `` / `` `_form_url` ``
 *   現在時刻は関数 `NOW()`（"YYYY/MM/DD HH:mm:ss.SSS" を返す）を使う。例: `TIME_FORMAT(NOW(), 'YYYY-MM-DD')`
 *   ファイル系 UDF: `FILE_NAMES(\`添付\`)` / `FILE_URLS(\`添付\`)` /
 *                  `FOLDER_NAME(\`添付\`)` / `FOLDER_URL(\`添付\`)`
 */

import {
  resolveTemplate,
  precompileTemplate,
  extractFieldRefs,
} from "../features/expression/templateEvaluator.js";
import {
  collectBalancedBraces,
  escapeBraces,
  unescapeBraces,
  scanAndReplace,
  isFullQueryBody,
  restoreEscapedBraces,
} from "../features/expression/templateScanner.js";
import { substituteCurrentIdLiteral, collapseQueryResult, resolveNestedBraceTokens } from "../features/expression/fullQuerySql.js";
import { evalExpression } from "../features/expression/alasqlExpressionEvaluator.js";
import { preprocessAlaSqlExpression } from "../features/expression/preprocessAlaSqlExpression.js";
import { coerceResultToString } from "../features/expression/coerceResultToString.js";
import { buildRowForExpression } from "../features/expression/buildRowForExpression.js";
import {
  buildFileUploadRowEntries,
  buildChildFormRowEntries,
} from "./labelValueMap.js";

const logTemplateError = (error, fullToken) => {
  if (typeof console !== "undefined" && typeof console.warn === "function") {
    console.warn("[nfb template]", error && error.message ? error.message : String(error), "in", JSON.stringify(fullToken));
  }
};

/**
 * context (React コンポーネント由来) → alasql 式評価用の平坦 row を 1 本構築する。
 *
 * 元データ形式（`{...}`）は廃止され、評価対象は **統一 view 行のみ**。置換は共通
 * alasql エンジン（alasqlExpressionEvaluator の `SELECT (<expr>) AS v FROM ? AS r`）で評価する。
 * - 値マップは `context.dataValueMap`（buildDataValueMap が返す typed view マップ：選択肢は
 *   ラベル連結、number は数値型、日付は canonical）を優先し、無ければ `context.labelValueMap`。
 *   （テスト等は labelValueMap のみ渡すケースがあるためフォールバックを残す。）
 * - fileUploadMeta があれば path ごとに `[{ name, driveFileUrl, ... }, ...]` 配列を
 *   行へ上書きで入れる（FILE_NAMES 等の UDF はこの配列を読む）。
 * - 予約値 `_id` / `_record_url` / `_form_url` を注入。現在時刻は UDF `NOW()`。
 *
 * @returns {object}
 */
function buildTemplateRow(context) {
  const ctx = context || {};
  const valueMap = ctx.dataValueMap || ctx.labelValueMap || {};
  const fileEntries = buildFileUploadRowEntries(ctx.fieldPaths || {}, ctx.fileUploadMeta || {});
  const childEntries = buildChildFormRowEntries(ctx.fieldPaths || {}, ctx.childFormMeta || {});
  const fixed = {
    _id: ctx.recordId || "",
    _record_url: ctx.recordUrl || "",
    _form_url: ctx.formUrl || "",
    _form_id: ctx.formId || "",
    _form_name: ctx.formName || "",
  };
  // 機微予約トークンは呼び出し側がゲート済みのときだけ context に載せる（外部アクション の admin gate）。
  // 印刷プレビュー等の通常経路では未指定 → 未注入 → 参照は空文字に解決される。
  if (ctx.spreadsheetId !== undefined) fixed._spreadsheet_id = ctx.spreadsheetId || "";
  if (ctx.spreadsheetUrl !== undefined) fixed._spreadsheet_url = ctx.spreadsheetUrl || "";
  if (ctx.sheetName !== undefined) fixed._sheet_name = ctx.sheetName || "";
  if (ctx.driveFileUrl !== undefined) fixed._drive_file_url = ctx.driveFileUrl || "";
  if (ctx.userEmail !== undefined) fixed._user_email = ctx.userEmail || "";
  const source = { ...valueMap };
  for (const path of Object.keys(fileEntries)) {
    source[path] = fileEntries[path];
  }
  // 子フォーム合成オブジェクトは文字列化せずオブジェクトのまま載せる（CHILD_FORM_* UDF が読む）。
  for (const path of Object.keys(childEntries)) {
    source[path] = childEntries[path];
  }
  return buildRowForExpression(source, fixed);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * テンプレートトークンを同期的に解決する。
 * alasql ライブラリのロード + 式の precompile は事前に済ませる必要がある。
 * 未 precompile 時は console.warn を出してから空文字を返す。
 */
export const resolveTemplateTokens = (template, context) => {
  if (template === undefined || template === null) return "";
  const text = String(template);
  if (!text) return "";
  if (text.indexOf("{") < 0) return text;
  const ctx = context || {};
  const row = buildTemplateRow(ctx);
  // full-query トークン（先頭 SELECT）は同期評価できないため、context.queryTokenValues
  // （prefetchQueryTokens の結果 Map）から引く。無いトークンは fallback ("")。
  const queryTokenValues = ctx.queryTokenValues instanceof Map ? ctx.queryTokenValues : undefined;
  // prefetch 完了を呼び出し側（PreviewPage）が ctx.queryTokensReady で伝える。未指定/false の間は
  // 未解決 full-query を警告しない（非同期 prefetch 前の同期 resolve は未解決が正常なため）。
  const queryTokensReady = ctx.queryTokensReady === true;
  const valueTransform = typeof ctx.valueTransform === "function" ? ctx.valueTransform : undefined;
  return resolveTemplate(text, row, { fallback: "", logError: logTemplateError, queryTokenValues, queryTokensReady, valueTransform });
};

// full-query 結果中の `{` `}` を `\{` `\}` にエスケープする。GAS 送信用テンプレに
// 結果を埋め込む際、ブレースがトークン誤認・破損しないようにする（GAS 側 nfbTplEscape_/
// nfbTplUnescape_ が `\{` をリテラル `{` に戻す）。
function escapeBraceLiteral_(value) {
  return String(value === undefined || value === null ? "" : value)
    .split("{").join("\\{")
    .split("}").join("\\}");
}

/**
 * テンプレート中の full-query トークン（`{{SELECT ...}}`）を実行し、
 * `Map<fullToken(escape 済み), 解決文字列>` を返す。式トークンは対象外。
 * full-query が無ければ空 Map（既存の式のみテンプレはほぼ無コスト）。
 *
 * context: { recordId, formId, forms?, liveRowOverride?, fallback? }
 *   - recordId        現レコード ID（`_id` 置換に使う）
 *   - formId          現フォーム ID（`_form` / 修飾なし列の defaultFormId）
 *   - forms           全フォーム配列（[フォーム名] 解決用）。無ければ dataStore.listForms で取得。
 *   - liveRowOverride 現レコードの入力中ライブ view 行（buildLiveViewRow の出力）。`_form` の
 *                     現レコード行を保存済みキャッシュではなくこのライブ値で解決する。
 */
export const prefetchQueryTokens = async (template, context) => {
  const cache = new Map();
  if (template === undefined || template === null) return cache;
  const text = String(template);
  if (text.indexOf("{") < 0) return cache;
  const ctx = context || {};
  const escaped = escapeBraces(text);
  const tokens = collectBalancedBraces(escaped).filter((t) => isFullQueryBody(t.body));
  if (tokens.length === 0) return cache;

  // データ層（analyticsStore / dataStore）は full-query が実在するときだけ動的 import する。
  // tokenReplacer の純関数（resolveTemplateTokens / injectResolvedQueryTokens 等）を
  // node のユニットテストで読み込む際にブラウザ専用依存を巻き込まないため。
  const { runFullQuery } = await import("../features/analytics/analyticsStore.js");

  const recordId = ctx.recordId || "";
  const defaultFormId = ctx.formId || "";
  const liveRowOverride = ctx.liveRowOverride || null;
  let forms = Array.isArray(ctx.forms) ? ctx.forms : null;
  if (!forms) {
    // full-query はフロント常駐データのみで解決する（サーバ同期しない）。フォーム一覧も
    // ネットワーク（dataStore.listForms → listFormsFromGas）ではなくローカルの IndexedDB
    // キャッシュ（getFormsFromCache）から取る。未取得なら空配列にフォールバック。
    try {
      const { getFormsFromCache } = await import("../app/state/formsCache.js");
      const res = await getFormsFromCache();
      forms = Array.isArray(res?.forms) ? res.forms : [];
    } catch (err) {
      logTemplateError(err, "(getFormsFromCache)");
      forms = [];
    }
  }

  const row = buildTemplateRow(ctx);

  // ネストした {{...}} を評価して文字列化する再帰ヘルパー（`{{SELECT {{...}} FROM yyy}}` 対応）。
  // body が full-query ならまず自分自身のさらに深いネストを先に潰してから実行し、
  // 単純式なら evalExpression で評価する（resolveTemplateAsync の単純式評価パスと同じロジック）。
  // 戻り値は resolveNestedBraceTokens 側で SQL 文字列リテラルとしてクォートされる。
  async function evalNestedToken_(body) {
    const flatBody = await resolveNestedBraceTokens(body, (childTok) => evalNestedToken_(childTok.body));
    if (isFullQueryBody(flatBody)) {
      try {
        const sql = substituteCurrentIdLiteral(flatBody, recordId);
        const res = await runFullQuery(sql, { forms, defaultFormId, liveRowOverride });
        if (res && res.ok) return collapseQueryResult(res.rows, res.columns);
        logTemplateError(new Error((res && res.error) || "full-query failed"), body);
      } catch (err) {
        logTemplateError(err, body);
      }
      return "";
    }
    const expr = preprocessAlaSqlExpression(String(flatBody || "").trim());
    if (!expr) return "";
    try {
      const value = await evalExpression(expr, row, { fallback: undefined });
      return value === undefined || value === null ? "" : coerceResultToString(value);
    } catch (err) {
      logTemplateError(err, body);
      return "";
    }
  }

  for (const tok of tokens) {
    if (cache.has(tok.fullToken)) continue;
    const rawSql = unescapeBraces(tok.body);
    const flatSql = await resolveNestedBraceTokens(rawSql, (childTok) => evalNestedToken_(childTok.body));
    let value = "";
    try {
      const sql = substituteCurrentIdLiteral(flatSql, recordId);
      const res = await runFullQuery(sql, { forms, defaultFormId, liveRowOverride });
      if (res && res.ok) {
        value = collapseQueryResult(res.rows, res.columns);
      } else {
        logTemplateError(new Error((res && res.error) || "full-query failed"), tok.fullToken);
      }
    } catch (err) {
      logTemplateError(err, tok.fullToken);
    }
    cache.set(tok.fullToken, value);
  }
  return cache;
};

/**
 * テンプレートトークンを非同期に解決する。full-query を prefetch → 式を precompile →
 * 同期 resolve（full-query 値は Map から、式は compile キャッシュから）。
 * フロントの表示・プレビュー用途の移行 API。
 */
export const resolveTemplateTokensAsync = async (template, context) => {
  if (template === undefined || template === null) return "";
  const text = String(template);
  if (!text) return "";
  if (text.indexOf("{") < 0) return text;
  const ctx = context || {};
  const queryTokenValues = await prefetchQueryTokens(text, ctx);
  await precompileTemplate(text);
  const row = buildTemplateRow(ctx);
  const valueTransform = typeof ctx.valueTransform === "function" ? ctx.valueTransform : undefined;
  // ここでは prefetch を await 済みなので、未解決 full-query は本物の欠落 → 警告する。
  return resolveTemplate(text, row, { fallback: "", logError: logTemplateError, queryTokenValues, queryTokensReady: true, valueTransform });
};

/**
 * 出力（PDF/Gmail/Doc ファイル名・Gmail 本文等）用に、テンプレート中の full-query
 * トークンだけをクライアントで事前解決し、結果を `\{` `\}` エスケープして埋め込んだ
 * 新しいテンプレ文字列を返す。単純式トークン（`{{`field`}}` 等）は原文のまま残し、
 * GAS が payload から解決する。full-query が無ければ原文をそのまま返す（GAS が全解決）。
 *
 * GAS にはクエリエンジンが無いため、この事前解決を経ずに `{{SELECT ...}}` が GAS へ
 * 届いた場合は GAS 側でリテラル/フォールバック扱いになる（Google Doc 本文経路など）。
 */
/**
 * テンプレート中の full-query トークンだけを queryTokenValues（escape 済み fullToken→値）
 * の解決値（`\{` `\}` エスケープ済み）に差し替え、単純式トークン・著者エスケープ・
 * リテラルは原文のまま残した新テンプレ文字列を返す純関数。
 * full-query が無ければ原文をそのまま返す。
 */
export const injectResolvedQueryTokens = (template, queryTokenValues) => {
  if (template === undefined || template === null) return "";
  const text = String(template);
  if (!text || text.indexOf("{") < 0) return text;
  const map = queryTokenValues instanceof Map ? queryTokenValues : null;
  if (!map || map.size === 0) return text;
  const escaped = escapeBraces(text);
  const replaced = scanAndReplace(escaped, (tok) => {
    if (isFullQueryBody(tok.body)) {
      const v = map.has(tok.fullToken) ? map.get(tok.fullToken) : "";
      return escapeBraceLiteral_(v);
    }
    return tok.fullToken;
  });
  return restoreEscapedBraces(replaced);
};

export const resolveQueryTokensInTemplate = async (template, context) => {
  if (template === undefined || template === null) return "";
  const text = String(template);
  if (!text) return text;
  if (text.indexOf("{") < 0) return text;
  const ctx = context || {};
  const queryTokenValues = await prefetchQueryTokens(text, ctx);
  return injectResolvedQueryTokens(text, queryTokenValues);
};

/**
 * テンプレートに含まれる式を一括 precompile する。
 * フォーム保存時 / プレビューマウント時に呼び出して、以降の同期 resolve を保証する。
 */
export const precompileTemplateTokens = (template) => precompileTemplate(template);

/**
 * テンプレート内のフィールド参照（バッククォート識別子）を抽出する。
 * computedFields の依存抽出 / 検索に使う。
 */
export const extractTemplateFieldRefs = (template) => extractFieldRefs(template);
