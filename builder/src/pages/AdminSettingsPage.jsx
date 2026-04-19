import React, { useEffect, useMemo, useState } from "react";
import AppLayout from "../app/components/AppLayout.jsx";
import ConfirmDialog from "../app/components/ConfirmDialog.jsx";
import { useAlert } from "../app/hooks/useAlert.js";
import { useConfirmDialog } from "../app/hooks/useConfirmDialog.js";
import { useDeployTime } from "../app/hooks/useDeployTime.js";
import { useBuilderSettings } from "../features/settings/settingsStore.js";
import { hasScriptRun, getAdminKey, setAdminKey, getAdminEmail, setAdminEmail, checkAdminEmailMembership, getRestrictToFormOnly, setRestrictToFormOnly } from "../services/gasClient.js";
import { useAuth } from "../app/state/authContext.jsx";

const normalizeAdminEmailInput = (value) => String(value || "")
  .split(";")
  .map((item) => item.trim())
  .filter(Boolean)
  .join(";");

function buildMembershipFailMessage({ userEmail, reason, groupErrors, detail }) {
  const safeUser = userEmail || "不明";
  if (reason === "missing_current_user_email") {
    return "現在ユーザーのメールアドレスを取得できませんでした。Google アカウントにログインし直してから再度お試しください。";
  }
  if (reason === "group_fetch_failed") {
    const entries = Object.entries(groupErrors || {});
    const lines = entries.length
      ? entries.map(([group, message]) => `・${group}: ${message}`).join("\n")
      : "（詳細不明）";
    return (
      `現在のアカウント（${safeUser}）が管理者メンバーであるか確認できませんでした。\n` +
      `以下のグループのメンバー取得に失敗しました:\n${lines}\n\n` +
      `権限不足・外部グループ・削除済みグループの可能性があります。\n` +
      `回避策: 自分のメールアドレスを管理者リストに直接追加してから保存してください。`
    );
  }
  if (reason === "not_member") {
    return (
      `現在のアカウント（${safeUser}）が管理者リストに含まれていません。\n` +
      `自分自身をロックアウトしないよう、現在のメールアドレスまたは所属グループをリストに含めてください。`
    );
  }
  return detail || `管理者リストの検証に失敗しました（${reason || "unknown"}）。`;
}

function AdminSettingRow({ title, description, label, inputValue, placeholder, onInputChange, onSave, loading, saveDisabled, statusContent }) {
  return (
    <>
      <div className="nf-settings-group-title nf-mb-6">{title}</div>
      <p className="nf-mb-12 nf-text-12 nf-text-muted">{description}</p>
      <label className="nf-block nf-fw-600 nf-mb-6">{label}</label>
      <div className="nf-row nf-gap-12">
        <input
          className="nf-input nf-flex-1 nf-min-w-0"
          type="text"
          value={inputValue}
          placeholder={placeholder}
          onChange={(event) => onInputChange(event.target.value)}
        />
        <button
          type="button"
          className="nf-btn nf-nowrap"
          onClick={onSave}
          disabled={loading || saveDisabled}
        >
          {loading ? "保存中..." : "保存"}
        </button>
      </div>
      <p className="nf-mt-6 nf-text-11 nf-text-muted">{statusContent}</p>
    </>
  );
}

