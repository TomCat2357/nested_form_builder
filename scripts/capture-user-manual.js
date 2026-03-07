const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require("playwright");

const APP_URL = "https://script.google.com/macros/s/AKfycbzEzpdLK7i8Qic0RxycSGuzYbBpoFDd3KSbwDmU1vaUPU0K_fYv0aUL-rYCB1yyLk5yAg/exec";
const OUTPUT_DIR = path.resolve(__dirname, "..", "docs", "user_manual_images");

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function waitForFrame(page) {
  for (let i = 0; i < 90; i += 1) {
    const frame = page.frames().find((current) => current.name() === "userHtmlFrame");
    if (frame) return frame;
    await page.waitForTimeout(1000);
  }
  throw new Error("userHtmlFrame が見つかりません");
}

async function openApp(context) {
  const page = await context.newPage();
  await page.goto(APP_URL, { waitUntil: "domcontentloaded", timeout: 120000 });
  const frame = await waitForFrame(page);
  const iframe = page.locator("#sandboxFrame");
  await iframe.waitFor({ state: "visible", timeout: 120000 });
  await page.waitForTimeout(3000);
  return { page, frame, iframe };
}

async function waitForText(frame, expectedText, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const text = await frame.locator("body").innerText();
    if (text.includes(expectedText)) return text;
    await frame.page().waitForTimeout(500);
  }
  throw new Error(`指定テキストを確認できませんでした: ${expectedText}`);
}

async function waitUntilSettled(frame, timeoutMs = 30000) {
  const pendingMarkers = ["読み込み中", "読み取り中", "同期中", "更新中"];
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const text = await frame.locator("body").innerText();
    if (!pendingMarkers.some((marker) => text.includes(marker))) return text;
    await frame.page().waitForTimeout(1000);
  }
  return frame.locator("body").innerText();
}

async function waitForLocatorCount(locator, minimumCount, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const count = await locator.count();
    if (count >= minimumCount) return count;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`要素数が足りません: expected >= ${minimumCount}`);
}

async function saveScreenshot(locator, fileName) {
  const filePath = path.join(OUTPUT_DIR, fileName);
  await locator.screenshot({ path: filePath });
  console.log(`saved ${fileName}`);
}

async function captureMain(context) {
  const { page, frame, iframe } = await openApp(context);
  await waitForText(frame, "フォーム一覧");
  await waitForLocatorCount(frame.locator(".main-card"), 1);
  await waitUntilSettled(frame);
  await saveScreenshot(iframe, "manual_01_main_page.png");
  await page.close();
}

async function captureSettings(context) {
  const { page, frame, iframe } = await openApp(context);
  await frame.getByRole("button", { name: "設定" }).click();
  await waitForText(frame, "テーマ設定");
  await saveScreenshot(iframe, "manual_02_settings_page.png");
  await page.close();
}

async function captureFormsAndImport(context) {
  const { page, frame, iframe } = await openApp(context);
  await frame.getByRole("button", { name: "フォーム管理" }).click();
  await waitForText(frame, "フォーム管理");
  await saveScreenshot(iframe, "manual_04_form_management_page.png");

  await frame.getByRole("button", { name: "インポート", exact: true }).click();
  const importPanel = frame.locator(".admin-import-panel");
  await importPanel.waitFor({ state: "visible", timeout: 30000 });
  await saveScreenshot(importPanel, "manual_05_import_dialog.png");
  await page.close();
}

async function ensureQuestionCards(frame) {
  const cards = frame.locator("[data-question-id]");
  if (await cards.count()) return cards;
  await frame.getByRole("button", { name: "質問を追加" }).click();
  await frame.page().waitForTimeout(500);
  return cards;
}

async function captureEditorScreens(context) {
  const { page, frame, iframe } = await openApp(context);
  await frame.getByRole("button", { name: "フォーム管理" }).click();
  await waitForText(frame, "フォーム管理");
  await frame.getByRole("button", { name: "新規作成" }).click();
  await waitForText(frame, "フォーム新規作成");
  await saveScreenshot(iframe, "manual_06_form_editor_page.png");

  const cards = await ensureQuestionCards(frame);
  const firstCard = cards.first();
  await firstCard.scrollIntoViewIfNeeded();
  await firstCard.getByPlaceholder("項目名を入力").fill("相談者名");
  await saveScreenshot(firstCard, "manual_07_question_card_basic.png");

  await firstCard.getByRole("button", { name: "次の質問を追加" }).click();
  await frame.page().waitForTimeout(700);

  const secondCard = cards.nth(1);
  await secondCard.scrollIntoViewIfNeeded();
  await secondCard.getByPlaceholder("項目名を入力").fill("相談方法");
  await secondCard.locator("select").first().selectOption("radio");
  await frame.page().waitForTimeout(700);

  const optionInputs = secondCard.getByPlaceholder("選択肢");
  await optionInputs.first().fill("電話");
  await secondCard.getByRole("button", { name: "選択肢を追加" }).click();
  await frame.page().waitForTimeout(400);
  await optionInputs.nth(1).fill("その他");
  await secondCard.getByRole("button", { name: "子質問追加" }).nth(1).click();
  await frame.page().waitForTimeout(700);

  const labelInputs = secondCard.getByPlaceholder("項目名を入力");
  await labelInputs.nth(1).fill("相談方法（その他）");
  await saveScreenshot(secondCard, "manual_09_question_card_nested.png");

  await frame.getByRole("button", { name: "プレビュー" }).click();
  await waitForText(frame, "相談者名");
  await frame.page().waitForTimeout(1000);
  await saveScreenshot(iframe, "manual_10_preview_page.png");

  await page.close();
}

async function findSearchTargetCard(frame) {
  const cards = frame.locator(".main-card");
  const count = await cards.count();
  for (let i = 0; i < count; i += 1) {
    const card = cards.nth(i);
    const text = await card.innerText();
    if (text.includes("新規フォーム")) return card;
  }
  if (count === 0) {
    throw new Error("検索画面へ進めるフォームカードがありません");
  }
  return cards.first();
}

async function captureSearchAndInput(context) {
  const { page, frame, iframe } = await openApp(context);
  const targetCard = await findSearchTargetCard(frame);
  await targetCard.click();
  await waitForText(frame, "検索 - ");
  await page.waitForTimeout(8000);
  await waitUntilSettled(frame);
  await saveScreenshot(iframe, "manual_12_search_page.png");

  await frame.getByRole("button", { name: "新規入力" }).click();
  await waitForText(frame, "フォーム入力");
  await page.waitForTimeout(6000);
  await waitUntilSettled(frame);
  await saveScreenshot(iframe, "manual_13_form_input_page.png");

  await page.close();
}

async function main() {
  await ensureDir(OUTPUT_DIR);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1400 },
    deviceScaleFactor: 1,
  });

  try {
    await captureMain(context);
    await captureSettings(context);
    await captureFormsAndImport(context);
    await captureEditorScreens(context);
    await captureSearchAndInput(context);
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
