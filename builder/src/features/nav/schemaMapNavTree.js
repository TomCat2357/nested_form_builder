import { traverseSchema } from "../../core/schemaUtils.js";

const toQuestionLabel = (field, indexTrail) => {
  const label = typeof field?.label === "string" ? field.label.trim() : "";
  return label || `質問 ${indexTrail.join(".")}`;
};

export const buildSchemaMapItems = ({ schema, responses = {}, scope = "all" } = {}) => {
  const items = [];
  const stack = [];
  const traversalOptions = scope === "visible" ? { responses } : {};

  traverseSchema(Array.isArray(schema) ? schema : [], (field, context) => {
    const id = typeof field?.id === "string" ? field.id.trim() : "";
    if (!id) return;

    const item = {
      id,
      depth: Math.max(0, context.depth - 1),
      indexLabel: `${context.indexTrail.join(".")}.`,
      label: toQuestionLabel(field, context.indexTrail),
      children: [],
    };

    const parent = stack[context.depth - 2];
    if (parent) {
      parent.children.push(item);
    } else {
      items.push(item);
    }

    stack[context.depth - 1] = item;
    stack.length = context.depth;
  }, traversalOptions);

  return items;
};

export const collectExpandableIds = (items) => {
  const ids = new Set();
  const walk = (nodes) => {
    (nodes || []).forEach((node) => {
      if (Array.isArray(node?.children) && node.children.length > 0) {
        ids.add(node.id);
        walk(node.children);
      }
    });
  };
  walk(items);
  return ids;
};
