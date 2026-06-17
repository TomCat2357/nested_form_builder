// PreviewPage のテンプレ収集・full-query 判定（純関数）。
// precompile / live prefetch / 保存時再解決 で収集条件が微妙に異なるため、
// 条件をオプションで忠実に再現する（統一して挙動を変えないこと）。

import { traverseSchema } from "../../core/schemaUtils.js";

// 置換フィールドの templateText が full-query トークン（`{{SELECT ...}}`）を含むかの判定。
export const FULL_QUERY_SUBST_RE = /\{\{\s*SELECT\b/i;

// schema 内のテンプレ文字列（`{` を含む templateText）を収集する。
//   substitutionOnly  : type==="substitution" のフィールドのみへ限定（保存時の full-query 再解決用）
//   includePrintFileName: printTemplateAction.fileNameTemplate（`{` を含む）も収集（precompile 用）
export function collectTemplateTexts(schema, { substitutionOnly = false, includePrintFileName = false } = {}) {
  const templates = [];
  traverseSchema(schema, (field) => {
    if (substitutionOnly && field?.type !== "substitution") return;
    if (typeof field?.templateText === "string" && field.templateText.indexOf("{") >= 0) {
      templates.push(field.templateText);
    }
    if (includePrintFileName) {
      const action = field?.printTemplateAction;
      if (action && typeof action === "object") {
        const fn = action.fileNameTemplate;
        if (typeof fn === "string" && fn.indexOf("{") >= 0) templates.push(fn);
      }
    }
  });
  return templates;
}

// schema 内に full-query 置換（`{{SELECT ...}}`）を含む substitution フィールドがあるか。
export function detectFullQuerySubstitution(schema) {
  let found = false;
  traverseSchema(schema, (field) => {
    if (found || field?.type !== "substitution") return;
    if (typeof field?.templateText === "string" && FULL_QUERY_SUBST_RE.test(field.templateText)) found = true;
  });
  return found;
}
