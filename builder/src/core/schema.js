import { genId } from "./ids.js";
import { DISPLAY_MODES, ensureDisplayModeForType, normalizeDisplayMode, toImportantFlag } from "./displayModes.js";
import { DEFAULT_STYLE_SETTINGS, normalizeStyleSettings } from "./styleSettings.js";

const sanitizeOptionLabel = (label) => (/^選択肢\d+$/.test(label || "") ? "" : label || "");

export const SCHEMA_STORAGE_KEY = "nested_form_builder_schema_slim_v1";
export const MAX_DEPTH = 6;

/**
 * childrenByValue を再帰的に走査し、各子配列に walkFn を適用する
 * @param {object} childrenByValue
 * @param {function} walkFn - 配列を受け取り変換した配列を返す関数
 * @returns {object} 変換後の childrenByValue
 */
const mapChildrenByValue = (childrenByValue, walkFn) => {
  if (!childrenByValue || typeof childrenByValue !== "object") return childrenByValue;
  const fixed = {};
  Object.keys(childrenByValue).forEach((key) => {
    fixed[key] = walkFn(childrenByValue[key]);
  });
  return fixed;
};

export const sampleSchema = () => [
  {
    id: genId(),
    type: "checkboxes",
    label: "好きな果物？",
    options: [
      { id: genId(), label: "リンゴ" },
      { id: genId(), label: "みかん" },
      { id: genId(), label: "ぶどう" },
    ],
    childrenByValue: {
      "リンゴ": [
        { id: genId(), type: "regex", label: "どれくらい食べる？", pattern: "^.+$", required: false, placeholder: "例: 1日1個" },
      ],
      "みかん": [
        {
          id: genId(),
          type: "select",
          label: "何個食べる？",
          options: [
            { id: genId(), label: "１個" },
            { id: genId(), label: "２個" },
            { id: genId(), label: "３個以上" },
          ],
        },
      ],
    },
  },
];

export const deepClone = (value) => {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};

export const normalizeSchemaIDs = (nodes) => {
  const walk = (arr) => (arr || []).map((field) => {
    const id = field.id || genId();
    const base = { ...field, id };

    if (["radio", "select", "checkboxes"].includes(base.type)) {
      base.options = (base.options || []).map((opt) => ({
        id: opt?.id || genId(),
        label: sanitizeOptionLabel(opt?.label),
      }));
      delete base.pattern;
      delete base.defaultNow;
    } else if (base.type === "regex") {
      delete base.options;
      base.pattern = typeof base.pattern === "string" ? base.pattern : "";
      delete base.defaultNow;
    } else if (["date", "time"].includes(base.type)) {
      delete base.options;
      delete base.pattern;
      base.defaultNow = !!base.defaultNow;
    } else if (base.type === "message") {
      delete base.options;
      delete base.pattern;
      delete base.defaultNow;
      delete base.required;
      delete base.placeholder;
      delete base.showPlaceholder;
    } else {
      delete base.options;
      delete base.pattern;
      delete base.defaultNow;
    }

    if (base.childrenByValue && typeof base.childrenByValue === "object") {
      base.childrenByValue = mapChildrenByValue(base.childrenByValue, walk);
    }

    const hasExplicitDisplayMode = Object.prototype.hasOwnProperty.call(base, "displayMode");
    const normalizedDisplayMode = ensureDisplayModeForType(
      normalizeDisplayMode(base.displayMode, { importantFlag: !!base.important }),
      base.type,
      { explicit: hasExplicitDisplayMode },
    );
    base.displayMode = normalizedDisplayMode;
    base.important = toImportantFlag(normalizedDisplayMode);

    // showPlaceholderのデフォルト値を設定
    if (base.placeholder !== undefined && base.showPlaceholder === undefined) {
      base.showPlaceholder = true;
    }

    // スタイル設定の正規化（古いデータ/型ずれを吸収）
    if (Object.prototype.hasOwnProperty.call(base, "showStyleSettings")) {
      if (typeof base.showStyleSettings === "string") {
        const lowered = base.showStyleSettings.toLowerCase();
        if (lowered === "true") base.showStyleSettings = true;
        else if (lowered === "false") base.showStyleSettings = false;
        else base.showStyleSettings = !!base.showStyleSettings;
      } else {
        base.showStyleSettings = !!base.showStyleSettings;
      }
    } else if (base.styleSettings && typeof base.styleSettings === "object") {
      // styleSettings が存在する場合は ON と推測
      base.showStyleSettings = true;
    }

    if (base.showStyleSettings === true && (!base.styleSettings || typeof base.styleSettings !== "object")) {
      base.styleSettings = { ...DEFAULT_STYLE_SETTINGS };
    } else if (base.styleSettings && typeof base.styleSettings === "object") {
      base.styleSettings = normalizeStyleSettings(base.styleSettings);
    }

    // _savedChoiceStateを保持する
    if (base._savedChoiceState && typeof base._savedChoiceState === "object") {
      base._savedChoiceState = {
        options: base._savedChoiceState.options
          ? base._savedChoiceState.options.map((opt) => ({
              id: opt?.id || genId(),
              label: sanitizeOptionLabel(opt?.label),
            }))
          : undefined,
        childrenByValue: mapChildrenByValue(base._savedChoiceState.childrenByValue, walk),
      };
    }

    return base;
  });

  return walk(Array.isArray(nodes) ? nodes : []);
};

