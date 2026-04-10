import React from "react";
import { buildSafeRegex } from "../../core/validate.js";
import { deepClone, normalizeSchemaIDs, MAX_DEPTH, DEFAULT_MULTILINE_ROWS } from "../../core/schema.js";
import { genId } from "../../core/ids.js";
import { resolveIsDisplayed } from "../../core/displayModes.js";
import { buildPhonePattern, getStandardPhonePlaceholder } from "../../core/phone.js";
import {
  getPrintTemplateOutputLabel,
  normalizePrintTemplateAction,
  PRINT_TEMPLATE_OUTPUT_OPTIONS,
  PRINT_TEMPLATE_OUTPUT_TYPES,
} from "../../utils/printTemplateAction.js";
import { styles as s } from "./styles.js";
import OptionRow from "./OptionRow.jsx";
import {
  WEEKDAY_TYPE,
  MESSAGE_TYPE,
  PRINT_TEMPLATE_TYPE,
  DISPLAY_LABEL,
  EMAIL_PLACEHOLDER,
  EXCLUDE_FROM_SEARCH_AND_PRINT_LABEL,
  isChoiceType,
  isDateOrTimeType,
  isMessageType,
  isPrintTemplateType,
  isBasicInputType,
  applyDisplayedFlag,
  handleTypeChange,
  PlaceholderInput,
  StyleSettingsInput,
  TextDefaultValueInput,
  TextInputRestrictionInput,
  NumberSettingsInput,
} from "./QuestionCardInputs.jsx";

