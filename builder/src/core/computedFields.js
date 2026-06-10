/**
 * 置換フィールド (type: "substitution") の依存グラフ管理・循環参照検出・一括評価
 *
 * テンプレート内のフィールド参照を解析し、トポロジカル順で安全に一括評価する。
 */

import { traverseSchema } from "./schemaUtils.js";
import { resolveTemplateTokens } from "../utils/tokenReplacer.js";
import { normalizeFileUploadEntries } from "./collect.js";
import { extractFieldRefs, validateTemplateSyntax } from "../features/expression/templateEvaluator.js";
import { splitMultiValue } from "../utils/multiValue.js";
import { joinFieldPath, splitFieldKey, PATH_SEP } from "../utils/pathCodec.js";
import { FULL_QUERY_SUBST_RE } from "./constants.js";

// ---------------------------------------------------------------------------
// Dependency extraction
// ---------------------------------------------------------------------------

/**
 * テンプレート文字列からフィールドラベル参照を抽出する（置換フィールド用）。
 * `{ ... `field` ... }` の形でバッククォート識別子を集める。予約トークン
 * (`_id` / `_record_url` / `_form_url` 等の `_` プレフィックス) は
 * フィールド依存から除外する。現在時刻は alasql UDF `NOW()` を使う。
 *
 * @param {string} templateText
 * @returns {string[]}
 */
export const extractTemplateDependencies = (templateText) => {
  return extractFieldRefs(templateText);
};

/**
 * フィールドの依存先ラベル一覧を取得する
 */
const getFieldDependencies = (field) => {
  if (field?.type === "substitution") {
    return extractTemplateDependencies(field.templateText || "");
  }
  return [];
};

// ---------------------------------------------------------------------------
// Graph construction & cycle detection
// ---------------------------------------------------------------------------

/**
 * スキーマから置換フィールドの依存グラフを構築する。
 * フィールド参照キーはフルパス (`親|子|孫`)。トップレベル質問はフルパス＝
 * 葉ラベルなのでそのまま参照可。
 *
 * @param {Array} schema
 * @returns {{
 *   computedFields: Array<{ id: string, label: string, path: string, type: string, field: Object }>,
 *   pathToId: Object,
 *   graph: Map<string, Set<string>>,
 *   order: string[],
 *   hasCycle: boolean,
 *   cycleFields: string[]
 * }}
 */
