import React from "react";
import { buildSafeRegex } from "../../core/validate.js";
import { deepClone, normalizeSchemaIDs, MAX_DEPTH } from "../../core/schema.js";
import { genId } from "../../core/ids.js";
import { resolveIsDisplayed } from "../../core/displayModes.js";
import { DEFAULT_STYLE_SETTINGS, normalizeStyleSettings } from "../../core/styleSettings.js";
import { styles as s } from "./styles.js";
import OptionRow from "./OptionRow.jsx";
// 定数
const CHOICE_TYPES = ["radio", "select", "checkboxes"];
const INPUT_TYPES = ["text", "textarea", "number", "url"];
const DATE_TIME_TYPES = ["date", "time"];
const MESSAGE_TYPE = "message";
const USER_NAME_TYPE = "userName";
const DISPLAY_LABEL = "表示";

// ヘルパー関数
const isChoiceType = (type) => CHOICE_TYPES.includes(type);
const isInputType = (type) => INPUT_TYPES.includes(type);
const isDateOrTimeType = (type) => DATE_TIME_TYPES.includes(type);
const isMessageType = (type) => type === MESSAGE_TYPE;
const isUserNameType = (type) => type === USER_NAME_TYPE;
const applyDisplayedFlag = (target, displayed) => {
  target.isDisplayed = displayed === true;
  delete target.displayMode;
  delete target.important;
  delete target.compact;
};

/**
 * 選択肢系から非選択肢系への変更時に、選択肢状態を退避してoptionsを削除する
 */
function saveAndClearChoiceState(next, field, oldIsChoice) {
  if (oldIsChoice) {
    next._savedChoiceState = {
      options: deepClone(field.options),
      childrenByValue: field.childrenByValue ? deepClone(field.childrenByValue) : undefined
    };
    delete next.options;
    delete next.childrenByValue;
  } else {
    delete next.options;
  }
}

/**
 * タイプ変更時の状態を管理する関数
 * 選択肢系⇔入力系の変換時にchildrenByValueの状態を保存・復元する
 */
function handleTypeChange(field, newType) {
  const next = deepClone(field);
  const oldType = field.type;
  next.type = newType;
  const wasDisplayed = resolveIsDisplayed(next);

  const oldIsChoice = isChoiceType(oldType);
  const newIsChoice = isChoiceType(newType);

  if (newIsChoice) {
    // 選択肢系への変更
    delete next.pattern;
    delete next.defaultNow;

    if (oldIsChoice) {
      // 選択肢系 → 選択肢系: childrenByValueをそのまま引き継ぎ
      next.options = next.options?.length ? next.options : [{ id: genId(), label: "" }];
    } else {
      // 入力系 → 選択肢系: 仮保存から復元
      if (field._savedChoiceState) {
        next.options = deepClone(field._savedChoiceState.options);
        next.childrenByValue = deepClone(field._savedChoiceState.childrenByValue);
        delete next._savedChoiceState;
      } else {
        next.options = next.options?.length ? next.options : [{ id: genId(), label: "" }];
      }
    }
  } else if (newType === "regex") {
    // 正規表現への変更
    next.pattern = typeof next.pattern === "string" ? next.pattern : "";
    delete next.defaultNow;
    saveAndClearChoiceState(next, field, oldIsChoice);
  } else if (isDateOrTimeType(newType)) {
    // 日付・時刻への変更
    delete next.pattern;
    next.defaultNow = !!next.defaultNow;
    saveAndClearChoiceState(next, field, oldIsChoice);
  } else if (newType === USER_NAME_TYPE) {
    // 入力ユーザー名への変更
    delete next.pattern;
    delete next.placeholder;
    delete next.showPlaceholder;
    next.defaultNow = !!next.defaultNow;
    saveAndClearChoiceState(next, field, oldIsChoice);
  } else if (newType === MESSAGE_TYPE) {
    // メッセージへの変更
    delete next.pattern;
    delete next.defaultNow;
    delete next.required;
    saveAndClearChoiceState(next, field, oldIsChoice);
  } else {
    // テキスト、テキストエリア、数値への変更
    delete next.pattern;
    delete next.defaultNow;
    saveAndClearChoiceState(next, field, oldIsChoice);
  }

  applyDisplayedFlag(next, wasDisplayed);

  return next;
}

/**
 * プレースホルダー入力UI
 */
