import React, { useEffect, useMemo, useState } from "react";
import BaseDialog from "../../app/components/BaseDialog.jsx";
import DialogFooter from "../../app/components/DialogFooter.jsx";
import DriveBrowserDialog from "../../features/drive/DriveBrowserDialog.jsx";

// コピー対象として個別に選べる標準フォルダ 8 カテゴリ。key は GAS の NFB_STD_FOLDER_ORDER と一致させる。
const COPY_CATEGORY_OPTIONS = [
  { key: "forms", label: "01_forms（フォーム定義）" },
  { key: "questions", label: "02_questions（Question 定義）" },
  { key: "dashboards", label: "03_dashboards（Dashboard 定義）" },
  { key: "spreadsheets", label: "04_spreadsheets（回答スプレッドシート）" },
  { key: "report_templates", label: "05_report_templates（印刷様式テンプレート）" },
  { key: "upload", label: "06_upload_files（アップロードファイル）" },
  { key: "externalActions", label: "07_external_actions（外部アクション）" },
  { key: "documents", label: "08_documents（ドキュメント）" },
];

// システムごと（appsscript 本体 + 標準フォルダ構成）を別のプロジェクトフォルダへコピーするダイアログ。
// コピー先プロジェクトフォルダ URL + カテゴリ単位の選択（8 カテゴリ）+「データ（12 行目以降）も含める」
// +「マッピング JSON を書き出す」オプションを受け取る。フォルダ（8 階層）は選択に関わらず常に作成される。
export default function AdminCopyStructureDialog({
  open,
  url,
  onUrlChange,
  categories = {},
  onCategoryChange,
  copyData,
  onCopyDataChange,
  rebuildMapping,
  onRebuildMappingChange,
  onConfirm,
  onCancel,
  loading,
}) {
  const [error, setError] = useState("");
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);

  useEffect(() => {
    if (!open) {
      setError("");
      setFolderPickerOpen(false);
    }
  }, [open]);

  // すべてのカテゴリが OFF なら「コピーする中身が無い」とみなして確定を抑止する。
  const allOff = useMemo(
    () => COPY_CATEGORY_OPTIONS.every((opt) => !categories[opt.key]),
    [categories],
  );

  // 依存先カテゴリを外した選択への非ブロッキング警告（許可はする）。
  const dependencyWarnings = useMemo(() => {
    const warnings = [];
    if (categories.dashboards && !categories.questions) {
      warnings.push("Dashboard を含めますが Question を除外しています。Dashboard のカードは参照を保持したまま未配線になり、コピー先で再リンク（または各エンティティの保存時の自動再リンク）が必要です。");
    }
    if (categories.questions && !categories.forms) {
      warnings.push("Question を含めますが Form を除外しています。Question の formId は保持されますが、コピー先で名前フォールバックによる再リンクが必要です。");
    }
    if (categories.forms && !categories.spreadsheets) {
      warnings.push("Form を含めますが スプレッドシート を除外しています。フォームのスプレッドシート参照 URL はクリアされます。");
    }
    if (categories.forms && !categories.report_templates) {
      warnings.push("Form を含めますが 印刷様式テンプレート を除外しています。フォームの印刷テンプレート URL はクリアされます。");
    }
    return warnings;
  }, [categories]);

  const handleConfirm = () => {
    const trimmed = (url || "").trim();
    if (!trimmed) {
      setError("コピー先プロジェクトフォルダの URL を入力してください");
      return;
    }
    setError("");
    onConfirm();
  };

  return (
    <BaseDialog
      open={open}
      title="システムごとコピー"
      footer={
        <DialogFooter
          onCancel={onCancel}
          onConfirm={handleConfirm}
          confirmLabel={loading ? "コピー中..." : "別のプロジェクトフォルダへコピー"}
          cancelDisabled={loading}
          confirmDisabled={loading || allOff}
        />
      }
    >
      <p className="dialog-message">
        appsscript 本体と標準フォルダ構成（01_forms〜08_documents）をコピー先プロジェクトフォルダへ複製し、
        フォーム→スプレッドシート等のリンクをコピー後の URL で再構成します。標準フォルダ構成外を指すリンクは
        削除されます。コピー先スクリプトの Web アプリは手動で再デプロイが必要です（Script Properties は
        引き継がれず、マッピングはコピー先の 設定 &gt; 管理 から「インポート」または「同期」で手動復元します）。
      </p>
      <p className="nf-mt-6 nf-text-12 nf-text-muted">
        ※ appsscript 本体は Google ドライブ上で複製されます（Apps Script API の有効化は不要です）。
        複製先スクリプトの Web アプリは手動で再デプロイしてください。
      </p>

      <div>
        <label className="nf-block nf-mb-6 nf-text-13 nf-fw-600">コピー先プロジェクトフォルダ URL</label>
        <div className="nf-row nf-gap-8">
          <input
            type="text"
            value={url}
            onChange={(event) => {
              onUrlChange(event.target.value);
              if (error) setError("");
            }}
            className="nf-input nf-flex-1"
            placeholder="https://drive.google.com/drive/folders/..."
          />
          <button type="button" className="nf-btn nf-nowrap" onClick={() => setFolderPickerOpen(true)}>
            Driveから選択
          </button>
        </div>
        {error && <p className="nf-mt-6 nf-text-danger-strong nf-text-12">{error}</p>}
        <DriveBrowserDialog
          open={folderPickerOpen}
          mode="folders"
          select="folder"
          title="コピー先プロジェクトフォルダを選択"
          onCancel={() => setFolderPickerOpen(false)}
          onSelect={({ url: pickedUrl }) => { setFolderPickerOpen(false); onUrlChange(pickedUrl); if (error) setError(""); }}
        />
      </div>

      <div className="nf-mt-12">
        <div className="nf-text-13 nf-fw-600 nf-mb-6">コピーする対象（カテゴリ）</div>
        <p className="nf-mt-2 nf-mb-6 nf-text-11 nf-text-muted">
          チェックを外したカテゴリは中身を複製しません。フォルダ（標準 8 階層）は選択に関わらずコピー先へ常に作成されます。
        </p>
        {COPY_CATEGORY_OPTIONS.map((opt) => (
          <React.Fragment key={opt.key}>
            <label className="nf-row nf-gap-8 nf-mt-6" style={{ alignItems: "center", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={!!categories[opt.key]}
                onChange={(event) => onCategoryChange(opt.key, event.target.checked)}
              />
              <span className="nf-text-13">{opt.label}</span>
            </label>
            {opt.key === "spreadsheets" && (
              <>
                <label
                  className="nf-row nf-gap-8 nf-mt-6"
                  style={{ alignItems: "center", cursor: categories.spreadsheets ? "pointer" : "not-allowed", marginLeft: 24 }}
                >
                  <input
                    type="checkbox"
                    checked={!!categories.spreadsheets && !!copyData}
                    disabled={!categories.spreadsheets}
                    onChange={(event) => onCopyDataChange(event.target.checked)}
                  />
                  <span className="nf-text-12">データ（12 行目以降）も含める</span>
                </label>
                <p className="nf-mt-2 nf-text-11 nf-text-muted" style={{ marginLeft: 24 }}>
                  OFF の場合、コピー先スプレッドシートはヘッダー（1〜11 行）のみで、回答データは含めません。
                </p>
              </>
            )}
            {opt.key === "externalActions" && (
              <p className="nf-mt-2 nf-text-11 nf-text-muted" style={{ marginLeft: 24 }}>
                外部アクション は URL 埋め込み等を含む場合があります。OFF の場合 07_external_actions は複製せず、フォーム内の
                外部アクション 送信先 URL もクリアします（コピー先で再リンクしてください）。
              </p>
            )}
          </React.Fragment>
        ))}
        {allOff && (
          <p className="nf-mt-6 nf-text-12 nf-text-danger-strong">
            コピーする対象を 1 つ以上選択してください。
          </p>
        )}
      </div>

      {dependencyWarnings.length > 0 && (
        <div className="nf-mt-12">
          {dependencyWarnings.map((warning, index) => (
            <p key={index} className="nf-mt-2 nf-text-12 nf-text-danger-strong">⚠ {warning}</p>
          ))}
        </div>
      )}

      <label className="nf-row nf-gap-8 nf-mt-12" style={{ alignItems: "center", cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={!!rebuildMapping}
          onChange={(event) => onRebuildMappingChange(event.target.checked)}
        />
        <span className="nf-text-13">マッピング JSON を書き出す（推奨）</span>
      </label>
      <p className="nf-mt-2 nf-text-11 nf-text-muted">
        ON の場合、コピー先プロジェクトフォルダに _nfb_mapping.json（新 fileId に振り直し済み）を保存します。コピー先の
        設定 &gt; 管理 から「インポート」（URL 空欄でプロジェクトフォルダの最新を読込）または「同期」を実行してマッピングを
        復元してください。OFF の場合は JSON を残さず、コピー先では「同期」のみで復元します。
      </p>
    </BaseDialog>
  );
}
