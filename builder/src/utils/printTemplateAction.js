export const PRINT_TEMPLATE_OUTPUT_TYPES = Object.freeze({
  GOOGLE_DOC: "googleDoc",
  PDF: "pdf",
  GMAIL: "gmail",
});

export const PRINT_TEMPLATE_OUTPUT_OPTIONS = [
  { value: PRINT_TEMPLATE_OUTPUT_TYPES.GOOGLE_DOC, label: "GoogleDocument" },
  { value: PRINT_TEMPLATE_OUTPUT_TYPES.PDF, label: "PDF" },
  { value: PRINT_TEMPLATE_OUTPUT_TYPES.GMAIL, label: "Gmail" },
];

export const normalizePrintTemplateOutputType = (value) => (
  value === PRINT_TEMPLATE_OUTPUT_TYPES.PDF || value === PRINT_TEMPLATE_OUTPUT_TYPES.GMAIL
    ? value
    : PRINT_TEMPLATE_OUTPUT_TYPES.GOOGLE_DOC
);

export const normalizePrintTemplateAction = (value) => {
  const base = value && typeof value === "object" ? value : {};
  return {
    enabled: base.enabled === true,
    outputType: normalizePrintTemplateOutputType(base.outputType),
    useCustomTemplate: base.useCustomTemplate === true,
    templateUrl: typeof base.templateUrl === "string" ? base.templateUrl : "",
    fileNameTemplate: typeof base.fileNameTemplate === "string" ? base.fileNameTemplate : "",
    gmailTemplateTo: typeof base.gmailTemplateTo === "string" ? base.gmailTemplateTo : "",
    gmailTemplateCc: typeof base.gmailTemplateCc === "string" ? base.gmailTemplateCc : "",
    gmailTemplateBcc: typeof base.gmailTemplateBcc === "string" ? base.gmailTemplateBcc : "",
    gmailTemplateSubject: typeof base.gmailTemplateSubject === "string" ? base.gmailTemplateSubject : "",
    gmailTemplateBody: typeof base.gmailTemplateBody === "string" ? base.gmailTemplateBody : "",
  };
};

export const getPrintTemplateOutputLabel = (actionOrType) => {
  const outputType = typeof actionOrType === "string"
    ? normalizePrintTemplateOutputType(actionOrType)
    : normalizePrintTemplateOutputType(actionOrType?.outputType);
  return PRINT_TEMPLATE_OUTPUT_OPTIONS.find((option) => option.value === outputType)?.label || "GoogleDocument";
};

export const resolvePrintTemplateFieldLabel = (field) => {
  const explicitLabel = typeof field?.label === "string" ? field.label.trim() : "";
  if (explicitLabel) return explicitLabel;
  return getPrintTemplateOutputLabel(field?.printTemplateAction);
};
