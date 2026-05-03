import { traverseSchema } from "../../../core/schemaUtils.js";
import { headerKeyToAlaSqlKey } from "./headerToAlaSqlKey.js";

const FIXED_PATHS = ["id", "No.", "createdAt", "createdBy", "modifiedAt", "modifiedBy", "deletedAt", "deletedBy"];

export function buildColumnIndex(form) {
  const byPipePath = new Map();
  const byFieldId = new Map();

  for (const fixed of FIXED_PATHS) {
    byPipePath.set(fixed, fixed);
  }

  if (form && Array.isArray(form.schema)) {
    traverseSchema(form.schema, (field, ctx) => {
      const segments = Array.isArray(ctx?.pathSegments) ? ctx.pathSegments : [];
      const pipePath = segments.join("|");
      if (!pipePath) return;
      const alaSqlKey = headerKeyToAlaSqlKey(pipePath);
      if (!byPipePath.has(pipePath)) byPipePath.set(pipePath, alaSqlKey);
      if (field && field.id && !byFieldId.has(field.id)) {
        byFieldId.set(field.id, alaSqlKey);
      }
    });
  }

  return { byPipePath, byFieldId };
}

export function resolveColumnRef(token, index) {
  if (!token) return null;
  const key = String(token);
  if (index) {
    if (index.byPipePath.has(key)) return index.byPipePath.get(key);
    if (index.byFieldId.has(key)) return index.byFieldId.get(key);
  }
  // schema に存在しないトークンも、パイプ → __ 変換だけ施して素通し
  // (集計列 [count] や任意のエイリアス指定に対応)
  return headerKeyToAlaSqlKey(key);
}
