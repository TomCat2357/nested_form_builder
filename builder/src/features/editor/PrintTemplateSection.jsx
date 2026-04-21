import React from "react";
import {
  getPrintTemplateOutputLabel,
  PRINT_TEMPLATE_OUTPUT_OPTIONS,
  PRINT_TEMPLATE_OUTPUT_TYPES,
} from "../../utils/printTemplateAction.js";
import { styles as s } from "./styles.js";

function PrintTemplateDocFields({ field, onChange, printTemplateAction }) {
  const updateAction = (patch) => onChange({
    ...field,
    printTemplateAction: { ...printTemplateAction, ...patch, enabled: true },
  });

  return (
    <>
      <label className="nf-row nf-gap-6">
        <input
          type="checkbox"
          checked={!!printTemplateAction.useCustomTemplate}
          onChange={(event) => updateAction({ useCustomTemplate: event.target.checked })}
        />
        カスタムテンプレートを使う
      </label>
      {printTemplateAction.useCustomTemplate && (
        <input
          className={s.input.className}
          placeholder="テンプレートURL（Google Document URL）"
          value={printTemplateAction.templateUrl || ""}
          onChange={(event) => updateAction({ templateUrl: event.target.value })}
        />
      )}
      <input
        className={s.input.className}
        placeholder="出力ファイル名（例: {@_id}_{@_NOW|time:YYYY-MM-DD}）"
        value={printTemplateAction.fileNameTemplate || ""}
        onChange={(event) => updateAction({ fileNameTemplate: event.target.value })}
      />
      <div className="nf-text-11 nf-text-muted">未指定時はフォーム設定の印刷様式出力ファイル名規則を使用します。</div>
    </>
  );
}

const GMAIL_TEMPLATE_FIELDS = [
  { key: "gmailTemplateTo", label: "To", placeholder: "例: {メールアドレス}" },
  { key: "gmailTemplateCc", label: "Cc", placeholder: "例: {メールアドレス}" },
  { key: "gmailTemplateBcc", label: "Bcc", placeholder: "例: {メールアドレス}" },
  { key: "gmailTemplateSubject", label: "件名", placeholder: "例: 【申請】{@_id}_{@_NOW|time:YYYY-MM-DD}" },
];

function PrintTemplateGmailFields({ field, onChange, printTemplateAction }) {
  const updateAction = (patch) => onChange({
    ...field,
    printTemplateAction: { ...printTemplateAction, ...patch, enabled: true },
  });

  return (
    <>
      <label className="nf-row nf-gap-8 nf-items-center">
        <input
          type="checkbox"
          checked={printTemplateAction.gmailAttachPdf || false}
          onChange={(event) => updateAction({ gmailAttachPdf: event.target.checked })}
        />
        <span className="nf-text-11">PDF を添付</span>
      </label>
      {printTemplateAction.gmailAttachPdf && (
        <div className="nf-text-11 nf-text-muted">PDF 添付時の出力名は、フォーム設定の印刷様式出力ファイル名規則か既定値を使用します。</div>
      )}
      {GMAIL_TEMPLATE_FIELDS.map(({ key, label, placeholder }) => (
        <label key={key} className="nf-col nf-gap-4">
          <span className="nf-text-11 nf-text-muted">{label}</span>
          <input
            className={s.input.className}
            placeholder={placeholder}
            value={printTemplateAction[key] || ""}
            onChange={(event) => updateAction({ [key]: event.target.value })}
          />
        </label>
      ))}
      <label className="nf-col nf-gap-4">
        <span className="nf-text-11 nf-text-muted">本文</span>
        <textarea
          className={`${s.input.className} nf-h-96`}
          placeholder="本文テンプレートを入力"
          value={printTemplateAction.gmailTemplateBody || ""}
          onChange={(event) => updateAction({ gmailTemplateBody: event.target.value })}
        />
      </label>
    </>
  );
}

export function PrintTemplateSection({ field, onChange, printTemplateAction }) {
  const isGmail = printTemplateAction.outputType === PRINT_TEMPLATE_OUTPUT_TYPES.GMAIL;

  return (
    <div className="nf-mt-8">
      <div className="nf-col nf-gap-8">
        <div className="nf-text-12 nf-text-subtle">未入力時の表示名は {getPrintTemplateOutputLabel(printTemplateAction)} です。</div>
        <select
          className={s.input.className}
          value={printTemplateAction.outputType}
          onChange={(event) => onChange({
            ...field,
            printTemplateAction: {
              ...printTemplateAction,
              outputType: event.target.value,
              enabled: true,
            },
          })}
        >
          {PRINT_TEMPLATE_OUTPUT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        {isGmail
          ? <PrintTemplateGmailFields field={field} onChange={onChange} printTemplateAction={printTemplateAction} />
          : <PrintTemplateDocFields field={field} onChange={onChange} printTemplateAction={printTemplateAction} />
        }
        <div className="nf-text-11 nf-text-muted">{"出力ファイル名では {@_id} / {@_NOW} / {@フィールド名} を使えます。{@_NOW|time:YYYY-MM-DD} や {@_NOW|time:HH:mm} のようにパイプで書式を指定できます。Gmail 本文では {@_record_url} / {@_form_url} も使えます。{値|if:@_record_url,代替} のように予約トークンを条件に使えます。ファイルアップロードフィールドは {@フィールド名|folder_url} / {@フィールド名|file_urls} で出せます。"}</div>
      </div>
    </div>
  );
}