function PlaceholderInput({ field, onChange, onFocus }) {
  return (
    <div className="nf-mt-8">
      <label className={`nf-row nf-gap-6${field.showPlaceholder ? " nf-mb-4" : ""}`}>
        <input
          type="checkbox"
          checked={!!field.showPlaceholder}
          onChange={(event) => {
            onChange({ ...field, showPlaceholder: event.target.checked });
          }}
        />
        プレースホルダー
      </label>
      {field.showPlaceholder && (
        <div className="nf-row nf-gap-8">
          <input
            className={s.input.className}
            placeholder="例: 入力例を表示"
            value={field.placeholder || ""}
            onChange={(event) => onChange({ ...field, placeholder: event.target.value })}
            onFocus={onFocus}
          />
        </div>
      )}
    </div>
  );
}

/**
 * スタイル設定入力UI
 */
function StyleSettingsInput({ field, onChange, onFocus }) {
  const styleSettings = normalizeStyleSettings(field.styleSettings || {});
  const isStyleSettingsEnabled = typeof field.showStyleSettings === "boolean"
    ? field.showStyleSettings
    : !!field.styleSettings;
  return (
    <div className="nf-mt-8">
      <label className={`nf-row nf-gap-6${isStyleSettingsEnabled ? " nf-mb-4" : ""}`}>
        <input
          type="checkbox"
          checked={isStyleSettingsEnabled}
          onChange={(event) => {
            const checked = event.target.checked;
            if (checked) {
              const restored = (field.styleSettings && typeof field.styleSettings === "object")
                ? field.styleSettings
                : (field._savedStyleSettings && typeof field._savedStyleSettings === "object" ? field._savedStyleSettings : {});
              const nextStyleSettings = { ...DEFAULT_STYLE_SETTINGS, ...normalizeStyleSettings(restored) };
              console.log("[StyleSettingsInput] toggle ON", {
                id: field.id,
                label: field.label,
                restoredFrom: field.styleSettings ? "styleSettings" : (field._savedStyleSettings ? "_savedStyleSettings" : "default"),
                nextStyleSettings
              });
              const nextField = { ...field, showStyleSettings: true, styleSettings: nextStyleSettings };
              delete nextField._savedStyleSettings;
              onChange(nextField);
              return;
            }
            console.log("[StyleSettingsInput] toggle OFF (keep in-memory until save)", {
              id: field.id,
              label: field.label,
              styleSettings: field.styleSettings,
            });
            const nextField = { ...field, showStyleSettings: false };
            if (field.styleSettings && typeof field.styleSettings === "object") {
              nextField._savedStyleSettings = field.styleSettings;
            }
            onChange(nextField);
          }}
        />
        スタイル設定
      </label>
      {isStyleSettingsEnabled && (
        <div className="nf-row nf-gap-8 nf-mt-4">
          <div className="nf-flex-1">
            <label className="nf-text-12 nf-mb-2 nf-text-subtle">文字サイズ</label>
            <select
              className={s.input.className}
              value={styleSettings.labelSize || "default"}
              onChange={(event) => onChange({
                ...field,
                styleSettings: { ...styleSettings, labelSize: event.target.value }
              })}
              onFocus={onFocus}
            >
              <option value="smallest">最も小さく</option>
              <option value="smaller">小さく</option>
              <option value="default">標準</option>
              <option value="larger">大きく</option>
              <option value="largest">最も大きく</option>
            </select>
          </div>
          <div className="nf-flex-1">
            <label className="nf-text-12 nf-mb-2 nf-text-subtle">文字色</label>
            <select
              className={s.input.className}
              value={styleSettings.textColor || "#000000"}
              onChange={(event) => onChange({
                ...field,
                styleSettings: { ...styleSettings, textColor: event.target.value }
              })}
              onFocus={onFocus}
            >
              <option value="#000000">黒（デフォルト）</option>
              <option value="#DC2626">赤</option>
              <option value="#2563EB">青</option>
              <option value="#16A34A">緑</option>
              <option value="#6B7280">グレー</option>
            </select>
          </div>
        </div>
      )}
    </div>
  );
}

