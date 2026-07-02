import React from "react";
import ConfirmDialog from "../../app/components/ConfirmDialog.jsx";

/**
 * 管理一覧ページ共通の確認ダイアログ 4 種（アーカイブ / リンク解除 / 削除 / コピー）。
 *
 * 文言は adminListConfirmTexts.js（formConfirmTexts / buildAnalyticsConfirmTexts）を
 * texts に渡して差し替える。キャンセル時の状態リセット形状はページごとに異なる
 * （formId vs id / folderFormCount vs folderItemCount）ため、onCancel クロージャで
 * ページ側が持つ。フォーム一覧固有の readOnly / childOnly ダイアログは対象外
 * （AdminFormListPage にインラインで残る）。
 *
 * @param {object} props
 * @param {object} props.texts {archive|remove|hardRemove|copy: {title(state), message(state)}}
 * @param {{state: object, onCancel: () => void, onConfirm: () => void}} props.archive
 * @param {{state: object, onCancel: () => void, onConfirm: () => void}} props.remove
 * @param {{state: object, onCancel: () => void, onConfirm: () => void}} props.hardRemove
 * @param {{state: object, onCancel: () => void, onConfirm: () => void}} props.copy
 */
export default function AdminListConfirmDialogs({ texts, archive, remove, hardRemove, copy }) {
  return (
    <>
      <ConfirmDialog
        open={archive.state.open}
        title={texts.archive.title(archive.state)}
        message={texts.archive.message(archive.state)}
        options={[
          { label: "キャンセル", value: "cancel", onSelect: archive.onCancel },
          {
            label: archive.state.allArchived ? "解除" : "アーカイブ",
            value: "archive",
            variant: "primary",
            onSelect: archive.onConfirm,
          },
        ]}
      />

      <ConfirmDialog
        open={remove.state.open}
        title={texts.remove.title(remove.state)}
        message={texts.remove.message(remove.state)}
        options={[
          { label: "キャンセル", value: "cancel", onSelect: remove.onCancel },
          { label: "リンク解除", value: "delete", variant: "danger", onSelect: remove.onConfirm },
        ]}
      />

      <ConfirmDialog
        open={hardRemove.state.open}
        title={texts.hardRemove.title(hardRemove.state)}
        message={texts.hardRemove.message(hardRemove.state)}
        options={[
          { label: "キャンセル", value: "cancel", onSelect: hardRemove.onCancel },
          { label: "削除", value: "delete", variant: "danger", onSelect: hardRemove.onConfirm },
        ]}
      />

      <ConfirmDialog
        open={copy.state.open}
        title={texts.copy.title(copy.state)}
        message={texts.copy.message(copy.state)}
        options={[
          { label: "キャンセル", value: "cancel", onSelect: copy.onCancel },
          { label: "コピー", value: "copy", variant: "primary", onSelect: copy.onConfirm },
        ]}
      />
    </>
  );
}
