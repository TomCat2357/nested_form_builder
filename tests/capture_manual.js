const { chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const APP_URL = 'https://script.google.com/macros/s/AKfycbxrNsXeFG-CcZVtt1jWwjBEwibyFs4-2i-A_5xJh1iOyGUN2VVhmR6QccWwodw82umJFQ/exec';
const EXPORT_DIR = path.resolve(__dirname, '../docs/screenshots');

const VIEWPORT = { width: 1440, height: 900 };

async function ensureDir(dir) {
  await fs.promises.mkdir(dir, { recursive: true });
}

async function capture(page, fileName, options = {}) {
  const filePath = path.join(EXPORT_DIR, fileName);
  await page.waitForTimeout(500);
  await page.screenshot({ path: filePath, fullPage: true, ...options });
  console.log(`saved: ${filePath}`);
}

async function waitForNetworkIdle(page, timeout = 5000) {
  try {
    await page.waitForLoadState('networkidle', { timeout });
  } catch (err) {
    // Ignore timeout to keep flow moving when network is chatty
  }
}

async function captureAppFlow(browser) {
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();

  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await waitForNetworkIdle(page);
  await capture(page, '01_app_home.png');

  const appFrame = page.frameLocator('iframe').frameLocator('iframe');

  const adminButton = appFrame.locator('text=管理画面へ').first();
  await adminButton.waitFor({ state: 'visible', timeout: 15000 });
  await capture(page, '02_admin_entry.png');
  await adminButton.click();
  await waitForNetworkIdle(page);
  await capture(page, '03_admin_list.png');

  const importButton = appFrame.locator('button:has-text("インポート")').first();
  if (await importButton.isVisible()) {
    await importButton.click();
    await page.waitForTimeout(500);
    await capture(page, '04_admin_import_dialog.png');
    const importCancel = appFrame.locator('button:has-text("キャンセル")').first();
    if (await importCancel.isVisible()) {
      await importCancel.click();
    }
  }

  const backButton = appFrame.locator('text=フォーム一覧へ').first();
  if (await backButton.isVisible()) {
    await backButton.click();
    await waitForNetworkIdle(page);
  } else {
    await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
    await waitForNetworkIdle(page);
  }
  await capture(page, '05_form_list.png');

  const formCard = appFrame.locator('text=ヒグマは好きか').first();
  await formCard.waitFor({ state: 'visible', timeout: 15000 });
  await capture(page, '06_form_card.png');
  await formCard.click();
  await waitForNetworkIdle(page);
  await capture(page, '07_data_list.png');

  const newEntryButton = appFrame.locator('text=新規入力').first();
  await newEntryButton.waitFor({ state: 'visible', timeout: 15000 });
  await newEntryButton.click();
  await waitForNetworkIdle(page);
  await capture(page, '08_new_entry_blank.png');

  await appFrame.locator('input[name="\"氏名\""]').fill('田中太郎');
  await appFrame.locator('label:has-text("男性")').click();
  await appFrame.locator('input[name="\"年齢\""]').fill('35');
  await appFrame.locator('label:has-text("アセス")').click();
  await appFrame.locator('label:has-text("法・条例制度")').click();
  await waitForNetworkIdle(page);
  await capture(page, '09_form_assess_filled.png');

  const cancelEntry = appFrame.locator('button:has-text("キャンセル")').first();
  if (await cancelEntry.isVisible()) {
    await cancelEntry.click();
    await waitForNetworkIdle(page);
  }

  const searchBox = appFrame.locator('input[placeholder="キーワード検索"]').first();
  await searchBox.waitFor({ state: 'visible', timeout: 15000 });
  await capture(page, '10_search_blank.png');
  await searchBox.fill('田中');
  await waitForNetworkIdle(page);
  await capture(page, '11_search_result_basic.png');
  await searchBox.fill('氏名:田中 and 年齢>=30');
  await waitForNetworkIdle(page);
  await capture(page, '12_search_result_advanced.png');
  await searchBox.fill('');

  const firstRow = appFrame.locator('table tbody tr').first();
  await firstRow.waitFor({ state: 'visible', timeout: 15000 });
  await firstRow.click();
  await waitForNetworkIdle(page);
  await capture(page, '13_edit_entry.png');
  const cancelEdit = appFrame.locator('button:has-text("キャンセル")').first();
  if (await cancelEdit.isVisible()) {
    await cancelEdit.click();
    await waitForNetworkIdle(page);
  }

  const firstCheckbox = appFrame.locator('table tbody tr input[type="checkbox"]').first();
  if (await firstCheckbox.isVisible()) {
    await firstCheckbox.click();
    await capture(page, '14_delete_select.png');
    const deleteButton = appFrame.locator('button:has-text("削除")').first();
    if (await deleteButton.isVisible()) {
      await deleteButton.click();
      const confirmButton = appFrame.locator('button:has-text("削除")').nth(1);
      await confirmButton.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
      await capture(page, '15_delete_confirm.png');
      const cancelDelete = appFrame.locator('button:has-text("キャンセル")').last();
      if (await cancelDelete.isVisible()) {
        await cancelDelete.click();
      }
    }
  }

  await context.close();
}

async function captureSpreadsheet(browser) {
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();

  await page.goto('https://docs.google.com/spreadsheets/d/1rwrTE6Ndpd22_lkUwuo-9YOY0cqWS8WUCu1_EzVKv74/edit', { waitUntil: 'domcontentloaded' });
  await waitForNetworkIdle(page, 10000);
  await capture(page, '16_spreadsheet_overview.png');

  await context.close();
}

(async () => {
  await ensureDir(EXPORT_DIR);
  const browser = await chromium.launch({ headless: true });

  try {
    await captureAppFlow(browser);
    await captureSpreadsheet(browser);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
