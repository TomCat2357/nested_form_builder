/**
 * 計算/置換フィールドの依存グラフ管理・循環参照検出・一括評価
 *
 * 計算フィールド (type: "calculated") と置換フィールド (type: "substitution") の
 * 依存関係を解析し、トポロジカル順で安全に一括評価する。
 */

import { traverseSchema } from "./schemaUtils.js";
import { extractFormulaDependencies, compileFormula, evaluateFormula } from "./formulaEngine.js";
import { resolveTemplateTokens } from "../utils/tokenReplacer.js";

// ---------------------------------------------------------------------------
// Dependency extraction
// ---------------------------------------------------------------------------

const TOKEN_RE = /\{([^{}]+)\}/g;

/**
 * テンプレート文字列からフィールドラベル参照を抽出する（置換フィールド用）
 * パイプ部分は除去してラベル名のみ返す
 * @param {string} templateText
 * @returns {string[]}
 */
export const extractTemplateDependencies = (templateText) => {
  if (!templateText || typeof templateText !== "string") return [];
  const deps = [];
  const seen = new Set();
  let m;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(templateText)) !== null) {
    const raw = m[1].trim();
    const forceField = raw.startsWith("\\");
    const tokenName = forceField ? raw.slice(1) : raw;
    const pipeIndex = tokenName.indexOf("|");
    const fieldPart = pipeIndex >= 0 ? tokenName.substring(0, pipeIndex).trim() : tokenName.trim();
    // 予約トークンはフィールド依存ではない
    if (fieldPart.startsWith("_") || !fieldPart) continue;
    if (!seen.has(fieldPart)) {
      deps.push(fieldPart);
      seen.add(fieldPart);
    }
  }
  return deps;
};

/**
 * フィールドの依存先ラベル一覧を取得する
 */
const getFieldDependencies = (field) => {
  if (field?.type === "calculated") {
    return extractFormulaDependencies(field.formula || "");
  }
  if (field?.type === "substitution") {
    return extractTemplateDependencies(field.templateText || "");
  }
  return [];
};

// ---------------------------------------------------------------------------
// Graph construction & cycle detection
// ---------------------------------------------------------------------------

/**
 * スキーマから計算/置換フィールドの依存グラフを構築する
 * @param {Array} schema
 * @returns {{
 *   computedFields: Array<{ id: string, label: string, type: string, field: Object }>,
 *   labelToId: Object,
 *   graph: Map<string, Set<string>>,
 *   order: string[],
 *   hasCycle: boolean,
 *   cycleFields: string[]
 * }}
 */
export const buildDependencyGraph = (schema) => {
  const computedFields = [];
  const labelToId = {};
  const allLabels = {};

  // 全フィールドのラベル→ID マッピングを構築
  traverseSchema(schema, (field) => {
    const label = (field?.label || "").trim();
    if (label && field?.id) {
      if (!allLabels[label]) allLabels[label] = field.id;
      labelToId[label] = field.id;
    }
    if (field?.type === "calculated" || field?.type === "substitution") {
      computedFields.push({
        id: field.id,
        label,
        type: field.type,
        field,
      });
    }
  });

  if (computedFields.length === 0) {
    return { computedFields, labelToId, graph: new Map(), order: [], hasCycle: false, cycleFields: [] };
  }

  // 計算/置換フィールドのラベル集合
  const computedLabelSet = new Set(computedFields.map((cf) => cf.label));

  // 有向グラフ: computedLabel -> Set<computedLabel> (依存先のうち計算/置換のもの)
  const graph = new Map();
  const inDegree = new Map();

  for (const cf of computedFields) {
    graph.set(cf.label, new Set());
    inDegree.set(cf.label, 0);
  }

  for (const cf of computedFields) {
    const deps = getFieldDependencies(cf.field);
    for (const dep of deps) {
      if (computedLabelSet.has(dep) && dep !== cf.label) {
        // dep -> cf (cfはdepに依存 = depが完了しないとcfは計算できない)
        graph.get(dep).add(cf.label);
        inDegree.set(cf.label, (inDegree.get(cf.label) || 0) + 1);
      }
    }
  }

  // カーンのアルゴリズムでトポロジカルソート
  const queue = [];
  for (const [label, deg] of inDegree) {
    if (deg === 0) queue.push(label);
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
    ? computedFields.filter((cf) => !order.includes(cf.label)).map((cf) => cf.label)
    : [];

  return { computedFields, labelToId, graph, order, hasCycle, cycleFields };
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

// ---------------------------------------------------------------------------
// Batch evaluation
// ---------------------------------------------------------------------------

/**
 * 全計算/置換フィールドをトポロジカル順で一括評価する
 *
 * @param {Array} schema
 * @param {Object} responses - ユーザー入力値 { fieldId: value }
 * @param {Object} baseLabelValueMap - 非計算フィールドのラベル→値マップ
 * @param {Object} [tokenContext] - resolveTemplateTokens用コンテキスト（now, recordId等）
 * @returns {{ computedValues: Object, computedErrors: Object }}
 *   computedValues: { fieldId: computedValue }
 *   computedErrors: { fieldId: errorMessage }
 */
export const evaluateAllComputedFields = (schema, responses, baseLabelValueMap, tokenContext) => {
  const { computedFields, order, hasCycle, cycleFields } = buildDependencyGraph(schema);

  if (computedFields.length === 0) {
    return { computedValues: {}, computedErrors: {} };
  }

  const computedValues = {};
  const computedErrors = {};
  const labelValueMap = { ...baseLabelValueMap };

  // ラベル→フィールド情報のルックアップ
  const labelToField = {};
  for (const cf of computedFields) {
    labelToField[cf.label] = cf;
  }

  // 循環参照のフィールドにエラーを設定
  if (hasCycle) {
    for (const label of cycleFields) {
      const cf = labelToField[label];
      if (cf) {
        computedErrors[cf.id] = "循環参照が検出されました";
      }
    }
  }

  // トポロジカル順で評価
  for (const label of order) {
    const cf = labelToField[label];
    if (!cf) continue;

    if (cf.type === "calculated") {
      const compiled = compileFormula(cf.field.formula || "");
      const result = evaluateFormula(compiled, labelValueMap);
      if (result.error) {
        computedErrors[cf.id] = result.error;
        computedValues[cf.id] = "";
      } else {
        computedValues[cf.id] = result.value;
      }
    } else if (cf.type === "substitution") {
      try {
        const ctx = {
          ...(tokenContext || {}),
          labelValueMap,
        };
        const resolved = resolveTemplateTokens(cf.field.templateText || "", ctx);
        computedValues[cf.id] = resolved;
      } catch (e) {
        computedErrors[cf.id] = `置換エラー: ${e.message}`;
        computedValues[cf.id] = "";
      }
    }

    // 結果をlabelValueMapに反映（後続の計算フィールドが参照できるように）
    if (cf.label && computedValues[cf.id] !== undefined) {
      labelValueMap[cf.label] = String(computedValues[cf.id]);
    }
  }

  return { computedValues, computedErrors };
};
