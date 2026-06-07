// Playwright E2E 共通ヘルパー。
// 読み取り専用スモーク（test-playwright.js）と保存系テスト（test-playwright-save.js）の
// 双方から require する。デプロイ URL 解決と GAS 二重 iframe の掘り下げを共通化する。

const assert = require("node:assert/strict");
const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_TIMEOUT_MS = Number(process.env.PLAYWRIGHT_TIMEOUT_MS || 20000);

function readJsonFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8").replace(/^﻿/, "");
  return JSON.parse(raw);
}

function readDeploymentUrlFromCache(cwd) {
  const cachePath = path.join(cwd, ".gas-deployment.json");
  if (!fs.existsSync(cachePath)) return "";

  try {
    const raw = readJsonFile(cachePath);
    if (raw?.webAppUrl) return String(raw.webAppUrl).trim();
    if (raw?.deploymentId) return `https://script.google.com/macros/s/${String(raw.deploymentId).trim()}/exec`;
  } catch (_error) {
    return "";
  }

  return "";
}

function readHeadDeploymentUrlFromClasp(cwd) {
  try {
    const output = execSync("clasp deployments", {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const headLine = output.split(/\r?\n/).find((line) => line.includes("@HEAD"));
    if (!headLine) return "";

    const matched = headLine.match(/AKf[\w-]+/);
    if (!matched) return "";

    return `https://script.google.com/macros/s/${matched[0]}/exec`;
  } catch (_error) {
    return "";
  }
}

function resolveAppUrl() {
  const explicitUrl = String(process.env.PLAYWRIGHT_APP_URL || "").trim();
  if (explicitUrl) return explicitUrl;

  const cwd = process.cwd();
  const cacheUrl = readDeploymentUrlFromCache(cwd);
  if (cacheUrl) return cacheUrl;

  return readHeadDeploymentUrlFromClasp(cwd);
}

// SPA 内ルートを「外側 doGet が ?route= から __INITIAL_HASH__ に注入 → applyInitialHashFromGas で
// 内側 iframe の hash に反映」させるための URL を作る（builder/src/utils/appUrl.js と同じ規約）。
// デプロイ済み GAS Web アプリ専用。ローカル dev では ?route= は効かない（#/path を使うこと）。
function buildRouteUrl(baseUrl, hashPath) {
  const base = String(baseUrl || "").replace(/#.*$/, "");
  const normalized = !hashPath
    ? "/"
    : (hashPath.startsWith("/") ? hashPath : `/${hashPath}`);
  const separator = base.includes("?") ? "&" : "?";
  return `${base}${separator}route=${encodeURIComponent(normalized)}`;
}

// GAS Web アプリは二重 iframe 構造。React 本体（main を持ち、内部に iframe を持たない最内フレーム）を返す。
async function getAppSurface(page) {
  await page.waitForTimeout(1500);
  const frames = page.frames();
  if (frames.length <= 1) return page.mainFrame();

  const candidates = frames.filter((frame) => frame !== page.mainFrame());
  for (const frame of candidates.slice().reverse()) {
    const mainCount = await frame.locator("main").count().catch(() => 0);
    const nestedFrameCount = await frame.locator("iframe").count().catch(() => 0);
    if (mainCount > 0 && nestedFrameCount === 0) {
      return frame;
    }
  }

  return candidates[candidates.length - 1];
}

async function expectNoGoogleLogin(page) {
  const currentUrl = page.url();
  assert.ok(
    !/accounts\.google\.com/i.test(currentUrl),
    `Google ログイン画面へリダイレクトされました: ${currentUrl}`,
  );
}

async function waitForAppReady(surface) {
  const loadingText = surface.getByText("読み込み中");
  await loadingText.waitFor({ state: "hidden", timeout: DEFAULT_TIMEOUT_MS }).catch(() => {});

  const selectors = [".app-root", ".app-container", ".nf-card", "main", "h1"];
  for (const selector of selectors) {
    const locator = surface.locator(selector);
    if (await locator.count()) {
      await locator.first().waitFor({ state: "visible", timeout: DEFAULT_TIMEOUT_MS }).catch(() => {});
      return;
    }
  }
  throw new Error("アプリ本体の描画を確認できませんでした");
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  readJsonFile,
  readDeploymentUrlFromCache,
  readHeadDeploymentUrlFromClasp,
  resolveAppUrl,
  buildRouteUrl,
  getAppSurface,
  expectNoGoogleLogin,
  waitForAppReady,
};
