import React from "react";
import { DEFAULT_MULTILINE_ROWS, normalizeWebhookAction } from "../../core/schema.js";
import { isValidExternalActionUrl } from "../../utils/externalActionUrl.js";
import { useAppData } from "../../app/state/AppDataProvider.jsx";
import SearchableSelect from "../../app/components/SearchableSelect.jsx";
import { formQualifiedName } from "../analytics/utils/formIdentifierResolver.js";
import { buildChildFormUrl } from "../../utils/formShareUrl.js";
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
        <div className="nf-text-11 nf-text-muted">
          アップロードされたファイルは標準フォルダ構成の <code>06_upload_files</code> に保存されます。
        </div>
      </div>
      <div className="nf-mt-8">
        <div className="nf-text-12 nf-fw-600 nf-mb-4">フォルダ命名規則</div>
        <input
          className="nf-input"
          type="text"
          value={field.driveFolderNameTemplate ?? ""}
          placeholder="{`_id`}_{TIME_FORMAT(NOW(), 'YYYY-MM-DD')}_{`担当者名`}"
          onChange={(event) => onChange({ ...field, driveFolderNameTemplate: event.target.value })}
        />
        <div className="nf-text-11 nf-text-muted nf-mt-4">
          {"空白の場合は子フォルダを作らず、ルートフォルダ直下に保存します。{`_id`}, {NOW()}, {`フィールド名`} を使えます。ネストされた子質問は {`親|子`} のフルパスで指定。{TIME_FORMAT(NOW(), 'YYYY-MM-DD')} のように関数で書式を指定できます。"}
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
        <div className="nf-mt-8">
          <label className="nf-fw-600 nf-mb-4">精度</label>
          <div className="nf-row nf-gap-12 nf-wrap nf-mt-4">
            <label className="nf-row nf-gap-4 nf-nowrap">
              <input
                type="radio"
                name={`time-precision-${field.id}`}
                checked={(field.timePrecision || "second") === "minute"}
                onChange={() => onChange({ ...field, timePrecision: "minute" })}
              />
              <span>分まで（時:分）</span>
            </label>
            <label className="nf-row nf-gap-4 nf-nowrap">
              <input
                type="radio"
                name={`time-precision-${field.id}`}
                checked={(field.timePrecision || "second") === "second"}
                onChange={() => onChange({ ...field, timePrecision: "second" })}
              />
              <span>秒まで（時:分:秒）</span>
            </label>
            <label className="nf-row nf-gap-4 nf-nowrap">
              <input
                type="radio"
                name={`time-precision-${field.id}`}
                checked={field.timePrecision === "millisecond"}
                onChange={() => onChange({ ...field, timePrecision: "millisecond" })}
              />
              <span>ミリ秒まで（時:分:秒.ミリ秒）</span>
            </label>
          </div>
        </div>
      )}
    </div>
  );
}

export function WebhookSection({ field, onChange }) {
  const action = normalizeWebhookAction(field.webhookAction);
  const urlInvalid = action.url.trim() !== "" && !isValidExternalActionUrl(action.url);
  const updateAction = (patch) => onChange({ ...field, webhookAction: { ...action, ...patch } });
  return (
    <div className="nf-mt-8">
      <div className="nf-col nf-gap-8">
        <label className="nf-col nf-gap-4">
          <span className="nf-text-12 nf-fw-600">送信先 URL（GAS Web アプリ等）</span>
          <input
            className={s.input.className}
            type="text"
            style={{ borderColor: urlInvalid ? "#d93025" : undefined }}
            placeholder="https://script.google.com/macros/.../exec"
            value={action.url}
            onChange={(event) => updateAction({ url: event.target.value })}
          />
          {urlInvalid && (
            <span className="nf-text-danger-ink nf-text-11">http:// または https:// で始まる URL を入力してください。</span>
          )}
        </label>
        <label className="nf-row nf-gap-6">
          <input
            type="checkbox"
            checked={!!action.adminOnly}
            onChange={(event) => updateAction({ adminOnly: event.target.checked })}
          />
          管理者限定
        </label>
        <div className="nf-text-11 nf-text-muted">
          {"ボタンを押すと新しいタブで URL を開き、同時にこのレコードの内容を POST 送信します（GAS 側は doPost(e) の e.parameter.payload を JSON.parse して受信）。管理者限定を ON にすると、管理者以外にはこのボタンが表示されません。管理者限定のときだけ保存先情報（spreadsheetId 等）も送られます。"}
        </div>
      </div>
    </div>
  );
}

