import React, { useMemo, useState } from "react";
import { NFB_FUNCTION_CATALOG } from "../features/expression/nfbFunctionCatalog.js";

// Playground「関数一覧」パネル。検索できる折りたたみ表示で、項目クリックで
// 現在のテキストエリアへ挿入する（挿入文字列の組み立て・カーソル挿入は onInsert 側）。
// insertDisabled（挿入先テキストエリアが無いモード）のときはクリックで名前をコピーする。

const KIND_BADGE = {
  udf: { label: "UDF", color: "#2563eb" },
  aggr: { label: "集計", color: "#7c3aed" },
  native: { label: "組込", color: "#6b7280" },
  token: { label: "トークン", color: "#059669" },
};

const panelStyle = {
  border: "1px solid var(--nf-border)",
  borderRadius: "4px",
  overflow: "hidden",
};

const headerBtnStyle = {
  display: "flex",
  width: "100%",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "8px",
  padding: "6px 12px",
  background: "var(--nf-input-bg, #f7f7f7)",
  border: "none",
  borderBottom: "1px solid var(--nf-border)",
  cursor: "pointer",
  font: "inherit",
  color: "var(--nf-text)",
  textAlign: "left",
};

const rowBtnStyle = {
  display: "block",
  width: "100%",
  textAlign: "left",
  background: "transparent",
  border: "none",
  borderBottom: "1px solid var(--nf-border)",
  padding: "6px 12px",
  cursor: "pointer",
  font: "inherit",
  color: "var(--nf-text)",
};

const badgeStyle = (color) => ({
  fontSize: "10px",
  lineHeight: 1.6,
  padding: "0 6px",
  borderRadius: "10px",
  color: "#fff",
  background: color,
  whiteSpace: "nowrap",
});

const monoStyle = { fontFamily: "monospace", fontSize: "12px" };

export default function FunctionReferencePanel({
  catalog = NFB_FUNCTION_CATALOG,
  onInsert,
  insertDisabled = false,
  insertDisabledHint = "",
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [copiedName, setCopiedName] = useState("");

  const total = useMemo(
    () => catalog.reduce((n, g) => n + g.items.length, 0),
    [catalog]
  );

  const groups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return catalog;
    return catalog
      .map((g) => ({
        category: g.category,
        items: g.items.filter(
          (it) =>
            it.name.toLowerCase().includes(q) ||
            (it.description || "").toLowerCase().includes(q) ||
            (it.signature || "").toLowerCase().includes(q) ||
            g.category.toLowerCase().includes(q)
        ),
      }))
      .filter((g) => g.items.length > 0);
  }, [catalog, filter]);

  const shown = useMemo(
    () => groups.reduce((n, g) => n + g.items.length, 0),
    [groups]
  );

  const handleClick = (item) => {
    if (insertDisabled) {
      try {
        if (navigator.clipboard) navigator.clipboard.writeText(item.name);
      } catch (_) {
        // クリップボード不可でも致命的ではないので握りつぶす。
      }
      setCopiedName(item.name);
      setTimeout(() => setCopiedName(""), 1200);
      return;
    }
    if (onInsert) onInsert(item);
  };

  return (
    <div style={panelStyle}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={headerBtnStyle}
        aria-expanded={open}
      >
        <span>{open ? "▾" : "▸"} 関数一覧</span>
        <span className="nf-text-11 nf-text-muted">
          {open ? `${shown} / ${total}` : `${total} 個`}
        </span>
      </button>

      {open && (
        <div>
          <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--nf-border)" }}>
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="関数名・説明で絞り込み..."
              style={{
                width: "100%",
                maxWidth: "400px",
                padding: "4px 8px",
                boxSizing: "border-box",
                border: "1px solid var(--nf-border)",
                borderRadius: "4px",
                background: "var(--nf-input-bg, #fff)",
                color: "var(--nf-text)",
                font: "inherit",
                fontSize: "13px",
              }}
            />
            <p className="nf-text-11 nf-text-muted nf-mt-4 nf-mb-0">
              {insertDisabled
                ? insertDisabledHint || "このモードでは挿入できません。クリックで関数名をコピーします。"
                : "クリックで、いま編集中のテキストのカーソル位置に挿入します。"}
            </p>
          </div>

          <div style={{ maxHeight: "360px", overflow: "auto" }}>
            {groups.length === 0 ? (
              <p className="nf-text-11 nf-text-muted" style={{ padding: "8px 12px", margin: 0 }}>
                一致する関数はありません。
              </p>
            ) : (
              groups.map((g) => (
                <div key={g.category}>
                  <div
                    className="nf-text-11 nf-text-muted"
                    style={{
                      padding: "4px 12px",
                      background: "var(--nf-input-bg, #f2f2f2)",
                      borderBottom: "1px solid var(--nf-border)",
                      fontWeight: 600,
                    }}
                  >
                    {g.category}
                  </div>
                  {g.items.map((item) => {
                    const badge = KIND_BADGE[item.kind] || KIND_BADGE.native;
                    return (
                      <button
                        key={item.name}
                        type="button"
                        onClick={() => handleClick(item)}
                        style={rowBtnStyle}
                        title={insertDisabled ? "クリックで名前をコピー" : "クリックで挿入"}
                      >
                        <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <span style={{ ...monoStyle, fontWeight: 700 }}>{item.signature || item.name}</span>
                          <span style={badgeStyle(badge.color)}>{badge.label}</span>
                          {item.sensitive && <span style={badgeStyle("#dc2626")}>機微</span>}
                          {copiedName === item.name && (
                            <span className="nf-text-11" style={{ color: "#059669" }}>コピー済</span>
                          )}
                        </span>
                        <span className="nf-text-11" style={{ display: "block", marginTop: "2px" }}>
                          {item.description}
                        </span>
                        {item.example && (
                          <span
                            className="nf-text-muted"
                            style={{ ...monoStyle, display: "block", marginTop: "2px", whiteSpace: "pre-wrap", wordBreak: "break-word" }}
                          >
                            {item.example}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
