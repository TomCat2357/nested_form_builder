export const PRINT_TEMPLATE_OUTPUT_TYPES = Object.freeze({
  PDF: "pdf",
  GMAIL: "gmail",
});

export const DEFAULT_STANDARD_PRINT_FILE_NAME_TEMPLATE = "{@_id}_{@_NOW|time:YYYY-MM-DD}";

export const PRINT_TEMPLATE_OUTPUT_OPTIONS = [
  { value: PRINT_TEMPLATE_OUTPUT_TYPES.PDF, label: "PDF" },
  { value: PRINT_TEMPLATE_OUTPUT_TYPES.GMAIL, label: "Gmail" },
];

export const normalizePrintTemplateOutputType = (value) => (
  value === PRINT_TEMPLATE_OUTPUT_TYPES.GMAIL
    ? PRINT_TEMPLATE_OUTPUT_TYPES.GMAIL
    : PRINT_TEMPLATE_OUTPUT_TYPES.PDF
);

export const normalizePrintTemplateAction = (value) => {
  const base = value && typeof value === "object" ? value : {};
  return {
    enabled: base.enabled === true,
    outputType: normalizePrintTemplateOutputType(base.outputType),
    useCustomTemplate: base.useCustomTemplate === true,
    templateUrl: typeof base.templateUrl === "string" ? base.templateUrl : "",
    fileNameTemplate: typeof base.fileNameTemplate === "string" ? base.fileNameTemplate : "",
    gmailAttachPdf: base.gmailAttachPdf === true,
    gmailTemplateTo: typeof base.gmailTemplateTo === "string" ? base.gmailTemplateTo : "",
    gmailTemplateCc: typeof base.gmailTemplateCc === "string" ? base.gmailTemplateCc : "",
    gmailTemplateBcc: typeof base.gmailTemplateBcc === "string" ? base.gmailTemplateBcc : "",
    gmailTemplateSubject: typeof base.gmailTemplateSubject === "string" ? base.gmailTemplateSubject : "",
    gmailTemplateBody: typeof base.gmailTemplateBody === "string" ? base.gmailTemplateBody : "",
  };
};

const normalizeTemplateString = (value) => (typeof value === "string" ? value.trim() : "");

export const resolveSharedPrintFileNameTemplate = (settings) => (
  normalizeTemplateString(settings?.standardPrintFileNameTemplate)
);

export const requiresPrintTemplateFileName = (value) => {
  const action = normalizePrintTemplateAction(value);
  return action.outputType !== PRINT_TEMPLATE_OUTPUT_TYPES.GMAIL || action.gmailAttachPdf;
};

export const resolveEffectivePrintTemplateFileNameTemplate = (value, settings = {}) => {
  const action = normalizePrintTemplateAction(value);
  const sharedTemplate = resolveSharedPrintFileNameTemplate(settings);
  const actionTemplate = normalizeTemplateString(action.fileNameTemplate);

  if (action.outputType === PRINT_TEMPLATE_OUTPUT_TYPES.GMAIL) {
    return action.gmailAttachPdf
      ? (sharedTemplate || DEFAULT_STANDARD_PRINT_FILE_NAME_TEMPLATE)
      : "";
  }

  return actionTemplate || sharedTemplate || DEFAULT_STANDARD_PRINT_FILE_NAME_TEMPLATE;
};

export const getPrintTemplateOutputLabel = (actionOrType) => {
  const outputType = typeof actionOrType === "string"
    ? normalizePrintTemplateOutputType(actionOrType)
    : normalizePrintTemplateOutputType(actionOrType?.outputType);
  return PRINT_TEMPLATE_OUTPUT_OPTIONS.find((option) => option.value === outputType)?.label || "PDF";
};

export const resolvePrintTemplateFieldLabel = (field) => {
  const explicitLabel = typeof field?.label === "string" ? field.label.trim() : "";
  if (explicitLabel) return explicitLabel;
  return getPrintTemplateOutputLabel(field?.printTemplateAction);
};
