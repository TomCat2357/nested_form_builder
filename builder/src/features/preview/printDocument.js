export const CHOICE_TYPES = new Set(["checkboxes", "radio", "select"]);

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

  if (type === "radio" || type === "select") {
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
  if (CHOICE_TYPES.has(field?.type)) {
    return toSelectedChoiceLabels(field, value).join(", ");
  }
  if (Array.isArray(value)) return value.join(", ");
  if (value === undefined || value === null || value === "") return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

const resolveFieldId = (field, depth, index) => field?.id || `tmp_${depth}_${index}_${field?.label || ""}`;

const resolveFieldLabel = (field) => {
  const fallback = field?.type === "message" ? "メッセージ" : "項目";
  return typeof field?.label === "string" && field.label.trim() ? field.label.trim() : fallback;
};

const shouldIncludePrintItem = (item, omitEmptyRows) => {
  if (!omitEmptyRows) return true;
  if (item?.type === "message") return true;
  return hasVisibleValue(item?.value);
};

const appendPrintItems = (fields, responses, depth, items, options = {}) => {
  (fields || []).forEach((field, index) => {
    const fieldId = resolveFieldId(field, depth, index);
    const normalizedField = { ...field, id: fieldId };
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

export const buildPrintDocumentPayload = ({ schema, responses, settings = {}, recordId, exportedAt = new Date(), omitEmptyRows = false }) => {
  const safeExportedAt = exportedAt instanceof Date && !Number.isNaN(exportedAt.getTime()) ? exportedAt : new Date();
  const formTitle = typeof settings.formTitle === "string" && settings.formTitle.trim() ? settings.formTitle.trim() : "受付フォーム";
  const resolvedRecordId = String(recordId || settings.recordId || "").trim() || "record";
  const recordNo = settings.recordNo === undefined || settings.recordNo === null ? "" : String(settings.recordNo).trim();
  const recordRef = recordNo || resolvedRecordId;

  return {
    fileName: `印刷フォーム_${sanitizePrintFileNamePart(formTitle, "form")}_${sanitizePrintFileNamePart(recordRef, "record")}_${formatFileTimestamp(safeExportedAt)}`,
    formTitle,
    recordId: resolvedRecordId,
    recordNo,
    exportedAtIso: safeExportedAt.toISOString(),
    items: appendPrintItems(schema, responses, 0, [], { omitEmptyRows: !!omitEmptyRows }),
  };
};

export const buildPrintDocumentBundlePayload = ({ formTitle, records, exportedAt = new Date() }) => {
  const safeExportedAt = exportedAt instanceof Date && !Number.isNaN(exportedAt.getTime()) ? exportedAt : new Date();
  const safeFormTitle = typeof formTitle === "string" && formTitle.trim() ? formTitle.trim() : "受付フォーム";
  const safeRecords = Array.isArray(records) ? records : [];

  return {
    fileName: `印刷フォーム_${sanitizePrintFileNamePart(safeFormTitle, "form")}_一括_${safeRecords.length}件_${formatFileTimestamp(safeExportedAt)}`,
    formTitle: safeFormTitle,
    exportedAtIso: safeExportedAt.toISOString(),
    records: safeRecords,
  };
};
