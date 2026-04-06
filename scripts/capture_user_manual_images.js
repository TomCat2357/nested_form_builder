const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const APP_URL =
  "https://script.google.com/macros/s/AKfycby9w6JdxWoCMp83a4THNyUBcopfDEsiDZAUbonTwf9eKsMd6IKYS3e3uq1ph2g5oYs4Qg/exec";

const OUT_DIR = path.resolve(__dirname, "..", "docs", "user_manual_images");
const VIEWPORT = { width: 1440, height: 2200 };

const FILES = {
  main: "manual_01_main_page.png",
  settings: "manual_02_settings_page.png",
  adminSettings: "manual_03_admin_settings_page.png",
  formManagement: "manual_04_form_management_page.png",
  importDialog: "manual_05_import_dialog.png",
  formEditor: "manual_06_form_editor_page.png",
  questionBasic: "manual_07_question_card_basic.png",
  questionChoices: "manual_08_question_card_choices.png",
  questionNested: "manual_09_question_card_nested.png",
  preview: "manual_10_preview_page.png",
  searchPreview: "manual_11_search_preview.png",
  search: "manual_12_search_page.png",
  formInput: "manual_13_form_input_page.png",
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForFrame(page) {
  for (let i = 0; i < 40; i += 1) {
    const frame = page.frame({ name: "userHtmlFrame" });
    if (frame) {
      await frame.waitForLoadState("domcontentloaded");
      return frame;
    }
    await sleep(250);
  }
  throw new Error("userHtmlFrame が見つかりません");
}

async function openApp(page) {
  await page.goto(APP_URL, { waitUntil: "networkidle", timeout: 60000 });

  const closeButton = page.getByLabel("閉じる");
  if (await closeButton.isVisible().catch(() => false)) {
    await closeButton.click();
    await sleep(500);
  }

  const frame = await waitForFrame(page);
  await sleep(1000);
  return frame;
}

async function screenshot(locator, filename) {
  await locator.screenshot({
    path: path.join(OUT_DIR, filename),
    animations: "disabled",
  });
}

async function setCheckboxByLabel(scope, labelText, checked) {
  const label = scope.locator("label").filter({ hasText: labelText }).first();
  const checkbox = label.locator('input[type="checkbox"]').first();
  const isChecked = await checkbox.isChecked();
  if (isChecked !== checked) {
    await checkbox.click({ force: true });
  }
}

async function sanitizeMainPage(frame) {
  await frame.evaluate(() => {
    document.querySelectorAll(".main-card").forEach((card, index) => {
      const title = card.querySelector("h2");
      const description = card.querySelector("p");
      const meta = card.querySelector(".main-meta");
      if (title) title.textContent = `サンプルフォーム ${index + 1}`;
      if (description) description.textContent = "フォームの説明がここに表示されます。";
      if (meta) meta.textContent = `最終更新: 2026/03/07 12:3${index}:00.000`;
    });
  });
}

async function sanitizeFormManagement(frame) {
  await frame.evaluate(() => {
    const rows = Array.from(document.querySelectorAll("tbody tr"));
    rows.forEach((row, index) => {
      const cells = row.querySelectorAll("td");
      if (cells[1]) {
        const blocks = cells[1].querySelectorAll("div");
        if (blocks[0]) blocks[0].textContent = `サンプルフォーム ${index + 1}`;
        if (blocks[1]) blocks[1].textContent = "フォーム管理用の説明文です。";
      }
      if (cells[2]) {
        const formId = cells[2].querySelector(".admin-form-id");
        if (formId) formId.textContent = `sample-form-${String(index + 1).padStart(2, "0")}`;
      }
      if (cells[3]) {
        cells[3].textContent = `2026/03/07 13:2${index}:00.000`;
      }
    });
  });
}

async function sanitizeSearchPage(frame) {
  await frame.evaluate(() => {
    const rows = Array.from(document.querySelectorAll("tbody tr"));
    rows.forEach((row, index) => {
      const cells = row.querySelectorAll("td");
      if (cells[1]) cells[1].textContent = `r_sample_${String(index + 1).padStart(3, "0")}`;
      if (cells[2]) cells[2].textContent = String(5 - index);
      if (cells[3]) cells[3].textContent = `2026/03/0${index + 1} 10:00:00`;
      if (cells[4]) cells[4].textContent = `2026/03/0${index + 1} 10:05:00`;
    });
  });
}

async function sanitizeFormInput(frame) {
  await frame.evaluate(() => {
    const responseIdInput = Array.from(document.querySelectorAll("input")).find((input) =>
      typeof input.value === "string" && input.value.startsWith("r_"),
    );
    if (responseIdInput) {
      responseIdInput.value = "r_sample_001";
    }
  });
}

async function openFormManagement(page) {
  const frame = await openApp(page);
  await frame.getByRole("button", { name: "フォーム管理" }).click({ force: true });
  await sleep(1500);
  return frame;
}

async function openNewFormEditor(page) {
  const frame = await openFormManagement(page);
  await frame.getByRole("button", { name: "新規作成" }).click({ force: true });
  await sleep(2000);
  return frame;
}

async function buildExampleEditor(frame) {
  await frame.locator('input[placeholder="フォーム名"]').first().fill("相談受付フォーム（例）");
  await frame.locator('textarea[placeholder="説明"]').fill("市民からの相談内容を受け付けるサンプルフォームです。");

  await frame.getByRole("button", { name: "質問を追加" }).click({ force: true });
  await sleep(500);

  const q1 = frame.locator("[data-question-id]").nth(0);
  await q1.locator('input[placeholder="項目名を入力"]').fill("相談者名");
  await setCheckboxByLabel(q1, "必須", true);
  await setCheckboxByLabel(q1, "表示", true);
  await setCheckboxByLabel(q1, "プレースホルダー", true);
  await q1.locator('input[placeholder="例: 入力例を表示"]').fill("例: 山田花子");

  await q1.getByRole("button", { name: "次の質問を追加" }).click({ force: true });
  await sleep(500);

  const q2 = frame.locator("[data-question-id]").nth(1);
  await q2.locator('input[placeholder="項目名を入力"]').fill("性別");
  await q2.locator("select").selectOption("radio");
  await sleep(500);
  await setCheckboxByLabel(q2, "表示", true);
  await q2.getByRole("button", { name: "選択肢を追加" }).click({ force: true });
  await q2.getByRole("button", { name: "選択肢を追加" }).click({ force: true });
  const q2Options = q2.locator('input[placeholder="選択肢"]');
  await q2Options.nth(0).fill("男性");
  await q2Options.nth(1).fill("女性");
  await q2Options.nth(2).fill("回答しない");

  await q2.getByRole("button", { name: "次の質問を追加" }).click({ force: true });
  await sleep(500);

  const q3 = frame.locator("[data-question-id]").nth(2);
  await q3.locator('input[placeholder="項目名を入力"]').fill("相談日");
  await q3.locator("select").selectOption("date");
  await sleep(500);
  await setCheckboxByLabel(q3, "表示", true);
  await setCheckboxByLabel(q3, "初期値を現在の日付にする", true);

  await q3.getByRole("button", { name: "次の質問を追加" }).click({ force: true });
  await sleep(500);

  const q4 = frame.locator("[data-question-id]").nth(3);
  await q4.locator('input[placeholder="項目名を入力"]').fill("相談方法");
  await q4.locator("select").selectOption("radio");
  await sleep(500);
  await setCheckboxByLabel(q4, "表示", true);
  await q4.getByRole("button", { name: "選択肢を追加" }).click({ force: true });
  await q4.getByRole("button", { name: "選択肢を追加" }).click({ force: true });
  const q4Options = q4.locator('input[placeholder="選択肢"]');
  await q4Options.nth(0).fill("電話");
  await q4Options.nth(1).fill("来庁");
  await q4Options.nth(2).fill("その他");
  await q4.getByRole("button", { name: "子質問追加" }).nth(2).click({ force: true });
  await sleep(500);

  const nestedQuestion = q4.locator("[data-question-id]").first();
  await nestedQuestion.locator('input[placeholder="項目名を入力"]').fill("相談方法（その他）");
  await setCheckboxByLabel(nestedQuestion, "必須", true);

  return { q1, q2, q4 };
}

async function fillPreviewExample(frame) {
  await frame.getByRole("button", { name: "プレビュー" }).click({ force: true });
  await sleep(1000);

  const nameField = frame.locator(".preview-field").filter({ hasText: "相談者名" }).first();
  await nameField.locator('input[type="text"]').fill("山田花子");

  const genderField = frame.locator(".preview-field").filter({ hasText: "性別" }).first();
  await genderField.locator("label").filter({ hasText: "女性" }).locator('input[type="radio"]').check({ force: true });

  const methodField = frame.locator(".preview-field").filter({ hasText: "相談方法" }).first();
  await methodField.locator("label").filter({ hasText: "その他" }).locator('input[type="radio"]').check({ force: true });
  await sleep(500);

  const otherMethodField = frame.locator(".preview-field").filter({ hasText: "相談方法（その他）" }).first();
  await otherMethodField.locator('input[type="text"]').fill("オンライン相談");
}

async function captureImages() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: VIEWPORT });

  try {
    let frame = await openApp(page);
    await sanitizeMainPage(frame);
    await screenshot(frame.locator("body"), FILES.main);

    frame = await openApp(page);
    await frame.getByRole("button", { name: "設定", exact: true }).click({ force: true });
    await sleep(1500);
    await screenshot(frame.locator("body"), FILES.settings);

    frame = await openApp(page);
    await frame.getByRole("button", { name: "管理者設定", exact: true }).click({ force: true });
    await sleep(1500);
    await screenshot(frame.locator("body"), FILES.adminSettings);

    frame = await openFormManagement(page);
    await sanitizeFormManagement(frame);
    await screenshot(frame.locator("body"), FILES.formManagement);

    frame = await openFormManagement(page);
    await frame.getByRole("button", { name: "インポート" }).click({ force: true });
    await sleep(500);
    await frame.locator(".admin-import-input").fill("https://drive.google.com/file/d/FILE_ID/view");
    await screenshot(frame.locator(".admin-import-panel"), FILES.importDialog);

    frame = await openNewFormEditor(page);
    await frame.locator('input[placeholder="フォーム名"]').first().fill("相談受付フォーム（例）");
    await frame.locator('textarea[placeholder="説明"]').fill("市民からの相談内容を受け付けるサンプルフォームです。");
    await screenshot(frame.locator("body"), FILES.formEditor);

    frame = await openNewFormEditor(page);
    const { q1, q2, q4 } = await buildExampleEditor(frame);
    await screenshot(q1, FILES.questionBasic);
    await screenshot(q2, FILES.questionChoices);
    await screenshot(q4, FILES.questionNested);

    await fillPreviewExample(frame);
    await screenshot(frame.locator("body"), FILES.preview);
    await frame.locator(".search-preview-table").scrollIntoViewIfNeeded();
    await screenshot(frame.locator(".search-preview-table"), FILES.searchPreview);

    frame = await openApp(page);
    await frame.locator(".main-card").nth(1).click({ force: true });
    await sleep(4000);
    await sanitizeSearchPage(frame);
    await screenshot(frame.locator("body"), FILES.search);

    await frame.getByRole("button", { name: "新規入力" }).click({ force: true });
    await sleep(2000);
    await sanitizeFormInput(frame);
    await screenshot(frame.locator("body"), FILES.formInput);
  } finally {
    await browser.close();
  }
}

captureImages()
  .then(() => {
    console.log("user manual images captured");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