export default function QuestionCard({ field, onChange, onAddBelow, onDelete, onFocus, isSelected, QuestionListComponent, depth = 1 }) {
  const isChoice = isChoiceType(field.type);
  const isRegex = field.type === "regex";
  const isDateOrTime = isDateOrTimeType(field.type);
  const isInput = isInputType(field.type);
  const isMessage = isMessageType(field.type);
  const isUserName = isUserNameType(field.type);
  const canAddChild = depth < MAX_DEPTH;
  const regexCheck = isRegex ? buildSafeRegex(field.pattern || "") : { error: null };
  const [selectedOptionIndex, setSelectedOptionIndex] = React.useState(null);
  const latestFieldRef = React.useRef(field);
  const latestOnChangeRef = React.useRef(onChange);
  latestFieldRef.current = field;
  latestOnChangeRef.current = onChange;
  const isDisplayed = resolveIsDisplayed(field);
  const handleDisplayToggle = (checked) => {
    const nextField = { ...field };
    applyDisplayedFlag(nextField, checked);
    onChange(nextField);
  };

  // 既存のplaceholderがある場合はshowPlaceholderをtrueにする
  React.useEffect(() => {
    if ((isInput || isRegex) && field.placeholder && !field.showPlaceholder) {
      onChange({ ...field, showPlaceholder: true });
    }
  }, []);

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

  // 選択肢の選択状態を親に伝達（質問の上下移動とは別の制御）
  React.useEffect(() => {
    if (isChoice && selectedOptionIndex !== null) {
      // 選択肢が選択されている場合は、その情報を含めて親に通知
      const canMoveUp = selectedOptionIndex > 0;
      const canMoveDown = selectedOptionIndex < (field.options?.length || 0) - 1;
      const optionLabel = field.options?.[selectedOptionIndex]?.label || `選択肢 ${selectedOptionIndex + 1}`;
      // onFocusに選択肢情報を含めることで、QuestionListが適切に処理できるようにする
      onFocus({
        type: "option",
        optionIndex: selectedOptionIndex,
        optionLabel,
        canMoveUp,
        canMoveDown,
        moveUp: () => moveOptionUp(selectedOptionIndex),
        moveDown: () => moveOptionDown(selectedOptionIndex)
      });
    }
  }, [selectedOptionIndex, isChoice, field.options?.length]);

  const cardAttrs = s.card(0, isSelected);

  return (
    <div className={cardAttrs.className} data-depth={cardAttrs["data-depth"]} data-selected={cardAttrs["data-selected"]}>
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
            const next = handleTypeChange(field, event.target.value);
            onChange(next);
          }}
          onFocus={onFocus}
        >
          <option value="text">テキスト</option>
          <option value="textarea">テキスト（複数行）</option>
          <option value="number">数値</option>
          <option value="regex">正規表現</option>
          <option value="checkboxes">チェックボックス</option>
          <option value="radio">ラジオ</option>
          <option value="select">ドロップダウン</option>
          <option value="date">日付</option>
          <option value="time">時間</option>
          <option value="userName">入力ユーザー名</option>
          <option value="url">URL</option>
          <option value="message">メッセージ</option>
        </select>
        {!isMessage && (
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

      {/* スタイル設定（全タイプで利用可能） */}
      <StyleSettingsInput field={field} onChange={onChange} onFocus={onFocus} />

      {isInput && <PlaceholderInput field={field} onChange={onChange} onFocus={onFocus} />}

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
        </div>
      )}

      {isUserName && (
        <div className="nf-mt-8">
          <label className="nf-row nf-gap-6">
            <input
              type="checkbox"
              checked={!!field.defaultNow}
              onChange={(event) => onChange({ ...field, defaultNow: event.target.checked })}
            />
            作成時に自動入力
          </label>
        </div>
      )}

      {isRegex && (
        <div className="nf-mt-8">
          <label className="nf-fw-600 nf-mb-4">正規表現（任意）</label>
          <input
            className={s.input.className}
            placeholder="例: ^[0-9]+$"
            value={field.pattern || ""}
            onChange={(event) => onChange({ ...field, pattern: event.target.value })}
            onFocus={onFocus}
          />
          {regexCheck.error && (
            <div className="nf-text-danger-ink nf-text-12 nf-mt-4">正規表現が不正です: {regexCheck.error}</div>
          )}
          <PlaceholderInput field={field} onChange={onChange} onFocus={onFocus} />
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
                next.options.push({ id: genId(), label: "" });
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
                next.options[index] = { id: nextOpt.id || genId(), label: nextLabel };

                // ラベル変更時も子質問を維持する
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
                // 選択肢がフォーカスされた時は、質問カード全体は選択しない
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
