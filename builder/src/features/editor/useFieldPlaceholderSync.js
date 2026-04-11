import React from "react";
import { getStandardPhonePlaceholder } from "../../core/phone.js";
import { EMAIL_PLACEHOLDER } from "./fieldTypes.js";

/**
 * placeholder / email / phone の自動同期を一箇所にまとめたカスタムフック。
 *
 * QuestionCard に散在していた 3 つの useEffect を統合し、
 * - showPlaceholder フラグとの整合
 * - email のデフォルト placeholder 付与
 * - phone の placeholder 自動追従
 * を担う。
 */
export function useFieldPlaceholderSync({ field, onChange, isText, isBasicInput, isEmail, isPhone }) {
  const phonePlaceholder = isPhone ? getStandardPhonePlaceholder(field) : "";
  const prevPhonePlaceholderRef = React.useRef(phonePlaceholder);

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

  return { phonePlaceholder };
}