export default function QuestionCard({
  field,
  onChange,
  onAddBelow,
  onDelete,
  onFocus,
  isSelected,
  QuestionListComponent,
  depth = 1,
  onQuestionControlChange,
  getTempState,
  setTempState,
  clearTempState,
}) {
  const isChoice = isChoiceType(field.type);
  const isWeekday = field.type === WEEKDAY_TYPE;
  const isText = field.type === "text";
  const isNumber = field.type === "number";
  const isDateOrTime = isDateOrTimeType(field.type);
  const isBasicInput = isBasicInputType(field.type);
  const isMessage = isMessageType(field.type);
  const isPrintTemplate = isPrintTemplateType(field.type);
  const isEmail = field.type === "email";
  const isPhone = field.type === "phone";
  const canAddChild = depth < MAX_DEPTH;
  const regexCheck = (isText && field.inputRestrictionMode === "pattern")
    ? buildSafeRegex(field.pattern || "")
    : { error: null };
  const phonePlaceholder = isPhone ? getStandardPhonePlaceholder(field) : "";
  const phonePattern = isPhone ? buildPhonePattern(field) : "";
  const prevPhonePlaceholderRef = React.useRef(phonePlaceholder);
  const [selectedOptionIndex, setSelectedOptionIndex] = React.useState(null);
  const latestFieldRef = React.useRef(field);
  const latestOnChangeRef = React.useRef(onChange);
  latestFieldRef.current = field;
  latestOnChangeRef.current = onChange;
  const isDisplayed = resolveIsDisplayed(field);
  const printTemplateAction = normalizePrintTemplateAction(field.printTemplateAction);

  const handleDisplayToggle = (checked) => {
    const nextField = { ...field };
    applyDisplayedFlag(nextField, checked);
    onChange(nextField);
  };

  React.useEffect(() => {
    if ((isText || isBasicInput || isEmail || isPhone) && field.placeholder && !field.showPlaceholder) {
      onChange({ ...field, showPlaceholder: true });
    }
  }, []);

  React.useEffect(() => {
    if (isEmail && field.showPlaceholder && !field.placeholder) {
      onChange({ ...field, placeholder: EMAIL_PLACEHOLDER });
    }
  }, [isEmail, field.showPlaceholder, field.placeholder]);

  React.useEffect(() => {
    if (!isPhone) {
      prevPhonePlaceholderRef.current = "";
      return;
    }

    const previousStandard = prevPhonePlaceholderRef.current;
    const currentPlaceholder = typeof field.placeholder === "string" ? field.placeholder : "";
    if (field.showPlaceholder && currentPlaceholder === previousStandard && currentPlaceholder !== phonePlaceholder) {
      prevPhonePlaceholderRef.current = phonePlaceholder;
      onChange({ ...field, placeholder: phonePlaceholder });
      return;
    }
    prevPhonePlaceholderRef.current = phonePlaceholder;
  }, [isPhone, field.showPlaceholder, field.placeholder, phonePlaceholder]);

  const moveOptionUp = (index) => {
    const currentField = latestFieldRef.current;
    if (!Array.isArray(currentField?.options)) return;
    if (index <= 0 || index >= currentField.options.length) return;
    const next = deepClone(currentField);
    [next.options[index - 1], next.options[index]] = [next.options[index], next.options[index - 1]];
    latestOnChangeRef.current(next);
    setSelectedOptionIndex(index - 1);
  };

  const moveOptionDown = (index) => {
    const currentField = latestFieldRef.current;
    if (!Array.isArray(currentField?.options)) return;
    if (index < 0 || index >= currentField.options.length - 1) return;
    const next = deepClone(currentField);
    [next.options[index], next.options[index + 1]] = [next.options[index + 1], next.options[index]];
    latestOnChangeRef.current(next);
    setSelectedOptionIndex(index + 1);
  };

  const buildOptionControlInfo = React.useCallback((index) => {
    const currentField = latestFieldRef.current;
    const options = Array.isArray(currentField?.options) ? currentField.options : [];
    if (index === null || index < 0 || index >= options.length) return null;
    return {
      type: "option",
      optionIndex: index,
      optionLabel: options[index]?.label || `選択肢 ${index + 1}`,
      canMoveUp: index > 0,
      canMoveDown: index < options.length - 1,
      moveUp: () => moveOptionUp(index),
      moveDown: () => moveOptionDown(index),
    };
  }, []);

  React.useEffect(() => {
    if (isChoice && selectedOptionIndex !== null) {
      const controlInfo = buildOptionControlInfo(selectedOptionIndex);
      if (controlInfo) onFocus(controlInfo);
    }
  }, [selectedOptionIndex, isChoice, field.options?.length, buildOptionControlInfo]);

  const updateChoiceDefaultSelection = (optionIndex, checked) => {
    const next = deepClone(field);
    next.options = (next.options || []).map((opt, index) => {
      if (field.type === "checkboxes") {
        return { ...opt, defaultSelected: index === optionIndex ? checked : !!opt.defaultSelected };
      }
      return { ...opt, defaultSelected: checked && index === optionIndex };
    });
    onChange(next);
  };

  const renderStyleSettingsInput = () => (
    <StyleSettingsInput
      field={field}
      onChange={onChange}
      onFocus={onFocus}
      getTempState={getTempState}
      setTempState={setTempState}
    />
  );

  const cardAttrs = s.card(0, isSelected);

  return (
    <div className={cardAttrs.className} data-depth={cardAttrs["data-depth"]} data-selected={cardAttrs["data-selected"]} data-question-id={field.id}>
      <div className="nf-row nf-gap-8 nf-mb-8 nf-wrap">
        <span className="nf-text-13 nf-fw-500 nf-text-ink nf-shrink-0">項目名</span>
        <input
          className={`${s.input.className} nf-w-auto nf-flex-1-1-200 nf-min-w-0`}
          placeholder="項目名を入力"
          value={field.label || ""}
          required
          onChange={(event) => onChange({ ...field, label: event.target.value })}
          onFocus={() => {
            setSelectedOptionIndex(null);
            onFocus();
          }}
        />
        <select
          value={field.type}
          className={`${s.input.className} nf-w-auto nf-min-w-150 nf-flex-0-1-auto`}
          onChange={(event) => {
            const next = handleTypeChange(field, event.target.value, { getTempState, setTempState });
            onChange(next);
          }}
          onFocus={onFocus}
        >
          <option value="text">テキスト</option>
          <option value="phone">電話番号</option>
          <option value="email">メールアドレス</option>
          <option value="url">URL</option>
          <option value="number">数値</option>
          <option value="date">日付</option>
          <option value="time">時間</option>
          <option value="weekday">曜日</option>
          <option value="checkboxes">チェックボックス</option>
          <option value="radio">ラジオボタン</option>
          <option value="select">ドロップダウン</option>
          <option value="fileUpload">ファイルアップロード</option>
          <option value="printTemplate">様式出力</option>
          <option value="message">メッセージ</option>
        </select>
        {!isMessage && !isPrintTemplate && (
          <label className="nf-row nf-gap-4 nf-nowrap">
            <input
              type="checkbox"
              checked={!!field.required}
              onChange={(event) => onChange({ ...field, required: event.target.checked })}
            />
            必須
          </label>
        )}
        <label className="nf-row nf-gap-6">
          <input
            type="checkbox"
            checked={isDisplayed}
            onChange={(event) => handleDisplayToggle(event.target.checked)}
          />
          {DISPLAY_LABEL}
        </label>
      </div>

      {isPrintTemplate && (
        <div className="nf-mt-8">
          <div className="nf-col nf-gap-8">
            <div className="nf-text-12 nf-text-subtle">未入力時の表示名は {getPrintTemplateOutputLabel(printTemplateAction)} です。</div>
            <select
              className={s.input.className}
              value={printTemplateAction.outputType}
              onChange={(event) => onChange({
                ...field,
                printTemplateAction: {
                  ...printTemplateAction,
                  outputType: event.target.value,
                  enabled: true,
                },
              })}
            >
              {PRINT_TEMPLATE_OUTPUT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            {printTemplateAction.outputType !== PRINT_TEMPLATE_OUTPUT_TYPES.GMAIL && (
              <label className="nf-row nf-gap-6">
                <input
                  type="checkbox"
                  checked={!!printTemplateAction.useCustomTemplate}
                  onChange={(event) => onChange({
                    ...field,
                    printTemplateAction: {
                      ...printTemplateAction,
                      useCustomTemplate: event.target.checked,
                      enabled: true,
                    },
                  })}
                />
                カスタムテンプレートを使う
              </label>
            )}
            {printTemplateAction.outputType !== PRINT_TEMPLATE_OUTPUT_TYPES.GMAIL && printTemplateAction.useCustomTemplate && (
              <input
                className={s.input.className}
                placeholder="テンプレートURL（Google Document URL）"
                value={printTemplateAction.templateUrl || ""}
                onChange={(event) => onChange({
                  ...field,
                  printTemplateAction: { ...printTemplateAction, templateUrl: event.target.value, enabled: true },
                })}
              />
            )}
            {printTemplateAction.outputType !== PRINT_TEMPLATE_OUTPUT_TYPES.GMAIL && (
              <>
                <input
                  className={s.input.className}
                  placeholder="出力ファイル名（例: {ID}_{_NOW|date:YYYY-MM-DD}）"
                  value={printTemplateAction.fileNameTemplate || ""}
                  onChange={(event) => onChange({
                    ...field,
                    printTemplateAction: { ...printTemplateAction, fileNameTemplate: event.target.value, enabled: true },
                  })}
                />
                <div className="nf-text-11 nf-text-muted">未指定時はフォーム設定の標準様式出力ファイル名規則を使用します。</div>
              </>
            )}
            {printTemplateAction.outputType === PRINT_TEMPLATE_OUTPUT_TYPES.GMAIL && (
              <>
                <label className="nf-row nf-gap-8 nf-items-center">
                  <input
                    type="checkbox"
                    checked={printTemplateAction.gmailAttachPdf || false}
                    onChange={(event) => onChange({
                      ...field,
                      printTemplateAction: { ...printTemplateAction, gmailAttachPdf: event.target.checked, enabled: true },
                    })}
                  />
                  <span className="nf-text-11">PDF を添付</span>
                </label>
                {printTemplateAction.gmailAttachPdf && (
                  <div className="nf-text-11 nf-text-muted">PDF 添付時の出力名は、フォーム設定の標準様式出力ファイル名規則か既定値を使用します。</div>
                )}
              </>
            )}
            {printTemplateAction.outputType === PRINT_TEMPLATE_OUTPUT_TYPES.GMAIL && (
              <>
                <label className="nf-col nf-gap-4">
                  <span className="nf-text-11 nf-text-muted">To</span>
                  <input
                    className={s.input.className}
                    placeholder="例: {メールアドレス}"
                    value={printTemplateAction.gmailTemplateTo || ""}
                    onChange={(event) => onChange({
                      ...field,
                      printTemplateAction: { ...printTemplateAction, gmailTemplateTo: event.target.value, enabled: true },
                    })}
                  />
                </label>
                <label className="nf-col nf-gap-4">
                  <span className="nf-text-11 nf-text-muted">Cc</span>
                  <input
                    className={s.input.className}
                    placeholder="例: {メールアドレス}"
                    value={printTemplateAction.gmailTemplateCc || ""}
                    onChange={(event) => onChange({
                      ...field,
                      printTemplateAction: { ...printTemplateAction, gmailTemplateCc: event.target.value, enabled: true },
                    })}
                  />
                </label>
                <label className="nf-col nf-gap-4">
                  <span className="nf-text-11 nf-text-muted">Bcc</span>
                  <input
                    className={s.input.className}
                    placeholder="例: {メールアドレス}"
                    value={printTemplateAction.gmailTemplateBcc || ""}
                    onChange={(event) => onChange({
                      ...field,
                      printTemplateAction: { ...printTemplateAction, gmailTemplateBcc: event.target.value, enabled: true },
                    })}
                  />
                </label>
                <label className="nf-col nf-gap-4">
                  <span className="nf-text-11 nf-text-muted">件名</span>
                  <input
                    className={s.input.className}
                    placeholder="例: 【申請】{ID}_{_NOW|date:YYYY-MM-DD}"
                    value={printTemplateAction.gmailTemplateSubject || ""}
                    onChange={(event) => onChange({
                      ...field,
                      printTemplateAction: { ...printTemplateAction, gmailTemplateSubject: event.target.value, enabled: true },
                    })}
                  />
                </label>
                <label className="nf-col nf-gap-4">
                  <span className="nf-text-11 nf-text-muted">本文</span>
                  <textarea
                    className={`${s.input.className} nf-h-96`}
                    placeholder="本文テンプレートを入力"
                    value={printTemplateAction.gmailTemplateBody || ""}
                    onChange={(event) => onChange({
                      ...field,
                      printTemplateAction: { ...printTemplateAction, gmailTemplateBody: event.target.value, enabled: true },
                    })}
                  />
                </label>
              </>
            )}
            <div className="nf-text-11 nf-text-muted">{"出力ファイル名では {ID} / {_NOW} / {フィールド名} を使えます。{_NOW|date:YYYY-MM-DD} や {_NOW|time:HH:mm} のようにパイプで書式を指定できます。予約語と同名の項目は {\\フィールド名} で参照します。Gmail 本文では {_folder_url} / {_record_url} / {_form_url} も使えます。"}</div>
          </div>
        </div>
      )}

      {!isText && renderStyleSettingsInput()}

      {isMessage && (
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
      )}


      {isText && (
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
          {renderStyleSettingsInput()}
          <PlaceholderInput field={field} onChange={onChange} onFocus={onFocus} />
          <TextDefaultValueInput field={field} onChange={onChange} onFocus={onFocus} />
          <TextInputRestrictionInput
            field={field}
            onChange={onChange}
            onFocus={onFocus}
            regexError={regexCheck.error}
            getTempState={getTempState}
            setTempState={setTempState}
          />
        </>
      )}

      {isBasicInput && <PlaceholderInput field={field} onChange={onChange} onFocus={onFocus} />}

      {isNumber && (
        <NumberSettingsInput field={field} onChange={onChange} onFocus={onFocus} />
      )}

      {isEmail && (
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
      )}

      {isPhone && (
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
      )}

      {field.type === "fileUpload" && (
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
              placeholder="{ID}_{_NOW|date:YYYY-MM-DD}_{担当者名}"
              onChange={(event) => onChange({ ...field, driveFolderNameTemplate: event.target.value })}
            />
            <div className="nf-text-11 nf-text-muted nf-mt-4">
              {"空白の場合は子フォルダを作らず、ルートフォルダ直下に保存します。{ID}, {_NOW}, {フィールド名} を使えます。{_NOW|date:YYYY-MM-DD} のようにパイプで書式を指定できます。予約語と同名の項目は {\\フィールド名} で参照できます"}
            </div>
          </div>
        </div>
      )}

      {isDateOrTime && (
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
      )}

      {isWeekday && (
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
      )}

      {isChoice && (
        <div className="nf-mt-8">
          <div className="nf-row-between nf-mb-6">
            <strong>選択肢</strong>
            <button
              type="button"
              className={s.btn.className}
              onClick={() => {
                const next = deepClone(field);
                next.options = next.options || [];
                next.options.push({ id: genId(), label: "", defaultSelected: false });
                onChange(next);
              }}
            >
              選択肢を追加
            </button>
          </div>

          {(field.options || []).map((opt, index) => (
            <OptionRow
              key={opt.id}
              option={opt}
              onChange={(nextOpt) => {
                const next = deepClone(field);
                const prevLabel = opt.label || "";
                const nextLabel = nextOpt.label || "";
                next.options[index] = {
                  id: nextOpt.id || genId(),
                  label: nextLabel,
                  defaultSelected: !!nextOpt.defaultSelected,
                };

                if (prevLabel !== nextLabel && next.childrenByValue?.[prevLabel]) {
                  next.childrenByValue = { ...next.childrenByValue };
                  const movedChildren = next.childrenByValue[prevLabel];
                  const existing = next.childrenByValue[nextLabel];
                  next.childrenByValue[nextLabel] = existing
                    ? normalizeSchemaIDs([...movedChildren, ...existing])
                    : movedChildren;
                  delete next.childrenByValue[prevLabel];
                }
                onChange(next);
              }}
              onDelete={() => {
                const next = deepClone(field);
                next.options.splice(index, 1);
                onChange(next);
                if (selectedOptionIndex === index) {
                  setSelectedOptionIndex(null);
                } else if (selectedOptionIndex > index) {
                  setSelectedOptionIndex(selectedOptionIndex - 1);
                }
              }}
              onFocus={() => {
                setSelectedOptionIndex(index);
                const controlInfo = buildOptionControlInfo(index);
                if (controlInfo) onFocus(controlInfo);
              }}
              isSelected={selectedOptionIndex === index}
              onAddChild={() => {
                if (!canAddChild) return;
                const next = deepClone(field);
                next.childrenByValue = next.childrenByValue || {};
                const key = opt.label;
                next.childrenByValue[key] = normalizeSchemaIDs(next.childrenByValue[key] || []);
                next.childrenByValue[key].push({ id: genId(), type: "text", label: "" });
                onChange(next);
              }}
              canAddChild={canAddChild}
              defaultSelectionControl={
                <label className="nf-row nf-gap-4 nf-nowrap">
                  <input
                    type="checkbox"
                    checked={!!opt.defaultSelected}
                    onChange={(event) => updateChoiceDefaultSelection(index, event.target.checked)}
                    onFocus={() => {
                      setSelectedOptionIndex(index);
                      const controlInfo = buildOptionControlInfo(index);
                      if (controlInfo) onFocus(controlInfo);
                    }}
                  />
                  初期選択
                </label>
              }
              childrenArea={
                (() => {
                  const hasChildren = field.childrenByValue && field.childrenByValue[opt.label]?.length;
                  return hasChildren ? (
                    <div className={s.child.className}>
                      <QuestionListComponent
                        fields={field.childrenByValue[opt.label]}
                        onChange={(childFields) => {
                          const next = deepClone(field);
                          next.childrenByValue[opt.label] = normalizeSchemaIDs(childFields);
                          onChange(next);
                        }}
                        depth={depth + 1}
                        onQuestionControlChange={onQuestionControlChange}
                        getTempState={getTempState}
                        setTempState={setTempState}
                        clearTempState={clearTempState}
                      />
                    </div>
                  ) : null;
                })()
              }
            />
          ))}
        </div>
      )}

      <div className="nf-row nf-gap-8 nf-mt-12">
        <button type="button" className={s.btnDanger.className} onClick={onDelete}>削除</button>
        <div className="nf-flex-1" />
        <button type="button" className={s.btn.className} onClick={onAddBelow}>次の質問を追加</button>
      </div>
    </div>
  );
}