export const buildDependencyGraph = (schema) => {
  const computedFields = [];
  const pathToId = {};

  traverseSchema(schema, (field, context) => {
    const label = (field?.label || "").trim();
    const path = joinFieldPath(context?.pathSegments || []);
    if (path && field?.id) {
      pathToId[path] = field.id;
    }
    if (field?.type === "substitution") {
      computedFields.push({
        id: field.id,
        label,
        path,
        type: field.type,
        field,
      });
    }
  });

  if (computedFields.length === 0) {
    return { computedFields, pathToId, graph: new Map(), order: [], hasCycle: false, cycleFields: [] };
  }

  // 置換フィールドのフルパス集合
  const computedPathSet = new Set(computedFields.map((cf) => cf.path));

  // 有向グラフ: computedPath -> Set<computedPath> (依存先のうち置換のもの)
  const graph = new Map();
  const inDegree = new Map();

  for (const cf of computedFields) {
    graph.set(cf.path, new Set());
    inDegree.set(cf.path, 0);
  }

  for (const cf of computedFields) {
    const deps = getFieldDependencies(cf.field);
    for (const dep of deps) {
      if (computedPathSet.has(dep) && dep !== cf.path) {
        // dep -> cf (cfはdepに依存 = depが完了しないとcfは計算できない)
        graph.get(dep).add(cf.path);
        inDegree.set(cf.path, (inDegree.get(cf.path) || 0) + 1);
      }
    }
  }

  // カーンのアルゴリズムでトポロジカルソート
  const queue = [];
  for (const [path, deg] of inDegree) {
    if (deg === 0) queue.push(path);
  }

  const order = [];
  while (queue.length > 0) {
    const current = queue.shift();
    order.push(current);
    for (const neighbor of (graph.get(current) || [])) {
      const newDeg = inDegree.get(neighbor) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }

  const hasCycle = order.length < computedFields.length;
  const cycleFields = hasCycle
    ? computedFields.filter((cf) => !order.includes(cf.path)).map((cf) => cf.path)
    : [];

  return { computedFields, pathToId, graph, order, hasCycle, cycleFields };
};

/**
 * 循環参照を検出する（フォーム保存時バリデーション用）
 * @param {Array} schema
 * @returns {{ hasCycle: boolean, cycleFields: string[] }}
 */
export const detectCircularReferences = (schema) => {
  const { hasCycle, cycleFields } = buildDependencyGraph(schema);
  return { hasCycle, cycleFields };
};

/**
 * 全置換フィールド (type: "substitution") の templateText を構文検証する
 * （フォーム保存前バリデーション用）。エラーがあった項目だけを返す。
 *
 * @param {Array} schema
 * @returns {Promise<{ ok: true } | { ok: false, invalidTemplates: Array<{ path: string, label: string, message: string }> }>}
 */
export const validateSubstitutionTemplates = async (schema) => {
  const targets = [];
  traverseSchema(schema, (field, context) => {
    if (field?.type !== "substitution") return;
    const templateText = typeof field.templateText === "string" ? field.templateText : "";
    if (!templateText || templateText.indexOf("{") < 0) return;
    targets.push({
      path: (context?.pathSegments || []).join(" > "),
      label: (field?.label || "").trim(),
      templateText,
    });
  });

  const invalidTemplates = [];
  for (const target of targets) {
    const result = await validateTemplateSyntax(target.templateText);
    if (!result.ok) {
      invalidTemplates.push({ path: target.path, label: target.label, message: result.message });
    }
  }

  if (invalidTemplates.length > 0) return { ok: false, invalidTemplates };
  return { ok: true };
};

// ---------------------------------------------------------------------------
// Batch evaluation
// ---------------------------------------------------------------------------

/**
 * 全置換フィールドをトポロジカル順で一括評価する
 *
 * @param {Array} schema
 * @param {Object} responses - ユーザー入力値 { fieldId: value }
 * @param {Object} baseMap - フルパス→値マップ（統一 typed view マップ。`{{...}}` 評価の基底）。
 * @param {Object} [tokenContext] - resolveTemplateTokens用コンテキスト（now, recordId等）
 * @returns {{ computedValues: Object, computedErrors: Object }}
 *   computedValues: { fieldId: computedValue }
 *   computedErrors: { fieldId: errorMessage }
 */
export const evaluateAllComputedFields = (schema, responses, baseMap, tokenContext) => {
  const { computedFields, order, hasCycle, cycleFields } = buildDependencyGraph(schema);

  if (computedFields.length === 0) {
    return { computedValues: {}, computedErrors: {} };
  }

  const computedValues = {};
  const computedErrors = {};
  const valueMap = { ...(baseMap && typeof baseMap === "object" ? baseMap : {}) };

  // パス→フィールド情報のルックアップ
  const pathToField = {};
  for (const cf of computedFields) {
    pathToField[cf.path] = cf;
  }

  // 循環参照のフィールドにエラーを設定
  if (hasCycle) {
    for (const path of cycleFields) {
      const cf = pathToField[path];
      if (cf) {
        computedErrors[cf.id] = "循環参照が検出されました";
      }
    }
  }

  // トポロジカル順で評価
  for (const path of order) {
    const cf = pathToField[path];
    if (!cf) continue;

    if (cf.type === "substitution") {
      try {
        const ctx = {
          ...(tokenContext || {}),
          dataValueMap: valueMap,
        };
        const resolved = resolveTemplateTokens(cf.field.templateText || "", ctx);
        computedValues[cf.id] = resolved;
      } catch (e) {
        computedErrors[cf.id] = `置換エラー: ${e.message}`;
        computedValues[cf.id] = "";
      }
    }

    // 結果をマップに反映（後続の置換フィールドが参照できるように）
    if (cf.path && computedValues[cf.id] !== undefined) {
      valueMap[cf.path] = String(computedValues[cf.id]);
    }
  }

  return { computedValues, computedErrors };
};

// ---------------------------------------------------------------------------
// Entry data enrichment for search
// ---------------------------------------------------------------------------

// 元データ方式の選択肢マーカー列（`親|選択肢`: ●/true/1）から選択ラベルを集める。
const collectOptionLabelsForPath = (entryData, path) => {
  const prefix = `${path}${PATH_SEP}`;
  const selected = [];
  for (const key of Object.keys(entryData)) {
    if (!key.startsWith(prefix)) continue;
    // remainder はエスケープ済みの 1 セグメント（直下の選択肢）のみ採用。孫マーカーは除外。
    const remSegs = splitFieldKey(key.slice(prefix.length));
    if (remSegs.length !== 1 || remSegs[0] === "") continue;
    const val = entryData[key];
    if (val !== undefined && val !== null && val !== "" && val !== false && val !== 0 && val !== "0") {
      selected.push(remSegs[0]);
    }
  }
  return selected;
};

/**
 * entry.data（元データ方式: 選択肢ごとのマーカー列）から、テンプレ / substitution 再評価用の
 * 統一 typed view マップ `{ フルパス: 値 }` を再構築する（検索時の置換再評価入力）。
 *
 * - checkboxes: マーカー列の選択ラベルを表示用 ", " で連結（view 期の codec 連結列とも両対応）。
 * - radio/select: マーカー列の選択ラベル（view 期の単一ラベル列とも両対応）。
 * - fileUpload: ファイル名を ", " 連結。message / printTemplate は値なし。
 * - その他（text/number/date 等）: 保存値そのまま（number は数値型を保持）。
 */
export const buildLabelValueMapFromEntryData = (schema, entryData) => {
  const map = {};
  const data = entryData || {};
  traverseSchema(schema, (field, context) => {
    if (!field?.label) return;
    const path = joinFieldPath(context.pathSegments || []);
    if (!path || Object.prototype.hasOwnProperty.call(map, path)) return;

    const type = field.type;
    if (type === "checkboxes") {
      const labels = collectOptionLabelsForPath(data, path);
      if (labels.length > 0) map[path] = labels.join(", ");
      else if (typeof data[path] === "string" && data[path]) map[path] = splitMultiValue(data[path]).join(", ");
    } else if (type === "radio" || type === "select") {
      const labels = collectOptionLabelsForPath(data, path);
      if (labels.length > 0) map[path] = labels[0];
      else if (typeof data[path] === "string" && data[path]) map[path] = data[path];
    } else if (type === "fileUpload") {
      const files = normalizeFileUploadEntries(data[path]);
      if (files.length > 0) map[path] = files.map((f) => f.name).join(", ");
    } else if (type === "message" || type === "printTemplate") {
      // no stored value
    } else {
      const raw = data[path];
      if (raw !== undefined && raw !== null && raw !== "") {
        map[path] = raw;
      }
    }
  });
  return map;
};

/**
 * 置換フィールドの fieldId → path マップを返す
 */
export const buildComputedFieldPathsById = (schema) => {
  const paths = {};
  traverseSchema(schema, (field, context) => {
    if (field?.type !== "substitution") return;
    const fid = field?.id;
    if (!fid) return;
    paths[fid] = joinFieldPath(context.pathSegments || []);
  });
  return paths;
};

const isEmptyComputedValue = (value) => value === undefined || value === null || value === "";

/**
 * 置換フィールドを動的評価して entry.data へ反映する共通コア。
 *
 * - onlyEmpty=true（バックフィル）: 値が空欄の置換 path だけを対象に補完する。
 * - onlyEmpty=false（再評価）: 全置換 path を再評価し、既存値と異なるものだけ更新する。
 *
 * いずれも「評価値が空」のときは既存値を空で潰さない（保守的に据え置く）。差分が無ければ
 * changed=false を返し、data は元の参照をそのまま返す（再レンダー・再同期の連鎖を抑える）。
 *
 * 評価（評価器）は依存チェーンのため常に全置換を対象に行うが、data へ書き込む対象は
 * fieldIds（指定時）に絞れる。これにより「子データ/full-query 依存の置換だけ上書き再評価し、
 * 同一レコード参照や NOW() 系は据え置く（毎表示で値が変わって書き戻しが暴れるのを防ぐ）」を実現する。
 *
 * @param {Array} schema
 * @param {Object} entryData
 * @param {Object} [tokenContext] - resolveTemplateTokens 用コンテキスト
 * @param {{ onlyEmpty?: boolean, fieldIds?: string[]|Set<string>|null }} [opts]
 *   onlyEmpty: 空欄のみ対象 / fieldIds: 書き込み対象を限定（null なら全置換）
 * @returns {{ data: Object, changed: boolean, newPaths: string[], changedPaths: string[] }}
 *   newPaths: baseData に元々存在しなかった path のみ / changedPaths: 値が変わった全 path
 */
const applyComputedFieldValues = (schema, entryData, tokenContext, { onlyEmpty = true, fieldIds = null } = {}) => {
  const baseData = entryData && typeof entryData === "object" ? entryData : {};
  const pathsById = buildComputedFieldPathsById(schema);
  const allFieldIds = Object.keys(pathsById).filter((fid) => Boolean(pathsById[fid]));
  if (allFieldIds.length === 0) {
    return { data: baseData, changed: false, newPaths: [], changedPaths: [] };
  }

  const restrictSet = Array.isArray(fieldIds)
    ? new Set(fieldIds)
    : (fieldIds instanceof Set ? fieldIds : null);
  const candidateFieldIds = restrictSet ? allFieldIds.filter((fid) => restrictSet.has(fid)) : allFieldIds;

  const targetFieldIds = onlyEmpty
    ? candidateFieldIds.filter((fid) => isEmptyComputedValue(baseData[pathsById[fid]]))
    : candidateFieldIds;
  if (targetFieldIds.length === 0) {
    return { data: baseData, changed: false, newPaths: [], changedPaths: [] };
  }

  const baseValueMap = buildLabelValueMapFromEntryData(schema, baseData);
  const { computedValues } = evaluateAllComputedFields(
    schema,
    null,
    baseValueMap,
    tokenContext,
  );

  const nextData = { ...baseData };
  const newPaths = [];
  const changedPaths = [];
  let changed = false;
  for (const fid of targetFieldIds) {
    const path = pathsById[fid];
    const value = computedValues[fid];
    // 評価値が空なら既存値を据え置く（空欄補完・再評価とも、空で上書きしない）。
    if (isEmptyComputedValue(value)) continue;
    const nextStr = String(value);
    const prevStr = isEmptyComputedValue(baseData[path]) ? "" : String(baseData[path]);
    if (nextStr === prevStr) continue;
    nextData[path] = nextStr;
    if (!Object.prototype.hasOwnProperty.call(baseData, path)) {
      newPaths.push(path);
    }
    changedPaths.push(path);
    changed = true;
  }
  return { data: changed ? nextData : baseData, changed, newPaths, changedPaths };
};

/**
 * entry.data の空欄の置換フィールドだけを動的評価で補完する。
 * 補完対象が無い場合や評価値が全て空だった場合は changed=false を返し、data は元の参照をそのまま返す。
 * fieldIds を渡すと補完対象をその集合に限定する（子データ/full-query 依存の置換を、子データ無しで
 * 誤って補完してしまうのを避けるための除外などに使う）。
 *
 * @param {Array} schema
 * @param {Object} entryData
 * @param {Object} [tokenContext]
 * @param {string[]|Set<string>|null} [fieldIds] - 補完対象に限定する fieldId 集合（null なら全置換）
 */
export const backfillComputedFieldValues = (schema, entryData, tokenContext, fieldIds = null) =>
  applyComputedFieldValues(schema, entryData, tokenContext, { onlyEmpty: true, fieldIds });

/**
 * 置換フィールドを再評価し、既存値と異なるものだけ data に反映する（stale 上書き用）。
 * 子フォームデータ変更・スキーマ変更・明示再同期で、保存済み置換値を新しい値へ更新する。
 * fieldIds を渡すと書き込み対象をその集合に限定する（子データ/full-query 依存のみ上書きし、
 * 同一レコード参照・NOW() 系は据え置く）。差分が無ければ changed=false を返す（冪等）。
 *
 * @param {Array} schema
 * @param {Object} entryData
 * @param {Object} [tokenContext]
 * @param {string[]|Set<string>|null} [fieldIds] - 書き込み対象に限定する fieldId 集合（null なら全置換）
 */
export const recomputeComputedFieldValues = (schema, entryData, tokenContext, fieldIds = null) =>
  applyComputedFieldValues(schema, entryData, tokenContext, { onlyEmpty: false, fieldIds });

/**
 * 置換フィールド（substitution）が参照する子フォーム（formLink の childFormId）と、
 * full-query（{{SELECT}}）を含むかを収集する純関数。検索結果一覧で「どの子フォームの
 * データを取得して childFormMeta に注入するか」「full-query 解決が必要か」を判定するために使う。
 *
 * - CHILD_FORM_*(`項目名`) は formLink のラベルパスを引数に取るので、置換テンプレの
 *   バッククォート参照（extractTemplateDependencies）と formLink パスの一致で childFormId を引く。
 * - full-query は FROM [フォーム名] で参照するため静的に childFormId を特定できない。
 *   hasFullQuery を立て、呼び出し側は必要に応じて全 formLink 子フォームを対象にする。
 *
 * @param {Array} schema
 * @returns {{
 *   childFormIds: string[],
 *   hasFullQuery: boolean,
 *   byFieldId: Object  // { [fieldId]: { childFormIds: string[], hasFullQuery: boolean } }
 * }}
 */
export const collectSubstitutionChildFormRefs = (schema) => {
  const formLinkByPath = {};
  traverseSchema(schema, (field, context) => {
    if (field?.type !== "formLink") return;
    const path = joinFieldPath(context?.pathSegments || []);
    const childFormId = typeof field.childFormId === "string" ? field.childFormId.trim() : "";
    if (path && childFormId) formLinkByPath[path] = childFormId;
  });

  const childFormIdSet = new Set();
  let hasFullQuery = false;
  const byFieldId = {};

  traverseSchema(schema, (field) => {
    if (field?.type !== "substitution") return;
    const fid = field?.id;
    const tpl = typeof field.templateText === "string" ? field.templateText : "";
    if (!fid || !tpl || tpl.indexOf("{") < 0) return;
    const fieldFullQuery = FULL_QUERY_SUBST_RE.test(tpl);
    const refSet = new Set();
    for (const dep of extractTemplateDependencies(tpl)) {
      const childFormId = formLinkByPath[dep];
      if (childFormId) {
        refSet.add(childFormId);
        childFormIdSet.add(childFormId);
      }
    }
    if (fieldFullQuery) hasFullQuery = true;
    if (refSet.size > 0 || fieldFullQuery) {
      byFieldId[fid] = { childFormIds: Array.from(refSet), hasFullQuery: fieldFullQuery };
    }
  });

  return { childFormIds: Array.from(childFormIdSet), hasFullQuery, byFieldId };
};