/**
 * エクスポート用にスキーマからIDフィールドを除去する
 * @param {Array} nodes - スキーマ配列
 * @returns {Array} IDが除去されたスキーマ
 */
export const stripSchemaIDs = (nodes) => {
  const walk = (arr) => (arr || []).map((field) => {
    const { id, ...rest } = field;
    const base = { ...rest };

    // options配列からもIDを除去
    if (["radio", "select", "checkboxes"].includes(base.type) && Array.isArray(base.options)) {
      base.options = base.options.map(({ id: optId, ...optRest }) => optRest);
    }

    // childrenByValueからも再帰的にIDを除去
    if (base.childrenByValue && typeof base.childrenByValue === "object") {
      base.childrenByValue = mapChildrenByValue(base.childrenByValue, walk);
    }

    // _savedChoiceStateからもIDを除去
    if (base._savedChoiceState && typeof base._savedChoiceState === "object") {
      base._savedChoiceState = {
        ...base._savedChoiceState,
        options: Array.isArray(base._savedChoiceState.options)
          ? base._savedChoiceState.options.map(({ id: optId, ...optRest }) => optRest)
          : base._savedChoiceState.options,
        childrenByValue: mapChildrenByValue(base._savedChoiceState.childrenByValue, walk),
      };
    }

    return base;
  });

  return walk(Array.isArray(nodes) ? nodes : []);
};

export const maxDepthOf = (fields, depth = 1) => {
  let max = depth - 1;
  (fields || []).forEach((field) => {
    max = Math.max(max, depth);
    if (field?.childrenByValue && typeof field.childrenByValue === "object") {
      Object.values(field.childrenByValue).forEach((children) => {
        max = Math.max(max, maxDepthOf(children, depth + 1));
      });
    }
  });
  return max;
};

export const validateMaxDepth = (fields, max = MAX_DEPTH) => {
  const depth = maxDepthOf(fields, 1);
  return depth <= max ? { ok: true, depth } : { ok: false, depth };
};

export const validateUniqueLabels = (fields) => {
  const seen = new Set();
  for (const field of fields || []) {
    const label = (field.label || "").trim();
    if (!label) continue;
    if (seen.has(label)) return { ok: false, dup: label };
    seen.add(label);
  }
  return { ok: true };
};

/**
 * 全ての質問がラベルを持っているか検証する
 */
export const validateRequiredLabels = (fields, { responses = null, visibleOnly = false } = {}) => {
  const walk = (nodes) => {
    for (const field of nodes || []) {
      // 非表示の項目はスキップ
      if (visibleOnly && field?.displayMode === DISPLAY_MODES.NONE) continue;
      const label = (field?.label || "").trim();
      if (!label) return false;

      if (field?.childrenByValue && typeof field.childrenByValue === "object") {
        let childKeys = Object.keys(field.childrenByValue);

        // visibleOnlyの場合、現在表示されている子質問のみをチェックする
        if (visibleOnly && responses) {
          const value = responses[field.id];
          if (field.type === "checkboxes" && Array.isArray(value)) {
            childKeys = value.filter((key) => Object.prototype.hasOwnProperty.call(field.childrenByValue, key));
          } else if (["radio", "select"].includes(field.type) && typeof value === "string" && value) {
            childKeys = field.childrenByValue[value] ? [value] : [];
          } else {
            childKeys = [];
          }
        }

        for (const key of childKeys) {
          const children = field.childrenByValue[key];
          if (!walk(children)) return false;
        }
      }
    }
    return true;
  };

  return walk(fields) ? { ok: true } : { ok: false };
};

