const fs = require('fs');
const path = require('path');

// 1. useLatestRef カスタムフックの作成
const hooksDir = path.join('builder', 'src', 'app', 'hooks');
if (!fs.existsSync(hooksDir)) fs.mkdirSync(hooksDir, { recursive: true });

const useLatestRefContent = `import { useRef, useEffect } from 'react';

/**
 * 最新の値を常に保持するRefを返すカスタムフック
 * 冗長な useEffect + useRef のボイラープレートを削減します。
 */
export function useLatestRef(value) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}
`;
fs.writeFileSync(path.join(hooksDir, 'useLatestRef.js'), useLatestRefContent, 'utf8');
console.log('✅ Created useLatestRef.js');

// Helper function
function updateFile(filePath, updater) {
  if (!fs.existsSync(filePath)) {
    console.warn(`⚠️ File not found: ${filePath}`);
    return;
  }
  let content = fs.readFileSync(filePath, 'utf8');
  const newContent = updater(content);
  if (content !== newContent) {
    fs.writeFileSync(filePath, newContent, 'utf8');
    console.log(`✅ Updated ${filePath}`);
  } else {
    console.log(`ℹ️ No changes needed for ${filePath}`);
  }
}

// 2. AdminDashboardPage.jsx の修正 (useLatestRef適用 & マウント時同期追加)
updateFile('builder/src/pages/AdminDashboardPage.jsx', (content) => {
  let res = content.replace(
    /import React, \{([^}]+)\} from "react";/,
    `import React, {$1} from "react";\nimport { useLatestRef } from "../app/hooks/useLatestRef.js";`
  );
  res = res.replace(
    /const loadingFormsRef = useRef\(loadingForms\);\s+useEffect\(\(\) => \{\s+loadingFormsRef\.current = loadingForms;\s+\}, \[loadingForms\]\);/g,
    `const loadingFormsRef = useLatestRef(loadingForms);\n\n  useEffect(() => {\n    handleOperationCacheCheck({ source: "mount" });\n  }, []);`
  );
  return res;
});

// 3. AdminFormEditorPage.jsx の修正 (useLatestRef適用)
updateFile('builder/src/pages/AdminFormEditorPage.jsx', (content) => {
  let res = content.replace(
    /import React, \{([^}]+)\} from "react";/,
    `import React, {$1} from "react";\nimport { useLatestRef } from "../app/hooks/useLatestRef.js";`
  );
  res = res.replace(
    /const isSavingRef = useRef\(isSaving\);\s+const isReadLockedRef = useRef\(isReadLocked\);\s+const loadingFormsRef = useRef\(loadingForms\);\s+useEffect\(\(\) => \{\s+isSavingRef\.current = isSaving;\s+\}, \[isSaving\]\);\s+useEffect\(\(\) => \{\s+isReadLockedRef\.current = isReadLocked;\s+\}, \[isReadLocked\]\);\s+useEffect\(\(\) => \{\s+loadingFormsRef\.current = loadingForms;\s+\}, \[loadingForms\]\);/g,
    `const isSavingRef = useLatestRef(isSaving);\n  const isReadLockedRef = useLatestRef(isReadLocked);\n  const loadingFormsRef = useLatestRef(loadingForms);`
  );
  return res;
});

// 4. FormPage.jsx の修正 (useLatestRef適用)
updateFile('builder/src/pages/FormPage.jsx', (content) => {
  let res = content.replace(
    /import React, \{([^}]+)\} from "react";/,
    `import React, {$1} from "react";\nimport { useLatestRef } from "../app/hooks/useLatestRef.js";`
  );
  res = res.replace(
    /const loadingRef = useRef\(loading\);\s+const reloadingRef = useRef\(isReloading\);\s+const savingRef = useRef\(isSaving\);\s+const readLockRef = useRef\(isReadLocked\);\s+const loadingFormsRef = useRef\(loadingForms\);\s+useEffect\(\(\) => \{\s+loadingRef\.current = loading;\s+\}, \[loading\]\);\s+useEffect\(\(\) => \{\s+reloadingRef\.current = isReloading;\s+\}, \[isReloading\]\);\s+useEffect\(\(\) => \{\s+savingRef\.current = isSaving;\s+\}, \[isSaving\]\);\s+useEffect\(\(\) => \{\s+readLockRef\.current = isReadLocked;\s+\}, \[isReadLocked\]\);\s+useEffect\(\(\) => \{\s+loadingFormsRef\.current = loadingForms;\s+\}, \[loadingForms\]\);/g,
    `const loadingRef = useLatestRef(loading);\n  const reloadingRef = useLatestRef(isReloading);\n  const savingRef = useLatestRef(isSaving);\n  const readLockRef = useLatestRef(isReadLocked);\n  const loadingFormsRef = useLatestRef(loadingForms);`
  );
  return res;
});

