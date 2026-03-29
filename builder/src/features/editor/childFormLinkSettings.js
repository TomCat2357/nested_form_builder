export const CHILD_FORM_LINK_PASTE_VALUE = "__paste_url__";

const CHILD_FORM_ID_PATTERN = /^form_[a-zA-Z0-9]+$/;

export const extractChildFormIdFromInput = (input) => {
  const trimmed = String(input || "").trim();
  if (!trimmed) return "";
  if (CHILD_FORM_ID_PATTERN.test(trimmed)) return trimmed;

  try {
    const url = new URL(trimmed);
    const formParam = url.searchParams.get("form");
    if (formParam && CHILD_FORM_ID_PATTERN.test(formParam)) return formParam;
  } catch (_) {
    // no-op: URL でなくても後続のパターン抽出を試す
  }

  const pathMatch = trimmed.match(/form[_/]([a-zA-Z0-9]+)/);
  if (pathMatch) return `form_${pathMatch[1]}`;

  return trimmed;
};

export const getVisibleChildFormOptions = (forms = []) =>
  (Array.isArray(forms) ? forms : []).filter((form) => form && !form.archived);

export const buildHiddenCurrentChildFormOption = (currentChildFormId, visibleForms = []) => {
  const normalizedId = String(currentChildFormId || "").trim();
  if (!normalizedId) return null;

  const alreadyVisible = (Array.isArray(visibleForms) ? visibleForms : []).some(
    (form) => String(form?.id || "").trim() === normalizedId,
  );
  if (alreadyVisible) return null;

  return {
    id: normalizedId,
    label: normalizedId,
  };
};
