import { resolveIsDisplayed } from "../core/displayModes.js";
import { traverseSchema } from "../core/schemaUtils.js";

const isExcludedMessageField = (field) => field?.type === "message" && field?.excludeFromSearchAndPrint === true;

export const collectDisplayFieldSettings = (schema) => {
  const collected = [];

  traverseSchema(schema, (field, context) => {
    if (resolveIsDisplayed(field) && !isExcludedMessageField(field)) {
      collected.push({
        path: context.pathSegments.join("|"),
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
