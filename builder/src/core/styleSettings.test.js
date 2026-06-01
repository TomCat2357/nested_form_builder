import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_STYLE_SETTINGS,
  normalizeStyleSettings,
  resolveTextColor,
  resolveBgColor,
  resolveStyleSettingsInlineStyle,
  STYLE_SETTINGS_DEFAULT_COLOR,
} from "./styleSettings.js";

test("normalizeStyleSettings は未設定時に設定のデフォルト色を使う", () => {
  assert.deepEqual(normalizeStyleSettings({}), DEFAULT_STYLE_SETTINGS);
});

test("normalizeStyleSettings は許可された文字色を保持する", () => {
  assert.equal(
    normalizeStyleSettings({ textColor: "#FFFFFF" }).textColor,
    "#FFFFFF",
  );
  assert.equal(
    normalizeStyleSettings({ textColor: "#000000" }).textColor,
    "#000000",
  );
});

test("resolveTextColor は設定のデフォルト時に undefined を返す", () => {
  assert.equal(
    resolveTextColor({ textColor: STYLE_SETTINGS_DEFAULT_COLOR }),
    undefined,
  );
  assert.equal(
    resolveTextColor({ textColor: "#000000" }),
    "#000000",
  );
});

test("normalizeStyleSettings は任意の HEX 色を保持し不正値はデフォルトに丸める", () => {
  const normalized = normalizeStyleSettings({ textColor: "#abcdef", bgColor: "#123" });
  assert.equal(normalized.textColor, "#abcdef");
  assert.equal(normalized.bgColor, "#123");
  const invalid = normalizeStyleSettings({ textColor: "red", bgColor: "rgb(0,0,0)" });
  assert.equal(invalid.textColor, STYLE_SETTINGS_DEFAULT_COLOR);
  assert.equal(invalid.bgColor, STYLE_SETTINGS_DEFAULT_COLOR);
});

test("resolveBgColor は設定のデフォルト時に undefined、HEX 指定時はその値を返す", () => {
  assert.equal(resolveBgColor({ bgColor: STYLE_SETTINGS_DEFAULT_COLOR }), undefined);
  assert.equal(resolveBgColor({ bgColor: "#2563EB" }), "#2563EB");
});

test("resolveStyleSettingsInlineStyle は背景色指定時に backgroundColor と borderColor を返す", () => {
  const style = resolveStyleSettingsInlineStyle({ bgColor: "#2563EB" });
  assert.equal(style.backgroundColor, "#2563EB");
  assert.equal(style.borderColor, "#2563EB");
  assert.deepEqual(resolveStyleSettingsInlineStyle({}), {});
});
