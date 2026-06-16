import { resolveIsDisplayed } from "../core/displayModes.js";
import { traverseSchema } from "../core/schemaUtils.js";
import { resolvePrintTemplateFieldLabel } from "../core/schema.js";
import { joinFieldPath, splitFieldPath } from "./pathCodec.js";

// 後方互換のための再エクスポート（従来は本モジュールが splitFieldPath を実装していた）。
export { splitFieldPath };

const isExcludedDisplayField = (field) => (
  field?.type === "externalAction"
  || (field?.type === "message" && field?.excludeFromSearchAndPrint === true)
  || (field?.type === "substitution" && field?.excludeFromSearch === true)
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
        path: joinFieldPath(pathSegments),
        type: field.type || "",
        fieldId: field.id || "",
        printTemplateAction: field.type === "printTemplate" ? (field.printTemplateAction ?? null) : undefined,
      });
    }
  });

  return collected;
};
