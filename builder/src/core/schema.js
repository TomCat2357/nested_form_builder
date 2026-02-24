import { genId } from "./ids.js";
import { resolveIsDisplayed } from "./displayModes.js";
import { DEFAULT_STYLE_SETTINGS, normalizeStyleSettings } from "./styleSettings.js";
import { MAX_DEPTH } from "./constants.js";
import { mapSchema, traverseSchema } from "./schemaUtils.js";

const sanitizeOptionLabel = (label) => (/^選択肢\d+$/.test(label || "") ? "" : label || "");

export const SCHEMA_STORAGE_KEY = "nested_form_builder_schema_slim_v1";
export { MAX_DEPTH };

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
  return mapSchema(nodes, (field) => {
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
    } else if (base.type === "userName") {
      delete base.options;
      delete base.pattern;
      delete base.placeholder;
      delete base.showPlaceholder;
      base.defaultNow = !!base.defaultNow;
    } else if (base.type === "email") {
      delete base.options;
      delete base.pattern;
      delete base.placeholder;
      delete base.showPlaceholder;
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

    base.isDisplayed = resolveIsDisplayed(base);
    delete base.displayMode;
    delete base.important;
    delete base.compact;

    if (base.placeholder !== undefined && base.showPlaceholder === undefined) {
      base.showPlaceholder = true;
    }

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
      base.showStyleSettings = true;
    }

    const hasExplicitShowStyleSettings = typeof base.showStyleSettings === "boolean";
    const shouldKeepStyleSettings = hasExplicitShowStyleSettings ? base.showStyleSettings : !!base.styleSettings;
    if (shouldKeepStyleSettings && (!base.styleSettings || typeof base.styleSettings !== "object")) {
      base.styleSettings = { ...DEFAULT_STYLE_SETTINGS };
    } else if (shouldKeepStyleSettings && base.styleSettings && typeof base.styleSettings === "object") {
      base.styleSettings = normalizeStyleSettings(base.styleSettings);
    } else {
      delete base.styleSettings;
    }

    if (hasExplicitShowStyleSettings) {
      base.showStyleSettings = !!base.showStyleSettings;
    } else if (base.styleSettings) {
      base.showStyleSettings = true;
    } else {
      delete base.showStyleSettings;
    }

    delete base._savedChoiceState;
    delete base._savedStyleSettings;
    delete base._savedChildrenForChoice;
    delete base._savedDisplayModeForChoice;

    return base;
  });
};

export const stripSchemaIDs = (nodes) => {
  return mapSchema(nodes, (field) => {
    const { id, ...rest } = field;
    const base = { ...rest };

    if (["radio", "select", "checkboxes"].includes(base.type) && Array.isArray(base.options)) {
      base.options = base.options.map(({ id: optId, ...optRest }) => optRest);
    }

    delete base._savedChoiceState;
    delete base._savedStyleSettings;
    delete base._savedChildrenForChoice;
    delete base._savedDisplayModeForChoice;

    return base;
  });
};

export const maxDepthOf = (fields) => {
  let max = 0;
  traverseSchema(fields, (field, context) => {
    max = Math.max(max, context.depth);
  });
  return max;
};

export const validateMaxDepth = (fields, max = MAX_DEPTH) => {
  const depth = maxDepthOf(fields);
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

export const validateRequiredLabels = (fields, { responses = null, visibleOnly = false } = {}) => {
  const emptyLabels = [];

  traverseSchema(fields, (field, context) => {
    if (visibleOnly && field?.isDisplayed !== true) return false;

    const label = (field?.label || "").trim();
    if (!label) {
      emptyLabels.push({ path: context.pathSegments.join(" > ") });
    }
  }, { responses: visibleOnly ? responses : null });

  if (emptyLabels.length > 0) return { ok: false, emptyLabels };
  return { ok: true };
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
