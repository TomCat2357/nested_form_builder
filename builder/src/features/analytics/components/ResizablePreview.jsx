import React, { useRef, useState } from "react";

const PREVIEW_PRESETS = [
  { label: "小", width: 320, height: 220 },
  { label: "中", width: 560, height: 340 },
  { label: "大", width: 900, height: 480 },
];

/**
 * ダッシュボードカードに小さく表示したときの見え方を確認できるよう、
 * 右下ドラッグで自由にリサイズできるプレビュー枠。プリセット (小/中/大) で
 * よく使うサイズへワンクリックリセットもできる。サイズはコンポーネント寿命の間だけ保持する。
 * テーブル種別は枠より大きい場合に枠内スクロールで切り取り、グラフは枠に追従して縮む。
 */
export default function ResizablePreview({ vizType, children }) {
  const wrapperRef = useRef(null);
  const [resetKey, setResetKey] = useState(0);
  const [initial, setInitial] = useState({ width: null, height: 360 });

  const applyPreset = (preset) => {
    setInitial({ width: preset.width, height: preset.height });
    setResetKey((k) => k + 1);
  };

  const overflow = vizType === "table" ? "auto" : "hidden";

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px", flexWrap: "wrap" }}>
        <span style={{ fontSize: "12px", fontWeight: 600 }}>プレビュー枠サイズ:</span>
        {PREVIEW_PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            className="nf-btn-outline"
            onClick={() => applyPreset(p)}
            style={{ fontSize: "11px", padding: "2px 8px" }}
            title={`${p.width}×${p.height}px に設定`}
          >
            {p.label} ({p.width}×{p.height})
          </button>
        ))}
        <span className="nf-text-subtle" style={{ fontSize: "11px" }}>
          右下隅をドラッグでも自由にリサイズできます
        </span>
      </div>
      <div
        key={resetKey}
        ref={wrapperRef}
        style={{
          border: "1px solid var(--nf-border)",
          borderRadius: "4px",
          padding: "12px",
          resize: "both",
          overflow,
          minWidth: "200px",
          minHeight: "120px",
          width: initial.width ? `${initial.width}px` : "100%",
          height: `${initial.height}px`,
          boxSizing: "border-box",
          position: "relative",
        }}
      >
        {children}
      </div>
    </div>
  );
}
