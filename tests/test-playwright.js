const assert = require("node:assert/strict");
const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const DEFAULT_TIMEOUT_MS = Number(process.env.PLAYWRIGHT_TIMEOUT_MS || 20000);
const REQUIRE_MULTI_RECORDS = process.env.PLAYWRIGHT_REQUIRE_MULTI_RECORDS !== "0";

function readDeploymentUrlFromCache(cwd) {
  const cachePath = path.join(cwd, ".gas-deployment.json");
  if (!fs.existsSync(cachePath)) return "";

  try {
    const raw = JSON.parse(fs.readFileSync(cachePath, "utf8"));
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

function buildTargetUrl(baseUrl) {
  const formId = String(process.env.PLAYWRIGHT_FORM_ID || "").trim();
  if (!formId) return baseUrl;
  const separator = baseUrl.includes("?") ? "&" : "?";
  return `${baseUrl}${separator}form=${encodeURIComponent(formId)}`;
}

async function getAppSurface(page) {
  await page.waitForTimeout(1500);
  const frames = page.frames();
  if (frames.length <= 1) return page.mainFrame();

  const candidates = frames.filter((frame) => frame !== page.mainFrame());
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
  const selectors = [".app-root", ".app-container", ".nf-card", "main"];
  for (const selector of selectors) {
    const locator = surface.locator(selector);
    if (await locator.count()) {
      await locator.first().waitFor({ state: "visible", timeout: DEFAULT_TIMEOUT_MS }).catch(() => {});
      return;
    }
  }
  throw new Error("アプリ本体の描画を確認できませんでした");
}

async function collectBreadcrumbLabels(surface) {
  const items = surface.locator(".breadcrumb-nav__item");
  const count = await items.count();
  const labels = [];
  for (let i = 0; i < count; i += 1) {
    const label = await items.nth(i).innerText().catch(() => "");
    labels.push(String(label || "").replace(/\s+/g, " ").trim());
  }
  return labels.filter(Boolean);
}

async function isSearchPage(surface) {
  const searchBox = surface.getByRole("searchbox");
  const table = surface.locator("table");
  return (await searchBox.count()) > 0 || (await table.count()) > 0;
}

async function openFormCard(surface, page, index) {
  const formCards = surface.locator("main > div");
  const count = await formCards.count();
  if (count <= index) return false;
  await formCards.nth(index).click();
  await page.waitForTimeout(1500);
  return true;
}

async function clickBackToMain(surface, page) {
  const backButton = surface.getByRole("button", { name: "← 戻る" }).first();
  if (await backButton.count()) {
    await backButton.click();
    await page.waitForTimeout(1200);
    return true;
  }
  return false;
}

async function findParentRecordWithChildJump(surface, page) {
  const rows = surface.locator("table tbody tr");
  const rowCount = await rows.count();
  for (let i = 0; i < Math.min(rowCount, 10); i += 1) {
    await rows.nth(i).click();
    await page.waitForTimeout(1200);
    const childJumpButtons = surface.locator(".child-form-jump-btn");
    if (await childJumpButtons.count()) {
      return true;
    }
    const backButton = surface.getByRole("button", { name: "← 戻る" }).first();
    if (!(await backButton.count())) return false;
    await backButton.click();
    await page.waitForTimeout(1200);
  }
  return false;
}

async function discoverHierarchyFlow(page, targetUrl) {
  for (let formIndex = 0; formIndex < 5; formIndex += 1) {
    if (formIndex > 0) {
      await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: DEFAULT_TIMEOUT_MS });
      await page.waitForTimeout(1500);
    }

    await expectNoGoogleLogin(page);
    let surface = await getAppSurface(page);
    await waitForAppReady(surface);

    if (!(await isSearchPage(surface))) {
      const opened = await openFormCard(surface, page, formIndex);
      if (!opened) break;
      surface = await getAppSurface(page);
    }

    if (!(await isSearchPage(surface))) continue;

    const found = await findParentRecordWithChildJump(surface, page);
    if (found) {
      return surface;
    }

    surface = await getAppSurface(page);
    await clickBackToMain(surface, page);
  }

  throw new Error("子フォームジャンプを持つ親レコードを見つけられませんでした。親子フォーム用のデータを確認してください。");
}

