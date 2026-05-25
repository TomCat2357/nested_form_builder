/**
 * フォーム schema → analytics 用の列メタ情報 / AlaSQL 型マップ。
 *
 * 旧 analyticsStore.js に散在していた schema 走査ヘルパー（buildAlaSqlTypeMapForForm /
 * buildSchemaTypeMap / formColumnsFromSchema）をここに集約。型の正規化は
 * aggregationCompatibility.js の単一情報源（buildFieldTypeMap / resolveColumnType）に委ねる。
 *
 * 用語整理:
 *   - data variant: スプレッドシート由来。checkboxes は option 真偽値列 (boolean)。
 *     型マップは buildFieldTypeMap → headerKeyToAlaSqlKey の単純合成 (buildAlaSqlTypeMap)。
 *   - view variant: 検索結果一覧形式。radio/select の親列はラベル文字列、checkboxes /
 *     weekday はカンマ "," 連結文字列で入る。data variant とは型ルールが異なるので
 *     resolveViewColumnType_ で view 固有の上書きを掛ける。
 */

import { headerKeyToAlaSqlKey } from "./utils/headerToAlaSqlKey.js";
import { buildFieldTypeMap, resolveColumnType } from "./utils/aggregationCompatibility.js";
import { forEachFormField, forEachChoiceOption } from "./utils/fieldMetas.js";

/**
 * view 形式テーブル向けの列型決定ルール。
 * checkboxes / weekday はカンマ "," 連結ラベル列として登録されるので string 扱い。
 * それ以外は通常の field.type 正規化（resolveColumnType 経由で FIXED_DATE_KEYS も尊重）。
 */
function resolveViewColumnType_(rawType, pipePath) {
  if (rawType === "checkboxes" || rawType === "weekday") return "string";
  return resolveColumnType(() => rawType, pipePath);
}

// view 形式テーブルが持つメタ列の定義。
// AlaSQL safe key（id, No_, createdAt 等）→ analytics 列型。
// data 形式テーブルでも entriesToAlaSqlRows が同名のメタ列を出すが、data の typeMap は
// schema 由来のみを持つので getFormColumns では出てこない。view 形式では UI 列一覧に
// 含めたいので getFormViewColumns で明示的に出す。
const VIEW_META_COLUMNS = [
  { alaSqlKey: "id",         path: ["id"],         label: "ID",      type: "string" },
  { alaSqlKey: "No_",        path: ["No."],        label: "No.",     type: "number" },
  { alaSqlKey: "createdAt",  path: ["createdAt"],  label: "作成日時", type: "date" },
  { alaSqlKey: "modifiedAt", path: ["modifiedAt"], label: "更新日時", type: "date" },
  { alaSqlKey: "createdBy",  path: ["createdBy"],  label: "作成者",  type: "string" },
  { alaSqlKey: "modifiedBy", path: ["modifiedBy"], label: "更新者",  type: "string" },
];

/**
 * フォームの schema から AlaSQL 用の列型マップを構築する。
 * - キー: 各列の AlaSQL safe key（headerKeyToAlaSqlKey 通過後）
 * - 値: "number" | "date" | "string" | "boolean" | "unknown"
 *
 * entriesToAlaSqlRows に渡し、保存値を列型に応じて coerce する用途。
 * （number は Number 化、date は ""/null を null 化、その他は素通し）
 */
export function buildAlaSqlTypeMap(form) {
  const out = new Map();
  if (!form) return out;
  for (const [pipePath, colType] of buildFieldTypeMap(form.schema)) {
    out.set(headerKeyToAlaSqlKey(pipePath), colType);
  }
  // choice 系の `親|選択肢` 列を boolean として追加。スプレッドシートの `●`/空白 は
  // entriesToAlaSqlRows で true/false に coerce され、未回答行も pre-seed で false になる。
  // フィールド列と alaSqlKey が衝突する場合はフィールド列を優先（先勝ち）。
  forEachChoiceOption(form, ({ alaSqlKey }) => {
    if (!out.has(alaSqlKey)) out.set(alaSqlKey, "boolean");
  });
  return out;
}

/**
 * フォームの列メタ情報を返す（フィールド選択 UI / compileStages 用）。
 * form.schema を 1 パスで走査して `{ key, alaSqlKey, path, label, type }` の配列を返す。
 * 同一パスが複数回出現したら最初のものを採用（先勝ち）。
 */
export function getFormColumns(form) {
  const cols = [];
  const usedAlaSqlKeys = new Set();
  forEachFormField(form, ({ field, segs, pipePath, alaSqlKey }) => {
    usedAlaSqlKeys.add(alaSqlKey);
    cols.push({
      key: pipePath,
      alaSqlKey,
      path: segs.slice(),
      label: segs[segs.length - 1] || pipePath,
      // resolveColumnType は FIXED_DATE_KEYS の短絡 + 生 field.type の正規化を行う。
      // この場で対象 field が手元にあるので関数形で生型を渡す。
      type: resolveColumnType(() => (field && field.type), pipePath),
    });
  });
  // choice 系の `親|選択肢` boolean 列（buildAlaSqlTypeMap と対）。
  // フィールド列と alaSqlKey が衝突する場合はフィールド列を優先（先勝ち）。
  forEachChoiceOption(form, ({ segs, pipePath, alaSqlKey, optionLabel }) => {
    if (usedAlaSqlKeys.has(alaSqlKey)) return;
    usedAlaSqlKeys.add(alaSqlKey);
    cols.push({
      key: pipePath,
      alaSqlKey,
      path: segs.slice(),
      label: optionLabel,
      type: "boolean",
    });
  });
  return cols;
}

/**
 * view 形式テーブル（registerFormViewAsTable で登録される）の列メタ情報を返す。
 *
 * getFormColumns との違い：
 *   - メタ列 (id / No. / createdAt / modifiedAt / createdBy / modifiedBy) を先頭に含める
 *   - radio / select / checkboxes の親列は "string" 型（選択ラベル文字列が入る）
 *   - option 真偽値列は出さない（そもそもスキーマ走査は field 単位なので元から出ない）
 *
 * 同一 path 衝突時はメタ列を優先（entriesToViewTableRows の上書き挙動と整合）。
 */
export function getFormViewColumns(form) {
  const cols = [];
  const usedAlaSqlKeys = new Set();
  // メタ列を先頭に
  for (const m of VIEW_META_COLUMNS) {
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
    // メタ列と衝突する alaSqlKey は出さない（entries 側で上書きされるので）。
    // forEachFormField は pipePath ベースで先勝ち重複排除するが、alaSqlKey 衝突は別軸。
    if (usedAlaSqlKeys.has(alaSqlKey)) return;
    usedAlaSqlKeys.add(alaSqlKey);
    cols.push({
      key: pipePath,
      alaSqlKey,
      path: segs.slice(),
      label: segs[segs.length - 1] || pipePath,
      type: resolveViewColumnType_(field && field.type, pipePath),
    });
  });
  return cols;
}

/**
 * view 形式テーブル用の AlaSQL 型マップ。
 * getFormViewColumns と同じ型決定ロジック（radio/select/checkboxes は "string"）。
 * メタ列も含める。
 */
export function buildViewAlaSqlTypeMap(form) {
  const out = new Map();
  for (const m of VIEW_META_COLUMNS) {
    out.set(m.alaSqlKey, m.type);
  }
  forEachFormField(form, ({ field, pipePath, alaSqlKey }) => {
    // メタ列を上書きしない（先勝ち）
    if (out.has(alaSqlKey)) return;
    out.set(alaSqlKey, resolveViewColumnType_(field && field.type, pipePath));
  });
  return out;
}
