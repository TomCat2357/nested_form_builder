import { formatUnixMsDateTimeSec, toUnixMs } from "../../utils/dateTime.js";
import { resolveFileDisplayName } from "../../core/collect.js";
import { findFirstFileUploadField } from "../../core/schema.js";

export const CHOICE_TYPES = new Set(["checkboxes", "radio", "select", "weekday"]);

export const isChoiceMarkerValue = (value) => value === true || value === 1 || value === "1" || value === "●";

export const toChoiceOptionLabels = (field) => {
  const options = Array.isArray(field?.options) ? field.options : [];
  const labels = [];
  const seen = new Set();
  options.forEach((opt) => {
    const label = typeof opt?.label === "string" ? opt.label : "";
    if (!label || seen.has(label)) return;
    labels.push(label);
    seen.add(label);
  });
  return labels;
};

const toRawSelectedLabels = (type, value) => {
  const labels = [];
  const seen = new Set();
  const add = (candidate) => {
    if (typeof candidate !== "string" || !candidate || seen.has(candidate)) return;
    labels.push(candidate);
    seen.add(candidate);
  };

  if (type === "checkboxes") {
    if (Array.isArray(value)) {
      value.forEach((item) => add(item));
      return labels;
    }
    if (typeof value === "string") {
      add(value);
    } else if (value && typeof value === "object") {
      Object.entries(value).forEach(([label, marker]) => {
        if (isChoiceMarkerValue(marker)) add(label);
      });
    }
    return labels;
  }

  if (type === "radio" || type === "select" || type === "weekday") {
    if (typeof value === "string") {
      add(value);
    } else if (Array.isArray(value)) {
      value.forEach((item) => add(item));
    } else if (value && typeof value === "object") {
      Object.entries(value).forEach(([label, marker]) => {
        if (isChoiceMarkerValue(marker)) add(label);
      });
    }
    return labels;
  }

  return labels;
};

export const toSelectedChoiceLabels = (field, value) => {
  const type = field?.type;
  if (!CHOICE_TYPES.has(type)) return [];

  const rawSelected = toRawSelectedLabels(type, value);
  if (rawSelected.length === 0) return [];

  const selectedSet = new Set(rawSelected);
  const ordered = [];
  const seen = new Set();

  toChoiceOptionLabels(field).forEach((label) => {
    if (!selectedSet.has(label) || seen.has(label)) return;
    ordered.push(label);
    seen.add(label);
  });

  rawSelected.forEach((label) => {
    if (seen.has(label)) return;
    ordered.push(label);
    seen.add(label);
  });

  return type === "checkboxes" ? ordered : ordered.slice(0, 1);
};

export const hasVisibleValue = (value) => {
  if (Array.isArray(value)) return value.length > 0;
  return value !== undefined && value !== null && value !== "";
};

export const isTextareaField = (field) => field?.type === "textarea" || (field?.type === "text" && field?.multiline);

const pad = (value) => String(value).padStart(2, "0");

export const formatFileTimestamp = (date) => {
  const safeDate = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  return `${safeDate.getFullYear()}${pad(safeDate.getMonth() + 1)}${pad(safeDate.getDate())}_${pad(safeDate.getHours())}${pad(safeDate.getMinutes())}${pad(safeDate.getSeconds())}`;
};

export const sanitizePrintFileNamePart = (input, fallback = "record") => {
  const normalized = String(input ?? "")
    .trim()
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ");
  return normalized || fallback;
};

export const formatPrintItemValue = (field, value) => {
  if (field?.type === "message") return "";
  if (field?.type === "printTemplate") return "";
  if (field?.type === "substitution") {
    return value != null && value !== "" ? String(value) : "";
  }
  if (field?.type === "fileUpload") {
    const files = Array.isArray(value) ? value : [];
    return files.map((f) => resolveFileDisplayName(f?.name || "不明なファイル", field?.hideFileExtension)).join(", ");
  }
  if (CHOICE_TYPES.has(field?.type)) {
    return toSelectedChoiceLabels(field, value).join(", ");
  }
  if (Array.isArray(value)) return value.join(", ");
  if (value === undefined || value === null || value === "") return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

export const resolveOmitEmptyRowsOnPrint = (settings = {}, overrideValue = undefined) => {
  if (overrideValue !== undefined) return !!overrideValue;
  return settings?.omitEmptyRowsOnPrint !== false;
};

export const resolveShowPrintHeader = (settings = {}, overrideValue = undefined) => {
  if (overrideValue !== undefined) return !!overrideValue;
  return settings?.showPrintHeader !== false;
};

export const formatRecordMetaDateTime = (value) => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" && value.trim() === "") return "";

  const unixMs = toUnixMs(value);
  if (Number.isFinite(unixMs) && unixMs > 0) {
    return formatUnixMsDateTimeSec(unixMs);
  }

  if (typeof value === "string") return value.trim();
  return "";
};

