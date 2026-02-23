import { resolveIsDisplayed } from "../core/displayModes.js";
import { traverseSchema } from "../core/schemaUtils.js";

export const collectDisplayFieldSettings = (schema) => {
  const collected = [];

  traverseSchema(schema, (field, context) => {
    if (resolveIsDisplayed(field)) {
      collected.push({
        path: context.pathSegments.join("|"),
        type: field.type || "",
      });
    }
  });

  return collected.sort((a, b) => String(a?.path || "").localeCompare(String(b?.path || ""), "ja"));
};

export const splitFieldPath = (path) => {
  if (!path) return [];
  return String(path)
    .split("|")
    .map((part) => part.trim())
    .filter((part) => part);
};
