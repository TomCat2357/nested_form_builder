import React, { useEffect, useMemo, useState } from "react";
import AppLayout from "../app/components/AppLayout.jsx";
import AlertDialog from "../app/components/AlertDialog.jsx";
import { useAlert } from "../app/hooks/useAlert.js";
import { useBuilderSettings } from "../features/settings/settingsStore.js";
import {
  DEFAULT_THEME,
  THEME_OPTIONS,
  getCustomThemes,
  removeCustomTheme,
  setCustomTheme,
} from "../app/theme/theme.js";
import ConfirmDialog from "../app/components/ConfirmDialog.jsx";
import { hasScriptRun, importThemeFromDrive, getAdminKey, setAdminKey } from "../services/gasClient.js";

const extractThemeName = (css, fallbackName = "") => {
  const match = String(css || "").match(/data-theme=(["'])([^"']+)\1/);
  if (match && match[2]) return match[2].trim();
  if (fallbackName) {
    return fallbackName.replace(/\.[^/.]+$/, "");
  }
  return "";
};

export default function ConfigPage() {
  const { settings, updateSetting } = useBuilderSettings();
  const { alertState, showAlert, closeAlert } = useAlert();
  const [customThemes, setCustomThemes] = useState([]);
  const [importUrl, setImportUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [removeTarget, setRemoveTarget] = useState(null);
  const [deployTime, setDeployTime] = useState("");
  const themeValue = settings?.theme || DEFAULT_THEME;

  // 管理者キー関連の状態
  const [adminKey, setAdminKeyState] = useState("");
  const [adminKeyInput, setAdminKeyInput] = useState("");
  const [adminKeyLoading, setAdminKeyLoading] = useState(false);
  const [adminKeyConfirm, setAdminKeyConfirm] = useState(false);
  const themeOptions = useMemo(
    () => [
      ...THEME_OPTIONS,
      ...customThemes.map((theme) => ({ value: theme.id, label: theme.name || "カスタムテーマ" })),
    ],
    [customThemes]
  );

  useEffect(() => {
    let active = true;
    (async () => {
      const themes = await getCustomThemes();
      if (active) {
        setCustomThemes(themes);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const hasSelectedTheme = themeOptions.some((option) => option.value === themeValue);
    if (!hasSelectedTheme && themeValue !== DEFAULT_THEME) {
      updateSetting("theme", DEFAULT_THEME);
    }
  }, [themeOptions, themeValue, updateSetting]);

  // デプロイ時刻を読み取り
  useEffect(() => {
    const metaTag = document.querySelector("meta[name=\"deploy-time\"]");
    if (metaTag) {
      setDeployTime(metaTag.getAttribute("content") || "");
    }
  }, []);

  // 管理者キーを読み込み
  useEffect(() => {
    if (!hasScriptRun()) return;
    (async () => {
      try {
        const key = await getAdminKey();
        setAdminKeyState(key);
        setAdminKeyInput(key);
      } catch (error) {
        console.error("[ConfigPage] getAdminKey failed", error);
      }
    })();
  }, []);

  // 管理者キー保存処理
  const handleSaveAdminKey = async () => {
    if (!hasScriptRun()) {
      showAlert("管理者キーの変更はGoogle Apps Script環境でのみ利用可能です");
      return;
    }
    setAdminKeyConfirm(false);
    setAdminKeyLoading(true);
    try {
      const newKey = await setAdminKey(adminKeyInput.trim());
      setAdminKeyState(newKey);
      setAdminKeyInput(newKey);
      if (newKey === "") {
        showAlert("管理者キーを解除しました。URLパラメータなしで管理者としてアクセスできます。");
      } else {
        showAlert("管理者キーを更新しました。次回から ?adminkey=" + newKey + " でアクセスしてください。");
      }
    } catch (error) {
      console.error("[ConfigPage] setAdminKey failed", error);
      showAlert(error?.message || "管理者キーの保存に失敗しました");
    } finally {
      setAdminKeyLoading(false);
    }
  };

  const adminKeyConfirmOptions = [
    { value: "cancel", label: "キャンセル", onSelect: () => setAdminKeyConfirm(false) },
    { value: "save", label: "保存する", variant: "primary", onSelect: handleSaveAdminKey },
  ];

  const handleImportTheme = async () => {
    if (importing) return;
    if (!hasScriptRun()) {
      showAlert("インポート機能はGoogle Apps Script環境でのみ利用可能です");
      return;
    }
    const url = (importUrl || "").trim();
    if (!url) {
      showAlert("Google Drive URLを入力してください");
      return;
    }
    setImporting(true);
    try {
      const result = await importThemeFromDrive(url);
      const css = result?.css || "";
      if (!css.trim()) {
        throw new Error("テーマファイルが空です");
      }
      const name = extractThemeName(css, result?.fileName);
      const theme = await setCustomTheme({ css, name, url: result?.fileUrl || url });
      if (!theme) {
        throw new Error("テーマファイルが空です");
      }
      const nextThemes = await getCustomThemes();
      setCustomThemes(nextThemes);
      setImportUrl(theme.url || "");
      updateSetting("theme", theme.id);
      showAlert("テーマをインポートしました");
    } catch (error) {
      console.error("[ConfigPage] theme import failed", error);
      showAlert(error?.message || "テーマのインポートに失敗しました");
    } finally {
      setImporting(false);
    }
  };

  const handleRemoveCustomTheme = (theme) => {
    if (!theme) return;
    setRemoveTarget(theme);
  };

  const handleConfirmRemove = async () => {
    if (!removeTarget) return;
    const nextThemes = await removeCustomTheme(removeTarget.id);
    setCustomThemes(nextThemes);
    if ((settings?.theme || DEFAULT_THEME) === removeTarget.id) {
      updateSetting("theme", DEFAULT_THEME);
    }
    setRemoveTarget(null);
    showAlert("インポートしたテーマを削除しました");
  };

  const removeOptions = [
    { value: "cancel", label: "キャンセル", onSelect: () => setRemoveTarget(null) },
    { value: "remove", label: "削除する", variant: "danger", onSelect: handleConfirmRemove },
  ];

  return (
    <AppLayout title="設定" fallbackPath="/" badge="テーマ">
      <div className="nf-card">
        <div className="nf-fw-600 nf-mb-8">テーマ設定</div>
        <div className="nf-mb-12">
          <label className="nf-block nf-fw-600 nf-mb-6">テーマ</label>
          <select
            className="nf-input"
            value={themeValue}
            onChange={(event) => updateSetting("theme", event.target.value)}
          >
            {themeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <p className="nf-mt-6 nf-text-12 nf-text-muted">アプリ全体の配色が切り替わります。</p>
        </div>

        <div className="nf-mt-16">
          <div className="nf-fw-600 nf-mb-6">テーマをインポート</div>
          <p className="nf-mb-12 nf-text-12 nf-text-muted">
            Google Drive内のテーマCSSファイルURLを指定してください。
          </p>
          <label className="nf-block nf-fw-600 nf-mb-6">Google Drive URL</label>
          <div className="nf-row nf-gap-12">
            <input
              className="nf-input nf-flex-1 nf-min-w-0"
              type="text"
              value={importUrl}
              placeholder="https://drive.google.com/file/d/..."
              onChange={(event) => setImportUrl(event.target.value)}
            />
            <button
              type="button"
              className="nf-btn nf-nowrap"
              onClick={handleImportTheme}
              disabled={importing}
            >
              {importing ? "インポート中..." : "インポート"}
            </button>
          </div>
          <p className="nf-mt-6 nf-text-11 nf-text-muted">
            推奨形式: <span className="nf-text-underline">:root[data-theme="..."]</span> を含むCSS
          </p>
          {customThemes.length > 0 && (
            <div className="nf-mt-12">
              <div className="nf-text-12 nf-text-muted">インポート済みテーマ</div>
              <div className="nf-col nf-gap-12 nf-mt-8">
                {customThemes.map((theme) => (
                  <div key={theme.id} className="nf-row nf-gap-12">
                    <div className="nf-flex-1 nf-min-w-0">
                      <div className="nf-fw-600">{theme.name || "カスタムテーマ"}</div>
                      {theme.url && (
                        <div className="nf-mt-4 nf-text-11 nf-text-muted">
                          <a className="nf-text-underline" href={theme.url} target="_blank" rel="noreferrer">
                            {theme.url}
                          </a>
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      className="nf-btn-outline nf-nowrap"
                      onClick={() => handleRemoveCustomTheme(theme)}
                    >
                      削除
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {hasScriptRun() && (
          <div className="nf-mt-16 nf-pt-16" style={{ borderTop: "1px solid var(--nf-color-border)" }}>
            <div className="nf-fw-600 nf-mb-6">アクセス制御</div>
            <p className="nf-mb-12 nf-text-12 nf-text-muted">
              管理者キーを設定すると、URLパラメータ <code>?adminkey=キー</code> でアクセスした場合のみ管理者として認識されます。
              空欄にすると誰でも管理者としてアクセスできます。
            </p>
            <label className="nf-block nf-fw-600 nf-mb-6">管理者キー</label>
            <div className="nf-row nf-gap-12">
              <input
                className="nf-input nf-flex-1 nf-min-w-0"
                type="text"
                value={adminKeyInput}
                placeholder="未設定（誰でも管理者）"
                onChange={(event) => setAdminKeyInput(event.target.value)}
              />
              <button
                type="button"
                className="nf-btn nf-nowrap"
                onClick={() => setAdminKeyConfirm(true)}
                disabled={adminKeyLoading || adminKeyInput === adminKey}
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
                "現在は管理者キーが未設定のため、誰でも管理者としてアクセスできます。"
              )}
            </p>
          </div>
        )}

        {deployTime && (
          <div className="nf-mt-16 nf-pt-16" style={{ borderTop: "1px solid var(--nf-color-border)" }}>
            <div className="nf-fw-600 nf-mb-6">システム情報</div>
            <div className="nf-text-12 nf-text-muted">
              <div>最終デプロイ: {deployTime}</div>
            </div>
          </div>
        )}
      </div>
      <ConfirmDialog
        open={Boolean(removeTarget)}
        title="インポートテーマを削除しますか？"
        message={
          removeTarget
            ? `削除すると「${removeTarget.name || "カスタムテーマ"}」は一覧から消え、選択中の場合はDefaultに戻ります。`
            : ""
        }
        options={removeOptions}
      />
      <ConfirmDialog
        open={adminKeyConfirm}
        title="管理者キーを変更しますか？"
        message={
          adminKeyInput.trim()
            ? `管理者キーを「${adminKeyInput.trim()}」に変更します。変更後は ?adminkey=${adminKeyInput.trim()} でアクセスしてください。`
            : "管理者キーを解除します。URLパラメータなしで誰でも管理者としてアクセスできるようになります。"
        }
        options={adminKeyConfirmOptions}
      />
      <AlertDialog open={alertState.open} title={alertState.title} message={alertState.message} onClose={closeAlert} />
    </AppLayout>
  );
}
