const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require("playwright");

const APP_URL = "https://script.google.com/macros/s/AKfycbzEzpdLK7i8Qic0RxycSGuzYbBpoFDd3KSbwDmU1vaUPU0K_fYv0aUL-rYCB1yyLk5yAg/exec";
const OUTPUT_DIR = path.resolve(__dirname, "..", "docs", "user_manual_images");
const VIEWPORT = { width: 1600, height: 2200 };
const SAMPLE_FORM_TITLE = "【マニュアル】相談受付フォーム";
const SAMPLE_FORM_DESCRIPTION = "Playwright で撮影するユーザーマニュアル用のサンプルフォームです。";
const DISPLAY_FORM_TITLE = "相談受付フォーム";
const SAMPLE_PATTERNS = ["【マニュアル】", "Playwright撮影用フォーム"];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function waitForFrame(page) {
  for (let i = 0; i < 60; i += 1) {
    const frame = page.frames().find((current) => current.name() === "userHtmlFrame");
    if (frame) return frame;
    await sleep(500);
  }
  throw new Error("userHtmlFrame が見つかりません");
}

async function openApp(context) {
  const page = await context.newPage();
  await page.goto(APP_URL, { waitUntil: "domcontentloaded", timeout: 120000 });
  const frame = await waitForFrame(page);
  const iframe = page.locator("#sandboxFrame");
  await iframe.waitFor({ state: "visible", timeout: 120000 });
  await page.waitForTimeout(2500);
  return { page, frame, iframe };
}

async function waitForCondition(checkFn, timeoutMs, errorMessage) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await checkFn()) return;
    await sleep(500);
  }
  throw new Error(errorMessage);
}

async function waitForText(frame, expectedText, timeoutMs = 30000) {
  await waitForCondition(
    async () => {
      const text = await frame.locator("body").innerText();
      return text.includes(expectedText);
    },
    timeoutMs,
    `指定テキストを確認できませんでした: ${expectedText}`,
  );
}

async function waitForCount(locator, minimumCount, timeoutMs = 30000) {
  await waitForCondition(
    async () => (await locator.count()) >= minimumCount,
    timeoutMs,
    `要素数が足りません: expected >= ${minimumCount}`,
  );
}

async function navigateHash(frame, hash, expectedText, timeoutMs = 30000) {
  await frame.evaluate((nextHash) => {
    if (window.location.hash === nextHash) {
      window.dispatchEvent(new HashChangeEvent("hashchange"));
      return;
    }
    window.location.hash = nextHash;
  }, hash);
  if (expectedText) {
    await waitForText(frame, expectedText, timeoutMs);
  }
  await frame.page().waitForTimeout(1500);
}

async function saveScreenshot(locator, fileName) {
  await locator.screenshot({ path: path.join(OUTPUT_DIR, fileName) });
  console.log(`saved ${fileName}`);
}

async function setCheckboxByLabel(scope, labelText, checked) {
  const label = scope.locator("label").filter({ hasText: labelText }).first();
  const checkbox = label.locator('input[type="checkbox"]').first();
  await checkbox.waitFor({ state: "attached", timeout: 10000 });
  const isChecked = await checkbox.isChecked();
  if (isChecked !== checked) {
    await checkbox.click({ force: true });
  }
}

async function setRadioByLabel(scope, labelText) {
  const label = scope.locator("label").filter({ hasText: labelText }).first();
  const radio = label.locator('input[type="radio"]').first();
  await radio.waitFor({ state: "attached", timeout: 10000 });
  await radio.check({ force: true });
}

async function cleanupSampleForms(frame) {
  await navigateHash(frame, "#/forms", "フォーム管理");
  const rows = frame.locator("tbody tr");
  const rowCount = await rows.count();
  let checkedCount = 0;

  for (let i = 0; i < rowCount; i += 1) {
    const row = rows.nth(i);
    const text = await row.innerText();
    if (!SAMPLE_PATTERNS.some((pattern) => text.includes(pattern))) continue;
    const checkbox = row.locator('input[type="checkbox"]').first();
    if (await checkbox.count()) {
      await checkbox.check({ force: true });
      checkedCount += 1;
    }
  }

  if (checkedCount === 0) return;

  await frame.getByRole("button", { name: "削除" }).click();
  await frame.page().waitForTimeout(500);
  await frame.locator(".dialog-btn.danger").click();

  await waitForCondition(
    async () => {
      const bodyText = await frame.locator("body").innerText();
      return !SAMPLE_PATTERNS.some((pattern) => bodyText.includes(pattern));
    },
    30000,
    "既存サンプルフォームを削除できませんでした",
  );
  await frame.page().waitForTimeout(1000);
}

