const normalizeSharedFormId = (value) => String(value || "").trim();

export const extractSharedFormIdFromInput = (input) => {
  const trimmed = normalizeSharedFormId(input);
  if (!trimmed) return "";

  const queryMatch = trimmed.match(/(?:[?&#]|^)form=([^&#]+)/i);
  if (queryMatch) {
    try {
      return normalizeSharedFormId(decodeURIComponent(queryMatch[1]));
    } catch (_) {
      return normalizeSharedFormId(queryMatch[1]);
    }
  }

  try {
    const url = new URL(trimmed);
    const formParam = url.searchParams.get("form");
    if (normalizeSharedFormId(formParam)) return normalizeSharedFormId(formParam);
  } catch (_) {
    // no-op: URL でなくても末尾で生値をそのまま使う
  }

  return trimmed;
};

export const buildSharedFormUrl = (baseUrl, formId) => {
  const normalizedBaseUrl = String(baseUrl || "").trim();
  const normalizedFormId = String(formId || "").trim();
  if (!normalizedBaseUrl || !normalizedFormId) return "";

  try {
    const url = new URL(normalizedBaseUrl);
    url.searchParams.set("form", normalizedFormId);
    return url.toString();
  } catch (_) {
    const hashIndex = normalizedBaseUrl.indexOf("#");
    const baseWithoutHash = hashIndex >= 0 ? normalizedBaseUrl.slice(0, hashIndex) : normalizedBaseUrl;
    const hashSuffix = hashIndex >= 0 ? normalizedBaseUrl.slice(hashIndex) : "";
    const joiner = baseWithoutHash.includes("?") ? "&" : "?";
    return `${baseWithoutHash}${joiner}form=${encodeURIComponent(normalizedFormId)}${hashSuffix}`;
  }
};
