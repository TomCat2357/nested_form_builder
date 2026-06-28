/**
 * FormPage の表示用派生値（純関数）。
 *
 * いずれも React に依存しない純粋な計算で、AppLayout のバッジや未保存確認ダイアログの
 * 文言・選択肢、PreviewPage に渡す settings オブジェクトを props/state から導く。
 * 振る舞いを変えずに JSX から計算を切り離すための置き場。
 */

// AppLayout のステータスバッジ（label / variant）を導く。
// 優先順位: 読み取り中 > 参照のみ > 閲覧 > 編集。
export const resolveFormPageBadge = ({ loading, isReloading, isFormReadOnly, isViewMode }) => {
  const isBusy = loading || isReloading;
  if (isBusy) {
    return { label: "読み取り中...", variant: "loading" };
  }
  if (isFormReadOnly) {
    return { label: "参照のみ", variant: "view" };
  }
  if (isViewMode) {
    return { label: "閲覧モード", variant: "view" };
  }
  return { label: "編集モード", variant: "edit" };
};

// 未保存変更ダイアログのメッセージ文言を intent から導く。
export const resolveUnsavedConfirmMessage = (intent) => {
  if (intent === "cancel-edit") {
    return "保存せずに編集内容を破棄しますか？";
  }
  if (intent && intent.startsWith("navigate:")) {
    return "保存せずに移動しますか？";
  }
  return "保存せずに前の画面へ戻りますか？";
};

// PreviewPage へ渡す settings マージオブジェクトを構築する。
export const buildPreviewSettings = ({
  form,
  currentRecordId,
  recordNoInput,
  entry,
  userName,
  userEmail,
  userAffiliation,
  userTitle,
  userPhone,
}) => ({
  ...(form?.settings || {}),
  formId: form?.id,
  recordId: currentRecordId,
  recordNo: recordNoInput,
  pid: entry?.pid || "",
  modifiedAt: entry?.modifiedAt,
  modifiedAtUnixMs: entry?.modifiedAtUnixMs,
  driveFileUrl: form?.driveFileUrl || "",
  userName,
  userEmail,
  userAffiliation,
  userTitle,
  userPhone,
});
