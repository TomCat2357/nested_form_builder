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
  resolveTemplateAsync,
  precompileTemplate,
  extractFieldRefs,
} from "../features/expression/templateEvaluator.js";
import { buildRowForExpression } from "../features/expression/buildRowForExpression.js";
import {
  buildLabelValueMap as sharedBuildLabelValueMap,
  buildFileUploadRowEntries,
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
  const fixed = {
    _id: ctx.recordId || "",
    _record_url: ctx.recordUrl || "",
    _form_url: ctx.formUrl || "",
  };
  const source = { ...valueMap };
  for (const path of Object.keys(fileEntries)) {
    source[path] = fileEntries[path];
  }
  return buildRowForExpression(source, fixed);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * fieldPaths + fieldValues + responses から { fullPath: 表示用文字列 } マップを構築。
 */
export const buildLabelValueMap = (fieldPaths, fieldValues, responses) =>
  sharedBuildLabelValueMap(fieldPaths, fieldValues, responses);

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
  const row = buildTemplateRow(context);
  return resolveTemplate(text, row, { fallback: "", logError: logTemplateError });
};

/**
 * 非同期版 — テンプレート内式を都度 precompile してから sync 評価する。
 * 初回マウント時 / プレビュー直前など同期保証が無い場面で使う。
 */
export const resolveTemplateTokensAsync = (template, context) => {
  if (template === undefined || template === null) return Promise.resolve("");
  const text = String(template);
  if (!text) return Promise.resolve("");
  if (text.indexOf("{") < 0) return Promise.resolve(text);
  const row = buildTemplateRow(context);
  return resolveTemplateAsync(text, row, { fallback: "", logError: logTemplateError });
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