async function ensureQuestionCards(frame) {
  const cards = frame.locator('[data-question-id][data-depth="0"]');
  if (await cards.count()) return cards;
  await frame.getByRole("button", { name: "質問を追加" }).click({ force: true });
  await frame.page().waitForTimeout(700);
  return cards;
}

async function buildManualForm(frame) {
  await navigateHash(frame, "#/forms/new", "フォーム新規作成");

  await frame.getByPlaceholder("フォーム名").fill(SAMPLE_FORM_TITLE);
  await frame.locator('textarea[placeholder="説明"]').fill(SAMPLE_FORM_DESCRIPTION);

  const cards = await ensureQuestionCards(frame);

  const q1 = cards.nth(0);
  await q1.getByPlaceholder("項目名を入力").fill("相談者名");
  await setCheckboxByLabel(q1, "必須", true);
  await setCheckboxByLabel(q1, "表示", true);
  await setCheckboxByLabel(q1, "スタイル設定", true);
  await setCheckboxByLabel(q1, "プレースホルダー", true);
  await q1.locator('input[placeholder="例: 入力例を表示"]').fill("例: 山田花子");
  await setRadioByLabel(q1, "ユーザー名");
  await setRadioByLabel(q1, "パターン指定（正規表現）");
  await q1.locator('input[placeholder="例: ^[0-9]+$"]').fill("^[^\\s].*$");

  await q1.getByRole("button", { name: "次の質問を追加" }).click({ force: true });
  await frame.page().waitForTimeout(700);

  const q2 = cards.nth(1);
  await q2.getByPlaceholder("項目名を入力").fill("受付番号");
  await q2.locator("select").first().selectOption("number");
  await frame.page().waitForTimeout(700);
  await setCheckboxByLabel(q2, "表示", true);
  await setCheckboxByLabel(q2, "整数のみ", true);
  const q2NumberInputs = q2.locator('input[type="number"]');
  await q2NumberInputs.nth(0).fill("1");
  await q2NumberInputs.nth(1).fill("999");

  await q2.getByRole("button", { name: "次の質問を追加" }).click({ force: true });
  await frame.page().waitForTimeout(700);

  const q3 = cards.nth(2);
  await q3.getByPlaceholder("項目名を入力").fill("連絡先電話番号");
  await q3.locator("select").first().selectOption("phone");
  await frame.page().waitForTimeout(700);
  await setCheckboxByLabel(q3, "表示", true);
  await setCheckboxByLabel(q3, "プレースホルダーを設定する", true);
  await setCheckboxByLabel(q3, "固定電話の市外局番省略を認める", true);

  await q3.getByRole("button", { name: "次の質問を追加" }).click({ force: true });
  await frame.page().waitForTimeout(700);

  const q4 = cards.nth(3);
  await q4.getByPlaceholder("項目名を入力").fill("相談方法");
  await q4.locator("select").first().selectOption("radio");
  await frame.page().waitForTimeout(700);
  await setCheckboxByLabel(q4, "表示", true);
  await q4.getByRole("button", { name: "選択肢を追加" }).click({ force: true });
  await q4.getByRole("button", { name: "選択肢を追加" }).click({ force: true });
  const q4Options = q4.getByPlaceholder("選択肢");
  await q4Options.nth(0).fill("電話");
  await q4Options.nth(1).fill("来庁");
  await q4Options.nth(2).fill("その他");
  await q4.getByRole("button", { name: "次の質問を追加" }).first().click({ force: true });
  await frame.page().waitForTimeout(700);

  const q5 = cards.nth(4);
  await q5.getByPlaceholder("項目名を入力").fill("受付日");
  await q5.locator("select").first().selectOption("date");
  await frame.page().waitForTimeout(700);
  await setCheckboxByLabel(q5, "表示", true);
  await setCheckboxByLabel(q5, "初期値を現在の日付にする", true);

  await q4.getByRole("button", { name: "子質問追加" }).nth(2).click({ force: true });
  await frame.page().waitForTimeout(700);
  const nestedInput = q4.locator('.nf-child input[placeholder="項目名を入力"]').first();
  await nestedInput.fill("相談方法（その他）");
  const nested = q4.locator(".nf-child [data-question-id]").first();
  await setCheckboxByLabel(nested, "必須", true);
}

