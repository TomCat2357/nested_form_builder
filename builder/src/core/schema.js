import { genId } from "./ids.js";
import { DEFAULT_STYLE_SETTINGS, normalizeStyleSettings } from "./styleSettings.js";
import { MAX_DEPTH } from "./constants.js";
import { normalizePhoneSettings } from "./phone.js";
import { traverseSchema, countSchemaNodes, resolveOrderedChildKeys, mapSchema } from "./schemaUtils.js";
import {
  normalizePrintTemplateAction,
  resolvePrintTemplateFieldLabel,
} from "../utils/printTemplateAction.js";
import { checkNumberFieldConfig, NUMBER_MODES } from "./validate.js";
export { countSchemaNodes };

// Webhook 質問カードの設定を正規化する。{ url, adminOnly } の形に揃える。
// URL の妥当性チェック（http(s) 始まりか）は編集 UI / 送信時に行う。
export const normalizeWebhookAction = (raw) => {
  const obj = raw && typeof raw === "object" ? raw : {};
  return {
    url: typeof obj.url === "string" ? obj.url : "",
    adminOnly: !!obj.adminOnly,
  };
};

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

export { MAX_DEPTH };
export const DEFAULT_TEXT_MAX_LENGTH = 20;
export const DEFAULT_MULTILINE_ROWS = 4;

const SUPPORTS_CHILDREN_TYPES = new Set([
  "text", "number", "email", "phone", "url", "date", "time", "fileUpload",
  // message は「回答」概念を持たないが、子質問を無条件（常に表示）で持てる。
  "message",
]);
export const supportsChildren = (type) => SUPPORTS_CHILDREN_TYPES.has(type);

// プレースホルダーを書けない（= placeholder 非対応の）全タイプで補足コメントを書ける。
// 正規化後タイプで判定する（textarea / regex / userName は text 等へ正規化済み）。
const SUPPORTS_PLACEHOLDER_TYPES = ["text", "number", "email", "phone", "url", "regex", "textarea"];
export const supportsSupplementaryComment = (type) => !SUPPORTS_PLACEHOLDER_TYPES.includes(type);

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

const normalizeNumberMode = (field) => {
  if (NUMBER_MODES.includes(field.numberMode)) return field.numberMode;
  if (normalizeBooleanSetting(field.integerOnly, false)) return "integer";
  return "unrestricted";
};

const normalizeNumberFieldSettings = (field) => {
  field.numberMode = normalizeNumberMode(field);
  delete field.integerOnly;

  const minValue = normalizeFiniteNumberSetting(field.minValue);
  if (minValue === undefined) delete field.minValue;
  else field.minValue = minValue;

  const maxValue = normalizeFiniteNumberSetting(field.maxValue);
  if (maxValue === undefined) delete field.maxValue;
  else field.maxValue = maxValue;

  return field;
};

// formLink フィールドの参照先（childFormId=対象fileId / childFormPath=表示用の論理パス）を
// 文字列へ揃える。schema 正規化・型変更ハンドラで共有する。
export const normalizeFormLinkSettings = (field) => {
  field.childFormId = typeof field.childFormId === "string" ? field.childFormId : "";
  field.childFormPath = typeof field.childFormPath === "string" ? field.childFormPath : "";
  // 子フォーム（pid==このレコード id の別フォーム行）のデータを Webhook / 印刷様式へ渡すか。
  // 既定 false（既存フォームは従来どおり子データ無し）。
  field.includeChildData = normalizeBooleanSetting(field.includeChildData, false);
  return field;
};

// fileUpload フィールドの Drive 連携設定を正規化する。schema 正規化（normalizeField）と
// 不要プロパティ整理（cleanUnusedFieldProperties）の双方で共有する。
export const normalizeFileUploadSettings = (field) => {
  field.allowUploadByUrl = normalizeBooleanSetting(field.allowUploadByUrl, false);
  field.allowFolderUrlEdit = normalizeBooleanSetting(field.allowFolderUrlEdit, false);
  field.hideFileExtension = normalizeBooleanSetting(field.hideFileExtension, true);
  field.driveRootFolderUrl = typeof field.driveRootFolderUrl === "string" ? field.driveRootFolderUrl : "";
  field.driveFolderNameTemplate = typeof field.driveFolderNameTemplate === "string" ? field.driveFolderNameTemplate : "";
  return field;
};

export const deepClone = (value) => {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};

