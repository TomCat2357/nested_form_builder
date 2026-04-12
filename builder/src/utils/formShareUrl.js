export const buildSharedFormUrl = (baseUrl, formId, recordId = "") => {
  const normalizedBaseUrl = String(baseUrl || "").trim();
  const normalizedFormId = String(formId || "").trim();
  const normalizedRecordId = String(recordId || "").trim();
  if (!normalizedBaseUrl || !normalizedFormId) return "";

  try {
    const url = new URL(normalizedBaseUrl);
    url.searchParams.set("form", normalizedFormId);
    if (normalizedRecordId) url.searchParams.set("record", normalizedRecordId);
    else url.searchParams.delete("record");
    return url.toString();
  } catch (_) {
    const hashIndex = normalizedBaseUrl.indexOf("#");
    const baseWithoutHash = hashIndex >= 0 ? normalizedBaseUrl.slice(0, hashIndex) : normalizedBaseUrl;
    const hashSuffix = hashIndex >= 0 ? normalizedBaseUrl.slice(hashIndex) : "";
    const joiner = baseWithoutHash.includes("?") ? "&" : "?";
    const recordQuery = normalizedRecordId ? `&record=${encodeURIComponent(normalizedRecordId)}` : "";
    return `${baseWithoutHash}${joiner}form=${encodeURIComponent(normalizedFormId)}${recordQuery}${hashSuffix}`;
  }
};

export const buildSharedRecordUrl = (baseUrl, formId, recordId) => (
  buildSharedFormUrl(baseUrl, formId, recordId)
);
