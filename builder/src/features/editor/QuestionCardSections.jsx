import React from "react";
import { DEFAULT_MULTILINE_ROWS } from "../../core/schema.js";
import { styles as s } from "./styles.js";
import {
  EMAIL_PLACEHOLDER,
  EXCLUDE_FROM_SEARCH_AND_PRINT_LABEL,
  PlaceholderInput,
  StyleSettingsInput,
  TextDefaultValueInput,
  TextInputRestrictionInput,
} from "./QuestionCardInputs.jsx";

export function MessageSection({ field, onChange }) {
  return (
    <div className="nf-mt-8">
      <label className="nf-row nf-gap-6">
        <input
          type="checkbox"
          checked={!!field.excludeFromSearchAndPrint}
          onChange={(event) => onChange({ ...field, excludeFromSearchAndPrint: event.target.checked })}
        />
        {EXCLUDE_FROM_SEARCH_AND_PRINT_LABEL}
      </label>
      <div className="nf-text-12 nf-text-subtle nf-mt-4">
        情報周知用のメッセージを検索結果一覧と印刷様式に出しません。
      </div>
    </div>
  );
}

export function TextFieldSection({ field, onChange, onFocus, regexError, getTempState, setTempState }) {
  return (
    <>
      <div className="nf-mt-8">
        <label className="nf-row nf-gap-6">
          <input
            type="checkbox"
            checked={!!field.multiline}
            onChange={(event) => onChange({ ...field, multiline: event.target.checked })}
          />
          複数行入力を許可
        </label>
      </div>
      {!!field.multiline && (
        <div className="nf-mt-6 nf-row nf-gap-6 nf-items-center">
          <label className="nf-text-12">テキストボックスの高さ（行数）</label>
          <input
            type="number"
            min="1"
            max="50"
            className={`${s.input.className}`}
            style={{ width: 72 }}
            value={field.multilineRows ?? DEFAULT_MULTILINE_ROWS}
            onChange={(event) => {
              const v = Number(event.target.value);
              onChange({ ...field, multilineRows: Number.isFinite(v) && v >= 1 ? Math.floor(v) : DEFAULT_MULTILINE_ROWS });
            }}
            onFocus={onFocus}
          />
        </div>
      )}
      <StyleSettingsInput
        field={field}
        onChange={onChange}
        onFocus={onFocus}
        getTempState={getTempState}
        setTempState={setTempState}
      />
      <PlaceholderInput field={field} onChange={onChange} onFocus={onFocus} />
      <TextDefaultValueInput field={field} onChange={onChange} onFocus={onFocus} />
      <TextInputRestrictionInput
        field={field}
        onChange={onChange}
        onFocus={onFocus}
        regexError={regexError}
        getTempState={getTempState}
        setTempState={setTempState}
      />
    </>
  );
}

export function EmailFieldSection({ field, onChange, onFocus }) {
  return (
    <>
      <PlaceholderInput
        field={field}
        onChange={onChange}
        onFocus={onFocus}
        toggleLabel="プレースホルダーを設定する"
        inputPlaceholder={EMAIL_PLACEHOLDER}
        defaultPlaceholder={EMAIL_PLACEHOLDER}
      />
      <div className="nf-mt-8">
        <label className="nf-row nf-gap-6">
          <input
            type="checkbox"
            checked={!!field.autoFillUserEmail}
            onChange={(event) => onChange({ ...field, autoFillUserEmail: event.target.checked })}
          />
          入力者のメールアドレスを自動入力する
        </label>
      </div>
    </>
  );
}