const isExcludedPrintField = (field) => (
  field?.type === "printTemplate"
  || ((field?.type === "message") && field?.excludeFromSearchAndPrint === true)
  || (field?.type === "substitution" && field?.excludeFromSearch === true)
);

const resolveFieldId = (field, depth, index) => field?.id || `tmp_${depth}_${index}_${field?.label || ""}`;

const resolveFieldLabel = (field) => {
  const fallback = field?.type === "message" ? "メッセージ" : "項目";
  return typeof field?.label === "string" && field.label.trim() ? field.label.trim() : fallback;
};

const isAlwaysIncludedPrintType = (type) => type === "message" || type === "fileUpload";

const shouldIncludePrintItem = (item, omitEmptyRows) => {
  if (!omitEmptyRows) return true;
  if (isAlwaysIncludedPrintType(item?.type)) return true;
  return hasVisibleValue(item?.value);
};

const appendPrintItems = (fields, responses, depth, items, options = {}) => {
  (fields || []).forEach((field, index) => {
    const fieldId = resolveFieldId(field, depth, index);
    const normalizedField = { ...field, id: fieldId };
    if (isExcludedPrintField(normalizedField)) return;
    const value = (responses || {})[fieldId] ?? (responses || {})[field?.id];

    const nextItem = {
      label: resolveFieldLabel(normalizedField),
      value: formatPrintItemValue(normalizedField, value),
      depth,
      type: normalizedField?.type || "text",
    };
    if (shouldIncludePrintItem(nextItem, options.omitEmptyRows)) {
      items.push(nextItem);
    }

    const selectedLabels = toSelectedChoiceLabels(normalizedField, value);
    if (!normalizedField?.childrenByValue) return;

    if (normalizedField.type === "checkboxes") {
      selectedLabels.forEach((label) => {
        appendPrintItems(normalizedField.childrenByValue?.[label] || [], responses, depth + 1, items, options);
      });
      return;
    }

    if (normalizedField.type === "radio" || normalizedField.type === "select") {
      const selected = selectedLabels[0];
      if (selected) {
        appendPrintItems(normalizedField.childrenByValue?.[selected] || [], responses, depth + 1, items, options);
      }
    }
  });
  return items;
};

export const buildFieldLabelsMap = (fields, map = {}) => {
  (fields || []).forEach((field) => {
    if (field?.id && typeof field?.label === "string" && field.label.trim()) {
      map[field.id] = field.label.trim();
    }
    if (field?.childrenByValue) {
      Object.values(field.childrenByValue).forEach((children) => {
        buildFieldLabelsMap(children, map);
      });
    }
  });
  return map;
};

export const collectFileUploadMeta = (fields, options = {}) => {
  const meta = {};
  const responses = options?.responses;
  const folderUrlsByField = options?.folderUrlsByField || {};
  const folderNamesByField = options?.folderNamesByField || {};

  const walk = (flds) => {
    (flds || []).forEach((field) => {
      if (field?.type === "fileUpload" && field?.id) {
        const entry = {};
        if (field.hideFileExtension) entry.hideFileExtension = true;
        if (responses) {
          const value = responses[field.id];
          const files = Array.isArray(value) ? value : [];
          entry.fileNames = files
            .map((f) => resolveFileDisplayName(f?.name || "", field?.hideFileExtension))
            .filter(Boolean);
          entry.fileUrls = files.map((f) => f?.driveFileUrl || "").filter(Boolean);
        }
        const folderUrl = folderUrlsByField[field.id];
        if (typeof folderUrl === "string" && folderUrl) entry.folderUrl = folderUrl;
        const folderName = folderNamesByField[field.id];
        if (typeof folderName === "string" && folderName) entry.folderName = folderName;
        if (Object.keys(entry).length > 0) meta[field.id] = entry;
      }
      if (field?.childrenByValue) {
        Object.values(field.childrenByValue).forEach(walk);
      }
    });
  };
  walk(fields);
  return meta;
};

const assignFieldValues = (fields, responses, map, isActive = true, depth = 0) => {
  (fields || []).forEach((field, index) => {
    const fieldId = resolveFieldId(field, depth, index);
    const normalizedField = { ...field, id: fieldId };
    const rawValue = isActive ? ((responses || {})[fieldId] ?? (responses || {})[field?.id]) : "";
    map[fieldId] = isActive ? formatPrintItemValue(normalizedField, rawValue) : "";

    if (!normalizedField?.childrenByValue) return;

    const selectedLabels = isActive ? toSelectedChoiceLabels(normalizedField, rawValue) : [];
    const selectedSet = new Set(selectedLabels);
    Object.entries(normalizedField.childrenByValue).forEach(([optionLabel, children]) => {
      assignFieldValues(children, responses, map, isActive && selectedSet.has(optionLabel), depth + 1);
    });
  });
  return map;
};

