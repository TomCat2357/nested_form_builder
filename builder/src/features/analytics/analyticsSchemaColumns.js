/**
 * フォーム schema → analytics 用の列メタ情報 / AlaSQL 型マップ。
 *
 * データ形式は view 形式に一本化された（元データ形式＝選択肢ごとの boolean 列は廃止）。
 * よって列メタ / 型マップは常に view 形式：
 *   - radio / select の親列は選択肢ラベル文字列（"string"）。
 *   - checkboxes の親列は共有 codec 連結文字列（"string"）。
 *   - option 真偽値列（`親|選択肢`）は出さない。
 *   - メタ列（id / No. / createdAt / modifiedAt / createdBy / modifiedBy）を先頭に含める。
 *   - 型の正規化は aggregationCompatibility.js（buildFieldTypeMap / resolveColumnType）に委ねる。
 *
 * 互換のため getFormViewColumns / buildViewAlaSqlTypeMap も別名として残すが、いずれも
 * getFormColumns / buildAlaSqlTypeMap と同一の view 形式を返す。
 */

import { resolveColumnType } from "./utils/aggregationCompatibility.js";
import { forEachFormField } from "./utils/fieldMetas.js";

/**
 * view 形式テーブル向けの列型決定ルール。
 * checkboxes / radio / select は選択ラベル文字列列なので string 扱い。
 * それ以外は通常の field.type 正規化（resolveColumnType 経由で FIXED_DATE_KEYS も尊重）。
 */
function resolveColumnType_(rawType, pipePath) {
  if (rawType === "checkboxes") return "string";
  return resolveColumnType(() => rawType, pipePath);
}

// view 形式テーブルが持つメタ列の定義。
// AlaSQL safe key（id, No_, createdAt 等）→ analytics 列型。
const META_COLUMNS = [
  { alaSqlKey: "id",         path: ["id"],         label: "ID",      type: "string" },
  { alaSqlKey: "No_",        path: ["No."],        label: "No.",     type: "number" },
  { alaSqlKey: "createdAt",  path: ["createdAt"],  label: "作成日時", type: "date" },
  { alaSqlKey: "modifiedAt", path: ["modifiedAt"], label: "更新日時", type: "date" },
  { alaSqlKey: "createdBy",  path: ["createdBy"],  label: "作成者",  type: "string" },
  { alaSqlKey: "modifiedBy", path: ["modifiedBy"], label: "更新者",  type: "string" },
];

/**
 * フォームの列メタ情報を返す（フィールド選択 UI / compileStages 用）。
 * メタ列を先頭に置き、続いて schema 由来のフィールド列を 1 パス走査で返す。
 * 同一 alaSqlKey 衝突時はメタ列を優先（entriesToViewTableRows の上書き挙動と整合）。
 */
export function getFormColumns(form) {
  const cols = [];
  const usedAlaSqlKeys = new Set();
  for (const m of META_COLUMNS) {
    cols.push({
      key: m.path.join("|"),
      alaSqlKey: m.alaSqlKey,
      path: m.path.slice(),
      label: m.label,
      type: m.type,
      isMeta: true,
    });
    usedAlaSqlKeys.add(m.alaSqlKey);
  }
  forEachFormField(form, ({ field, segs, pipePath, alaSqlKey }) => {
    if (usedAlaSqlKeys.has(alaSqlKey)) return;
    usedAlaSqlKeys.add(alaSqlKey);
    cols.push({
      key: pipePath,
      alaSqlKey,
      path: segs.slice(),
      label: segs[segs.length - 1] || pipePath,
      type: resolveColumnType_(field && field.type, pipePath),
    });
  });
  return cols;
}

/**
 * フォームの schema から AlaSQL 用の列型マップを構築する。
 * - キー: 各列の AlaSQL safe key（headerKeyToAlaSqlKey 通過後）
 * - 値: "number" | "date" | "string" | "unknown"
 * メタ列を含み、選択肢系は "string"（option 真偽値列は無い）。
 */
export function buildAlaSqlTypeMap(form) {
  const out = new Map();
  for (const m of META_COLUMNS) {
    out.set(m.alaSqlKey, m.type);
  }
  forEachFormField(form, ({ field, pipePath, alaSqlKey }) => {
    if (out.has(alaSqlKey)) return;
    out.set(alaSqlKey, resolveColumnType_(field && field.type, pipePath));
  });
  return out;
}

// 互換のための別名（view 形式は唯一のデータ形式なので getFormColumns / buildAlaSqlTypeMap と同一）。
export const getFormViewColumns = getFormColumns;
export const buildViewAlaSqlTypeMap = buildAlaSqlTypeMap;
