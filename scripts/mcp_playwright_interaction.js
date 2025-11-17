/**
 * Playwright interaction script for the published GAS app.
 *
 * Flows:
 * 1) Open the top page.
 * 2) Click "管理画面へ" to enter the admin UI.
 * 3) Dump clickable button/link texts and take screenshots for inspection.
 *
 * Environment overrides:
 *   TARGET_URL: target app URL.
 *   HEADLESS: set "false" to view the browser.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const TARGET_URL =
  process.env.TARGET_URL ||
  'https://script.google.com/macros/s/AKfycbzFCYP79BCMQ3CFi3bO6OqW0R5jv35D3UrI3ILtEph9AxZ_gs6t5GfNYHt6V62r472E/exec';
const HEADLESS = process.env.HEADLESS !== 'false';
const OUTPUT_DIR = path.join('playwright-report');

async function ensureDir(dirPath) {
  await fs.promises.mkdir(dirPath, { recursive: true });
}

async function listClickable(page) {
  const handles = await page.$$('button, a, [role="button"], input[type="button"], input[type="submit"]');
  const entries = [];
  for (const h of handles) {
    const text = (await h.textContent())?.trim() || (await h.getAttribute('value')) || '';
    const tag = await h.evaluate((el) => el.tagName.toLowerCase());
    entries.push({ tag, text });
  }
  return entries.filter((e) => e.text);
}

async function main() {
  await ensureDir(OUTPUT_DIR);
  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();

  await page.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 30_000 });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(OUTPUT_DIR, 'interaction-top.png'), fullPage: true });

  console.log('Frames after load:', page.frames().map((f) => ({ name: f.name(), url: f.url() })));
  const topButtons = await listClickable(page);
  console.log('Top page clickables:', topButtons);

  const targetFrame =
    page.frame({ name: 'userHtmlFrame' }) ||
    page.frame({ name: 'sandboxFrame' }) ||
    (await page.waitForSelector('iframe#sandboxFrame', { timeout: 10_000 }).then((h) => h.contentFrame()));
  if (!targetFrame) throw new Error('target frame not available');

  const frameButtons = await listClickable(targetFrame);
  console.log('Frame clickables:', frameButtons);

  const frameText = await targetFrame.evaluate(() => document.body.innerText.slice(0, 1000));
  console.log('Frame body text preview:', frameText);

  const adminButton = await targetFrame.waitForSelector('text=管理画面へ', { timeout: 20_000 }).catch(() => null);
  if (!adminButton) {
    throw new Error('管理画面へ button not found in frame');
  }
  await adminButton.click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);

  console.log('Frames after admin click:', page.frames().map((f) => ({ name: f.name(), url: f.url() })));
  const adminFrame = page.frame({ name: 'userHtmlFrame' });
  if (!adminFrame) throw new Error('admin frame not available');

  await adminFrame.waitForLoadState?.('load').catch(() => {});
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(OUTPUT_DIR, 'interaction-admin.png'), fullPage: true });
  const adminButtons = await listClickable(adminFrame);
  const adminText = await adminFrame.evaluate(() => document.body.innerText.slice(0, 1000));
  console.log('Admin page clickables:', adminButtons);
  console.log('Admin body text preview:', adminText);

  // Try creating a test form.
  const createButton = await adminFrame.$('text=新規作成');
  if (!createButton) {
    console.warn('新規作成 button not found, skipping creation.');
    await browser.close();
    return;
  }
  await createButton.click();
  await adminFrame.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUTPUT_DIR, 'interaction-create.png'), fullPage: true });

  const formInputs = await adminFrame.$$eval('input, textarea, select', (els) =>
    els.map((el) => ({
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute('type') || '',
      name: el.getAttribute('name') || '',
      placeholder: el.getAttribute('placeholder') || '',
    })),
  );
  console.log('Create form inputs:', formInputs);

  const nameInputHandle =
    (await adminFrame.$('input[placeholder*="名称"]')) ||
    (await adminFrame.$('input[placeholder*="フォーム"]')) ||
    (await adminFrame.$('input[type="text"]'));
  if (nameInputHandle) {
    await nameInputHandle.fill('Playwrightテストフォーム');
  }

  // Fill other likely-required fields.
  const fillByPlaceholder = async (placeholderPattern, value) => {
    const handle = await adminFrame.$(`input[placeholder*="${placeholderPattern}"]`);
    if (handle) {
      await handle.fill(value);
      return true;
    }
    return false;
  };
  const fillTextarea = async (placeholderPattern, value) => {
    const handle = await adminFrame.$(`textarea[placeholder*="${placeholderPattern}"]`);
    if (handle) {
      await handle.fill(value);
      return true;
    }
    return false;
  };

  await fillTextarea('説明', 'Playwrightによる自動入力テスト');
  await fillByPlaceholder('例: 来場者受付', 'Playwright受付フォーム');
  await fillByPlaceholder('1AbCdEf', '1AbCdEfGhIjKlMnOpQrStuVwXyZ-playwright');
  await fillByPlaceholder('Responses', 'Responses');
  await fillByPlaceholder('https://script.google.com/macros/s/', TARGET_URL);
  await fillByPlaceholder('20', '10');

  // Try to submit the form with common action buttons.
  const submitButton =
    (await adminFrame.$('text=保存')) ||
    (await adminFrame.$('text=作成')) ||
    (await adminFrame.$('text=登録')) ||
    (await adminFrame.$('button:has-text("保存")'));
  if (submitButton) {
    await submitButton.click();
    await adminFrame.waitForTimeout(800);

    // Confirmation dialog: "フォームを作成してよろしいですか？" with 保存/キャンセル
    const confirmDialog = await adminFrame.waitForSelector('text=フォームを作成してよろしいですか？', { timeout: 5000 }).catch(() => null);
    if (confirmDialog) {
      await adminFrame.evaluate(() => {
        const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find((d) =>
          d.textContent.includes('フォームを作成してよろしいですか？'),
        );
        if (!dialog) return;
        const buttons = Array.from(dialog.querySelectorAll('button, [role="button"]'));
        const saveBtn = buttons.find((b) => (b.textContent || '').includes('保存'));
        saveBtn?.click();
      });
      await adminFrame.waitForSelector('text=フォームを作成してよろしいですか？', { state: 'detached', timeout: 5000 }).catch(() => {});
      await adminFrame.waitForTimeout(1200);
    }
  } else {
    console.warn('保存/作成系のボタンが見つからず、クリックをスキップしました。');
  }

  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(OUTPUT_DIR, 'interaction-after-create.png'), fullPage: true });
  await page.screenshot({ path: path.join(OUTPUT_DIR, 'interaction-after-save.png'), fullPage: true });
  const afterText = await adminFrame.evaluate(() => document.body.innerText.slice(0, 1200));
  console.log('After save body text preview:', afterText);
  console.log('Frames after create attempt:', page.frames().map((f) => ({ name: f.name(), url: f.url() })));

  await browser.close();
}

main().catch((err) => {
  console.error('Interaction script failed:', err);
  process.exit(1);
});
