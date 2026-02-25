import React, { useEffect, useMemo, useState } from "react";
import AppLayout from "../app/components/AppLayout.jsx";
import ConfirmDialog from "../app/components/ConfirmDialog.jsx";
import { useAlert } from "../app/hooks/useAlert.js";
import { DEFAULT_THEME, applyThemeWithFallback } from "../app/theme/theme.js";
import { useBuilderSettings } from "../features/settings/settingsStore.js";
import { hasScriptRun, getAdminKey, setAdminKey, getAdminEmail, setAdminEmail, getRestrictToFormOnly, setRestrictToFormOnly } from "../services/gasClient.js";
import { useAuth } from "../app/state/authContext.jsx";

const normalizeAdminEmailInput = (value) => String(value || "")
  .split(";")
  .map((item) => item.trim())
  .filter(Boolean)
  .join(";");

export default function AdminSettingsPage() {
  const { showAlert } = useAlert();
const { settings } = useBuilderSettings();
  const [deployTime, setDeployTime] = useState("");

  const [adminKey, setAdminKeyState] = useState("");
  const [adminKeyInput, setAdminKeyInput] = useState("");
  const [adminKeyLoading, setAdminKeyLoading] = useState(false);
  const [adminKeyConfirm, setAdminKeyConfirm] = useState(false);

  const [adminEmail, setAdminEmailState] = useState("");
  const [adminEmailInput, setAdminEmailInput] = useState("");
  const [adminEmailLoading, setAdminEmailLoading] = useState(false);
  const [adminEmailConfirm, setAdminEmailConfirm] = useState(false);

  const [restrictToFormOnly, setRestrictToFormOnlyState] = useState(false);
  const [restrictToFormOnlyLoading, setRestrictToFormOnlyLoading] = useState(false);

  const { userEmail } = useAuth();
  const canManageAdminSettings = hasScriptRun();
  const normalizedAdminEmailInput = useMemo(
    () => normalizeAdminEmailInput(adminEmailInput),
    [adminEmailInput],
  );

  
  useEffect(() => {
    const metaTag = document.querySelector("meta[name=\"deploy-time\"]");
    if (metaTag) {
      setDeployTime(metaTag.getAttribute("content") || "");
    }
  }, []);

  useEffect(() => {
    if (!canManageAdminSettings) return;
    (async () => {
      try {
        const [key, email, restrict] = await Promise.all([getAdminKey(), getAdminEmail(), getRestrictToFormOnly()]);
        setAdminKeyState(key);
        setAdminKeyInput(key);
        setAdminEmailState(email);
        setAdminEmailInput(email);
        setRestrictToFormOnlyState(restrict);
      } catch (error) {
        console.error("[AdminSettingsPage] load failed", error);
        showAlert(error?.message || "管理者設定の読み込みに失敗しました");
      }
    })();
  }, [canManageAdminSettings, showAlert]);

  const handleSaveSetting = async ({ apiFunc, inputValue, setStateValue, setInputValue, setConfirmOpen, setLoading, successMsgEmpty, successMsgFilled, errorMsg }) => {
    if (!canManageAdminSettings) return;
    setConfirmOpen(false);
    setLoading(true);
    try {
      const newVal = await apiFunc(inputValue);
      setStateValue(newVal);
      setInputValue(newVal);
      showAlert(newVal === "" ? successMsgEmpty : successMsgFilled(newVal));
    } catch (error) {
      console.error(error);
      showAlert(error?.message || errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveAdminKey = () => handleSaveSetting({
    apiFunc: async (val) => await setAdminKey(val.trim()), inputValue: adminKeyInput, setStateValue: setAdminKeyState, setInputValue: setAdminKeyInput, setConfirmOpen: setAdminKeyConfirm, setLoading: setAdminKeyLoading,
    successMsgEmpty: "管理者キーを解除しました。URLパラメータなしで管理者としてアクセスできます。", successMsgFilled: (val) => `管理者キーを更新しました。次回から ?adminkey=${val} でアクセスしてください。`, errorMsg: "管理者キーの保存に失敗しました"
  });

  const handleSaveAdminEmail = () => handleSaveSetting({
    apiFunc: async (val) => await setAdminEmail(val), inputValue: normalizedAdminEmailInput, setStateValue: setAdminEmailState, setInputValue: setAdminEmailInput, setConfirmOpen: setAdminEmailConfirm, setLoading: setAdminEmailLoading,
    successMsgEmpty: "管理者メール制限を解除しました。メールアドレスによる管理者制限は行いません。", successMsgFilled: () => "管理者メールを更新しました。設定済みメールと一致しないユーザーは管理者画面へアクセスできません。", errorMsg: "管理者メールの保存に失敗しました"
  });

  const adminKeyConfirmOptions = [
    { value: "cancel", label: "キャンセル", onSelect: () => setAdminKeyConfirm(false) },
    { value: "save", label: "保存する", variant: "primary", onSelect: handleSaveAdminKey },
  ];

  const handleOpenAdminEmailConfirm = () => {
    // メールリストが空でない場合、現在のユーザーが含まれているか確認する
    if (normalizedAdminEmailInput) {
      const emails = normalizedAdminEmailInput.split(";").map((e) => e.trim().toLowerCase()).filter(Boolean);
      const currentEmail = (userEmail || "").trim().toLowerCase();
      if (!currentEmail || !emails.includes(currentEmail)) {
        showAlert(
          `現在のアカウント（${currentEmail || "不明"}）が管理者リストに含まれていません。\n` +
          `自分自身をロックアウトしないよう、現在のメールアドレスをリストに含めてください。`
        );
        return;
      }
    }
    setAdminEmailConfirm(true);
  };

  const adminEmailConfirmOptions = [
    { value: "cancel", label: "キャンセル", onSelect: () => setAdminEmailConfirm(false) },
    { value: "save", label: "保存する", variant: "primary", onSelect: handleSaveAdminEmail },
  ];

  const handleToggleRestrictToFormOnly = async (event) => {
    if (!canManageAdminSettings) return;
    const newValue = event.target.checked;
    setRestrictToFormOnlyLoading(true);
    try {
      const saved = await setRestrictToFormOnly(newValue);
      setRestrictToFormOnlyState(saved);
    } catch (error) {
      console.error("[AdminSettingsPage] setRestrictToFormOnly failed", error);
      showAlert(error?.message || "設定の保存に失敗しました");
    } finally {
      setRestrictToFormOnlyLoading(false);
    }
  };

  return (
    <AppLayout title="管理者設定" fallbackPath="/" badge="アクセス制御">
      <div className="nf-card">
        {!canManageAdminSettings && (
          <div className="nf-mb-12 nf-text-12 nf-text-muted">
            この機能はGoogle Apps Script環境でのみ利用可能です。
          </div>
        )}

        <div className="nf-settings-group-title nf-mb-6">管理者キー</div>
        <p className="nf-mb-12 nf-text-12 nf-text-muted">
          管理者キーを設定すると、URLパラメータ <code>?adminkey=キー</code> でアクセスした場合のみ管理者として認識されます。
          空欄にすると管理者キー制限は解除されます。
        </p>
        <label className="nf-block nf-fw-600 nf-mb-6">管理者キー</label>
        <div className="nf-row nf-gap-12">
          <input
            className="nf-input nf-flex-1 nf-min-w-0"
            type="text"
            value={adminKeyInput}
            placeholder="未設定（管理者キー制限なし）"
            onChange={(event) => setAdminKeyInput(event.target.value)}
          />
          <button
            type="button"
            className="nf-btn nf-nowrap"
            onClick={() => setAdminKeyConfirm(true)}
            disabled={adminKeyLoading || adminKeyInput.trim() === adminKey}
          >
            {adminKeyLoading ? "保存中..." : "保存"}
          </button>
        </div>
        <p className="nf-mt-6 nf-text-11 nf-text-muted">
          {adminKey ? (
            <>
              現在の管理者アクセスURL: <code>?adminkey={adminKey}</code>
            </>
          ) : (
            "現在は管理者キーが未設定のため、管理者キー制限はありません。"
          )}
        </p>

        <div className="nf-mt-16 nf-pt-16" style={{ borderTop: "1px solid var(--nf-color-border)" }}>
          <div className="nf-settings-group-title nf-mb-6">管理者メール</div>
          <p className="nf-mb-12 nf-text-12 nf-text-muted">
            複数指定する場合は <code>;</code> 区切りで入力してください。例: <code>admin1@example.com;admin2@example.com</code>
          </p>
          <label className="nf-block nf-fw-600 nf-mb-6">管理者メールアドレス</label>
          <div className="nf-row nf-gap-12">
            <input
              className="nf-input nf-flex-1 nf-min-w-0"
              type="text"
              value={adminEmailInput}
              placeholder="未設定（メール制限なし）"
              onChange={(event) => setAdminEmailInput(event.target.value)}
            />
            <button
              type="button"
              className="nf-btn nf-nowrap"
              onClick={handleOpenAdminEmailConfirm}
              disabled={adminEmailLoading || normalizedAdminEmailInput === adminEmail}
            >
              {adminEmailLoading ? "保存中..." : "保存"}
            </button>
          </div>
          <p className="nf-mt-6 nf-text-11 nf-text-muted">
            {adminEmail
              ? (
                <>
                  現在の管理者メール: <code>{adminEmail}</code>
                </>
              )
              : "現在は管理者メールが未設定のため、メールアドレスによる管理者制限はありません。"}
          </p>
        </div>

        <div className="nf-mt-16 nf-pt-16" style={{ borderTop: "1px solid var(--nf-color-border)" }}>
          <div className="nf-settings-group-title nf-mb-6">アクセス制限</div>
          <p className="nf-mb-12 nf-text-12 nf-text-muted">
            管理者キーまたは管理者メールが設定されている場合に有効です。ONにすると、<code>?form=xxx</code> を指定しない一般ユーザーはアクセス拒否されます。
          </p>
          <label className="nf-row nf-gap-8" style={{ alignItems: "center", cursor: restrictToFormOnlyLoading ? "default" : "pointer" }}>
            <input
              type="checkbox"
              checked={restrictToFormOnly}
              disabled={!canManageAdminSettings || restrictToFormOnlyLoading}
              onChange={handleToggleRestrictToFormOnly}
            />
            <span className="nf-text-13">
              一般ユーザーが行ける範囲を個別フォームのみとする
            </span>
            {restrictToFormOnlyLoading && <span className="nf-text-12 nf-text-muted">保存中...</span>}
          </label>
        </div>

        <div className="nf-mt-16 nf-pt-16" style={{ borderTop: "1px solid var(--nf-color-border)" }}>
          <div className="nf-settings-group-title nf-mb-6">システム情報</div>
          <div className="nf-text-12 nf-text-muted">
            <div>最終デプロイ: {deployTime || "情報なし"}</div>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={adminKeyConfirm}
        title="管理者キーを変更しますか？"
        message={
          adminKeyInput.trim()
            ? `管理者キーを「${adminKeyInput.trim()}」に変更します。変更後は ?adminkey=${adminKeyInput.trim()} でアクセスしてください。`
            : "管理者キーを解除します。URLパラメータなしで管理者としてアクセスできるようになります。"
        }
        options={adminKeyConfirmOptions}
      />

      <ConfirmDialog
        open={adminEmailConfirm}
        title="管理者メールを変更しますか？"
        message={
          normalizedAdminEmailInput
            ? `管理者メールを「${normalizedAdminEmailInput}」に変更します。設定されたメール以外は管理者画面へアクセスできなくなります。`
            : "管理者メール制限を解除します。メールアドレスによる管理者制限は行われません。"
        }
        options={adminEmailConfirmOptions}
      />

</AppLayout>
  );
}
