export const SHARED_FORM_ID_PATTERN = /^form_[a-zA-Z0-9]+$/;

export const isSharedFormId = (value) => SHARED_FORM_ID_PATTERN.test(String(value || "").trim());

export const extractSharedFormIdFromInput = (input) => {
  const trimmed = String(input || "").trim();
  if (!trimmed) return "";
  if (isSharedFormId(trimmed)) return trimmed;

  try {
    const url = new URL(trimmed);
    const formParam = url.searchParams.get("form");
    if (isSharedFormId(formParam)) return String(formParam).trim();
  } catch (_) {
    // no-op: URL でなくても後続のパターン抽出を試す
  }

  const pathMatch = trimmed.match(/(?:^|[/?#=&])form[_/]([a-zA-Z0-9]+)/);
  if (pathMatch) return `form_${pathMatch[1]}`;

  return "";
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
