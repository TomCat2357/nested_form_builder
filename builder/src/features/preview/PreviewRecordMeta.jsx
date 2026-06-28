import React from "react";

// プレビュー先頭のレコードメタ入力群（No. / ID / pid / 最終更新日時）。
// PreviewPage から DOM 構造・className・readOnly 挙動をそのまま切り出した表示専用コンポーネント。
function PreviewRecordMeta({
  settings = {},
  recordId,
  modifiedAtDisplay,
  readOnly = false,
  onRecordNoChange,
}) {
  return (
    <>
      {settings.showRecordNo !== false && (
        <div className="nf-mb-12">
          <label className="preview-label">No.</label>
          <input
            type="text"
            value={settings.recordNo || ""}
            readOnly={readOnly}
            className={`nf-input${readOnly ? " nf-input--readonly" : ""}`}
            onChange={(event) => {
              if (readOnly || typeof onRecordNoChange !== "function") return;
              onRecordNoChange(event.target.value);
            }}
          />
        </div>
      )}
      <div className="nf-mb-12">
        <label className="preview-label">ID</label>
        <input type="text" value={recordId} readOnly className="nf-input nf-input--readonly" />
      </div>
      {settings.pid ? (
        <div className="nf-mb-12">
          <label className="preview-label">親レコードID（pid）</label>
          <input type="text" value={settings.pid} readOnly disabled className="nf-input nf-input--disabled" />
        </div>
      ) : null}
      <div className="nf-mb-12">
        <label className="preview-label">最終更新日時</label>
        <input type="text" value={modifiedAtDisplay || "-"} readOnly className="nf-input nf-input--readonly" />
      </div>
    </>
  );
}

export default PreviewRecordMeta;