async function verifyChildSearchAndRecord(surface, page) {
  const parentBreadcrumb = await collectBreadcrumbLabels(surface);
  console.log(`[Playwright] parent breadcrumb: ${parentBreadcrumb.join(" > ")}`);
  assert.ok(parentBreadcrumb.length >= 2, "親レコード画面のパンくずが不足しています");

  const childJumpButton = surface.locator(".child-form-jump-btn").first();
  assert.ok(await childJumpButton.count(), "子フォームジャンプボタンが見つかりません");
  const childJumpLabel = (await childJumpButton.innerText()).replace(/\s+/g, " ").trim();
  await childJumpButton.click();
  await page.waitForTimeout(1500);

  surface = await getAppSurface(page);
  const childSearchBreadcrumb = await collectBreadcrumbLabels(surface);
  console.log(`[Playwright] child search breadcrumb: ${childSearchBreadcrumb.join(" > ")}`);
  assert.ok(childSearchBreadcrumb.length >= 3, "子フォーム検索画面のパンくずが不足しています");

  const childRows = surface.locator("table tbody tr");
  const childRowCount = await childRows.count();
  assert.ok(childRowCount > 0, "子フォーム検索結果にレコードがありません");

  await childRows.first().click();
  await page.waitForTimeout(1500);

  surface = await getAppSurface(page);
  const childRecordBreadcrumb = await collectBreadcrumbLabels(surface);
  console.log(`[Playwright] child record breadcrumb: ${childRecordBreadcrumb.join(" > ")}`);
  assert.ok(childRecordBreadcrumb.length >= 4, "子レコード画面のパンくずが不足しています");

  const backButton = surface.getByRole("button", { name: "← 戻る" }).first();
  assert.ok(await backButton.count(), "子レコード画面の戻るボタンが見つかりません");
  await backButton.click();
  await page.waitForTimeout(1500);

  surface = await getAppSurface(page);
  const childSearchBreadcrumbAfterBack = await collectBreadcrumbLabels(surface);
  console.log(`[Playwright] child search after back: ${childSearchBreadcrumbAfterBack.join(" > ")}`);
  assert.deepEqual(
    childSearchBreadcrumbAfterBack,
    childSearchBreadcrumb,
    "子レコードから戻った後に子フォーム検索画面のパンくずが維持されていません",
  );

  await surface.locator("table tbody tr").first().click();
  await page.waitForTimeout(1500);
  surface = await getAppSurface(page);

  const nextButton = surface.getByRole("button", { name: "次へ →" }).first();
  const hasNextButton = await nextButton.count();
  const canGoNext = hasNextButton && !(await nextButton.isDisabled());
  assert.ok(
    canGoNext || !REQUIRE_MULTI_RECORDS,
    "子レコードが複数件ないため、次へ/前への Playwright 検証を完了できませんでした",
  );

  if (canGoNext) {
    await nextButton.click();
    await page.waitForTimeout(1500);
    surface = await getAppSurface(page);

    const breadcrumbAfterNext = await collectBreadcrumbLabels(surface);
    console.log(`[Playwright] child record after next: ${breadcrumbAfterNext.join(" > ")}`);
    assert.ok(breadcrumbAfterNext.length >= 4, "次へ遷移後にパンくずが不足しています");

    const prevButton = surface.getByRole("button", { name: "← 前へ" }).first();
    const hasPrevButton = await prevButton.count();
    const canGoPrev = hasPrevButton && !(await prevButton.isDisabled());
    assert.ok(
      canGoPrev || !REQUIRE_MULTI_RECORDS,
      "次へ遷移後に前へボタンが使えないため、往復検証を完了できませんでした",
    );

    if (canGoPrev) {
      await prevButton.click();
      await page.waitForTimeout(1500);
      surface = await getAppSurface(page);
      const breadcrumbAfterPrev = await collectBreadcrumbLabels(surface);
      console.log(`[Playwright] child record after prev: ${breadcrumbAfterPrev.join(" > ")}`);
      assert.ok(breadcrumbAfterPrev.length >= 4, "前へ遷移後にパンくずが不足しています");
    }
  }

  console.log(`[Playwright] child jump button: ${childJumpLabel}`);
}

async function run() {
  const appUrl = resolveAppUrl();
  assert.ok(appUrl, "PLAYWRIGHT_APP_URL も deployment 情報も見つからないため検証を開始できません");

  const targetUrl = buildTargetUrl(appUrl);
  console.log(`[Playwright] target: ${targetUrl}`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: DEFAULT_TIMEOUT_MS });
    await page.waitForTimeout(2500);
    await expectNoGoogleLogin(page);

    const surface = await discoverHierarchyFlow(page, targetUrl);
    await verifyChildSearchAndRecord(surface, page);
    console.log("[Playwright] anonymous access and breadcrumb flow passed");
  } finally {
    await browser.close();
  }
}

run().catch((error) => {
  console.error("[Playwright] failed:", error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