async function createManualForm(frame) {
  await cleanupSampleForms(frame);
  await buildManualForm(frame);

  await frame.getByRole("button", { name: "保存" }).click();
  await waitForText(frame, "フォーム管理", 60000);

  const targetRow = frame.locator("tbody tr").filter({ hasText: SAMPLE_FORM_TITLE }).first();
  await targetRow.waitFor({ state: "visible", timeout: 60000 });
  const formId = (await targetRow.locator(".admin-form-id").innerText()).trim();
  return formId;
}

async function fillPreviewFields(frame, {
  name = "山田花子",
  number = "12",
  phone = "090-1234-5678",
  method = "その他",
  otherMethod = "オンライン相談",
} = {}) {
  const fields = frame.locator(".preview-field");

  await fields.filter({ hasText: "相談者名" }).locator('input[type="text"]').fill(name);
  await fields.filter({ hasText: "受付番号" }).locator('input[type="text"]').fill(number);
  await fields.filter({ hasText: "連絡先電話番号" }).locator('input[type="tel"]').fill(phone);
  await fields.filter({ hasText: "相談方法" }).locator("label").filter({ hasText: method }).locator('input[type="radio"]').check({ force: true });
  await frame.page().waitForTimeout(500);

  if (method === "その他") {
    await fields.filter({ hasText: "相談方法（その他）" }).locator('input[type="text"]').fill(otherMethod);
  }
}

async function ensureSearchRecord(frame, expectedText) {
  try {
    await waitForText(frame, expectedText, 15000);
  } catch {
    const refreshButton = frame.getByRole("button", { name: /更新/ });
    if (await refreshButton.count()) {
      await refreshButton.click({ force: true });
    }
    await waitForText(frame, expectedText, 60000);
  }
}

async function createSampleRecord(frame, formId) {
  await navigateHash(frame, `#/form/${formId}/new`, "フォーム入力", 60000);
  await waitForText(frame, "相談者名", 30000);
  await fillPreviewFields(frame);

  await frame.getByRole("button", { name: "保存" }).click();
  await waitForText(frame, "検索 - ", 60000);
  await ensureSearchRecord(frame, "山田花子");
}

async function getTopLevelCardByValue(frame, value) {
  const card = frame.locator('[data-question-id][data-depth="0"]').filter({
    has: frame.locator(`input[placeholder="項目名を入力"][value="${value}"]`),
  }).first();
  await card.waitFor({ state: "visible", timeout: 30000 });
  return card;
}

async function sanitizeMainPage(frame) {
  await frame.evaluate(({ title, description }) => {
    const cards = Array.from(document.querySelectorAll(".main-card"));
    cards.forEach((card, index) => {
      if (index > 0) card.remove();
    });
    const card = cards[0];
    if (!card) return;
    const titleEl = card.querySelector("h2");
    const descriptionEl = card.querySelector("p");
    const metaEl = card.querySelector(".main-meta");
    if (titleEl) titleEl.textContent = title;
    if (descriptionEl) descriptionEl.textContent = description;
    if (metaEl) metaEl.textContent = "最終更新: 2026/03/08 10:00:00.000";
  }, {
    title: DISPLAY_FORM_TITLE,
    description: "相談受付の流れを確認するためのサンプルフォームです。",
  });
}

async function sanitizeFormManagement(frame) {
  await frame.evaluate(({ title, description }) => {
    const rows = Array.from(document.querySelectorAll("tbody tr"));
    rows.forEach((row, index) => {
      if (index > 0) row.remove();
    });
    const row = rows[0];
    if (!row) return;
    const cells = row.querySelectorAll("td");
    if (cells[1]) {
      const blocks = cells[1].querySelectorAll("div");
      if (blocks[0]) blocks[0].textContent = title;
      if (blocks[1]) blocks[1].textContent = description;
    }
    if (cells[2]) {
      const formId = cells[2].querySelector(".admin-form-id");
      if (formId) formId.textContent = "f_sample_manual_001";
    }
    if (cells[3]) {
      cells[3].textContent = "2026/03/08 10:00:00.000";
    }
    if (cells[4]) {
      cells[4].textContent = "相談者名, 受付番号, 連絡先電話番号, 相談方法, 受付日";
    }
  }, {
    title: DISPLAY_FORM_TITLE,
    description: "相談受付の流れを確認するためのサンプルフォームです。",
  });
}

