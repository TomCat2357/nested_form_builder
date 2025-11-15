import React, { useRef } from "react";
import { downloadJson } from "../../utils/download.js";
import { stripSchemaIDs } from "../../core/schema.js";

const buttonStyle = { border: "1px solid #CBD5E1", background: "#F8FAFC", padding: "8px 12px", borderRadius: 8, cursor: "pointer" };
const linkStyle = { display: "none", fontSize: 12, textDecoration: "underline" };

export default function ExportSchemaButton({ schema, settings }) {
  const manualLinkRef = useRef(null);

  const handleExport = () => {
    const stripped = stripSchemaIDs(schema);
    const exportedSettings = {
      formTitle: settings?.formTitle || "",
      spreadsheetId: settings?.spreadsheetId || "",
      sheetName: settings?.sheetName || "",
      gasUrl: settings?.gasUrl || "",
    };
    downloadJson(
      {
        version: 1,
        schema: stripped,
        settings: exportedSettings,
      },
      "schema.json",
      manualLinkRef,
    );
  };

  return (
    <>
      <button type="button" style={buttonStyle} onClick={handleExport}>スキーマDL</button>
      <a ref={manualLinkRef} target="_blank" rel="noopener" style={linkStyle} />
    </>
  );
}