export const buildFieldValuesMap = (fields, responses, map = {}) => assignFieldValues(fields, responses, map);

const resolveDriveFolderUrl = (driveFolderState) => {
  if (!driveFolderState || typeof driveFolderState !== "object") return "";
  const inputUrl = typeof driveFolderState.inputUrl === "string" ? driveFolderState.inputUrl.trim() : "";
  const resolvedUrl = typeof driveFolderState.resolvedUrl === "string" ? driveFolderState.resolvedUrl.trim() : "";
  return inputUrl || resolvedUrl;
};

export const buildPrintDocumentPayload = ({
  schema,
  responses,
  settings = {},
  recordId,
  exportedAt = new Date(),
  omitEmptyRows,
  showHeader,
  driveFolderState = null,
  useTemporaryFolder = false,
  folderUrlsByField = {},
}) => {
  const safeExportedAt = exportedAt instanceof Date && !Number.isNaN(exportedAt.getTime()) ? exportedAt : new Date();
  const formTitle = typeof settings.formTitle === "string" && settings.formTitle.trim() ? settings.formTitle.trim() : "受付フォーム";
  const resolvedRecordId = String(recordId || settings.recordId || "").trim() || "record";
  const recordNo = settings.recordNo === undefined || settings.recordNo === null ? "" : String(settings.recordNo).trim();
  const modifiedAt = formatRecordMetaDateTime(settings.modifiedAtUnixMs ?? settings.modifiedAt);
  const recordRef = recordNo || resolvedRecordId;
  const shouldOmitEmptyRows = resolveOmitEmptyRowsOnPrint(settings, omitEmptyRows);
  const shouldShowHeader = resolveShowPrintHeader(settings, showHeader);
  const folderUrl = resolveDriveFolderUrl(driveFolderState);

  const firstUploadField = findFirstFileUploadField(schema);
  const fieldRootFolderUrl = firstUploadField?.driveRootFolderUrl || "";
  const fieldFolderNameTemplate = firstUploadField?.driveFolderNameTemplate || "";

  const hasDriveSettings = fieldRootFolderUrl || fieldFolderNameTemplate || folderUrl || useTemporaryFolder;
  const driveSettings = hasDriveSettings ? {
    rootFolderUrl: fieldRootFolderUrl,
    folderNameTemplate: fieldFolderNameTemplate,
    formId: settings.formId || "",
    recordId: resolvedRecordId,
    folderUrl,
    useTemporaryFolder: !!useTemporaryFolder,
    responses: responses || {},
    fieldLabels: buildFieldLabelsMap(schema),
    fieldValues: buildFieldValuesMap(schema, responses),
    fileUploadMeta: collectFileUploadMeta(schema, {
      responses: responses || {},
      folderUrlsByField,
    }),
  } : undefined;

  return {
    fileName: `印刷様式_${sanitizePrintFileNamePart(formTitle, "form")}_${sanitizePrintFileNamePart(recordRef, "record")}_${formatFileTimestamp(safeExportedAt)}`,
    formTitle,
    formId: settings.formId || "",
    templateSourceUrl: settings.standardPrintTemplateUrl || "",
    recordId: resolvedRecordId,
    recordNo,
    modifiedAt,
    showHeader: shouldShowHeader,
    exportedAtIso: safeExportedAt.toISOString(),
    items: appendPrintItems(schema, responses, 0, [], { omitEmptyRows: shouldOmitEmptyRows }),
    ...(driveSettings ? { driveSettings } : {}),
  };
};

export const buildPrintDocumentBundlePayload = ({ formTitle, records, exportedAt = new Date() }) => {
  const safeExportedAt = exportedAt instanceof Date && !Number.isNaN(exportedAt.getTime()) ? exportedAt : new Date();
  const safeFormTitle = typeof formTitle === "string" && formTitle.trim() ? formTitle.trim() : "受付フォーム";
  const safeRecords = Array.isArray(records) ? records : [];

  return {
    fileName: `印刷様式_${sanitizePrintFileNamePart(safeFormTitle, "form")}_一括_${safeRecords.length}件_${formatFileTimestamp(safeExportedAt)}`,
    formTitle: safeFormTitle,
    exportedAtIso: safeExportedAt.toISOString(),
    records: safeRecords,
  };
};
