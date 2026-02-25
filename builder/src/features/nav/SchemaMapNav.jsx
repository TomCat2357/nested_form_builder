import React, { useMemo } from "react";

const escapeForAttrSelector = (value) => {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(String(value));
  }
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
};

const hasBranchChildren = (field) => {
  const branches = field?.childrenByValue;
  if (!branches || typeof branches !== "object") return false;
  return Object.values(branches).some((children) => Array.isArray(children) && children.length > 0);
};

export default function SchemaMapNav({ schema }) {
  const items = useMemo(
    () =>
      (Array.isArray(schema) ? schema : [])
        .map((field, index) => {
          const id = typeof field?.id === "string" ? field.id.trim() : "";
          if (!id) return null;
          return {
            id,
            index: index + 1,
            label: (field?.label || "").trim() || `質問 ${index + 1}`,
            hasChildren: hasBranchChildren(field),
          };
        })
        .filter(Boolean),
    [schema],
  );

  if (items.length === 0) return null;

  const scrollToQuestion = (questionId) => {
    const escaped = escapeForAttrSelector(questionId);
    const target = document.querySelector(`[data-question-id="${escaped}"]`);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
  };

  return (
    <nav className="schema-map-nav" aria-label="目次ナビ">
      <div className="schema-map-nav__title">目次</div>
      <ul className="schema-map-nav__list">
        {items.map((item) => (
          <li key={item.id} className="schema-map-nav__item">
            <button type="button" className="schema-map-nav__button" onClick={() => scrollToQuestion(item.id)} title={item.label}>
              <span className="schema-map-nav__index">{item.index}.</span>
              <span className="schema-map-nav__label">{item.label}</span>
              {item.hasChildren && <span className="schema-map-nav__branch">+</span>}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