export function FormLinkSection({ field, onChange }) {
  const { forms } = useAppData();
  const [showUrl, setShowUrl] = React.useState(false);
  const childFormId = typeof field.childFormId === "string" ? field.childFormId : "";

  const formOptions = React.useMemo(
    () => (Array.isArray(forms) ? forms : [])
      .filter((f) => f && f.id)
      .map((f) => ({ value: f.id, label: formQualifiedName(f) || f.id, folder: f.folder || "" })),
    [forms],
  );

  const handleSelect = (selectedId) => {
    const selectedForm = (Array.isArray(forms) ? forms : []).find((f) => f && f.id === selectedId) || null;
    onChange({
      ...field,
      childFormId: selectedId || "",
      childFormPath: selectedForm ? (formQualifiedName(selectedForm) || "") : "",
    });
  };

  const baseUrl = (typeof window !== "undefined" && window.__GAS_WEBAPP_URL__) ? window.__GAS_WEBAPP_URL__ : "";
  // 確認用にリンク先フォームの物理 URL（?form=<fileId>）を表示する。pid は実行時にこのレコードの
  // ID が付与される（下の注記参照）ため、ここでは付けずに表示する。
  const physicalUrl = childFormId ? buildChildFormUrl(baseUrl, childFormId, "") : "";

  return (
    <div className="nf-mt-8">
      <div className="nf-col nf-gap-8">
        <label className="nf-col nf-gap-4">
          <span className="nf-text-12 nf-fw-600">開くフォーム（論理パス）</span>
          <SearchableSelect
            value={childFormId}
            onChange={handleSelect}
            options={formOptions}
            placeholder="フォームを選択"
          />
        </label>
        <label className="nf-row nf-gap-6">
          <input
            type="checkbox"
            checked={showUrl}
            onChange={(event) => setShowUrl(event.target.checked)}
          />
          物理 URL を表示
        </label>
        {showUrl && (
          <div className="nf-input nf-input--readonly nf-text-12 nf-text-subtle" style={{ wordBreak: "break-all" }}>
            {physicalUrl || "フォームを選択すると URL が表示されます"}
          </div>
        )}
        <div className="nf-text-11 nf-text-muted">
          {"ボタンを押すと、選択したフォームを別タブで開きます（?form=対象フォームのID&pid=このレコードのID）。pid はボタンを押したレコードの ID になり、開いた先ではその pid に紐づく行だけが表示され、新規行にもその pid が刻まれます。"}
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
            placeholder={"例: {`氏名`}さんはいつも元気だね。"}
            value={field.templateText || ""}
            onChange={(event) => onChange({ ...field, templateText: event.target.value })}
          />
          <span className="nf-text-11 nf-text-muted">
            {"{`フィールド名`} で他の項目の値を埋め込めます（元データ形式）。選択肢は {`項目名|選択肢`} で選択時 true / 未選択 false の真偽値になります。選択肢ラベルを埋め込むには {{`項目名`}} のように二重ブレース（ビュー形式）を使います。ネストされた子質問は親からのフルパスで指定します（グループの子は {`設置場所|設置開始日`}、選択肢の下にぶら下がる子は選択肢ラベルも挟んで {`選択1|答1|答1補足`} のように指定。元データ形式・ビュー形式とも同じパス）。{`_id`}, {TIME_FORMAT(NOW(), 'YYYY年MM月DD日')} 等が使えます。UPPER(...), LEFT(..., 3), TIME_FORMAT(...) などの関数式が使用できます。"}
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
          非表示でも他の置換フィールドや印刷様式から参照できます。
        </div>
      </div>
    </div>
  );
}
