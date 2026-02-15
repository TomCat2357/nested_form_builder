import { DISPLAY_MODES, resolveFieldDisplayMode } from "../core/displayModes.js";

const normalizeLabel = (label) => (typeof label === "string" ? label.trim() : "");

const joinPath = (base, label) => {
  const next = normalizeLabel(label);
  return next ? (base ? `${base}|${next}` : next) : base;
};

export const collectDisplayFieldSettings = (schema) => {
  const collected = [];

  const walk = (fields, basePath) => {
    (fields || []).forEach((field) => {
      const label = normalizeLabel(field?.label);
      if (!label) return;
      const path = joinPath(basePath, label);
      const mode = resolveFieldDisplayMode(field);
      if (mode !== DISPLAY_MODES.NONE) {
        collected.push({
          path,
          mode,
          type: field?.type || "",
        });
      }
      if (field?.childrenByValue && typeof field.childrenByValue === "object") {
        Object.entries(field.childrenByValue).forEach(([key, childFields]) => {
          const valuePath = joinPath(path, key);
          walk(childFields, valuePath);
        });
      }
    });
  };

  walk(Array.isArray(schema) ? schema : [], "");

  return collected.sort((a, b) => String(a?.path || "").localeCompare(String(b?.path || ""), "ja"));
};

export const splitFieldPath = (path) => {
  if (!path) return [];
  return String(path)
    .split("|")
    .map((part) => part.trim())
    .filter((part) => part);
};
