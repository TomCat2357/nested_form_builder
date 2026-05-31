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
    const path = (context?.pathSegments || []).join("|");
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

/**
 * entry.data（view 形式: フィールド 1 列）から、テンプレ / substitution 再評価用の
 * 統一 typed view マップ `{ フルパス: 値 }` を再構築する（検索時の置換再評価入力）。
 *
 * - checkboxes: 保存値（codec エスケープ付き連結）を分解し表示用 ", " で連結。
 * - radio/select/weekday: 保存値（単一ラベル）をそのまま。
 * - fileUpload: ファイル名を ", " 連結。message / printTemplate は値なし。
 * - その他（text/number/date 等）: 保存値そのまま（number は数値型を保持）。
 */
export const buildLabelValueMapFromEntryData = (schema, entryData) => {
  const map = {};
  const data = entryData || {};
  traverseSchema(schema, (field, context) => {
    if (!field?.label) return;
    const path = (context.pathSegments || []).join("|");
    if (!path || Object.prototype.hasOwnProperty.call(map, path)) return;

    const type = field.type;
    if (type === "checkboxes") {
      const labels = splitMultiValue(data[path]);
      if (labels.length > 0) map[path] = labels.join(", ");
    } else if (type === "radio" || type === "select" || type === "weekday") {
      const raw = data[path];
      if (typeof raw === "string" && raw) map[path] = raw;
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
    paths[fid] = (context.pathSegments || []).join("|");
  });
  return paths;
};

const isEmptyComputedValue = (value) => value === undefined || value === null || value === "";

/**
 * entry.data の空欄の置換フィールドだけを動的評価で補完する共通コア。
 * 補完対象が無い場合や評価値が全て空だった場合は changed=false を返し、data は元の参照をそのまま返す。
 *
 * @param {Array} schema
 * @param {Object} entryData
 * @param {Object} [tokenContext] - resolveTemplateTokens 用コンテキスト
 * @returns {{ data: Object, changed: boolean, newPaths: string[] }}
 *   newPaths: baseData に元々存在しなかった path のみ
 */
export const backfillComputedFieldValues = (schema, entryData, tokenContext) => {
  const baseData = entryData && typeof entryData === "object" ? entryData : {};
  const pathsById = buildComputedFieldPathsById(schema);
  const fieldIds = Object.keys(pathsById);
  if (fieldIds.length === 0) {
    return { data: baseData, changed: false, newPaths: [] };
  }

  const missingFieldIds = fieldIds.filter((fid) => {
    const path = pathsById[fid];
    if (!path) return false;
    return isEmptyComputedValue(baseData[path]);
  });
  if (missingFieldIds.length === 0) {
    return { data: baseData, changed: false, newPaths: [] };
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
  let changed = false;
  for (const fid of missingFieldIds) {
    const path = pathsById[fid];
    const value = computedValues[fid];
    if (isEmptyComputedValue(value)) continue;
    nextData[path] = String(value);
    if (!Object.prototype.hasOwnProperty.call(baseData, path)) {
      newPaths.push(path);
    }
    changed = true;
  }
  return { data: changed ? nextData : baseData, changed, newPaths };
};

/**
 * entry.data に置換フィールドの再評価結果を注入した新しい data を返す
 * 保存値（entry.data[path]）があればそれを優先し、空のフィールドだけ動的評価で補完する
 */
export const enrichEntryDataWithComputedFields = (schema, entryData, tokenContext) => {
  return backfillComputedFieldValues(schema, entryData, tokenContext).data;
};
