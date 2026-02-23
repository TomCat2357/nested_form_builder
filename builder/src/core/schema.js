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

    if (base.showStyleSettings === true && (!base.styleSettings || typeof base.styleSettings !== "object")) {
      base.styleSettings = { ...DEFAULT_STYLE_SETTINGS };
    } else if (base.styleSettings && typeof base.styleSettings === "object") {
      base.styleSettings = normalizeStyleSettings(base.styleSettings);
    }

    if (base._savedChoiceState && typeof base._savedChoiceState === "object") {
      base._savedChoiceState = {
        options: base._savedChoiceState.options
          ? base._savedChoiceState.options.map((opt) => ({
              id: opt?.id || genId(),
              label: sanitizeOptionLabel(opt?.label),
            }))
          : undefined,
        childrenByValue: base._savedChoiceState.childrenByValue,
      };
    }

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

    if (base._savedChoiceState && typeof base._savedChoiceState === "object") {
      base._savedChoiceState = {
        ...base._savedChoiceState,
        options: Array.isArray(base._savedChoiceState.options)
          ? base._savedChoiceState.options.map(({ id: optId, ...optRest }) => optRest)
          : base._savedChoiceState.options,
        childrenByValue: base._savedChoiceState.childrenByValue,
      };
    }

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

export const cleanupTempData = (schema) => {
  return mapSchema(schema, (field) => {
    const cleaned = { ...field };

    cleaned.isDisplayed = resolveIsDisplayed(cleaned);
    delete cleaned.displayMode;
    delete cleaned.important;
    delete cleaned.compact;

    delete cleaned._savedChildrenForChoice;
    delete cleaned._savedDisplayModeForChoice;
    delete cleaned._savedStyleSettings;

    if (typeof cleaned.showStyleSettings === "string") {
      const raw = cleaned.showStyleSettings;
      const lowered = raw.trim().toLowerCase();
      if (["true", "1", "yes", "on"].includes(lowered)) cleaned.showStyleSettings = true;
      else if (["false", "0", "no", "off", ""].includes(lowered)) cleaned.showStyleSettings = false;
      else cleaned.showStyleSettings = true;
    }
    const hasExplicitShowStyleSettings = typeof cleaned.showStyleSettings === "boolean";
    const shouldKeepStyleSettings = hasExplicitShowStyleSettings ? cleaned.showStyleSettings : !!cleaned.styleSettings;

    if (!shouldKeepStyleSettings) {
      delete cleaned.styleSettings;
    }

    if (hasExplicitShowStyleSettings) {
      cleaned.showStyleSettings = !!cleaned.showStyleSettings;
    } else if (cleaned.styleSettings) {
      cleaned.showStyleSettings = true;
    } else {
      delete cleaned.showStyleSettings;
    }

    if (["radio", "select", "checkboxes"].includes(cleaned.type)) {
      delete cleaned.pattern;
      delete cleaned.defaultNow;
      delete cleaned.placeholder;
      delete cleaned.showPlaceholder;
    } else {
      delete cleaned.options;
      delete cleaned.childrenByValue;
      delete cleaned._savedChoiceState;

      if (cleaned.type === "regex") {
        delete cleaned.defaultNow;
        if (!cleaned.showPlaceholder) delete cleaned.placeholder;
      } else if (["date", "time", "userName"].includes(cleaned.type)) {
        delete cleaned.pattern;
        delete cleaned.placeholder;
        delete cleaned.showPlaceholder;
      } else if (cleaned.type === "message") {
        delete cleaned.pattern;
        delete cleaned.defaultNow;
        delete cleaned.placeholder;
        delete cleaned.showPlaceholder;
        delete cleaned.required;
      } else {
        delete cleaned.pattern;
        delete cleaned.defaultNow;
        if (!cleaned.showPlaceholder) delete cleaned.placeholder;
      }
    }

    return cleaned;
  });
};
