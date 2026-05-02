import { traverseSchema } from "../../core/schemaUtils.js";

const CATEGORICAL_TYPES = new Set(["select", "radio", "checkboxes", "weekday"]);
const NUMERIC_TYPES = new Set(["number"]);
const TEMPORAL_TYPES = new Set(["date", "time"]);
const TEXT_TYPES = new Set(["text", "textarea", "regex", "userName", "email", "phone", "url"]);

export const FIELD_KIND = {
  CATEGORICAL: "categorical",
  NUMERIC: "numeric",
  TEMPORAL: "temporal",
  TEXT: "text",
  OTHER: "other",
};

export const classifyFieldType = (type) => {
  if (CATEGORICAL_TYPES.has(type)) return FIELD_KIND.CATEGORICAL;
  if (NUMERIC_TYPES.has(type)) return FIELD_KIND.NUMERIC;
  if (TEMPORAL_TYPES.has(type)) return FIELD_KIND.TEMPORAL;
  if (TEXT_TYPES.has(type)) return FIELD_KIND.TEXT;
  return FIELD_KIND.OTHER;
};

/**
 * フォーム schema を巡回して、集計可能なフィールド一覧を返す。
 * 戻り値: [{ path, label, type, kind }]
 *  path: pathSegments を "|" で結合した、entry.data の lookup キー
 */
export const collectAggregatableFields = (form) => {
  const fields = form?.fields || [];
  const out = [];
  traverseSchema(fields, (field, ctx) => {
    if (!field) return;
    const kind = classifyFieldType(field.type);
    if (kind === FIELD_KIND.OTHER) return;
    const path = (ctx?.pathSegments || []).join("|");
    if (!path) return;
    out.push({
      path,
      label: field.label || path,
      type: field.type,
      kind,
      depth: ctx?.depth || 0,
    });
  });
  return out;
};

export const filterFieldsByKind = (fields, kinds) => {
  const set = new Set(Array.isArray(kinds) ? kinds : [kinds]);
  return (fields || []).filter((f) => set.has(f.kind));
};
