import React, { useEffect, useMemo, useState } from "react";
import { buildSchemaMapItems, collectExpandableIds } from "./schemaMapNavTree.js";

const escapeForAttrSelector = (value) => {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(String(value));
  }
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
};

function SchemaMapNavList({ items, expandedIds, onToggle, onScroll }) {
  return (
    <ul className="schema-map-nav__list">
      {items.map((item) => {
        const hasChildren = Array.isArray(item.children) && item.children.length > 0;
        const expanded = hasChildren && expandedIds.has(item.id);

        return (
          <li key={item.id} className="schema-map-nav__item">
            <div className="schema-map-nav__row" style={{ "--schema-map-depth": item.depth }}>
              {hasChildren ? (
                <button
                  type="button"
                  className="schema-map-nav__toggle"
                  onClick={() => onToggle(item.id)}
                  aria-label={expanded ? `${item.label} を折りたたむ` : `${item.label} を展開する`}
                  aria-expanded={expanded ? "true" : "false"}
                >
                  {expanded ? "-" : "+"}
                </button>
              ) : (
                <span className="schema-map-nav__spacer" aria-hidden="true" />
              )}
              <button
                type="button"
                className="schema-map-nav__button"
                onClick={() => onScroll(item.id)}
                title={item.label}
              >
                <span className="schema-map-nav__index">{item.indexLabel}</span>
                <span className="schema-map-nav__label">{item.label}</span>
              </button>
            </div>
            {expanded && <SchemaMapNavList items={item.children} expandedIds={expandedIds} onToggle={onToggle} onScroll={onScroll} />}
          </li>
        );
      })}
    </ul>
  );
}

export default function SchemaMapNav({ schema, responses = {}, scope = "all" }) {
  const items = useMemo(() => buildSchemaMapItems({ schema, responses, scope }), [schema, responses, scope]);
  const expandableIds = useMemo(() => collectExpandableIds(items), [items]);
  const [expandedIds, setExpandedIds] = useState(() => new Set());

  useEffect(() => {
    setExpandedIds((prev) => {
      const next = new Set(Array.from(prev).filter((id) => expandableIds.has(id)));
      if (next.size === prev.size && Array.from(next).every((id) => prev.has(id))) {
        return prev;
      }
      return next;
    });
  }, [expandableIds]);

  if (items.length === 0) return null;

  const scrollToQuestion = (questionId) => {
    const escaped = escapeForAttrSelector(questionId);
    const target = document.querySelector(`[data-question-id="${escaped}"]`);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "start", inline: "nearest" });
  };

  const toggleExpanded = (questionId) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(questionId)) {
        next.delete(questionId);
      } else {
        next.add(questionId);
      }
      return next;
    });
  };

  return (
    <nav className="schema-map-nav" aria-label="目次ナビ">
      <div className="schema-map-nav__title">目次</div>
      <SchemaMapNavList items={items} expandedIds={expandedIds} onToggle={toggleExpanded} onScroll={scrollToQuestion} />
    </nav>
  );
}
