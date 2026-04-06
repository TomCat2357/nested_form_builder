import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_STYLE_SETTINGS,
  normalizeStyleSettings,
  resolveTextColor,
  STYLE_TEXT_COLORS,
} from "./styleSettings.js";

test("normalizeStyleSettings は未設定時に設定のデフォルト色を使う", () => {
  assert.deepEqual(normalizeStyleSettings({}), DEFAULT_STYLE_SETTINGS);
});

test("normalizeStyleSettings は許可された文字色を保持する", () => {
  assert.equal(
    normalizeStyleSettings({ textColor: STYLE_TEXT_COLORS.WHITE }).textColor,
    STYLE_TEXT_COLORS.WHITE,
  );
  assert.equal(
    normalizeStyleSettings({ textColor: STYLE_TEXT_COLORS.BLACK }).textColor,
    STYLE_TEXT_COLORS.BLACK,
  );
});

test("resolveTextColor は設定のデフォルト時に undefined を返す", () => {
  assert.equal(
    resolveTextColor({ textColor: STYLE_TEXT_COLORS.SETTINGS_DEFAULT }),
    undefined,
  );
  assert.equal(
    resolveTextColor({ textColor: STYLE_TEXT_COLORS.BLACK }),
    STYLE_TEXT_COLORS.BLACK,
  );
});