export function PhoneFieldSection({ field, onChange, onFocus, phonePlaceholder, phonePattern }) {
  return (
    <>
      <PlaceholderInput
        field={field}
        onChange={onChange}
        onFocus={onFocus}
        toggleLabel="プレースホルダーを設定する"
        inputPlaceholder={phonePlaceholder}
        defaultPlaceholder={phonePlaceholder}
      />
      <div className="nf-mt-8">
        <label className="nf-row nf-gap-6">
          <input
            type="checkbox"
            checked={!!field.autoFillUserPhone}
            onChange={(event) => onChange({ ...field, autoFillUserPhone: event.target.checked })}
          />
          入力者の電話番号を自動入力する
        </label>
      </div>
      <div className="nf-mt-8">
        <label className="nf-fw-600 nf-mb-4">形式</label>
        <div className="nf-row nf-gap-12 nf-wrap nf-mt-4">
          <label className="nf-row nf-gap-4 nf-nowrap">
            <input
              type="radio"
              name={`phone-format-${field.id}`}
              checked={(field.phoneFormat || "hyphen") === "hyphen"}
              onChange={() => onChange({ ...field, phoneFormat: "hyphen" })}
            />
            <span>ハイフンあり</span>
          </label>
          <label className="nf-row nf-gap-4 nf-nowrap">
            <input
              type="radio"
              name={`phone-format-${field.id}`}
              checked={field.phoneFormat === "plain"}
              onChange={() => onChange({ ...field, phoneFormat: "plain" })}
            />
            <span>ハイフンなし</span>
          </label>
        </div>
      </div>
      <div className="nf-mt-8">
        <div className="nf-row nf-gap-12 nf-wrap">
          <label className="nf-row nf-gap-4">
            <input
              type="checkbox"
              checked={!!field.allowFixedLineOmitAreaCode}
              onChange={(event) => onChange({ ...field, allowFixedLineOmitAreaCode: event.target.checked })}
            />
            <span>固定電話の市外局番省略を認める</span>
          </label>
          <label className="nf-row nf-gap-4">
            <input
              type="checkbox"
              checked={field.allowMobile !== false}
              onChange={(event) => onChange({ ...field, allowMobile: event.target.checked })}
            />
            <span>携帯電話（090 / 080 / 070）を許容</span>
          </label>
          <label className="nf-row nf-gap-4">
            <input
              type="checkbox"
              checked={field.allowIpPhone !== false}
              onChange={(event) => onChange({ ...field, allowIpPhone: event.target.checked })}
            />
            <span>IP電話（050）を許容</span>
          </label>
          <label className="nf-row nf-gap-4">
            <input
              type="checkbox"
              checked={field.allowTollFree !== false}
              onChange={(event) => onChange({ ...field, allowTollFree: event.target.checked })}
            />
            <span>フリーダイヤル（0120）を許容</span>
          </label>
        </div>
      </div>
      <div className="nf-mt-8 nf-text-12 nf-text-subtle">
        <div>許容パターン（正規表現）</div>
        <code className="nf-text-11 nf-text-muted nf-word-break">{phonePattern}</code>
      </div>
    </>
  );
}

export function FileUploadFieldSection({ field, onChange }) {
  return (
    <div className="nf-mt-8">
      <label className="nf-row nf-gap-6">
        <input
          type="checkbox"
          checked={!!field.allowUploadByUrl}
          onChange={(event) => onChange({ ...field, allowUploadByUrl: event.target.checked })}
        />
        URLによるアップロードを有効にする
      </label>
      <label className="nf-row nf-gap-6 nf-mt-8">
        <input
          type="checkbox"
          checked={!!field.allowFolderUrlEdit}
          onChange={(event) => onChange({ ...field, allowFolderUrlEdit: event.target.checked })}
        />
        保存先フォルダURLを変更可能にする
      </label>
      <label className="nf-row nf-gap-6 nf-mt-8">
        <input
          type="checkbox"
          checked={!!field.hideFileExtension}
          onChange={(event) => onChange({ ...field, hideFileExtension: event.target.checked })}
        />
        ファイル名の拡張子を非表示にする
      </label>
      <div className="nf-mt-12">
        <div className="nf-text-12 nf-fw-600 nf-mb-4">ルートフォルダURL</div>
        <input
          className="nf-input"
          type="text"
          value={field.driveRootFolderUrl ?? ""}
          placeholder="https://drive.google.com/drive/folders/..."
          onChange={(event) => onChange({ ...field, driveRootFolderUrl: event.target.value })}
        />
        <div className="nf-text-11 nf-text-muted nf-mt-4">
          空白の場合はマイドライブのルートがファイルの保存先になります
        </div>
      </div>
      <div className="nf-mt-8">
        <div className="nf-text-12 nf-fw-600 nf-mb-4">フォルダ命名規則</div>
        <input
          className="nf-input"
          type="text"
          value={field.driveFolderNameTemplate ?? ""}
          placeholder="{@_id}_{@_NOW|time:YYYY-MM-DD}_{担当者名}"
          onChange={(event) => onChange({ ...field, driveFolderNameTemplate: event.target.value })}
        />
        <div className="nf-text-11 nf-text-muted nf-mt-4">
          {"空白の場合は子フォルダを作らず、ルートフォルダ直下に保存します。{@_id}, {@_NOW}, {@フィールド名} を使えます。{@_NOW|time:YYYY-MM-DD} のようにパイプで書式を指定できます。"}
        </div>
      </div>
    </div>
  );
}

