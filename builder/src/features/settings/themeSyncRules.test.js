import assert from "node:assert/strict";
import test from "node:test";
import {
  THEME_SYNC_SCOPE,
  THEME_SYNC_TRIGGER,
  resolveThemeSyncScope,
} from "./themeSyncRules.js";

test("②で OFF から ON にしたときは現在のグループ1テーマを全フォームへ反映する", () => {
  const scope = resolveThemeSyncScope({
    isFormMode: false,
    syncAllFormsTheme: true,
    trigger: THEME_SYNC_TRIGGER.SYNC_ENABLED,
  });

  assert.equal(scope, THEME_SYNC_SCOPE.ALL_FORMS_FROM_GLOBAL);
});

test("②でチェック ON 中にテーマ変更したときはグループ1と全フォームへ反映する", () => {
  const scope = resolveThemeSyncScope({
    isFormMode: false,
    syncAllFormsTheme: true,
    trigger: THEME_SYNC_TRIGGER.THEME_UPDATED,
  });

  assert.equal(scope, THEME_SYNC_SCOPE.GLOBAL_AND_ALL_FORMS);
});

test("②でチェック OFF 中にテーマ変更したときはグループ1だけを変更する", () => {
  const scope = resolveThemeSyncScope({
    isFormMode: false,
    syncAllFormsTheme: false,
    trigger: THEME_SYNC_TRIGGER.THEME_UPDATED,
  });

  assert.equal(scope, THEME_SYNC_SCOPE.GLOBAL_ONLY);
});

test("⑦でテーマ変更したときはチェック状態に関係なく対象フォームだけを変更する", () => {
  const scopeWhenSyncOff = resolveThemeSyncScope({
    isFormMode: true,
    syncAllFormsTheme: false,
    trigger: THEME_SYNC_TRIGGER.THEME_UPDATED,
  });
  const scopeWhenSyncOn = resolveThemeSyncScope({
    isFormMode: true,
    syncAllFormsTheme: true,
    trigger: THEME_SYNC_TRIGGER.THEME_UPDATED,
  });

  assert.equal(scopeWhenSyncOff, THEME_SYNC_SCOPE.CURRENT_FORM_ONLY);
  assert.equal(scopeWhenSyncOn, THEME_SYNC_SCOPE.CURRENT_FORM_ONLY);
});

test("⑦でテーマインポートや削除フォールバックが起きても対象フォームだけに閉じる", () => {
  const scope = resolveThemeSyncScope({
    isFormMode: true,
    syncAllFormsTheme: true,
    trigger: THEME_SYNC_TRIGGER.THEME_UPDATED,
  });

  assert.equal(scope, THEME_SYNC_SCOPE.CURRENT_FORM_ONLY);
});
