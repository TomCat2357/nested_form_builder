import React, { useEffect, useRef, useState } from "react";
import {
  FONT_SIZE_PX_OPTIONS,
  COLOR_PRESETS,
  BACKGROUND_PRESETS,
  ALIGN_PRESETS,
  resolveFontSizePx,
  resolveColorHex,
  resolveBackgroundHex,
  resolveAlign,
} from "../constants/messageCardPresets.js";

/**
 * ダッシュボードのテキストウィジェット (メッセージボックス)。
 *
 * - 編集モード (editable): カード本体は contentEditable。onBlur で text を親に通知。
 *   ホバー時にツールバー（サイズ/文字色/背景色/揃え/削除）を表示。
 * - 閲覧モード: contentEditable=false、ツールバー非表示。
 *
 * react-grid-layout のドラッグハンドル用に `.dashboard-card-header` クラスを持つ
 * 細い帯をカード上部に常設（編集モードのみ）。閲覧モードではドラッグ不要なので非表示。
 */
export default function DashboardMessageCard({
  card,
  editable,
  onUpdate,
  onRemove,
}) {
  const editorRef = useRef(null);
  const lastSavedTextRef = useRef(card.text || "");
  const [hovered, setHovered] = useState(false);

  // 親 state の text が外から変わったとき（別タブ編集など）に反映する。
  // 自分が編集中の場合はカーソル位置を壊さないよう DOM の textContent を直接更新せず、
  // 一致しないときだけ書き換える。
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    const incoming = card.text || "";
    if (el.textContent !== incoming) {
      el.textContent = incoming;
      lastSavedTextRef.current = incoming;
    }
  }, [card.text]);

  const handleBlur = () => {
    const el = editorRef.current;
    if (!el) return;
    const next = el.textContent || "";
    if (next === lastSavedTextRef.current) return;
    lastSavedTextRef.current = next;
    if (onUpdate) onUpdate(card.id, { text: next });
  };

  const update = (patch) => {
    if (onUpdate) onUpdate(card.id, patch);
  };

  const fontSizePx = resolveFontSizePx(card.fontSize);
  const colorHex = resolveColorHex(card.color);
  const backgroundHex = resolveBackgroundHex(card.background);
  const alignKey = resolveAlign(card.align);

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: backgroundHex,
        border: editable ? "1px dashed var(--nf-border, #d1d5db)" : "none",
        borderRadius: 4,
        overflow: "hidden",
        position: "relative",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {editable && (
        <div
          className="dashboard-card-header"
          style={{
            height: 12,
            background: "var(--nf-bg-subtle, rgba(0,0,0,0.04))",
            cursor: "move",
            flexShrink: 0,
          }}
          title="ドラッグで移動"
        />
      )}
      {editable && hovered && (
        <MessageCardToolbar
          card={card}
          onChangeField={update}
          onRemove={onRemove ? () => onRemove(card.id) : null}
        />
      )}
      <div
        ref={editorRef}
        contentEditable={!!editable}
        suppressContentEditableWarning
        onBlur={handleBlur}
        style={{
          flex: 1,
          padding: "8px 12px",
          fontSize: fontSizePx,
          color: colorHex,
          textAlign: alignKey,
          outline: "none",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          overflowY: "auto",
        }}
      />
      {editable && !card.text && (
        <div
          style={{
            position: "absolute",
            top: 20,
            left: 12,
            color: "var(--nf-text-muted, #9ca3af)",
            fontSize: fontSizePx,
            pointerEvents: "none",
          }}
        >
          メッセージを入力...
        </div>
      )}
    </div>
  );
}

function MessageCardToolbar({ card, onChangeField, onRemove }) {
  return (
    <div
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        top: 16,
        right: 4,
        zIndex: 2,
        display: "inline-flex",
        gap: 6,
        alignItems: "center",
        padding: "3px 6px",
        background: "var(--nf-bg, #ffffff)",
        border: "1px solid var(--nf-border, #d1d5db)",
        borderRadius: 4,
        fontSize: 11,
        boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
      }}
    >
      <label style={{ display: "inline-flex", alignItems: "center", gap: 3 }} title="文字サイズ (px)">
        <span style={{ fontSize: 10, color: "var(--nf-text-muted)" }}>サイズ</span>
        <select
          value={resolveFontSizePx(card.fontSize)}
          onChange={(e) => onChangeField({ fontSize: Number(e.target.value) })}
          style={{ fontSize: 11, padding: "1px 2px" }}
        >
          {(() => {
            const currentPx = resolveFontSizePx(card.fontSize);
            // 旧データの px が候補にない場合でも選択肢として表示できるよう、必要なら現在値を差し込む。
            const options = FONT_SIZE_PX_OPTIONS.includes(currentPx)
              ? FONT_SIZE_PX_OPTIONS
              : [...FONT_SIZE_PX_OPTIONS, currentPx].sort((a, b) => a - b);
            return options.map((px) => (
              <option key={px} value={px}>{px}px</option>
            ));
          })()}
        </select>
      </label>

      <SwatchGroup
        label="文字色"
        value={card.color || "default"}
        presets={COLOR_PRESETS}
        onChange={(key) => onChangeField({ color: key })}
      />

      <SwatchGroup
        label="背景"
        value={card.background || "transparent"}
        presets={BACKGROUND_PRESETS}
        onChange={(key) => onChangeField({ background: key })}
      />

      <label style={{ display: "inline-flex", alignItems: "center", gap: 3 }} title="揃え">
        <span style={{ fontSize: 10, color: "var(--nf-text-muted)" }}>揃え</span>
        <select
          value={card.align || "left"}
          onChange={(e) => onChangeField({ align: e.target.value })}
          style={{ fontSize: 11, padding: "1px 2px" }}
        >
          {ALIGN_PRESETS.map((p) => (
            <option key={p.key} value={p.key}>{p.label}</option>
          ))}
        </select>
      </label>

      {onRemove && (
        <button
          type="button"
          className="nf-btn-outline nf-btn-danger"
          style={{ fontSize: 11, padding: "1px 6px" }}
          onClick={onRemove}
          title="削除"
        >×</button>
      )}
    </div>
  );
}

function SwatchGroup({ label, value, presets, onChange }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }} title={label}>
      <span style={{ fontSize: 10, color: "var(--nf-text-muted)" }}>{label}</span>
      {presets.map((p) => {
        const active = p.key === value;
        const isTransparent = p.hex === "transparent";
        return (
          <button
            key={p.key}
            type="button"
            onClick={() => onChange(p.key)}
            title={p.label}
            style={{
              width: 14,
              height: 14,
              padding: 0,
              borderRadius: 3,
              border: active
                ? "2px solid var(--nf-text, #1f2937)"
                : "1px solid var(--nf-border, #d1d5db)",
              background: isTransparent
                ? "linear-gradient(to top right, transparent calc(50% - 1px), red 50%, transparent calc(50% + 1px))"
                : p.hex,
              cursor: "pointer",
              flexShrink: 0,
            }}
          />
        );
      })}
    </span>
  );
}