export function DateTimeFieldSection({ field, onChange }) {
  return (
    <div className="nf-mt-8">
      <label className="nf-row nf-gap-6">
        <input
          type="checkbox"
          checked={!!field.defaultNow}
          onChange={(event) => onChange({ ...field, defaultNow: event.target.checked })}
        />
        初期値を現在{field.type === "date" ? "の日付" : "の時刻"}にする
      </label>
      {field.type === "time" && (
        <label className="nf-row nf-gap-6 nf-mt-8">
          <input
            type="checkbox"
            checked={!!field.includeSeconds}
            onChange={(event) => onChange({ ...field, includeSeconds: event.target.checked })}
          />
          秒を含める（時:分:秒）
        </label>
      )}
    </div>
  );
}

export function WeekdayFieldSection({ field, onChange }) {
  return (
    <div className="nf-mt-8">
      <div className="nf-text-12 nf-text-subtle nf-mb-4">
        選択肢は固定です: 月・火・水・木・金・土・日
      </div>
      <label className="nf-row nf-gap-6">
        <input
          type="checkbox"
          checked={!!field.defaultToday}
          onChange={(event) => onChange({ ...field, defaultToday: event.target.checked })}
        />
        初期値を今日の曜日にする
      </label>
    </div>
  );
}

export function CalculatedFieldSection({ field, onChange, formulaError }) {
  return (
    <div className="nf-mt-8">
      <div className="nf-col nf-gap-8">
        <label className="nf-col nf-gap-4">
          <span className="nf-text-12 nf-fw-600">計算式</span>
          <textarea
            className={`${s.input.className} nf-h-64`}
            placeholder={"例: {売上} - {経費} * 0.1"}
            value={field.formula || ""}
            onChange={(event) => onChange({ ...field, formula: event.target.value })}
          />
          {formulaError && (
            <div className="nf-text-danger-ink nf-text-12 nf-mt-4">計算式エラー: {formulaError}</div>
          )}
          <span className="nf-text-11 nf-text-muted">
            {"{フィールド名} で他の項目を参照できます。四則演算（+ - * / % **）のほか、max, min, abs, round, floor, ceil, trunc, pow, sqrt, log, log10, PI, E が使えます。Math.max(...) 形式もOKです。"}
          </span>
        </label>
        <label className="nf-row nf-gap-6">
          <input
            type="checkbox"
            checked={!!field.excludeFromSearch}
            onChange={(event) => onChange({ ...field, excludeFromSearch: event.target.checked })}
          />
          検索結果に表示しない
        </label>
        <label className="nf-row nf-gap-6">
          <input
            type="checkbox"
            checked={!!field.hideFromRecordView}
            onChange={(event) => onChange({ ...field, hideFromRecordView: event.target.checked })}
          />
          レコード閲覧・編集画面に表示しない
        </label>
        <div className="nf-text-11 nf-text-muted">
          非表示でも他の計算・置換フィールドや印刷様式から参照できます。
        </div>
      </div>
    </div>
  );
}

export function SubstitutionFieldSection({ field, onChange }) {
  return (
    <div className="nf-mt-8">
      <div className="nf-col nf-gap-8">
        <label className="nf-col nf-gap-4">
          <span className="nf-text-12 nf-fw-600">置換テキスト</span>
          <textarea
            className={`${s.input.className} nf-h-64`}
            placeholder={"例: {氏名}さんはいつも元気だね。"}
            value={field.templateText || ""}
            onChange={(event) => onChange({ ...field, templateText: event.target.value })}
          />
          <span className="nf-text-11 nf-text-muted">
            {"{@フィールド名} で他の項目の値を埋め込めます。{@_id}, {@_NOW|time:YYYY年MM月DD日} 等の予約トークンも使えます。パイプ変換（|upper, |left:3 等）も使用できます。"}
          </span>
        </label>
        <label className="nf-row nf-gap-6">
          <input
            type="checkbox"
            checked={!!field.excludeFromSearch}
            onChange={(event) => onChange({ ...field, excludeFromSearch: event.target.checked })}
          />
          検索結果に表示しない
        </label>
        <label className="nf-row nf-gap-6">
          <input
            type="checkbox"
            checked={!!field.hideFromRecordView}
            onChange={(event) => onChange({ ...field, hideFromRecordView: event.target.checked })}
          />
          レコード閲覧・編集画面に表示しない
        </label>
        <div className="nf-text-11 nf-text-muted">
          非表示でも他の計算・置換フィールドや印刷様式から参照できます。
        </div>
      </div>
    </div>
  );
}
