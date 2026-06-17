import React, { useCallback } from "react";
import { EXTERNAL_ACTIONS_MAX, normalizeExternalActions } from "../../utils/settings.js";
import { isValidExternalActionUrl } from "../../utils/externalActionUrl.js";
import {
  DEFAULT_STYLE_SETTINGS,
  normalizeStyleSettings,
} from "../../core/styleSettings.js";
import { StyleColorField } from "../editor/QuestionCardInputs.jsx";

const SECTION_LABELS = {
  search: "検索画面ボタン",
};

const updateActionAt = (list, idx, patch) => {
  const next = list.slice();
  next[idx] = { ...next[idx], ...patch };
  return next;
};

function ActionStyleSettings({ idx, action, onChange, disabled }) {
  const enabled = typeof action.showStyleSettings === "boolean"
    ? action.showStyleSettings
    : !!action.styleSettings;
  const styleSettings = normalizeStyleSettings(action.styleSettings || {});
  return (
    <div className="nf-mt-4 nf-mb-4">
      <label className="nf-flex nf-items-center nf-gap-4 nf-text-12" style={{ cursor: disabled ? "not-allowed" : "pointer" }}>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => {
            if (event.target.checked) {
              onChange(idx, {
                showStyleSettings: true,
                styleSettings: { ...DEFAULT_STYLE_SETTINGS, ...styleSettings },
              });
            } else {
              onChange(idx, { showStyleSettings: false, styleSettings: undefined });
            }
          }}
          disabled={disabled}
        />
        スタイル設定
      </label>
      {enabled && (
        <div className="nf-row nf-gap-8 nf-mt-4 nf-wrap" style={{ maxWidth: 480 }}>
          <div className="nf-flex-1">
            <label className="nf-text-12 nf-mb-2 nf-text-subtle">文字サイズ</label>
            <select
              className="nf-input"
              value={styleSettings.labelSize || "default"}
              onChange={(event) => onChange(idx, { styleSettings: { ...styleSettings, labelSize: event.target.value } })}
              disabled={disabled}
            >
              <option value="smallest">最も小さく</option>
              <option value="smaller">小さく</option>
              <option value="default">標準</option>
              <option value="larger">大きく</option>
              <option value="largest">最も大きく</option>
            </select>
          </div>
          <StyleColorField
            label="文字色"
            value={styleSettings.textColor}
            defaultPickerColor="#000000"
            onChange={(textColor) => onChange(idx, { styleSettings: { ...styleSettings, textColor } })}
            disabled={disabled}
          />
          <StyleColorField
            label="背景色"
            value={styleSettings.bgColor}
            defaultPickerColor="#2563EB"
            onChange={(bgColor) => onChange(idx, { styleSettings: { ...styleSettings, bgColor } })}
            disabled={disabled}
          />
        </div>
      )}
    </div>
  );
}

function ActionRow({ idx, action, onChange, disabled, urlInvalid }) {
  return (
    <div className="nf-mb-12">
      <div className="nf-flex nf-gap-8 nf-items-start nf-wrap">
        <input
          type="text"
          className="nf-input"
          style={{ flex: "0 0 180px" }}
          placeholder={`ボタン${idx + 1} ラベル`}
          value={action.label}
          onChange={(event) => onChange(idx, { label: event.target.value })}
          disabled={disabled}
        />
        <input
          type="text"
          className="nf-input"
          style={{
            flex: "1 1 280px",
            borderColor: urlInvalid ? "#d93025" : undefined,
          }}
          placeholder="https://script.google.com/macros/.../exec?ssid=..."
          value={action.url}
          onChange={(event) => onChange(idx, { url: event.target.value })}
          disabled={disabled}
        />
        <label
          className="nf-flex nf-items-center nf-gap-4 nf-text-12"
          style={{ flex: "0 0 auto", cursor: disabled ? "not-allowed" : "pointer", whiteSpace: "nowrap" }}
          title="ON にすると管理者ロールのユーザーにだけボタンが表示されます。{{`_spreadsheet_id`}} 等の機微トークンも管理者限定ボタンでのみ展開されます。"
        >
          <input
            type="checkbox"
            checked={!!action.adminOnly}
            onChange={(event) => onChange(idx, { adminOnly: event.target.checked })}
            disabled={disabled}
          />
          管理者限定
        </label>
      </div>
      <ActionStyleSettings idx={idx} action={action} onChange={onChange} disabled={disabled} />
    </div>
  );
}

function SectionEditor({ sectionKey, list, onChange, disabled }) {
  const handleRowChange = useCallback(
    (idx, patch) => onChange(updateActionAt(list, idx, patch)),
    [list, onChange],
  );
  return (
    <div className="nf-mb-12">
      <div className="nf-fw-600 nf-mb-6">{SECTION_LABELS[sectionKey]} (最大 {EXTERNAL_ACTIONS_MAX} 個)</div>
      {list.map((action, idx) => (
        <ActionRow
          key={idx}
          idx={idx}
          action={action}
          onChange={handleRowChange}
          disabled={disabled}
          urlInvalid={action.url.trim() !== "" && !isValidExternalActionUrl(action.url)}
        />
      ))}
    </div>
  );
}

export default function ExternalActionsEditor({ value, onChange, disabled }) {
  const normalized = normalizeExternalActions(value);

  const handleEnabledChange = useCallback(
    (event) => {
      onChange({ ...normalized, enabled: event.target.checked });
    },
    [normalized, onChange],
  );

  const handleSectionChange = useCallback(
    (sectionKey) => (nextList) => {
      onChange({ ...normalized, [sectionKey]: nextList });
    },
    [normalized, onChange],
  );

  return (
    <div>
      <label className="nf-flex nf-items-center nf-gap-8 nf-mb-12" style={{ cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={!!normalized.enabled}
          onChange={handleEnabledChange}
          disabled={disabled}
        />
        <span className="nf-fw-600">外部アクションを有効化</span>
      </label>
      {normalized.enabled && (
        <>
          <p className="nf-text-12 nf-text-muted nf-mb-12">
            検索結果一覧に、別途用意した GAS Web アプリ等へデータを送るボタンを最大 {EXTERNAL_ACTIONS_MAX} つ置けます。
            クリックすると新しいタブで URL を開き、同時に絞り込み後の全行を <strong>POST 送信</strong>します
            （GAS 側は <code>doPost(e)</code> の <code>e.parameter.payload</code> を <code>JSON.parse</code> して受信）。
            <code> http:// </code> または <code> https:// </code> で始まる URL のみ登録できます。
            <br />
            URL には印刷様式と同じ <code>{"{{...}}"}</code> トークンが使えます（例: <code>{"{{`_form_id`}}"}</code>）。値は自動で URL エンコードされます。
            <strong>管理者限定ボタンのみ</strong>、保存先情報 <code>storage</code>（<code>spreadsheetId</code> 等）が payload と機微 URL トークン（<code>{"{{`_spreadsheet_id`}}"}</code> 等）に展開されます。
            管理者限定でないボタンで機微トークンを URL に使うと URL が無効化されます。
            <br />
            ※ 個々のレコードからの送信は、質問カードの種別「外部アクション」を使ってください。
            <br />
            ※ 誤送信防止シークレットは<strong>管理者設定の「外部アクション 送信元シークレット」</strong>でシステム全体に 1 つ設定します（受信アプリ側の Script Properties <code>NFB_EXT_ACTION_SECRET</code> と同値）。
          </p>
          <SectionEditor
            sectionKey="search"
            list={normalized.search}
            onChange={handleSectionChange("search")}
            disabled={disabled}
          />
        </>
      )}
    </div>
  );
}
