import React, { useMemo } from "react";
import BaseDialog from "../../app/components/BaseDialog.jsx";
import DialogFooter from "../../app/components/DialogFooter.jsx";
import SearchableSelect from "../../app/components/SearchableSelect.jsx";
import { normalizeFolderPath } from "../../utils/folderTree.js";

const ROOT_LABEL = "／ 最上位（ルート）";

/**
 * フォーム/Question/Dashboard とフォルダの移動ダイアログ。
 * 移動先は検索ボックス付きドロップダウン（SearchableSelect）で既存フォルダから選ぶ。
 * 空選択（先頭の ROOT_LABEL）= 最上位。フォルダ階層の深さは問わず全候補を列挙する。
 * excludePaths（移動中のフォルダ自身とその配下）は候補から除外し、不正な移動先を選べないようにする。
 * 最終的な存在チェック・自己/配下チェックは呼び出し側（confirm）とサーバで実施する。
 */
export default function AdminMoveDialog({
  open,
  count = 0,
  value,
  onChange,
  onConfirm,
  onCancel,
  error = "",
  folders = [],
  excludePaths = [],
}) {
  const options = useMemo(() => {
    const excluded = (excludePaths || [])
      .map((p) => normalizeFolderPath(p))
      .filter(Boolean);
    const isExcluded = (path) =>
      excluded.some((ex) => path === ex || path.startsWith(ex + "/"));
    const seen = new Set();
    const out = [];
    for (const raw of folders || []) {
      const path = normalizeFolderPath(raw);
      if (!path || seen.has(path) || isExcluded(path)) continue;
      seen.add(path);
      // label = フルパス：検索対象かつ表示。folder にも同値を入れて階層順に並べる。
      out.push({ value: path, label: path, folder: path });
    }
    return out;
  }, [folders, excludePaths]);

  return (
    <BaseDialog
      open={open}
      title="移動"
      footer={
        <DialogFooter onCancel={onCancel} onConfirm={onConfirm} confirmLabel="移動" />
      }
    >
      <p className="dialog-message">
        選択中の {count} 件を移動します。移動先フォルダを選択してください。
      </p>
      <div>
        <label className="nf-block nf-mb-6 nf-text-13 nf-fw-600">移動先フォルダ</label>
        <SearchableSelect
          value={value}
          onChange={onChange}
          options={options}
          placeholder={ROOT_LABEL}
          searchPlaceholder="フォルダ名で絞り込み..."
        />
        {error && <p className="nf-mt-6 nf-text-danger-strong nf-text-12">{error}</p>}
        <p className="nf-mt-6 nf-text-muted nf-text-11">
          「{ROOT_LABEL}」を選ぶと最上位へ移動します。
        </p>
      </div>
    </BaseDialog>
  );
}
