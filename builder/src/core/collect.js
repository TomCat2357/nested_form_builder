import { traverseSchema } from "./schemaUtils.js";

export const sanitizeFileUploadEntry = (entry) => {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const name = typeof entry.name === "string" ? entry.name : "";
  const driveFileId = typeof entry.driveFileId === "string" ? entry.driveFileId : "";
  const driveFileUrl = typeof entry.driveFileUrl === "string" ? entry.driveFileUrl : "";
  if (!name && !driveFileId && !driveFileUrl) return null;
  return { name, driveFileId, driveFileUrl };
};

const serializeFileUploadValue = (value) => {
  const files = Array.isArray(value)
    ? value.map((entry) => sanitizeFileUploadEntry(entry)).filter(Boolean)
    : [];
  if (files.length === 0) return "";
  return JSON.stringify(files);
};

export const collectResponses = (fields, responses) => {
  const out = {};
  const orderList = [];

  traverseSchema(fields, (field, context) => {
    const value = responses?.[field.id];
    const base = context.pathSegments.join("|");

    if (field.type === "checkboxes" && Array.isArray(value)) {
      value.forEach((lbl) => {
        const key = `${base}|${lbl}`;
        out[key] = "●";
        orderList.push(key);
      });
    } else if (["radio", "select", "weekday"].includes(field.type) && typeof value === "string" && value) {
      const key = `${base}|${value}`;
      out[key] = "●";
      orderList.push(key);
    } else if (field.type === "fileUpload") {
      const serialized = serializeFileUploadValue(value);
      if (serialized) {
        out[base] = serialized;
        orderList.push(base);
      }
    } else if (["text", "textarea", "number", "regex", "date", "time", "url", "userName", "email", "phone"].includes(field.type) && value != null && value !== "") {
      out[base] = value;
      orderList.push(base);
    }
  }, { responses });

  return out;
};

export const collectAllPossiblePaths = (fields) => {
  const paths = [];

  traverseSchema(fields, (field, context) => {
    const base = context.pathSegments.join("|");

    if (["checkboxes", "radio", "select", "weekday"].includes(field.type) && Array.isArray(field.options)) {
      field.options.forEach((option) => {
        const optionLabel = option.label || "";
        paths.push(`${base}|${optionLabel}`);
      });
    } else if (field.type === "fileUpload") {
      paths.push(base);
    } else if (["text", "textarea", "number", "regex", "date", "time", "url", "userName", "email", "phone"].includes(field.type)) {
      paths.push(base);
    }
  });

  return paths;
};

export const resolveFileDisplayName = (fileName, hideExtension) => {
  if (!fileName) return "ファイル";
  if (!hideExtension) return fileName;
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
};

export const sortResponses = (responses, schema = null) => {
  const source = responses || {};

  if (schema) {
    const allPaths = collectAllPossiblePaths(schema);
    const sorted = {};
    allPaths.forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        sorted[key] = source[key];
      }
    });
    return { map: sorted, keys: allPaths };
  }

  const keys = Object.keys(source).sort((a, b) => String(a).localeCompare(String(b), "ja"));
  const sorted = {};
  keys.forEach((key) => {
    sorted[key] = source[key];
  });
  return { map: sorted, keys };
};
