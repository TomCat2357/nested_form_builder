/**
 * スキーマの木構造を変換して新しいツリーを生成する（Map操作）
 */
export const mapSchema = (schema, mapper) => {
  const walk = (nodes, pathSegments = [], depth = 1) => {
    return (nodes || []).map((field, index) => {
      const fieldLabel = (field.label || "").trim();
      const currentPath = [...pathSegments, fieldLabel];
      const context = { pathSegments: currentPath, index, depth };

      const newField = mapper(field, context);

      if (newField && newField.childrenByValue && typeof newField.childrenByValue === "object") {
        const newChildren = {};
        Object.keys(newField.childrenByValue).forEach((optionLabel) => {
          newChildren[optionLabel] = walk(
            newField.childrenByValue[optionLabel],
            [...currentPath, optionLabel],
            depth + 1
          );
        });
        newField.childrenByValue = newChildren;
      }

      return newField;
    });
  };
  return walk(Array.isArray(schema) ? schema : []);
};

/**
 * スキーマの木構造を巡回する（Read-Only操作）
 */
export const traverseSchema = (schema, visitor, options = {}) => {
  const walk = (nodes, pathSegments = [], depth = 1, indexTrail = []) => {
    (nodes || []).forEach((field, index) => {
      const currentIndexTrail = [...indexTrail, index + 1];
      const fieldLabel = (field.label || "").trim();
      const fallbackLabel = `質問 ${currentIndexTrail.join(".")} (${field.type || "unknown"})`;
      const currentPath = [...pathSegments, fieldLabel || fallbackLabel];
      const context = { pathSegments: currentPath, index, depth, indexTrail: currentIndexTrail };

      const shouldContinue = visitor(field, context);
      if (shouldContinue === false) return;

      if (field.childrenByValue && typeof field.childrenByValue === "object") {
        let childKeys = Object.keys(field.childrenByValue);

        if (options.getChildKeys) {
          childKeys = options.getChildKeys(field, context);
        } else if (options.responses) {
          const value = options.responses[field.id];
          if (field.type === "checkboxes" && Array.isArray(value)) {
            childKeys = value.filter(k => Object.prototype.hasOwnProperty.call(field.childrenByValue, k));
          } else if (["radio", "select"].includes(field.type) && typeof value === "string" && value) {
            childKeys = field.childrenByValue[value] ? [value] : [];
          } else {
            childKeys = [];
          }
        }

        childKeys.forEach((key) => {
          walk(field.childrenByValue[key], [...currentPath, key], depth + 1, currentIndexTrail);
        });
      }
    });
  };
  walk(Array.isArray(schema) ? schema : []);
};