async function sanitizeSearchPage(frame) {
  await frame.evaluate(() => {
    const row = document.querySelector("tbody tr");
    if (!row) return;

    const cells = Array.from(row.querySelectorAll("td"));
    let timestampIndex = 0;

    cells.forEach((cell) => {
      const text = cell.textContent.trim();
      const idButton = cell.querySelector("button");
      if (idButton && /^r_/.test(idButton.textContent.trim())) {
        idButton.textContent = "r_sample_001";
        return;
      }
      if (/^\d{4}\/\d{2}\/\d{2}/.test(text)) {
        cell.textContent = timestampIndex === 0
          ? "2026/03/08 10:00:00"
          : "2026/03/08 10:05:00";
        timestampIndex += 1;
      }
    });
  });
}

async function sanitizeEditorHeader(frame) {
  await frame.evaluate(({ title, description }) => {
    const nameInput = document.querySelector('input[placeholder="フォーム名"]');
    const descriptionInput = document.querySelector('textarea[placeholder="説明"]');
    const inputs = Array.from(document.querySelectorAll("input"));
    const driveInput = inputs.find((input) => typeof input.placeholder === "string" && input.placeholder.includes("マイドライブルート"));
    const spreadsheetInput = inputs.find((input) => typeof input.value === "string" && input.value.includes("docs.google.com/spreadsheets"));
    const previewTitle = document.querySelector(".preview-title");
    const headerTitle = document.querySelector(".app-header-title");
    if (nameInput) nameInput.value = title;
    if (descriptionInput) descriptionInput.value = description;
    if (driveInput) driveInput.value = "https://drive.google.com/drive/folders/FOLDER_ID";
    if (spreadsheetInput) spreadsheetInput.value = "https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit";
    if (previewTitle) previewTitle.textContent = title;
    if (headerTitle) headerTitle.textContent = headerTitle.textContent.replace("【マニュアル】", "");
  }, {
    title: DISPLAY_FORM_TITLE,
    description: "相談受付の流れを確認するためのサンプルフォームです。",
  });
}

async function sanitizeStatusLine(frame) {
  await frame.evaluate(() => {
    const status = document.querySelector(".search-bar .nf-text-subtle");
    const headerTitle = document.querySelector(".app-header-title");
    if (status) {
      status.textContent = "最終更新: 2026/03/08 10:10:00";
    }
    if (headerTitle) {
      headerTitle.textContent = headerTitle.textContent.replace("【マニュアル】", "");
    }
  });
}

async function sanitizePreviewTitle(frame) {
  await frame.evaluate((title) => {
    const previewTitle = document.querySelector(".preview-title");
    if (previewTitle) {
      previewTitle.textContent = title;
    }
  }, DISPLAY_FORM_TITLE);
}

async function sanitizeRecordId(frame, value) {
  await frame.evaluate((recordId) => {
    const inputs = Array.from(document.querySelectorAll("input"));
    const responseIdInput = inputs.find((input) => typeof input.value === "string" && input.value.startsWith("r_"));
    if (responseIdInput) {
      responseIdInput.value = recordId;
    }
  }, value);
}

async function setupSampleData(context) {
  const { page, frame } = await openApp(context);

  try {
    const formId = await createManualForm(frame);
    await createSampleRecord(frame, formId);
    return formId;
  } finally {
    await page.close();
  }
}

async function captureMain(context) {
  const { page, frame, iframe } = await openApp(context);
  try {
    await waitForCount(frame.locator(".main-card"), 1, 60000);
    await sanitizeMainPage(frame);
    await saveScreenshot(iframe, "manual_01_main_page.png");
  } finally {
    await page.close();
  }
}

