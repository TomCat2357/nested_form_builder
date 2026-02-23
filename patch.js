#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

/**
 * ============================================================
 * Utilities
 * ============================================================
 */

function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

function readText(p) {
  return fs.readFileSync(p, "utf8");
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function ts() {
  // 例: 2026-02-23T05-59-46-631Z
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function writeWithBackup(filePath, nextText) {
  const prev = readText(filePath);
  if (prev === nextText) return { changed: false, backupPath: null };

  const backupPath = `${filePath}.bak.${ts()}`;
  fs.writeFileSync(backupPath, prev, "utf8");
  fs.writeFileSync(filePath, nextText, "utf8");
  return { changed: true, backupPath };
}

function writeNewFileOrUpdate(filePath, nextText) {
  if (!exists(filePath)) {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, nextText, "utf8");
    return { changed: true, created: true, backupPath: null };
  }
  const r = writeWithBackup(filePath, nextText);
  return { changed: r.changed, created: false, backupPath: r.backupPath };
}

function findRepoRoot(startDir) {
  let dir = startDir;
  for (let i = 0; i < 12; i++) {
    const app = path.join(dir, "builder", "src", "app", "App.jsx");
    const useAlert = path.join(dir, "builder", "src", "app", "hooks", "useAlert.js");
    if (exists(app) && exists(useAlert)) return dir;

    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    "repo root not found. Run this from nested_form_builder/ (or inside it). " +
      "Expected builder/src/app/App.jsx and builder/src/app/hooks/useAlert.js"
  );
}

function listFilesRecursive(rootDir, { exts, ignoreDirs }) {
  const out = [];
  const stack = [rootDir];

  while (stack.length) {
    const cur = stack.pop();
    const stat = fs.statSync(cur);

    if (stat.isDirectory()) {
      const base = path.basename(cur);
      if (ignoreDirs.has(base)) continue;

      const items = fs.readdirSync(cur).map((n) => path.join(cur, n));
      for (const it of items) stack.push(it);
      continue;
    }

    if (!stat.isFile()) continue;

    const ext = path.extname(cur).toLowerCase();
    if (exts.has(ext)) out.push(cur);
  }

  return out;
}

function normalizeNewlines(s) {
  // keep existing style mostly; but avoid accumulating blank lines
  return s.replace(/\r\n/g, "\n");
}

function cleanupExtraBlankLines(src) {
  return src
    .replace(/\n{4,}/g, "\n\n\n")
    .replace(/[ \t]+\n/g, "\n");
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function rel(root, p) {
  return path.relative(root, p).split(path.sep).join("/");
}

/**
 * ============================================================
 * Code-aware helpers (lightweight)
 * ============================================================
 */

/**
 * Remove JS comments and string literals roughly, so we can check identifier usage
 * without being fooled by comments/strings.
 * Not a full parser; it is “good enough” for import-cleanup decisions.
 */
function stripCommentsAndStrings(code) {
  // Remove block comments
  let s = code.replace(/\/\*[\s\S]*?\*\//g, " ");
  // Remove line comments
  s = s.replace(/(^|[^:])\/\/.*$/gm, "$1 ");
  // Remove single-quoted strings
  s = s.replace(/'(?:\\.|[^'\\])*'/g, "''");
  // Remove double-quoted strings
  s = s.replace(/"(?:\\.|[^"\\])*"/g, '""');
  // Remove template literals (rough)
  s = s.replace(/`(?:\\.|[^`\\])*`/g, "``");
  return s;
}

/**
 * ============================================================
 * Transformations
 * ============================================================
 */

function removeAlertDialogImport(src) {
  // import AlertDialog from ".../AlertDialog.jsx";
  return src.replace(
    /^[ \t]*import\s+AlertDialog\s+from\s+["'][^"']*AlertDialog(?:\.jsx|\.js)?["'];?\s*\n/gm,
    ""
  );
}

function removeAlertDialogJsx(src) {
  // Remove both:
  //   <AlertDialog ... />
  //   <AlertDialog ...></AlertDialog>
  // Strategy:
  // - First remove paired tag blocks (non-greedy)
  // - Then remove self-closing tags
  let out = src;

  // Paired tag: starts on its own line typically; we allow arbitrary props/newlines inside start tag.
  out = out.replace(
    /^[ \t]*<AlertDialog\b[\s\S]*?>[\s\S]*?<\/AlertDialog>\s*\n?/gm,
    ""
  );

  // Self-closing
  out = out.replace(/^[ \t]*<AlertDialog\b[\s\S]*?\/>\s*\n?/gm, "");

  return out;
}

/**
 * Fix obvious broken patterns like:
 *   const [searchParams, showAlert } = useAlert();
 *   const [x, showAlert} = useAlert();
 *
 * We only convert to:
 *   const { showAlert } = useAlert();
 *
 * We do NOT try to salvage the first array element (it’s not from useAlert anyway).
 */
function fixBrokenUseAlertArrayDestructure(src) {
  return src.replace(
    /^[ \t]*(const|let|var)\s*\[\s*[^,\]]+\s*,\s*showAlert\s*}\s*=\s*useAlert\(\)\s*;\s*\n?/gm,
    (m, decl) => `${decl} { showAlert } = useAlert();\n`
  );
}

/**
 * Shrink:
 *   const { alertState, showAlert, closeAlert } = useAlert();
 * into only used names (showAlert/closeAlert/alertState) based on usage in the rest of file.
 *
 * Safety:
 * - Only acts on object destructuring `{ ... } = useAlert()`
 * - Keeps aliases like `alertState: a`, defaults `x = 1` as-is.
 */
function shrinkUseAlertObjectDestructure(src) {
  const whole = src;

  return src.replace(
    /^([ \t]*)(const|let|var)\s+{\s*([^}]+?)\s*}\s*=\s*useAlert\(\)\s*;\s*\n?/gm,
    (match, indent, decl, inside, offset) => {
      const withoutLine = whole.slice(0, offset) + whole.slice(offset + match.length);

      const rawParts = inside
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean);

      const kept = [];
      for (const part of rawParts) {
        // part can be:
        //  - alertState
        //  - alertState: as
        //  - showAlert = fn
        //  - alertState: as = def
        const left = part.split(":")[0].split("=")[0].trim();
        if (!left) continue;

        // Identifier usage check
        const re = new RegExp(`\\b${escapeRegExp(left)}\\b`);
        if (re.test(withoutLine)) kept.push(part);
      }

      if (kept.length === 0) return "";
      return `${indent}${decl} { ${kept.join(", ")} } = useAlert();\n`;
    }
  );
}

/**
 * Remove:
 *   import { useAlert } from "...";
 * if identifier is truly unused in code (excluding comments/strings).
 */
function removeUseAlertImportIfUnused(src) {
  const codeOnly = stripCommentsAndStrings(src);
  const uses = /\buseAlert\b/.test(codeOnly);
  if (uses) return src;

  return src.replace(
    /^[ \t]*import\s*{\s*useAlert\s*}\s*from\s*["'][^"']+["'];?\s*\n/gm,
    ""
  );
}

/**
 * ============================================================
 * App.jsx patch
 * ============================================================
 */

function patchAppJsx(appPath) {
  let src = normalizeNewlines(readText(appPath));

  // Add import if missing
  if (!src.includes('from "./state/AlertProvider.jsx"')) {
    // prefer to place after AppDataProvider import
    const before = src;
    src = src.replace(
      /(import\s+\{\s*AppDataProvider\s*\}\s+from\s+"\.\/state\/AppDataProvider\.jsx";\s*\n)/,
      `$1import { AlertProvider } from "./state/AlertProvider.jsx";\n`
    );

    // fallback: insert after react-router-dom import
    if (src === before) {
      src = src.replace(
        /(import\s+\{\s*HashRouter[\s\S]*?\}\s+from\s+"react-router-dom";\s*\n)/,
        `$1import { AlertProvider } from "./state/AlertProvider.jsx";\n`
      );
    }
  }

  // Wrap HashRouter with AlertProvider only if not already wrapped
  const hasProviderWrap = /<AlertProvider>/.test(src);

  if (!hasProviderWrap) {
    // Open tag insertion: between <AppDataProvider> and <HashRouter>
    src = src.replace(
      /(<AuthProvider>\s*\n\s*<AppDataProvider>\s*\n\s*)(<HashRouter>)/m,
      `$1<AlertProvider>\n        $2`
    );

    // Close tag insertion: before </AppDataProvider>, after </HashRouter>
    // Use RegExp(string) to avoid /-literal pitfalls.
    src = src.replace(
      new RegExp("(<\\/HashRouter>\\s*\\n\\s*)(<\\/AppDataProvider>)", "m"),
      `$1</AlertProvider>\n      $2`
    );
  }

  return src;
}

/**
 * ============================================================
 * Main
 * ============================================================
 */

function main() {
  const repoRoot = findRepoRoot(process.cwd());
  const builderSrc = path.join(repoRoot, "builder", "src");

  const alertProviderPath = path.join(repoRoot, "builder", "src", "app", "state", "AlertProvider.jsx");
  const useAlertPath = path.join(repoRoot, "builder", "src", "app", "hooks", "useAlert.js");
  const appPath = path.join(repoRoot, "builder", "src", "app", "App.jsx");

  const alertProviderContent = `import React, { createContext, useCallback, useMemo, useState } from "react";
import AlertDialog from "../components/AlertDialog.jsx";

export const AlertContext = createContext(null);

export function AlertProvider({ children }) {
  const [alertState, setAlertState] = useState({ open: false, title: "", message: "" });

  const showAlert = useCallback((message, title = "通知") => {
    setAlertState({
      open: true,
      title,
      message: message === undefined || message === null ? "" : String(message),
    });
  }, []);

  const closeAlert = useCallback(() => {
    setAlertState({ open: false, title: "", message: "" });
  }, []);

  const value = useMemo(
    () => ({ alertState, showAlert, closeAlert }),
    [alertState, showAlert, closeAlert],
  );

  return (
    <AlertContext.Provider value={value}>
      {children}
      <AlertDialog
        open={alertState.open}
        title={alertState.title}
        message={alertState.message}
        onClose={closeAlert}
      />
    </AlertContext.Provider>
  );
}
`;

  const useAlertContent = `import { useContext } from "react";
import { AlertContext } from "../state/AlertProvider.jsx";

export function useAlert() {
  const ctx = useContext(AlertContext);
  if (!ctx) throw new Error("useAlert must be used within AlertProvider");
  return ctx;
}
`;

  const results = {
    created: [],
    updated: [],
    touched: 0,
    backups: 0,
  };

  // 1) Create/Update AlertProvider
  {
    const r = writeNewFileOrUpdate(alertProviderPath, alertProviderContent);
    if (r.created) results.created.push(rel(repoRoot, alertProviderPath));
    if (r.backupPath) results.backups++;
    if (r.changed && !r.created) results.updated.push(rel(repoRoot, alertProviderPath));
  }

  // 2) Update useAlert.js to context based
  {
    const r = writeWithBackup(useAlertPath, useAlertContent);
    if (r.backupPath) results.backups++;
    if (r.changed) results.updated.push(rel(repoRoot, useAlertPath));
  }

  // 3) Patch App.jsx
  {
    const next = patchAppJsx(appPath);
    const r = writeWithBackup(appPath, next);
    if (r.backupPath) results.backups++;
    if (r.changed) results.updated.push(rel(repoRoot, appPath));
  }

  // 4) Sweep builder/src for duplicated AlertDialog usage
  const all = listFilesRecursive(builderSrc, {
    exts: new Set([".js", ".jsx"]),
    ignoreDirs: new Set(["node_modules", "dist", "build", ".git"]),
  });

  const skip = new Set([
    path.normalize(path.join("builder", "src", "app", "components", "AlertDialog.jsx")),
    path.normalize(path.join("builder", "src", "app", "state", "AlertProvider.jsx")),
  ]);

  for (const filePath of all) {
    const relPath = path.normalize(rel(repoRoot, filePath));
    if (skip.has(relPath)) continue;
    if (relPath.endsWith(path.normalize(path.join("builder", "src", "app", "hooks", "useAlert.js")))) continue;
    if (relPath.endsWith(path.normalize(path.join("builder", "src", "app", "App.jsx")))) continue;

    let src = normalizeNewlines(readText(filePath));
    const before = src;

    // Quick skip: if file has neither AlertDialog nor useAlert text, ignore
    if (!/\bAlertDialog\b/.test(src) && !/\buseAlert\b/.test(src)) continue;

    // 4-1) Remove import + JSX
    src = removeAlertDialogImport(src);
    src = removeAlertDialogJsx(src);

    // 4-2) Fix broken array destructuring accidents
    src = fixBrokenUseAlertArrayDestructure(src);

    // 4-3) Shrink object destructuring (safe)
    src = shrinkUseAlertObjectDestructure(src);

    // 4-4) Remove unused import { useAlert } if possible
    src = removeUseAlertImportIfUnused(src);

    // 4-5) Cleanup formatting
    src = cleanupExtraBlankLines(src);

    if (src !== before) {
      const r = writeWithBackup(filePath, src);
      results.touched++;
      if (r.backupPath) results.backups++;
      if (r.changed) results.updated.push(relPath);
    }
  }

  // Summary
  console.log("✅ AlertDialog de-dup refactor applied.");
  if (results.created.length) {
    console.log("  created:");
    for (const p of results.created) console.log("   -", p);
  }
  if (results.updated.length) {
    console.log("  updated:");
    for (const p of results.updated) console.log("   -", p);
  }
  console.log(`  touched files: ${results.touched}`);
  console.log(`  backups created: ${results.backups}`);
  console.log("Next: run ./deploy.ps1 (or npm build) and smoke-test alert flows.");
}

main();
