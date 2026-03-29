import { extractSharedFormIdFromInput } from "../../utils/formShareUrl.js";

export const CHILD_FORM_LINK_PASTE_VALUE = "__paste_url__";

const normalizeForms = (forms = []) => (Array.isArray(forms) ? forms : []).filter((form) => form && form.id);

export const getChildFormOptionLabel = (form) => (
  form?.settings?.formTitle || form?.name || form?.id || ""
);

export const extractChildFormIdFromInput = (input) => extractSharedFormIdFromInput(input);

export const resolveChildFormPasteInput = (input, forms = []) => {
  const trimmed = String(input || "").trim();
  if (!trimmed) {
    return { status: "empty", formId: "", form: null, label: "" };
  }

  const extracted = extractChildFormIdFromInput(trimmed);
  if (!extracted) {
    return { status: "not_found", formId: "", form: null, label: "" };
  }

  const matchedForm = normalizeForms(forms).find((form) => String(form.id || "").trim() === extracted);
  if (!matchedForm) {
    return { status: "not_found", formId: extracted, form: null, label: "" };
  }

  return {
    status: "matched",
    formId: extracted,
    form: matchedForm,
    label: getChildFormOptionLabel(matchedForm) || extracted,
  };
};

export const getVisibleChildFormOptions = (forms = []) =>
  normalizeForms(forms).filter((form) => !form.archived);

export const buildHiddenCurrentChildFormOption = (currentChildFormId, visibleForms = [], allForms = []) => {
  const normalizedId = String(currentChildFormId || "").trim();
  if (!normalizedId) return null;

  const alreadyVisible = normalizeForms(visibleForms).some(
    (form) => String(form?.id || "").trim() === normalizedId,
  );
  if (alreadyVisible) return null;

  const matchedForm = normalizeForms(allForms).find(
    (form) => String(form?.id || "").trim() === normalizedId,
  );

  return {
    id: normalizedId,
    label: getChildFormOptionLabel(matchedForm) || normalizedId,
  };
};
