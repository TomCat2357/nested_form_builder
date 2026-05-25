/**
 * FormPage 末尾に並ぶダイアログ群。
 *
 * - 未保存変更の確認
 * - 削除 / 削除取消し
 * - Drive フォルダ削除
 * - フォルダ操作失敗時のリンク解除確認
 * - 既存レコードコピー
 *
 * 業務ロジックを持たない純粋な JSX 塊。すべて props で動作する。
 */

import React from "react";
import ConfirmDialog from "../app/components/ConfirmDialog.jsx";
import RecordCopyDialog from "../app/components/RecordCopyDialog.jsx";

export default function FormPageDialogs({
  unsavedDialog,
  confirmMessage,
  confirmOptions,
  entryActionDialog,
  confirmEntryAction,
  driveFolderDialog,
  handleDeleteDriveFolder,
  unlinkFolderDialog,
  handleConfirmUnlinkFolder,
  handleCancelUnlinkFolder,
  isCopyDialogOpen,
  normalizedSchema,
  copySourceResponses,
  handleConfirmRecordCopy,
  setIsCopyDialogOpen,
}) {
  return (
    <>
      <ConfirmDialog
        open={unsavedDialog.state.open}
        title="未保存の変更があります"
        message={confirmMessage}
        options={confirmOptions}
      />
      <ConfirmDialog
        open={entryActionDialog.state.open}
        title={entryActionDialog.state.action === "undelete" ? "削除取消し" : "レコードを削除"}
        message={entryActionDialog.state.action === "undelete"
          ? "このレコードの削除を取り消し、復活させます。よろしいですか？"
          : "このレコードを削除します。よろしいですか？"}
        options={[
          { label: "キャンセル", value: "cancel", onSelect: entryActionDialog.reset },
          entryActionDialog.state.action === "undelete"
            ? { label: "削除取消し", value: "undelete", variant: "primary", onSelect: confirmEntryAction }
            : { label: "削除", value: "delete", variant: "danger", onSelect: confirmEntryAction },
        ]}
      />
      <ConfirmDialog
        open={driveFolderDialog.state.open}
        title="フォルダ削除"
        message="現在の保存先フォルダのリンクを解除し、存在するフォルダは保存時にごみ箱へ移動します。よろしいですか？"
        options={[
          { label: "キャンセル", value: "cancel", onSelect: driveFolderDialog.close },
          { label: "フォルダ削除", value: "delete-folder", variant: "danger", onSelect: handleDeleteDriveFolder },
        ]}
      />
      <ConfirmDialog
        open={unlinkFolderDialog.state.open}
        title="フォルダ操作に失敗しました"
        message={`保存先フォルダの処理中にエラーが発生しました（${unlinkFolderDialog.state.errorMessage}）。フォルダのリンクを解除して保存を続行しますか？（Driveフォルダの操作はスキップされます）`}
        options={[
          { label: "キャンセル", value: "cancel", onSelect: handleCancelUnlinkFolder },
          { label: "リンクを解除して保存", value: "unlink", variant: "danger", onSelect: handleConfirmUnlinkFolder },
        ]}
      />
      <RecordCopyDialog
        open={isCopyDialogOpen}
        schema={normalizedSchema}
        sourceResponses={copySourceResponses}
        onConfirm={handleConfirmRecordCopy}
        onCancel={() => setIsCopyDialogOpen(false)}
      />
    </>
  );
}