// 5. useEntriesWithCache.js の修正 (useLatestRef適用)
updateFile('builder/src/features/search/useEntriesWithCache.js', (content) => {
  let res = content.replace(
    /import \{([^}]+)\} from "react";/,
    `import {$1} from "react";\nimport { useLatestRef } from "../../app/hooks/useLatestRef.js";`
  );
  res = res.replace(
    /const lastSyncedAtRef = useRef\(lastSyncedAt\);\s+const backgroundLoadingRef = useRef\(false\);\s+const loadingFormsRef = useRef\(loadingForms\);\s+useEffect\(\(\) => \{\s+lastSyncedAtRef\.current = lastSyncedAt;\s+\}, \[lastSyncedAt\]\);\s+useEffect\(\(\) => \{\s+loadingFormsRef\.current = loadingForms;\s+\}, \[loadingForms\]\);/g,
    `const lastSyncedAtRef = useLatestRef(lastSyncedAt);\n  const backgroundLoadingRef = useRef(false);\n  const loadingFormsRef = useLatestRef(loadingForms);`
  );
  return res;
});

// 6. MainPage.jsx の修正 (マウント時データ読み取り判定追加)
updateFile('builder/src/pages/MainPage.jsx', (content) => {
  let res = content.replace(
    /import \{ formatUnixMsDateTime, toUnixMs \} from "\.\.\/utils\/dateTime\.js";/,
    `import { formatUnixMsDateTime, toUnixMs } from "../utils/dateTime.js";\nimport { evaluateCache, FORM_CACHE_MAX_AGE_MS, FORM_CACHE_BACKGROUND_REFRESH_MS } from "../app/state/cachePolicy.js";`
  );
  res = res.replace(
    /const \{ forms, loadingForms \} = useAppData\(\);/,
    `const { forms, loadingForms, refreshForms, lastSyncedAt } = useAppData();`
  );
  res = res.replace(
    /const activeForms = useMemo\(\(\) => forms\.filter\(\(form\) => !form\.archived\), \[forms\]\);/,
    `const activeForms = useMemo(() => forms.filter((form) => !form.archived), [forms]);\n\n  useEffect(() => {\n    const decision = evaluateCache({\n      lastSyncedAt,\n      hasData: forms.length > 0,\n      maxAgeMs: FORM_CACHE_MAX_AGE_MS,\n      backgroundAgeMs: FORM_CACHE_BACKGROUND_REFRESH_MS,\n    });\n    if (decision.shouldSync && !loadingForms) {\n      refreshForms({ reason: "main-mount-sync", background: false });\n    } else if (decision.shouldBackground && !loadingForms) {\n      refreshForms({ reason: "main-mount-background", background: true }).catch(console.error);\n    }\n  }, [lastSyncedAt, forms.length, loadingForms, refreshForms]);`
  );
  return res;
});

// 7. displayModes.js の修正 (後方互換性無視し単純化)
updateFile('builder/src/core/displayModes.js', () => {
  return `export const resolveIsDisplayed = (field) => !!field?.isDisplayed;\n`;
});

// 8. schema.js の修正 (不要なプロパティ削除を廃止)
updateFile('builder/src/core/schema.js', (content) => {
  let res = content.replace(
    /base\.isDisplayed = resolveIsDisplayed\(base\);\s*delete base\.displayMode;\s*delete base\.important;\s*delete base\.compact;/g,
    `base.isDisplayed = !!base.isDisplayed;`
  );
  res = res.replace(/import \{ resolveIsDisplayed \} from "\.\/displayModes\.js";\n/, '');
  return res;
});

// 9. dataStore.js の修正 (冗長なGAS利用可否チェックを削除)
updateFile('builder/src/app/state/dataStore.js', (content) => {
  let res = content.replace(/\s*if\s*\(!hasScriptRun\(\)\)\s*\{\s*throw new Error\("GAS unavailable"\);\s*\}/g, '');
  res = res.replace(/hasScriptRun,\s*/g, '');
  return res;
});

// 10. selfTests.js の修正 (後方互換性確認テストの削除)
updateFile('builder/src/core/selfTests.js', (content) => {
  return content.replace(/\s*\/\/ 旧表示キー移行:[\s\S]*?(?=\s*\/\/ 選択系表示は常に縮退列)/, '\n');
});

console.log('🎉 Refactoring patch applied successfully!');
