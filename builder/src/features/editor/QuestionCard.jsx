import React from "react";
import { buildSafeRegex } from "../../core/validate.js";
import { deepClone, normalizeSchemaIDs, MAX_DEPTH } from "../../core/schema.js";
import { genId } from "../../core/ids.js";
import { DISPLAY_MODES, ensureDisplayModeForType, toImportantFlag } from "../../core/displayModes.js";
import { styles as s } from "./styles.js";
import OptionRow from "./OptionRow.jsx";

// 定数
const CHOICE_TYPES = ["radio", "select", "checkboxes"];
const INPUT_TYPES = ["text", "textarea", "number"];
const DATE_TIME_TYPES = ["date", "time"];
const resolveDisplayModeForType = (type, displayed) => (displayed ? ensureDisplayModeForType(DISPLAY_MODES.NORMAL, type) : DISPLAY_MODES.NONE);
const DISPLAY_LABEL = "表示";

// ヘルパー関数
const isChoiceType = (type) => CHOICE_TYPES.includes(type);
const isInputType = (type) => INPUT_TYPES.includes(type);
const isDateOrTimeType = (type) => DATE_TIME_TYPES.includes(type);
const getDisplayMode = (field) => {
  const rawMode = typeof field?.displayMode === "string"
    ? field.displayMode
    : (field?.important ? DISPLAY_MODES.NORMAL : DISPLAY_MODES.NONE);
  return ensureDisplayModeForType(rawMode, field?.type);
};
const applyDisplayMode = (target, mode) => {
  const nextMode = ensureDisplayModeForType(mode, target.type);
  target.displayMode = nextMode;
  target.important = toImportantFlag(nextMode);
};

/**
 * タイプ変更時の状態を管理する関数
 * 選択肢系⇔入力系の変換時にchildrenByValueの状態を保存・復元する
 */
function handleTypeChange(field, newType) {
  const next = deepClone(field);
  const oldType = field.type;
  next.type = newType;
  const wasDisplayed = getDisplayMode(next) !== DISPLAY_MODES.NONE;

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
  } else if (isDateOrTimeType(newType)) {
    // 日付・時刻への変更
    delete next.pattern;
    next.defaultNow = !!next.defaultNow;

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
  } else {
    // テキスト、テキストエリア、数値への変更
    delete next.pattern;
    delete next.defaultNow;

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

  applyDisplayMode(next, resolveDisplayModeForType(newType, wasDisplayed));

  return next;
}

/**
 * プレースホルダー入力UI
 */
function PlaceholderInput({ field, onChange, onFocus }) {
  return (
    <div style={{ marginTop: 8 }}>
      <label style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: field.showPlaceholder ? 4 : 0 }}>
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
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            style={{ ...s.input, flex: 1 }}
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

export default function QuestionCard({ field, onChange, onAddBelow, onDelete, onFocus, isSelected, QuestionListComponent, depth = 1 }) {
  const isChoice = isChoiceType(field.type);
  const isRegex = field.type === "regex";
  const isDateOrTime = isDateOrTimeType(field.type);
  const isInput = isInputType(field.type);
  const canAddChild = depth < MAX_DEPTH;
  const regexCheck = isRegex ? buildSafeRegex(field.pattern || "") : { error: null };
  const [selectedOptionIndex, setSelectedOptionIndex] = React.useState(null);
  const displayMode = getDisplayMode(field);
  const isDisplayed = displayMode !== DISPLAY_MODES.NONE;
  const handleDisplayToggle = (checked) => {
    const nextField = { ...field };
    applyDisplayMode(nextField, resolveDisplayModeForType(nextField.type, checked));
    onChange(nextField);
  };

  // 既存のplaceholderがある場合はshowPlaceholderをtrueにする
  React.useEffect(() => {
    if ((isInput || isRegex) && field.placeholder && !field.showPlaceholder) {
      onChange({ ...field, showPlaceholder: true });
    }
  }, []);

  const moveOptionUp = (index) => {
    if (index === 0) return;
    const next = deepClone(field);
    [next.options[index - 1], next.options[index]] = [next.options[index], next.options[index - 1]];
    onChange(next);
    setSelectedOptionIndex(index - 1);
  };

  const moveOptionDown = (index) => {
    if (index === field.options.length - 1) return;
    const next = deepClone(field);
    [next.options[index], next.options[index + 1]] = [next.options[index + 1], next.options[index]];
    onChange(next);
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
        type: 'option',
        optionIndex: selectedOptionIndex,
        optionLabel,
        canMoveUp,
        canMoveDown,
        moveUp: () => moveOptionUp(selectedOptionIndex),
        moveDown: () => moveOptionDown(selectedOptionIndex)
      });
    }
  }, [selectedOptionIndex, isChoice, field.options?.length]);

  return (
    <div style={{ ...s.card(0), border: isSelected ? "2px solid #3B82F6" : s.card(0).border }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: "#374151", flexShrink: 0 }}>項目名</span>
        <input
          style={{ ...s.input, width: "auto", flex: "1 1 200px", minWidth: 0 }}
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
          style={{ ...s.input, width: "auto", minWidth: 150, flex: "0 1 auto" }}
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
        </select>
        <label style={{ display: "flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>
          <input
            type="checkbox"
            checked={!!field.required}
            onChange={(event) => onChange({ ...field, required: event.target.checked })}
          />
          必須
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input
            type="checkbox"
            checked={isDisplayed}
            onChange={(event) => handleDisplayToggle(event.target.checked)}
          />
          {DISPLAY_LABEL}
        </label>
      </div>

      {isInput && <PlaceholderInput field={field} onChange={onChange} onFocus={onFocus} />}

      {isDateOrTime && (
        <div style={{ marginTop: 8 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input
              type="checkbox"
              checked={!!field.defaultNow}
              onChange={(event) => onChange({ ...field, defaultNow: event.target.checked })}
            />
            初期値を現在{field.type === "date" ? "の日付" : "の時刻"}にする
          </label>
        </div>
      )}

      {isRegex && (
        <div style={{ marginTop: 8 }}>
          <label style={{ display: "block", fontWeight: 600, marginBottom: 4 }}>正規表現（任意）</label>
          <input
            style={s.input}
            placeholder="例: ^[0-9]+$"
            value={field.pattern || ""}
            onChange={(event) => onChange({ ...field, pattern: event.target.value })}
            onFocus={onFocus}
          />
          {regexCheck.error && (
            <div style={{ color: "#B91C1C", fontSize: 12, marginTop: 4 }}>正規表現が不正です: {regexCheck.error}</div>
          )}
          <PlaceholderInput field={field} onChange={onChange} onFocus={onFocus} />
        </div>
      )}

      {isChoice && (
        <div style={{ marginTop: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <strong>選択肢</strong>
            <button
              type="button"
              style={s.btn}
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
                next.options[index] = { id: nextOpt.id || genId(), label: nextOpt.label || "" };
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
                    <div style={{ marginTop: 8, paddingLeft: 12, borderLeft: "2px solid #E5E7EB" }}>
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

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button type="button" style={s.btnDanger} onClick={onDelete}>削除</button>
        <div style={{ flex: 1 }} />
        <button type="button" style={s.btn} onClick={onAddBelow}>次の質問を追加</button>
      </div>
    </div>
  );
}