const buildMigratedPrintTemplateField = (sourceField, sourceFieldId) => {
  const normalizedAction = normalizePrintTemplateAction(sourceField?.printTemplateAction);
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
  const supportsSearchExclusion = type === "substitution";
  const supportsHideFromRecordView = type === "substitution";
  const supportsTemplateText = type === "substitution";
  const supportsPrintTemplateAction = type === "printTemplate";
  const supportsWebhookAction = type === "webhook";
  const supportsFormLink = type === "formLink";

  if (!isChoice) {
    delete field.options;
    delete field.childrenByValue;
  }
  if (!supportsChildren(type)) {
    delete field.children;
  } else if (field.children !== undefined && !Array.isArray(field.children)) {
    delete field.children;
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
    delete field.multilineRows;
    delete field.defaultValueMode;
    delete field.defaultValueText;
  }
  if (field.type === "text" && !field.multiline) {
    delete field.multilineRows;
  }
  if (!supportsDefaultNow) delete field.defaultNow;
  if (type !== "time") {
    delete field.includeSeconds;
    delete field.timePrecision;
  } else {
    // legacy includeSeconds は timePrecision へ集約済み（normalizeSchemaIDs）。残骸を除去。
    delete field.includeSeconds;
  }
  delete field.defaultToday;
  if (!supportsEmailAutoFill) delete field.autoFillUserEmail;
  if (!supportsNumberSettings) {
    delete field.integerOnly;
    delete field.numberMode;
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
  // 補足コメント: placeholder 非対応タイプのみ保持。空文字は prune してデータを膨らませない。
  if (!supportsSupplementaryComment(type)
      || typeof field.supplementaryComment !== "string"
      || !field.supplementaryComment.trim()) {
    delete field.supplementaryComment;
  }
  if (!supportsSupplementaryComment(type)) {
    delete field.showSupplementaryComment;
  }
  if (!supportsSearchAndPrintExclusion) {
    delete field.excludeFromSearchAndPrint;
  } else {
    field.excludeFromSearchAndPrint = normalizeBooleanSetting(field.excludeFromSearchAndPrint, false);
  }
  if (supportsPrintTemplateAction) {
    field.printTemplateAction = {
      ...normalizePrintTemplateAction(field.printTemplateAction),
      enabled: true,
    };
  } else {
    delete field.printTemplateAction;
  }
  if (supportsWebhookAction) {
    field.webhookAction = normalizeWebhookAction(field.webhookAction);
  } else {
    delete field.webhookAction;
  }
  if (supportsFormLink) {
    normalizeFormLinkSettings(field);
  } else {
    delete field.childFormId;
    delete field.childFormPath;
    delete field.includeChildData;
  }
  delete field.formula;
  if (supportsTemplateText) {
    field.templateText = typeof field.templateText === "string" ? field.templateText : "";
  } else {
    delete field.templateText;
  }
  if (supportsSearchExclusion) {
    field.excludeFromSearch = !!field.excludeFromSearch;
  } else {
    delete field.excludeFromSearch;
  }
  if (supportsHideFromRecordView) {
    field.hideFromRecordView = !!field.hideFromRecordView;
  } else {
    delete field.hideFromRecordView;
  }
  if (type === "message" || type === "printTemplate" || type === "substitution" || type === "webhook" || type === "formLink") delete field.required;
  if (type === "fileUpload") {
    normalizeFileUploadSettings(field);
  } else {
    delete field.allowUploadByUrl;
    delete field.allowFolderUrlEdit;
    delete field.hideFileExtension;
    delete field.driveRootFolderUrl;
    delete field.driveFolderNameTemplate;
  }
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
      if (base.multiline) {
        const parsed = Number(base.multilineRows);
        base.multilineRows = Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : DEFAULT_MULTILINE_ROWS;
      } else {
        delete base.multilineRows;
      }
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
      if (base.type === "time") {
        // 時刻精度: timePrecision が正なら維持、なければ legacy includeSeconds から導出
        //（false → "minute" / true・未設定 → "second"）。新規既定は "second"。
        const validPrecisions = ["minute", "second", "millisecond"];
        if (!validPrecisions.includes(base.timePrecision)) {
          base.timePrecision = base.includeSeconds === false ? "minute" : "second";
        }
        delete base.includeSeconds;
      }
    } else if (base.type === "email") {
      base.autoFillUserEmail = !!(base.autoFillUserEmail ?? base.defaultNow);
    } else if (base.type === "phone") {
      Object.assign(base, normalizePhoneSettings(base));
    } else if (base.type === "fileUpload") {
      normalizeFileUploadSettings(base);
    } else if (base.type === "printTemplate") {
      base.label = typeof base.label === "string" ? base.label : "";
      base.printTemplateAction = {
        ...normalizePrintTemplateAction(base.printTemplateAction),
        enabled: true,
      };
    } else if (base.type === "substitution") {
      base.templateText = typeof base.templateText === "string" ? base.templateText : "";
      base.excludeFromSearch = !!base.excludeFromSearch;
      base.hideFromRecordView = !!base.hideFromRecordView;
    } else if (base.type === "formLink") {
      base.label = typeof base.label === "string" ? base.label : "";
      normalizeFormLinkSettings(base);
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
        resolveOrderedChildKeys(normalizedField).forEach((optionLabel) => {
          nextChildren[optionLabel] = normalizeNodes(
            normalizedField.childrenByValue[optionLabel],
            [...currentPath, optionLabel],
            depth + 1,
          );
        });
        normalizedField.childrenByValue = nextChildren;
      }

      if (Array.isArray(normalizedField?.children)) {
        normalizedField.children = normalizeNodes(
          normalizedField.children,
          [...currentPath],
          depth + 1,
        );
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

// GAS 側の双子は gas/schemaUtils.gs の nfbStripSchemaIDs_。振る舞いを変える場合は
// 両側を揃えること。等価性は tests/schema-walkers-equivalence.test.cjs で担保。
export const stripSchemaIDs = (nodes) =>
  mapSchema(nodes, (field) => {
    const base = {};
    if (field && typeof field === "object") {
      for (const key in field) {
        if (!Object.prototype.hasOwnProperty.call(field, key)) continue;
        if (key === "id") continue;
        base[key] = field[key];
      }
    }
    if (Array.isArray(base.options)) {
      const newOpts = [];
      for (let i = 0; i < base.options.length; i++) {
        const opt = base.options[i];
        const optBase = {};
        if (opt && typeof opt === "object") {
          for (const ok in opt) {
            if (!Object.prototype.hasOwnProperty.call(opt, ok)) continue;
            if (ok === "id") continue;
            optBase[ok] = opt[ok];
          }
        }
        newOpts.push(optBase);
      }
      base.options = newOpts;
    }
    for (let u = 0; u < UI_TEMP_KEYS.length; u++) delete base[UI_TEMP_KEYS[u]];
    return base;
  });

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

// ラベルに使うことを禁止する文字。
// バッククォートはテンプレ式 `{ `name` }` の識別子区切りに使われるため、
// ラベル中に混入すると scanTokens / forEachBacktickIdent が破綻する。
const FORBIDDEN_LABEL_CHARS = "`";

const findForbiddenLabelChar = (label) => {
  const text = String(label || "");
  for (let i = 0; i < FORBIDDEN_LABEL_CHARS.length; i += 1) {
    const ch = FORBIDDEN_LABEL_CHARS.charAt(i);
    if (text.indexOf(ch) >= 0) return ch;
  }
  return null;
};

export const validateLabelCharacters = (fields) => {
  const invalidLabels = [];
  traverseSchema(fields, (field, context) => {
    const label = (field?.label || "").trim();
    if (!label) return;
    const ch = findForbiddenLabelChar(label);
    if (ch) {
      invalidLabels.push({
        path: context.pathSegments.join(" > "),
        label,
        char: ch,
      });
    }
  });
  if (invalidLabels.length > 0) return { ok: false, invalidLabels };
  return { ok: true };
};

export const validateRequiredLabels = (fields, { responses = null, visibleOnly = false } = {}) => {
  const emptyLabels = [];

  traverseSchema(fields, (field, context) => {
    if (visibleOnly && field?.isDisplayed !== true) return false;

    if (field?.type === "printTemplate") return;

    const label = (field?.label || "").trim();
    if (!label) {
      emptyLabels.push({ path: context.pathSegments.join(" > ") });
    }
  }, { responses: visibleOnly ? responses : null });

  if (emptyLabels.length > 0) return { ok: false, emptyLabels };
  return { ok: true };
};

// 数値フィールドの設定（モード別の最小値必須・整数・下限・min≤max）を検証する。
// FormBuilderWorkspace.handleSave から呼び、不正があれば保存をブロックする。
export const validateNumberFieldConfigs = (fields) => {
  const invalidFields = [];
  traverseSchema(fields, (field, context) => {
    if (field?.type !== "number") return;
    const result = checkNumberFieldConfig(field);
    if (!result.ok) {
      invalidFields.push({ path: context.pathSegments.join(" > "), message: result.message });
    }
  });
  if (invalidFields.length > 0) return { ok: false, invalidFields };
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

// fileUpload フィールドの収集は共有走査 traverseSchema に委譲する（DFS pre-order）。
// 正規化済みスキーマでは childrenByValue の挿入順 = options 順 = resolveOrderedChildKeys 順
// のため、従来の手書き走査と同じ順序で訪問する。
export const collectFileUploadFields = (fields) => {
  const out = [];
  traverseSchema(fields, (field) => {
    if (field?.type === "fileUpload") out.push(field);
  });
  return out;
};

export const findFirstFileUploadField = (fields) => {
  let found = null;
  traverseSchema(fields, (field) => {
    if (found) return false;
    if (field?.type === "fileUpload") {
      found = field;
      return false;
    }
  });
  return found;
};

export { resolvePrintTemplateFieldLabel };
