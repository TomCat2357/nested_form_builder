/**
 * Simple Playwright smoke test for the MCP server.
 *
 * - Targets the Google Apps Script endpoint by default.
 * - Captures status, title, a short body preview, console logs, and a screenshot.
 * - Environment overrides:
 *     TARGET_URL: URL to load (defaults to provided GAS endpoint).
 *     HEADLESS: set to "false" to see the browser; otherwise headless.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const TARGET_URL =
  process.env.TARGET_URL ||
  'https://script.google.com/macros/s/AKfycbzFCYP79BCMQ3CFi3bO6OqW0R5jv35D3UrI3ILtEph9AxZ_gs6t5GfNYHt6V62r472E/exec';

const HEADLESS = process.env.HEADLESS !== 'false';
const OUTPUT_DIR = path.join('playwright-report');
const SCREENSHOT_PATH = path.join(OUTPUT_DIR, 'mcp-playwright-check.png');

async function ensureDir(dirPath) {
  await fs.promises.mkdir(dirPath, { recursive: true });
}

async function main() {
  await ensureDir(OUTPUT_DIR);

  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();

  const consoleLogs = [];
  page.on('console', (msg) => consoleLogs.push({ type: msg.type(), text: msg.text() }));

  console.log(`Navigating to: ${TARGET_URL}`);
  const response = await page.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 30_000 });

  // Wait a moment for potential post-load scripts.
  await page.waitForTimeout(1500);

  const title = await page.title();
  const bodyPreview = (await page.textContent('body'))?.slice(0, 200) || '';
  const status = response?.status();

  await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true });

  const mainRequest = response?.request();
  const redirectChain = [];
  for (let req = mainRequest?.redirectedFrom(); req; req = req.redirectedFrom()) {
    redirectChain.unshift(req.url());
  }

  console.log('--- Result ---');
  console.log(`Final URL: ${response?.url()}`);
  console.log(`HTTP status: ${status}`);
  console.log(`Redirect chain: ${redirectChain.length ? redirectChain.join(' -> ') : '(none)'}`);
  console.log(`Title: ${title}`);
  console.log(`Body preview: ${bodyPreview.replace(/\s+/g, ' ').trim()}`);
  console.log(`Screenshot: ${SCREENSHOT_PATH}`);
  console.log('Console logs:');
  for (const log of consoleLogs) {
    console.log(`  [${log.type}] ${log.text}`);
  }

  await browser.close();
}

main().catch((err) => {
  console.error('Playwright check failed:', err);
  process.exit(1);
});
