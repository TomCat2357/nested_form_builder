/**
 * 置換フィールド (type: "substitution") の依存グラフ管理・循環参照検出・一括評価
 *
 * テンプレート内のフィールド参照を解析し、トポロジカル順で安全に一括評価する。
 */

import { traverseSchema } from "./schemaUtils.js";
import { resolveTemplateTokens } from "../utils/tokenReplacer.js";
import { normalizeFileUploadEntries } from "./collect.js";
import { extractFieldRefs, validateTemplateSyntax } from "../features/expression/templateEvaluator.js";
import { isChoiceMarkerValue } from "../utils/responses.js";

const isPlainObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);

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
 * @param {Object} baseMaps - フルパス→値マップ。`{ data, view }` 形式で元データ形式
 *   （単一ブレース `{...}` 用）とビュー形式（二重ブレース `{{...}}` 用）の両方を渡す。
 *   後方互換のため単一の平坦マップを渡した場合は data/view 双方の基底として扱う。
 * @param {Object} [tokenContext] - resolveTemplateTokens用コンテキスト（now, recordId等）
 * @returns {{ computedValues: Object, computedErrors: Object }}
 *   computedValues: { fieldId: computedValue }
 *   computedErrors: { fieldId: errorMessage }
 */
export const evaluateAllComputedFields = (schema, responses, baseMaps, tokenContext) => {
  const { computedFields, order, hasCycle, cycleFields } = buildDependencyGraph(schema);

  if (computedFields.length === 0) {
    return { computedValues: {}, computedErrors: {} };
  }

  const isWrapper = isPlainObject(baseMaps) && (isPlainObject(baseMaps.data) || isPlainObject(baseMaps.view));
  const baseDataMap = isWrapper ? (baseMaps.data || {}) : (baseMaps || {});
  const baseViewMap = isWrapper ? (baseMaps.view || {}) : (baseMaps || {});

  const computedValues = {};
  const computedErrors = {};
  const dataValueMap = { ...baseDataMap };
  const labelValueMap = { ...baseViewMap };

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
          dataValueMap,
          labelValueMap,
        };
        const resolved = resolveTemplateTokens(cf.field.templateText || "", ctx);
        computedValues[cf.id] = resolved;
      } catch (e) {
        computedErrors[cf.id] = `置換エラー: ${e.message}`;
        computedValues[cf.id] = "";
      }
    }

    // 結果を両マップに反映（後続の置換フィールドが {…} / {{…}} どちらでも参照できるように）
    if (cf.path && computedValues[cf.id] !== undefined) {
      const asString = String(computedValues[cf.id]);
      dataValueMap[cf.path] = asString;
      labelValueMap[cf.path] = asString;
    }
  }

  return { computedValues, computedErrors };
};

// ---------------------------------------------------------------------------
// Entry data enrichment for search
// ---------------------------------------------------------------------------

const collectOptionLabelsForPath = (entryData, path) => {
  const prefix = `${path}|`;
  const selected = [];
  for (const key of Object.keys(entryData)) {
    if (!key.startsWith(prefix)) continue;
    const remainder = key.slice(prefix.length);
    if (!remainder || remainder.includes("|")) continue;
    const val = entryData[key];
    if (val !== undefined && val !== null && val !== "" && val !== false && val !== 0 && val !== "0") {
      selected.push(remainder);
    }
  }
  return selected;
};

/**
 * entry.data からフルパス→値マップを再構築する
 * （置換フィールドを検索時に再評価するための入力として使う）
 */
export const buildLabelValueMapFromEntryData = (schema, entryData) => {
  const map = {};
  const data = entryData || {};
  traverseSchema(schema, (field, context) => {
    if (!field?.label) return;
    const path = (context.pathSegments || []).join("|");
    if (!path) return;
    if (Object.prototype.hasOwnProperty.call(map, path)) return;

    const type = field.type;
    if (type === "radio" || type === "select") {
      const options = collectOptionLabelsForPath(data, path);
      if (options.length > 0) map[path] = options[0];
    } else if (type === "checkboxes" || type === "weekday") {
      const options = collectOptionLabelsForPath(data, path);
      if (options.length > 0) map[path] = options.join(", ");
    } else if (type === "fileUpload") {
      const files = normalizeFileUploadEntries(data[path]);
      if (files.length > 0) map[path] = files.map((f) => f.name).join(", ");
    } else if (type === "message" || type === "printTemplate") {
      // no stored value
    } else {
      const raw = data[path];
      if (raw !== undefined && raw !== null && raw !== "") {
        map[path] = String(raw);
      }
    }
  });
  return map;
};

const ENTRY_DATA_CHOICE_TYPES = ["radio", "select", "checkboxes", "weekday"];

/**
 * entry.data から元データ形式（data）の `{ フルパス: 値 }` マップを再構築する。
 * 単一ブレース `{...}` 置換の再評価入力に使う。
 *
 * - 選択肢はオプション単位パス `親|選択肢` → 真偽値（マーカーを isChoiceMarkerValue
 *   で boolean 化）。
 * - 非選択肢は entry.data の保存値そのまま。fileUpload / message / printTemplate は除外。
 */
export const buildDataValueMapFromEntryData = (schema, entryData) => {
  const map = {};
  const data = entryData || {};
  traverseSchema(schema, (field, context) => {
    if (!field?.label) return;
    const path = (context.pathSegments || []).join("|");
    if (!path) return;

    const type = field.type;
    if (ENTRY_DATA_CHOICE_TYPES.includes(type)) {
      (Array.isArray(field.options) ? field.options : []).forEach((opt) => {
        const label = typeof opt?.label === "string" ? opt.label : "";
        if (!label) return;
        const key = `${path}|${label}`;
        map[key] = isChoiceMarkerValue(data[key]);
      });
    } else if (type === "fileUpload" || type === "message" || type === "printTemplate") {
      // 行構築時の FILE_* UDF / 値を持たない型は除外
    } else {
      const raw = data[path];
      if (raw !== undefined && raw !== null && raw !== "" && !Object.prototype.hasOwnProperty.call(map, path)) {
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

  const baseLabelValueMap = buildLabelValueMapFromEntryData(schema, baseData);
  const baseDataValueMap = buildDataValueMapFromEntryData(schema, baseData);
  const { computedValues } = evaluateAllComputedFields(
    schema,
    null,
    { data: baseDataValueMap, view: baseLabelValueMap },
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
