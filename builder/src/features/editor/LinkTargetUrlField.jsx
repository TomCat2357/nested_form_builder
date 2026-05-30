import { useState } from "react";

/**
 * 普段は隠している「リンク先URL（保存先）」入力欄。
 *
 * 指定すると保存時に GAS の targetUrl 経由で、この定義を別の Drive ファイル/フォルダへ
 * 保存（リンク先の付け替え）する。ファイル URL = 上書き、フォルダ URL = 複製。
 * id ＝ Drive fileId に統一しているため、保存先（fileId）が変わると id も付け替わる。
 * 参照元（クエスチョン→フォーム / ダッシュボード→クエスチョン）は名前で自動再リンクされる。
 *
 * @param {string}   value         入力中の URL（空文字＝未指定）
 * @param {Function} onChange      (next: string) => void
 * @param {boolean}  [disabled]
 * @param {string}   [entityLabel] 説明文に差し込む名称（例: "Question 定義"）
 */
export default function LinkTargetUrlField({ value, onChange, disabled = false, entityLabel = "定義" }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <label style={{ display: "flex", alignItems: "center", gap: "6px" }}>
        <input
          type="checkbox"
          checked={open}
          disabled={disabled}
          onChange={(e) => { setOpen(e.target.checked); if (!e.target.checked) onChange(""); }}
        />
        <span className="nf-text-13">リンク先URL（保存先）を指定する（上級者向け）</span>
      </label>
      {open && (
        <div style={{ marginTop: "8px" }}>
          <input
            className="nf-input"
            type="text"
            value={value}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            placeholder="ファイルURL＝上書き / フォルダURL＝複製（空欄＝標準フォルダ構成）"
            style={{ width: "100%", maxWidth: "640px" }}
          />
          <p className="nf-text-11 nf-text-muted nf-mt-4 nf-mb-0">
            指定すると、この{entityLabel}を別の Drive ファイル/フォルダへ保存してリンク先を付け替えます。
            ファイル URL は上書き、フォルダ URL は複製。空欄なら標準フォルダ構成に従います。
            ※ 保存先（fileId）が変わると、この項目の id も付け替わります（参照元は名前で自動再リンクされます）。
          </p>
        </div>
      )}
    </div>
  );
}
