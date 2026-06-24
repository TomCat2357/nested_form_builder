import React from "react";
import { resolveSettingsCheckboxChecked, resolveSettingsFieldValue } from "../../utils/settings.js";
import SearchableSelect from "../../app/components/SearchableSelect.jsx";
import { extractDriveFileId } from "../../utils/printTemplateAction.js";
import { buildDocumentUrl, buildSpreadsheetUrl } from "../../utils/externalActionUrl.js";
import { normalizeSpreadsheetId } from "../../utils/spreadsheet.js";
import { useReportTemplateOptions } from "../editor/useReportTemplateOptions.js";
import { useSpreadsheetOptions } from "../editor/useSpreadsheetOptions.js";

// 標準印刷様式テンプレートを 05_report_templates 内の Google ドキュメントから論理パスで選ぶ。
// 保存値は素の fileId（standardPrintTemplateId）。extractDriveFileId は素 id も旧 URL も受けるため
// value=fileId とマッピングして選択状態を復元できる。
function ReportTemplateSelectField({ field, value, onChange, disabled }) {
  const { options, loading, error } = useReportTemplateOptions();
  const currentFileId = extractDriveFileId(value);
  const matched = options.find((opt) => opt.value === currentFileId);
  const hasUnlistedValue = !!currentFileId && !matched && !loading && !error;

  const handleSelect = (fileId) => {
    const opt = options.find((o) => o.value === fileId);
    // 物理は素の fileId で保持（opt.value=fileId）。
    onChange(field.key, opt ? opt.value : "");
  };

  return (
    <div className="nf-col nf-gap-4">
      <SearchableSelect
        value={matched ? currentFileId : ""}
        onChange={handleSelect}
        options={options}
        placeholder={loading ? "読み込み中..." : "05_report_templates から選択（未選択で自動生成）"}
        searchPlaceholder="様式名で絞り込み..."
        style={disabled ? { pointerEvents: "none", opacity: 0.6 } : undefined}
      />
      {error && (
        <span className="nf-text-11 nf-text-muted">テンプレート一覧を取得できませんでした（{error}）。</span>
      )}
      {hasUnlistedValue && (
        <span className="nf-text-11 nf-text-muted" style={{ wordBreak: "break-all" }}>
          現在の設定: {buildDocumentUrl(currentFileId)}（一覧に無いため未選択表示。選び直すと置き換わります）
        </span>
      )}
    </div>
  );
}

// 保存先スプレッドシートを 04_spreadsheets 内から論理パスで選ぶ。保存値は論理パス文字列
// （value=path）。実行時は GAS がパス→fileId を解決する。直接 URL/ID は別欄（spreadsheetId）で指定する。
function SpreadsheetSelectField({ field, value, onChange, disabled }) {
  const { options, loading, error } = useSpreadsheetOptions();
  const current = typeof value === "string" ? value : "";
  const matched = options.find((opt) => opt.value === current);
  const hasUnlistedValue = !!current && !matched && !loading && !error;

  const handleSelect = (path) => {
    onChange(field.key, path || "");
  };

  return (
    <div className="nf-col nf-gap-4">
      <SearchableSelect
        value={matched ? current : ""}
        onChange={handleSelect}
        options={options}
        placeholder={loading ? "読み込み中..." : "04_spreadsheets から選択（未選択で自動作成）"}
        searchPlaceholder="シート名・パスで絞り込み..."
        style={disabled ? { pointerEvents: "none", opacity: 0.6 } : undefined}
      />
      {error && (
        <span className="nf-text-11 nf-text-muted">スプレッドシート一覧を取得できませんでした（{error}）。</span>
      )}
      {hasUnlistedValue && (
        <span className="nf-text-11 nf-text-muted" style={{ wordBreak: "break-all" }}>
          現在の設定: {value}（一覧に無いパス。保存時にこのパスへ新規作成されます）
        </span>
      )}
    </div>
  );
}

export function SettingsField({ field, value, onChange, disabled }) {
  if (field.type === "reportTemplateSelect") {
    return <ReportTemplateSelectField field={field} value={value} onChange={onChange} disabled={disabled} />;
  }
  if (field.type === "spreadsheetSelect") {
    return <SpreadsheetSelectField field={field} value={value} onChange={onChange} disabled={disabled} />;
  }
  const isSelect = field.type === "select" || Array.isArray(field.options);

  if (isSelect) {
    return (
      <select
        className="nf-input"
        value={resolveSettingsFieldValue(field, value)}
        onChange={(event) => onChange(field.key, event.target.value)}
        disabled={disabled}
      >
        {(field.options || []).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }

  // spreadsheetId は素の fileId で保持するため、参照のみ（readOnly）の表示では物理 URL を復元して見せる。
  const displayValue = (field.readOnly && field.key === "spreadsheetId")
    ? buildSpreadsheetUrl(normalizeSpreadsheetId(value || ""))
    : (value ?? "");

  return (
    <input
      className="nf-input"
      type={field.type || "text"}
      value={displayValue}
      placeholder={field.placeholder}
      onChange={(event) => onChange(field.key, event.target.value)}
      disabled={disabled}
      readOnly={!!field.readOnly}
      style={field.readOnly ? { opacity: 0.7 } : undefined}
    />
  );
}

export function SettingsCheckboxField({ field, value, onChange, disabled }) {
  return (
    <label className="nf-flex nf-items-center nf-gap-8" style={{ cursor: "pointer" }}>
      <input
        type="checkbox"
        checked={resolveSettingsCheckboxChecked(field, value)}
        onChange={(event) => onChange(field.key, event.target.checked)}
        disabled={disabled}
      />
      <span className="nf-fw-600">{field.label}</span>
    </label>
  );
}

export function SettingsGroupFields({ fields, values, onChange, disabled }) {
  const checkboxFields = fields.filter((f) => f.type === "checkbox");
  const otherFields = fields.filter((f) => f.type !== "checkbox");

  return (
    <>
      {otherFields.map((field) => (
        <div key={field.key} className="nf-mb-12">
          <label className="nf-block nf-fw-600 nf-mb-6">
            {field.label}
            {field.required && <span className="nf-text-danger nf-ml-4">*</span>}
          </label>
          <SettingsField
            field={field}
            value={values[field.key]}
            onChange={onChange}
            disabled={disabled}
          />
          {field.description && (
            <p className="nf-text-11 nf-text-muted nf-mt-4 nf-mb-0">{field.description}</p>
          )}
        </div>
      ))}
      {checkboxFields.length > 0 && (
        <div className="nf-flex nf-flex-wrap nf-gap-16 nf-mb-12">
          {checkboxFields.map((field) => (
            <SettingsCheckboxField
              key={field.key}
              field={field}
              value={values[field.key]}
              onChange={onChange}
              disabled={disabled}
            />
          ))}
        </div>
      )}
    </>
  );
}
