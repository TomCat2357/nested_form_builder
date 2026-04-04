import { genId } from "./ids.js";
import { DEFAULT_STYLE_SETTINGS, normalizeStyleSettings } from "./styleSettings.js";
import { MAX_DEPTH } from "./constants.js";
import { normalizePhoneSettings } from "./phone.js";
import { traverseSchema, countSchemaNodes } from "./schemaUtils.js";
export { countSchemaNodes };

const sanitizeOptionLabel = (label) => (/^選択肢\d+$/.test(label || "") ? "" : label || "");
const UI_TEMP_KEYS = [
  "_savedChoiceState",
  "_savedStyleSettings",
  "_savedChildrenForChoice",
  "_savedDisplayModeForChoice",
];

const clearUiTempState = (obj) => {
  UI_TEMP_KEYS.forEach((key) => {
    delete obj[key];
  });
};

const stableHash = (seed) => {
  let hash = 2166136261;
  const text = String(seed || "");
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

const buildStableFieldId = (field, context) => {
  const path = Array.isArray(context?.pathSegments) ? context.pathSegments.join("|") : "";
  const index = Number.isFinite(context?.index) ? context.index : -1;
  const depth = Number.isFinite(context?.depth) ? context.depth : -1;
  const fieldType = field?.type || "field";
  return `f_auto_${stableHash(`${fieldType}|${depth}|${index}|${path}`)}`;
};

const buildStableOptionId = (fieldId, optionLabel, optionIndex) => {
  const index = Number.isFinite(optionIndex) ? optionIndex : -1;
  return `o_auto_${stableHash(`${fieldId}|${index}|${optionLabel || ""}`)}`;
};

const collectOrderedChildKeys = (field) => {
  const branches = field?.childrenByValue;
  if (!branches || typeof branches !== "object") return [];

  const branchKeys = Object.keys(branches);
  if (branchKeys.length === 0) return [];

  const ordered = [];
  const seen = new Set();
  const options = Array.isArray(field?.options) ? field.options : [];

  options.forEach((opt) => {
    const label = typeof opt?.label === "string" ? opt.label : "";
    if (seen.has(label) || !Object.prototype.hasOwnProperty.call(branches, label)) return;
    ordered.push(label);
    seen.add(label);
  });

  branchKeys.forEach((key) => {
    if (seen.has(key)) return;
    ordered.push(key);
    seen.add(key);
  });

  return ordered;
};

export const SCHEMA_STORAGE_KEY = "nested_form_builder_schema_slim_v1";
export { MAX_DEPTH };
export const DEFAULT_TEXT_MAX_LENGTH = 20;

const normalizeBooleanSetting = (value, defaultValue = false) => {
  if (value === undefined) return defaultValue;
  if (typeof value === "string") {
    const lowered = value.toLowerCase();
    if (lowered === "true") return true;
    if (lowered === "false") return false;
  }
  return !!value;
};

const normalizeFiniteNumberSetting = (value) => {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const normalizeNumberFieldSettings = (field) => {
  field.integerOnly = normalizeBooleanSetting(field.integerOnly, false);

  const minValue = normalizeFiniteNumberSetting(field.minValue);
  if (minValue === undefined) delete field.minValue;
  else field.minValue = minValue;

  const maxValue = normalizeFiniteNumberSetting(field.maxValue);
  if (maxValue === undefined) delete field.maxValue;
  else field.maxValue = maxValue;

  return field;
};

const normalizePrintTemplateSettings = (value) => {
  const base = value && typeof value === "object" ? value : {};
  const outputType = typeof base.outputType === "string" && base.outputType.trim() ? base.outputType.trim() : "googleDoc";
  return {
    enabled: base.enabled === true,
    templateUrl: typeof base.templateUrl === "string" ? base.templateUrl : "",
    fileNameTemplate: typeof base.fileNameTemplate === "string" ? base.fileNameTemplate : "",
    outputType,
    buttonLabel: typeof base.buttonLabel === "string" ? base.buttonLabel : "",
  };
};


export const deepClone = (value) => {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};

const buildMigratedPrintTemplateField = (sourceField, sourceFieldId) => {
  const normalizedAction = normalizePrintTemplateSettings(sourceField?.printTemplateAction);
  if (!normalizedAction.enabled) return null;

  const baseLabel = typeof sourceField?.label === "string" && sourceField.label.trim()
    ? sourceField.label.trim()
    : "ファイルアップロード";

  return {
    id: `f_auto_${stableHash(`${sourceFieldId}|printTemplate`)}`,
    type: "printTemplate",
    label: `${baseLabel} 様式出力`,
    isDisplayed: !!sourceField?.isDisplayed,
    printTemplateAction: {
      ...normalizedAction,
      enabled: true,
    },
  };
};

export const cleanUnusedFieldProperties = (field) => {
  const type = field.type;
  const isChoice = ["radio", "select", "checkboxes"].includes(type);
  const supportsPattern = ["text", "regex"].includes(type);
  const supportsTextDefaults = ["text", "userName"].includes(type);
  const supportsEmailAutoFill = type === "email";
  const supportsNumberSettings = type === "number";
  const supportsPhone = type === "phone";
  const supportsDefaultNow = ["date", "time"].includes(type);
  const supportsPlaceholder = ["text", "number", "email", "phone", "url", "regex", "textarea"].includes(type);
  const supportsSearchAndPrintExclusion = type === "message";
  const supportsPrintTemplateAction = type === "printTemplate";

  if (!isChoice) {
    delete field.options;
    delete field.childrenByValue;
  }
  if (isChoice && Array.isArray(field.options)) {
    field.options = field.options.map((opt) => ({ ...opt, defaultSelected: !!opt?.defaultSelected }));
  }
  if (!supportsPattern) {
    delete field.pattern;
    delete field.inputRestrictionMode;
    delete field.maxLength;
  }
  if (field.type === "text" && field.inputRestrictionMode !== "pattern") delete field.pattern;
  if (field.type === "text" && field.inputRestrictionMode !== "maxLength") delete field.maxLength;
  if (!supportsTextDefaults) {
    delete field.multiline;
    delete field.defaultValueMode;
    delete field.defaultValueText;
  }
  if (!supportsDefaultNow) delete field.defaultNow;
  if (!supportsEmailAutoFill) delete field.autoFillUserEmail;
  if (!supportsNumberSettings) {
    delete field.integerOnly;
    delete field.minValue;
    delete field.maxValue;
  } else {
    normalizeNumberFieldSettings(field);
  }
  if (!supportsPhone) {
    delete field.phoneFormat;
    delete field.allowFixedLineOmitAreaCode;
    delete field.allowMobile;
    delete field.allowIpPhone;
    delete field.allowTollFree;
    delete field.autoFillUserPhone;
  }
  if (!supportsPlaceholder) {
    delete field.placeholder;
    delete field.showPlaceholder;
  }
  if (!supportsSearchAndPrintExclusion) {
    delete field.excludeFromSearchAndPrint;
  } else {
    field.excludeFromSearchAndPrint = normalizeBooleanSetting(field.excludeFromSearchAndPrint, false);
  }
  if (supportsPrintTemplateAction) {
    field.printTemplateAction = {
      ...normalizePrintTemplateSettings(field.printTemplateAction),
      enabled: true,
    };
  } else {
    delete field.printTemplateAction;
  }
  if (type === "message" || type === "printTemplate") delete field.required;
  if (type === "fileUpload") {
    field.allowUploadByUrl = normalizeBooleanSetting(field.allowUploadByUrl, false);
  } else {
    delete field.allowUploadByUrl;
  }
  delete field.allowMultipleFiles;
  return field;
};

export const normalizeSchemaIDs = (nodes) => {
  const normalizeField = (field, context) => {
    const id = field.id || buildStableFieldId(field, context);
    const base = { ...field, id };

    if (base.type === "textarea") {
      base.type = "text";
      base.multiline = true;
    } else if (base.type === "regex") {
      base.type = "text";
      base.multiline = false;
      base.inputRestrictionMode = "pattern";
      base.pattern = typeof base.pattern === "string" ? base.pattern : "";
    } else if (base.type === "userName") {
      base.type = "text";
      base.multiline = false;
      base.defaultValueMode = "userName";
    }

    if (["radio", "select", "checkboxes"].includes(base.type)) {
      base.options = (base.options || []).map((opt, optionIndex) => {
        const optionLabel = sanitizeOptionLabel(opt?.label);
        return {
          id: opt?.id || buildStableOptionId(id, optionLabel, optionIndex),
          label: optionLabel,
          defaultSelected: !!opt?.defaultSelected,
        };
      });
      if (["radio", "select"].includes(base.type)) {
        let seenSelected = false;
        base.options = base.options.map((opt) => {
          if (!opt.defaultSelected || seenSelected) return { ...opt, defaultSelected: false };
          seenSelected = true;
          return opt;
        });
      }
    } else if (base.type === "text") {
      base.multiline = !!base.multiline;
      base.defaultValueMode = [ "none", "userName", "userAffiliation", "userTitle", "custom" ].includes(base.defaultValueMode)
        ? base.defaultValueMode
        : "none";
      base.defaultValueText = typeof base.defaultValueText === "string" ? base.defaultValueText : "";
      if (base.inputRestrictionMode === "maxLength") {
        const parsedMaxLength = Number(base.maxLength);
        base.inputRestrictionMode = "maxLength";
        base.maxLength = Number.isFinite(parsedMaxLength) && parsedMaxLength > 0
          ? Math.floor(parsedMaxLength)
          : DEFAULT_TEXT_MAX_LENGTH;
      } else if (base.inputRestrictionMode === "pattern") {
        base.inputRestrictionMode = "pattern";
      } else {
        base.inputRestrictionMode = "none";
      }
      base.pattern = typeof base.pattern === "string" ? base.pattern : "";
    } else if (base.type === "number") {
      normalizeNumberFieldSettings(base);
    } else if (["date", "time"].includes(base.type)) {
      base.defaultNow = !!base.defaultNow;
    } else if (base.type === "email") {
      base.autoFillUserEmail = !!(base.autoFillUserEmail ?? base.defaultNow);
    } else if (base.type === "phone") {
      Object.assign(base, normalizePhoneSettings(base));
    } else if (base.type === "fileUpload") {
      base.allowUploadByUrl = normalizeBooleanSetting(base.allowUploadByUrl, false);
    } else if (base.type === "printTemplate") {
      base.label = typeof base.label === "string" && base.label.trim() ? base.label : "様式出力";
      base.printTemplateAction = {
        ...normalizePrintTemplateSettings(base.printTemplateAction),
        enabled: true,
      };
    }

    cleanUnusedFieldProperties(base);
    base.isDisplayed = !!base.isDisplayed;

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

    clearUiTempState(base);

    return base;
  };

  const normalizeNodes = (inputNodes, pathSegments = [], depth = 1) => {
    const sourceNodes = Array.isArray(inputNodes) ? inputNodes : [];
    const normalizedNodes = [];

    sourceNodes.forEach((field, index) => {
      const fieldLabel = (field?.label || "").trim();
      const currentPath = [...pathSegments, fieldLabel];
      const context = { pathSegments: currentPath, index, depth };
      const sourceFieldId = field?.id || buildStableFieldId(field, context);
      const migratedPrintTemplateField = field?.type === "fileUpload"
        ? buildMigratedPrintTemplateField(field, sourceFieldId)
        : null;
      const normalizedField = normalizeField(field, context);

      if (normalizedField?.childrenByValue && typeof normalizedField.childrenByValue === "object") {
        const nextChildren = {};
        collectOrderedChildKeys(normalizedField).forEach((optionLabel) => {
          nextChildren[optionLabel] = normalizeNodes(
            normalizedField.childrenByValue[optionLabel],
            [...currentPath, optionLabel],
            depth + 1,
          );
        });
        normalizedField.childrenByValue = nextChildren;
      }

      normalizedNodes.push(normalizedField);
      if (migratedPrintTemplateField) {
        normalizedNodes.push(normalizeField(migratedPrintTemplateField, {
          pathSegments: [...pathSegments, migratedPrintTemplateField.label],
          index: index + 0.5,
          depth,
        }));
      }
    });

    return normalizedNodes;
  };

  return normalizeNodes(nodes);
};

export const stripSchemaIDs = (nodes) => {
  return mapSchema(nodes, (field) => {
    const { id, ...rest } = field;
    const base = { ...rest };

    if (["radio", "select", "checkboxes"].includes(base.type) && Array.isArray(base.options)) {
      base.options = base.options.map(({ id: optId, ...optRest }) => optRest);
    }

    clearUiTempState(base);

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
