import React, { createContext, useContext, useMemo } from "react";

/**
 * フォーム文脈 Context。
 *
 * 子フォームを同一 SPA のオーバーレイで開くとき、その配下の SearchPage / FormPage /
 * PreviewPage に「自分は子フォーム文脈（pid 固定）である」ことを伝えるための Context。
 *
 * - 既定（Provider なし）は `null`。各消費側は従来どおり URL グローバル（getUrlPid 等）へ
 *   フォールバックするので、新規タブで開く既存の子フォームは無改修で動く。
 * - `inChildContext` が true のサブツリーでは formLink ボタンを隠す／孫フォームを作らせない等、
 *   「子文脈」の分岐を URL グローバルではなくこの値で判定する。
 * - データ層（gasClient）の pid 付与は React を介さないため、別途 formPidContext の
 *   registerFormPid で formId→pid を登録する（本 Context とは別経路・併用する）。
 */
const FormContext = createContext(null);

export function FormContextProvider({ formId = "", pid = "", inChildContext = false, registerDirtyChecker = null, onRequestClose = null, children }) {
  const value = useMemo(
    () => ({
      formId: String(formId || ""),
      pid: String(pid || ""),
      inChildContext: !!inChildContext,
      // 配下の FormPage が「未保存編集あり」を返す関数を登録するためのフック。オーバーレイは
      // 閉じる前にこれを呼んで dirty なら確認する（子フォームの誤クローズによる入力消失を防ぐ）。
      registerDirtyChecker: typeof registerDirtyChecker === "function" ? registerDirtyChecker : null,
      // オーバーレイ自体を閉じる要求を出すためのフック（dirty チェック付き close）。子レコード一覧の
      // 「戻る」はこれを呼んでオーバーレイごと閉じる（MemoryRouter 内を空回りさせない）。
      onRequestClose: typeof onRequestClose === "function" ? onRequestClose : null,
    }),
    [formId, pid, inChildContext, registerDirtyChecker, onRequestClose],
  );
  return <FormContext.Provider value={value}>{children}</FormContext.Provider>;
}

/**
 * 現在のフォーム文脈を返す。Provider 配下でなければ `null`。
 */
export function useFormContext() {
  return useContext(FormContext);
}

/**
 * 子フォームをオーバーレイで開くためのトリガ Context。
 *
 * `openChildForm({childFormId, pid, childFormName})` を提供する。実体（オーバーレイ本体）は
 * features/childform/ChildFormOverlay の ChildFormProvider が `ChildFormContext.Provider` で供給する。
 * 本体（SearchPage / FormPage を import する）から切り離してこの leaf モジュールに置くことで、
 * PreviewPage → ChildFormOverlay → FormPage → PreviewPage の循環 import を避ける。
 * Provider 配下でないときは `openChildForm` が `null`。呼び出し側はそれを見てフォールバック
 * （従来の新規タブ）に切替える。
 */
export const ChildFormContext = createContext({ openChildForm: null });

export function useChildForm() {
  return useContext(ChildFormContext);
}