async function captureSettings(context) {
  const { page, frame, iframe } = await openApp(context);
  try {
    await navigateHash(frame, "#/config", "テーマ設定", 30000);
    await saveScreenshot(iframe, "manual_02_settings_page.png");
  } finally {
    await page.close();
  }
}

async function captureFormsAndImport(context) {
  const { page, frame, iframe } = await openApp(context);
  try {
    await navigateHash(frame, "#/forms", "フォーム管理", 30000);
    await waitForText(frame, SAMPLE_FORM_TITLE, 30000);
    await sanitizeFormManagement(frame);
    await saveScreenshot(iframe, "manual_04_form_management_page.png");

    await frame.getByRole("button", { name: "インポート", exact: true }).click();
    const importPanel = frame.locator(".admin-import-panel");
    await importPanel.waitFor({ state: "visible", timeout: 30000 });
    await frame.locator(".admin-import-input").fill("https://drive.google.com/file/d/FILE_ID/view");
    await saveScreenshot(importPanel, "manual_05_import_dialog.png");
  } finally {
    await page.close();
  }
}

async function captureEditorScreens(context, formId) {
  const { page, frame, iframe } = await openApp(context);
  try {
    await navigateHash(frame, `#/forms/${formId}/edit`, "フォーム修正", 60000);
    await waitForCount(frame.locator('[data-question-id][data-depth="0"]'), 5, 30000);

    await sanitizeEditorHeader(frame);
    await saveScreenshot(iframe, "manual_06_form_editor_page.png");

    const q1 = await getTopLevelCardByValue(frame, "相談者名");
    const q2 = await getTopLevelCardByValue(frame, "受付番号");
    const q3 = await getTopLevelCardByValue(frame, "連絡先電話番号");
    const q4 = await getTopLevelCardByValue(frame, "相談方法");

    await q1.scrollIntoViewIfNeeded();
    await saveScreenshot(q1, "manual_07_question_card_basic.png");

    await q2.scrollIntoViewIfNeeded();
    await saveScreenshot(q2, "manual_07b_question_card_number.png");

    await q3.scrollIntoViewIfNeeded();
    await saveScreenshot(q3, "manual_07c_question_card_phone.png");

    await q4.scrollIntoViewIfNeeded();
    await saveScreenshot(q4, "manual_09_question_card_nested.png");

    await frame.getByRole("button", { name: "プレビュー" }).click({ force: true });
    await waitForText(frame, "相談者名", 30000);
    await frame.page().waitForTimeout(1000);
    await fillPreviewFields(frame);
    await sanitizePreviewTitle(frame);
    await sanitizeRecordId(frame, "r_preview_001");
    await saveScreenshot(iframe, "manual_10_preview_page.png");
  } finally {
    await page.close();
  }
}

async function captureSearch(context, formId) {
  const { page, frame, iframe } = await openApp(context);
  try {
    await navigateHash(frame, `#/search?form=${formId}`, "検索 - ", 60000);
    await ensureSearchRecord(frame, "山田花子");
    await sanitizeStatusLine(frame);
    await sanitizeSearchPage(frame);
    await saveScreenshot(iframe, "manual_12_search_page.png");
  } finally {
    await page.close();
  }
}

async function captureFormInput(context, formId) {
  const { page, frame, iframe } = await openApp(context);
  try {
    await navigateHash(frame, `#/form/${formId}/new`, "フォーム入力", 60000);
    await waitForText(frame, "相談者名", 30000);
    await fillPreviewFields(frame, {
      name: "佐藤次郎",
      number: "34",
      phone: "03-1234-5678",
      method: "その他",
      otherMethod: "訪問相談",
    });
    await sanitizeStatusLine(frame);
    await sanitizePreviewTitle(frame);
    await sanitizeRecordId(frame, "r_sample_002");
    await saveScreenshot(iframe, "manual_13_form_input_page.png");
  } finally {
    await page.close();
  }
}

async function main() {
  await ensureDir(OUTPUT_DIR);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
  });

  try {
    const formId = await setupSampleData(context);
    await captureMain(context);
    await captureSettings(context);
    await captureFormsAndImport(context);
    await captureEditorScreens(context, formId);
    await captureSearch(context, formId);
    await captureFormInput(context, formId);
    const { page, frame } = await openApp(context);
    try {
      await cleanupSampleForms(frame);
    } finally {
      await page.close();
    }
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