export default function AdminSettingsPage() {
  const { showAlert } = useAlert();
  const { settings } = useBuilderSettings();
  const deployTime = useDeployTime();

  const [adminKey, setAdminKeyState] = useState("");
  const [adminKeyInput, setAdminKeyInput] = useState("");
  const [adminKeyLoading, setAdminKeyLoading] = useState(false);
  const adminKeyDialog = useConfirmDialog();

  const [adminEmail, setAdminEmailState] = useState("");
  const [adminEmailInput, setAdminEmailInput] = useState("");
  const [adminEmailLoading, setAdminEmailLoading] = useState(false);
  const adminEmailDialog = useConfirmDialog();

  const [restrictToFormOnly, setRestrictToFormOnlyState] = useState(false);
  const [restrictToFormOnlyLoading, setRestrictToFormOnlyLoading] = useState(false);

  const { userEmail } = useAuth();
  const canManageAdminSettings = hasScriptRun();
  const normalizedAdminEmailInput = useMemo(
    () => normalizeAdminEmailInput(adminEmailInput),
    [adminEmailInput],
  );

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

  const handleSaveSetting = async ({ apiFunc, inputValue, setStateValue, setInputValue, closeDialog, setLoading, successMsgEmpty, successMsgFilled, errorMsg }) => {
    if (!canManageAdminSettings) return;
    closeDialog();
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
    apiFunc: async (val) => await setAdminKey(val.trim()), inputValue: adminKeyInput, setStateValue: setAdminKeyState, setInputValue: setAdminKeyInput, closeDialog: adminKeyDialog.close, setLoading: setAdminKeyLoading,
    successMsgEmpty: "管理者キーを解除しました。URLパラメータなしで管理者としてアクセスできます。", successMsgFilled: (val) => `管理者キーを更新しました。次回から ?adminkey=${val} でアクセスしてください。`, errorMsg: "管理者キーの保存に失敗しました"
  });

  const handleSaveAdminEmail = async () => {
    if (!canManageAdminSettings) return;
    adminEmailDialog.close();
    setAdminEmailLoading(true);
    try {
      const newVal = await setAdminEmail(normalizedAdminEmailInput);
      setAdminEmailState(newVal);
      setAdminEmailInput(newVal);
      showAlert(newVal === "" ? "管理者メール制限を解除しました。メールアドレスによる管理者制限は行いません。" : "管理者メールを更新しました。設定済みメールと一致しないユーザーは管理者画面へアクセスできません。");
    } catch (error) {
      console.error(error);
      const serverResult = error?.result;
      if (serverResult?.reason) {
        showAlert(buildMembershipFailMessage({
          userEmail: (userEmail || "").trim().toLowerCase(),
          reason: serverResult.reason,
          groupErrors: serverResult.groupErrors,
          detail: serverResult.detail,
        }));
      } else {
        showAlert(error?.message || "管理者メールの保存に失敗しました");
      }
    } finally {
      setAdminEmailLoading(false);
    }
  };

  const adminKeyConfirmOptions = [
    { value: "cancel", label: "キャンセル", onSelect: adminKeyDialog.close },
    { value: "save", label: "保存する", variant: "primary", onSelect: handleSaveAdminKey },
  ];

  const handleOpenAdminEmailConfirm = async () => {
    if (normalizedAdminEmailInput) {
      const emails = normalizedAdminEmailInput.split(";").map((e) => e.trim().toLowerCase()).filter(Boolean);
      const currentEmail = (userEmail || "").trim().toLowerCase();
      // 個人メール直接一致ならAPIコール不要で即OK
      if (!currentEmail || !emails.includes(currentEmail)) {
        // グループメンバーシップをサーバー側で確認
        try {
          const check = await checkAdminEmailMembership({
            userEmail: currentEmail,
            adminEmails: normalizedAdminEmailInput,
          });
          if (!check.isMember) {
            showAlert(buildMembershipFailMessage({
              userEmail: currentEmail,
              reason: check.reason,
              groupErrors: check.groupErrors,
              detail: check.detail,
            }));
            return;
          }
        } catch (error) {
          console.error("[AdminSettingsPage] membership check failed", error);
          // API失敗時はダイアログを開く（バックエンドのSetAdminEmail_が最終チェック）
        }
      }
    }
    adminEmailDialog.open();
  };

  const adminEmailConfirmOptions = [
    { value: "cancel", label: "キャンセル", onSelect: adminEmailDialog.close },
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

        <AdminSettingRow
          title="管理者キー"
          description={<>管理者キーを設定すると、URLパラメータ <code>?adminkey=キー</code> でアクセスした場合のみ管理者として認識されます。空欄にすると管理者キー制限は解除されます。</>}
          label="管理者キー"
          inputValue={adminKeyInput}
          placeholder="未設定（管理者キー制限なし）"
          onInputChange={setAdminKeyInput}
          onSave={() => adminKeyDialog.open()}
          loading={adminKeyLoading}
          saveDisabled={adminKeyInput.trim() === adminKey}
          statusContent={adminKey ? (<>現在の管理者アクセスURL: <code>?adminkey={adminKey}</code></>) : "現在は管理者キーが未設定のため、管理者キー制限はありません。"}
        />

        <div className="nf-section-divider">
          <AdminSettingRow
            title="管理者メール"
            description={<>複数指定する場合は <code>;</code> 区切りで入力してください。Google グループのメールアドレスも指定できます（グループのメンバー全員が管理者として認識されます）。例: <code>admin1@example.com;admin-group@googlegroups.com</code></>}
            label="管理者メールアドレス"
            inputValue={adminEmailInput}
            placeholder="未設定（メール制限なし）"
            onInputChange={setAdminEmailInput}
            onSave={handleOpenAdminEmailConfirm}
            loading={adminEmailLoading}
            saveDisabled={normalizedAdminEmailInput === adminEmail}
            statusContent={adminEmail ? (<>現在の管理者メール: <code>{adminEmail}</code></>) : "現在は管理者メールが未設定のため、メールアドレスによる管理者制限はありません。"}
          />
        </div>

        <div className="nf-section-divider">
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

        <div className="nf-section-divider">
          <div className="nf-settings-group-title nf-mb-6">システム情報</div>
          <div className="nf-text-12 nf-text-muted">
            <div>最終デプロイ: {deployTime || "情報なし"}</div>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={adminKeyDialog.state.open}
        title="管理者キーを変更しますか？"
        message={
          adminKeyInput.trim()
            ? `管理者キーを「${adminKeyInput.trim()}」に変更します。変更後は ?adminkey=${adminKeyInput.trim()} でアクセスしてください。`
            : "管理者キーを解除します。URLパラメータなしで管理者としてアクセスできるようになります。"
        }
        options={adminKeyConfirmOptions}
      />

      <ConfirmDialog
        open={adminEmailDialog.state.open}
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
