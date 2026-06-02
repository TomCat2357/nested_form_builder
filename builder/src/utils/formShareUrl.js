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

// 子フォームを開くための URL を組む。?form=<対象fileId>&pid=<親レコードID>。
// 親レコードに紐づく子フォーム（pid で行を絞り込み・新規行に刻印）を別タブで開く用途で、
// record は付けない。buildSharedFormUrl は record 用途で他所が使うためシグネチャを変えない。
export const buildChildFormUrl = (baseUrl, formId, pid = "") => {
  const normalizedBaseUrl = String(baseUrl || "").trim();
  const normalizedFormId = String(formId || "").trim();
  const normalizedPid = String(pid || "").trim();
  if (!normalizedBaseUrl || !normalizedFormId) return "";

  try {
    const url = new URL(normalizedBaseUrl);
    url.searchParams.set("form", normalizedFormId);
    url.searchParams.delete("record");
    if (normalizedPid) url.searchParams.set("pid", normalizedPid);
    else url.searchParams.delete("pid");
    return url.toString();
  } catch (_) {
    const hashIndex = normalizedBaseUrl.indexOf("#");
    const baseWithoutHash = hashIndex >= 0 ? normalizedBaseUrl.slice(0, hashIndex) : normalizedBaseUrl;
    const hashSuffix = hashIndex >= 0 ? normalizedBaseUrl.slice(hashIndex) : "";
    const joiner = baseWithoutHash.includes("?") ? "&" : "?";
    const pidQuery = normalizedPid ? `&pid=${encodeURIComponent(normalizedPid)}` : "";
    return `${baseWithoutHash}${joiner}form=${encodeURIComponent(normalizedFormId)}${pidQuery}${hashSuffix}`;
  }
};
