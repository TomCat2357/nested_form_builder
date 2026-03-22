import { traverseSchema } from "../../core/schemaUtils.js";

export const collectChildFormLinks = (schema) => {
  const links = [];

  traverseSchema(schema || [], (field, context) => {
    if (field?.type !== "childFormLink" || !field?.childFormId) return;

    links.push({
      fieldId: String(field?.id || context?.pathSegments?.join("|") || ""),
      childFormId: String(field.childFormId),
      childFormButtonLabel: String(field?.label || "子フォーム"),
      labelPath: Array.isArray(context?.pathSegments) ? context.pathSegments.join("|") : "",
    });
  });

  return links;
};

export const mergeChildFormLinksByFormId = (childFormLinks, getFormById) => {
  const merged = [];
  const byFormId = new Map();

  (childFormLinks || []).forEach((link) => {
    const childFormId = String(link?.childFormId || "").trim();
    if (!childFormId) return;

    if (!byFormId.has(childFormId)) {
      const form = typeof getFormById === "function" ? getFormById(childFormId) : null;
      const next = {
        childFormId,
        form,
        formTitle: form?.settings?.formTitle || form?.name || childFormId,
        labelPaths: [],
        childFormButtonLabels: [],
      };
      byFormId.set(childFormId, next);
      merged.push(next);
    }

    const target = byFormId.get(childFormId);
    if (link?.labelPath && !target.labelPaths.includes(link.labelPath)) {
      target.labelPaths.push(link.labelPath);
    }
    if (link?.childFormButtonLabel && !target.childFormButtonLabels.includes(link.childFormButtonLabel)) {
      target.childFormButtonLabels.push(link.childFormButtonLabel);
    }
  });

  return merged;
};
