import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MemoryRouter, Routes, Route, Navigate } from "react-router-dom";
import OverlayDialog from "../analytics/components/OverlayDialog.jsx";
import SearchPage from "../../pages/SearchPage.jsx";
import FormPage from "../../pages/FormPage.jsx";
import { FormContextProvider, ChildFormContext } from "../../app/state/formContext.jsx";
import { registerFormPid, unregisterFormPid } from "../../services/formPidContext.js";
import { applyTheme } from "../../app/theme/theme.js";

/**
 * 子フォーム（formLink「別フォームを開く」）を新規タブのフルロードではなく、同一 SPA の
 * オーバーレイで開く仕組み。
 *
 * - `openChildForm({childFormId, pid, childFormName})` を Context 越しに提供する。親フォームの
 *   PreviewPage はこれを呼ぶだけ（従来の window.open を置換）。
 * - オーバーレイ内は **独立した MemoryRouter** で既存の SearchPage / FormPage をそのまま動かす。
 *   検索↔レコード編集・保存後遷移はすべてオーバーレイ内で完結し、親の URL/状態は触らない
 *   （親は編集モードのままマウント継続＝編集内容を保持。✕／Escape／背景クリックで閉じると親へ復帰）。
 * - 開いている間 `registerFormPid(childFormId, pid)` でデータ層に pid を登録する。gasClient の
 *   withUrlPid が payload.formId 連動で pid を引くので、子の検索は pid 絞り込み・新規レコードは
 *   pid 刻印になる（親の裏更新と混線しない）。
 * - `FormContextProvider` で配下に inChildContext=true を供給し、子フォーム内では formLink ボタンを
 *   隠す＝孫フォームを作らせない（オーバーレイの多段化を防ぐ）。
 */

const OVERLAY_STYLE = {
  alignItems: "center",
  padding: "2vh 0",
  background: "rgba(0, 0, 0, 0.4)",
};

const PANEL_STYLE = {
  background: "var(--nf-surface, #ffffff)",
  width: "96vw",
  maxWidth: "96vw",
  height: "94vh",
  display: "flex",
  flexDirection: "column",
  borderRadius: 8,
  boxShadow: "0 10px 40px rgba(0, 0, 0, 0.3)",
  overflow: "hidden",
};

const HEADER_STYLE = {
  padding: "8px 12px",
  borderBottom: "1px solid var(--nf-border, #e5e7eb)",
  flexShrink: 0,
};

const BODY_STYLE = { flex: 1, minHeight: 0, overflow: "auto" };

// 子フォームの検索＋入力を独立した MemoryRouter で動かす。親 URL/状態は不変。
function ChildFormApp({ childFormId, pid, registerDirtyChecker }) {
  const initialEntries = useMemo(
    () => [`/search?form=${encodeURIComponent(childFormId)}`],
    [childFormId],
  );
  const fallback = `/search?form=${encodeURIComponent(childFormId)}`;
  return (
    <FormContextProvider formId={childFormId} pid={pid} inChildContext registerDirtyChecker={registerDirtyChecker}>
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route path="/search" element={<SearchPage />} />
          <Route path="/form/:formId/new" element={<FormPage />} />
          <Route path="/form/:formId/entry/:entryId" element={<FormPage />} />
          {/* オーバーレイ内の想定外遷移（設定等）は子の検索一覧へ寄せて閉じ込める。 */}
          <Route path="*" element={<Navigate to={fallback} replace />} />
        </Routes>
      </MemoryRouter>
    </FormContextProvider>
  );
}

export function ChildFormProvider({ children }) {
  // アクティブな子フォーム { childFormId, pid, childFormName }。null で非表示。
  const [active, setActive] = useState(null);
  // 開く直前の親テーマ（data-theme）。子フォームの AppLayout が data-theme を子テーマに
  // 書き換えるため、閉じる時にこれへ戻して親の見た目を復帰させる。
  const prevThemeRef = useRef("");
  // 配下の子 FormPage が登録する「未保存編集あり」判定関数。閉じる前に呼んで誤クローズを防ぐ。
  const dirtyCheckerRef = useRef(null);

  const registerDirtyChecker = useCallback((fn) => {
    dirtyCheckerRef.current = typeof fn === "function" ? fn : null;
  }, []);

  const openChildForm = useCallback(({ childFormId, pid = "", childFormName = "" } = {}) => {
    const id = String(childFormId || "").trim();
    if (!id) return;
    prevThemeRef.current = (typeof document !== "undefined" && document.documentElement?.dataset?.theme) || "";
    setActive({
      childFormId: id,
      pid: String(pid || "").trim(),
      childFormName: String(childFormName || ""),
    });
  }, []);

  // 実際に閉じる：dirty チェッカを破棄 → 非表示 → 親テーマを復帰。
  const doClose = useCallback(() => {
    dirtyCheckerRef.current = null;
    setActive(null);
    const prev = prevThemeRef.current;
    if (prev && typeof document !== "undefined") {
      try { applyTheme(prev); } catch (_e) { /* テーマ復帰失敗は無視 */ }
    }
  }, []);

  // 子フォームに未保存編集があれば確認してから閉じる（✕／Escape／背景クリック共通）。
  const close = useCallback(() => {
    const checker = dirtyCheckerRef.current;
    if (typeof checker === "function" && checker()) {
      const confirmed = typeof window !== "undefined" && typeof window.confirm === "function"
        ? window.confirm("子フォームに保存されていない編集があります。保存せずに閉じますか？")
        : true;
      if (!confirmed) return;
    }
    doClose();
  }, [doClose]);

  // 表示中の子フォーム pid をデータ層へ登録（gasClient.withUrlPid が formId 連動で引く）。
  // 閉じたら解除して、親フォームの呼び出しに pid が紛れ込まないようにする。
  useEffect(() => {
    if (!active) return undefined;
    registerFormPid(active.childFormId, active.pid);
    return () => unregisterFormPid(active.childFormId);
  }, [active]);

  const ctx = useMemo(() => ({ openChildForm }), [openChildForm]);

  return (
    <ChildFormContext.Provider value={ctx}>
      {children}
      <OverlayDialog
        open={!!active}
        onClose={close}
        title={active?.childFormName ? `子フォーム: ${active.childFormName}` : "子フォーム"}
        overlayStyle={OVERLAY_STYLE}
        panelStyle={PANEL_STYLE}
        headerStyle={HEADER_STYLE}
        bodyStyle={BODY_STYLE}
        closeLabel="子フォームを閉じる"
      >
        {active ? (
          <ChildFormApp
            key={`${active.childFormId}:${active.pid}`}
            childFormId={active.childFormId}
            pid={active.pid}
            registerDirtyChecker={registerDirtyChecker}
          />
        ) : null}
      </OverlayDialog>
    </ChildFormContext.Provider>
  );
}
