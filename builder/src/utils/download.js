export const updateManualLink = (anchorRef, dataUrl, filename) => {
  const anchor = anchorRef?.current;
  if (!anchor) return;
  anchor.setAttribute("href", dataUrl);
  anchor.setAttribute("download", filename);
  anchor.style.display = "inline";
  anchor.textContent = "ダウンロードできない場合はこちら";
};

export const downloadTextFile = (content, filename, anchorRef, mimeType = "text/plain") => {
  const dataUrl = `data:${mimeType};charset=utf-8,${encodeURIComponent(content)}`;
  updateManualLink(anchorRef, dataUrl, filename);

  try {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1200);
    return true;
  } catch (err) {
    console.error("downloadTextFile", err);
    try {
      window.open(dataUrl, "_blank");
    } catch (subErr) {
      console.error("downloadTextFile fallback failed", subErr);
    }
    return false;
  }
};

export const downloadJson = (data, filename, anchorRef) => {
  const json = JSON.stringify(data, null, 2);
  return downloadTextFile(json, filename || "schema.json", anchorRef, "application/json");
};