export const computeSchemaHash = (schema) => {
  const json = JSON.stringify(schema);
  let hash = 0;
  for (let i = 0; i < json.length; i += 1) {
    hash = (hash << 5) - hash + json.charCodeAt(i);
    hash |= 0;
  }
  return `v1-${Math.abs(hash)}`;
};

/**
 * フォーム保存時に一時保存データをクリーンアップする
 * @param {Array} schema - スキーマ配列
 * @returns {Array} クリーンアップされたスキーマ
 */
export const cleanupTempData = (schema) => {
  const walk = (arr) => (arr || []).map((field) => {
    const cleaned = { ...field };

    // 一時データは無条件削除
    delete cleaned._savedChildrenForChoice;
    delete cleaned._savedDisplayModeForChoice;
    delete cleaned._savedStyleSettings;

    // スタイル設定のクリーンアップ
    // - showStyleSettings が boolean の場合はそれを優先（OFFで保存した場合は styleSettings をリセット）
    // - showStyleSettings が未設定の場合は styleSettings の有無から推測（未表示/未マウントの質問でも保存で消えないように）
    if (typeof cleaned.showStyleSettings === "string") {
      const raw = cleaned.showStyleSettings;
      const lowered = raw.trim().toLowerCase();
      if (["true", "1", "yes", "on"].includes(lowered)) cleaned.showStyleSettings = true;
      else if (["false", "0", "no", "off", ""].includes(lowered)) cleaned.showStyleSettings = false;
      else {
        console.warn("[cleanupTempData] showStyleSettings is a non-boolean string; coercing to true", {
          id: cleaned.id,
          label: cleaned.label,
          value: raw,
        });
        cleaned.showStyleSettings = true;
      }
    }
    const hasExplicitShowStyleSettings = typeof cleaned.showStyleSettings === "boolean";
    const shouldKeepStyleSettings = hasExplicitShowStyleSettings ? cleaned.showStyleSettings : !!cleaned.styleSettings;

    if (!shouldKeepStyleSettings) {
      if (cleaned.styleSettings) {
        console.log("[cleanupTempData] styleSettings removed (showStyleSettings is OFF)", {
          id: cleaned.id,
          label: cleaned.label,
        });
      }
      delete cleaned.styleSettings;
    }

    if (hasExplicitShowStyleSettings) {
      cleaned.showStyleSettings = !!cleaned.showStyleSettings;
    } else if (cleaned.styleSettings) {
      cleaned.showStyleSettings = true;
      console.log("[cleanupTempData] showStyleSettings inferred as ON (styleSettings exists)", {
        id: cleaned.id,
        label: cleaned.label,
      });
    } else {
      delete cleaned.showStyleSettings;
    }

    // typeに応じて、UIで見えていないフィールドを削除
    if (["radio", "select", "checkboxes"].includes(cleaned.type)) {
      // 選択肢型：options/childrenByValueは保持、他は削除
      delete cleaned.pattern;
      delete cleaned.defaultNow;
      delete cleaned.placeholder;
      delete cleaned.showPlaceholder;
    } else {
      // 非選択肢型：options/childrenByValue/_savedChoiceStateを削除
      delete cleaned.options;
      delete cleaned.childrenByValue;
      delete cleaned._savedChoiceState;

      if (cleaned.type === "regex") {
        // regex型：patternは保持、placeholderはshowPlaceholder次第
        delete cleaned.defaultNow;
        if (!cleaned.showPlaceholder) {
          delete cleaned.placeholder;
        }
      } else if (["date", "time"].includes(cleaned.type)) {
        // date/time型：defaultNowは保持、placeholderなし
        delete cleaned.pattern;
        delete cleaned.placeholder;
        delete cleaned.showPlaceholder;
      } else if (cleaned.type === "message") {
        // message型：すべての入力関連フィールドを削除
        delete cleaned.pattern;
        delete cleaned.defaultNow;
        delete cleaned.placeholder;
        delete cleaned.showPlaceholder;
        delete cleaned.required;
      } else {
        // その他（text, numberなど）：placeholderはshowPlaceholder次第
        delete cleaned.pattern;
        delete cleaned.defaultNow;
        if (!cleaned.showPlaceholder) {
          delete cleaned.placeholder;
        }
      }
    }

    // 子要素も再帰的にクリーンアップ
    if (cleaned.childrenByValue && typeof cleaned.childrenByValue === "object") {
      cleaned.childrenByValue = mapChildrenByValue(cleaned.childrenByValue, walk);
    }

    return cleaned;
  });

  return walk(Array.isArray(schema) ? schema : []);
};
