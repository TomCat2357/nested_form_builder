import { resolveIsDisplayed } from "../core/displayModes.js";
import { traverseSchema } from "../core/schemaUtils.js";
import { resolvePrintTemplateFieldLabel } from "../core/schema.js";

const isExcludedDisplayField = (field) => (
  field?.type === "message" && field?.excludeFromSearchAndPrint === true
);

export const collectDisplayFieldSettings = (schema) => {
  const collected = [];

  traverseSchema(schema, (field, context) => {
    if (resolveIsDisplayed(field) && !isExcludedDisplayField(field)) {
      const pathSegments = Array.isArray(context?.pathSegments) ? [...context.pathSegments] : [];
      if (field?.type === "printTemplate") {
        if (pathSegments.length > 0) {
          pathSegments[pathSegments.length - 1] = resolvePrintTemplateFieldLabel(field);
        } else {
          pathSegments.push(resolvePrintTemplateFieldLabel(field));
        }
      }
      collected.push({
        path: pathSegments.join("|"),
        type: field.type || "",
        fieldId: field.id || "",
      });
    }
  });

  return collected;
};

export const splitFieldPath = (path) => {
  if (!path) return [];
  return String(path)
    .split("|")
    .map((part) => part.trim())
    .filter((part) => part);
};
