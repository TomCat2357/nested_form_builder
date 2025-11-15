import React, { useRef } from "react";
import { createFormHtmlString } from "../../generators/pure_form/template.js";
import { downloadTextFile } from "../../utils/download.js";
import { normalizeSchemaIDs } from "../../core/schema.js";

const buttonStyle = { border: "1px solid #CBD5E1", background: "#F8FAFC", padding: "8px 12px", borderRadius: 8, cursor: "pointer" };
const linkStyle = { display: "none", fontSize: 12, textDecoration: "underline" };

export default function ExportFormHtmlButton({ schema, settings }) {
  const manualLinkRef = useRef(null);

  const handleExportHtml = () => {
    const normalized = normalizeSchemaIDs(schema);
    const html = createFormHtmlString(normalized, settings);
    downloadTextFile(html, "form.html", manualLinkRef, "text/html");
  };

  return (
    <>
      <button type="button" style={buttonStyle} onClick={handleExportHtml}>フォームHTML DL</button>
      <a ref={manualLinkRef} target="_blank" rel="noopener" style={linkStyle} />
    </>
  );
}
