/**
 * driveGmailOutput.gs
 * Gmail下書き出力（テンプレートフィールド解決・下書き生成）
 *
 * PDF添付が有効な場合は driveOutput.gs の nfbCreateTempPdfBlob_ を利用する。
 */

function nfbResolveGmailTemplateFields_(action, outputContext) {
  action = action || {};
  return {
    to: nfbResolveTemplateTokens_(String(action.gmailTemplateTo || ""), outputContext),
    cc: nfbResolveTemplateTokens_(String(action.gmailTemplateCc || ""), outputContext),
    bcc: nfbResolveTemplateTokens_(String(action.gmailTemplateBcc || ""), outputContext),
    subject: nfbResolveTemplateTokens_(String(action.gmailTemplateSubject || ""), outputContext),
    body: nfbResolveTemplateTokens_(String(action.gmailTemplateBody || ""), outputContext, { allowGmailOnlyTokens: true })
  };
}

function nfbCreateGmailDraftOutput_(payload, action, outputContext, finalBaseName) {
  var emailFields = nfbResolveGmailTemplateFields_(action, outputContext);
  var attachments = [];

  if (action && action.gmailAttachPdf) {
    attachments.push(nfbCreateTempPdfBlob_(payload, action, outputContext, finalBaseName));
  }

  var draftOptions = {};
  if (emailFields.cc) draftOptions.cc = emailFields.cc;
  if (emailFields.bcc) draftOptions.bcc = emailFields.bcc;
  if (attachments.length > 0) draftOptions.attachments = attachments;

  var draft = GmailApp.createDraft(emailFields.to, emailFields.subject, emailFields.body, draftOptions);

  return {
    ok: true,
    outputType: "gmail",
    draftId: draft.getId(),
    openUrl: "https://mail.google.com/mail/#drafts"
  };
}
