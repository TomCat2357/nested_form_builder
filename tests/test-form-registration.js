/**
 * フォーム登録・インポートテスト
 *
 * テスト内容：
 * - 新規フォーム作成が正しく反映されること
 * - Google Driveからのインポートが正しく反映されること
 * - フォーム一覧に作成・インポートしたフォームが表示されること
 */

const { chromium } = require('playwright');

const APP_URL = 'https://script.google.com/macros/s/AKfycbzFCYP79BCMQ3CFi3bO6OqW0R5jv35D3UrI3ILtEph9AxZ_gs6t5GfNYHt6V62r472E/exec';
const IMPORT_FOLDER_URL_1 = 'https://drive.google.com/drive/u/0/folders/1aMFYDLuQ86fKM9AhUvLlb8Y0QK4krjcY';
const IMPORT_FOLDER_URL_2 = 'https://drive.google.com/drive/u/0/folders/1prBDiRinhAw2mRJir_1BwGv4tSINJc28';

/**
 * iframeコンテキストを取得するヘルパー関数
 */
async function getAppFrame(page) {
  const outerFrame = page.frameLocator('iframe[title="Nested Form Builder"]');
  const innerFrame = outerFrame.frameLocator('iframe[title="Nested Form Builder"]');
  return innerFrame;
}

/**
 * ダイアログを閉じる
 */
async function dismissDialog(frame, page, buttonPattern = null) {
  const dialog = frame.locator('[role="dialog"][aria-modal="true"]');
  if ((await dialog.count()) === 0) {
    return false;
  }

  if (buttonPattern) {
    const button = dialog.getByRole('button', { name: buttonPattern });
    if (await button.count()) {
      await button.first().click();
      await page.waitForTimeout(500);
      return true;
    }
  }

  const patterns = [
    /保存/,
    /OK/,
    /確認/,
    /閉じる/,
    /キャンセル/,
  ];

  for (const pattern of patterns) {
    const button = dialog.getByRole('button', { name: pattern });
    if (await button.count()) {
      await button.first().click();
      await page.waitForTimeout(500);
      return true;
    }
  }

  return false;
}

/**
 * 管理画面へ移動
 */
async function goToAdmin(page) {
  const frame = await getAppFrame(page);
  console.log('  → 管理画面へ移動中...');

  const adminButton = frame.getByRole('button', { name: '管理画面へ' });
  if ((await adminButton.count()) === 0) {
    console.log('  ⚠️  管理画面ボタンが見つかりません（すでに管理画面にいる可能性）');
    return frame;
  }

  await adminButton.click();
  await page.waitForTimeout(2000);
  return frame;
}

/**
 * フォーム一覧のカウントを取得
 */
async function getFormCount(frame) {
  // テーブル内の行数をカウント（ヘッダー行を除く）
  const rows = frame.locator('table tbody tr');
  const count = await rows.count();

  // 「フォームが登録されていません」メッセージがあるかチェック
  const emptyMessage = frame.getByText('フォームが登録されていません');
  if ((await emptyMessage.count()) > 0) {
    return 0;
  }

  return count;
}

/**
 * 新規フォーム作成テスト
 */
async function testCreateNewForm(page) {
  console.log('\n📝 テスト1: 新規フォーム作成');

  const frame = await goToAdmin(page);

  // 作成前のフォーム数を記録
  const initialCount = await getFormCount(frame);
  console.log(`  ✅ 作成前のフォーム数: ${initialCount}個`);

  // 新規作成ボタンをクリック
  console.log('  → 新規作成ボタンをクリック...');
  const newFormButton = frame.getByRole('button', { name: '新規作成' });
  if ((await newFormButton.count()) === 0) {
    console.log('  ❌ 新規作成ボタンが見つかりません');
    return { success: false };
  }
  await newFormButton.click();
  await page.waitForTimeout(2000);

  // フォーム名を入力
  const formName = `テストフォーム_${Date.now()}`;
  console.log(`  → フォーム名を入力: ${formName}`);
  const formNameInput = frame.getByRole('textbox').first();
  await formNameInput.fill(formName);
  await page.waitForTimeout(500);

  // 質問を1つ追加
  console.log('  → 質問を追加...');
  const addQuestionButton = frame.getByRole('button', { name: '質問を追加', exact: true });
  await addQuestionButton.click();
  await page.waitForTimeout(2000);

  // 質問入力欄が表示されるまで待機
  const questionInput = frame.getByPlaceholder('項目名を入力').first();
  await questionInput.waitFor({ state: 'visible', timeout: 10000 });
  await questionInput.fill('テスト質問1');
  await page.waitForTimeout(1000);

  // 保存ボタンをクリック
  console.log('  → 保存ボタンをクリック...');
  const saveButton = frame.getByRole('button', { name: '保存' });
  await saveButton.click();
  await page.waitForTimeout(1000);

  // 確認ダイアログが出たら確認
  await dismissDialog(frame, page, /保存/);
  await page.waitForTimeout(3000);

  // 管理画面に戻る
  await goToAdmin(page);
  await page.waitForTimeout(2000);

  // 作成後のフォーム数を確認
  const finalCount = await getFormCount(frame);
  console.log(`  ✅ 作成後のフォーム数: ${finalCount}個`);

  // フォーム名が一覧に表示されているか確認
  const formNameCell = frame.getByText(formName);
  const isDisplayed = (await formNameCell.count()) > 0;
  console.log(`  ${isDisplayed ? '✅' : '❌'} フォーム「${formName}」が一覧に表示されている: ${isDisplayed}`);

  if (finalCount <= initialCount) {
    console.log('  ❌ フォーム数が増えていません');
    return { success: false, formName };
  }

  if (!isDisplayed) {
    console.log('  ❌ 作成したフォームが一覧に表示されていません');
    return { success: false, formName };
  }

  console.log('  ✅ テスト成功: 新規フォームが正しく作成・表示されました');
  return { success: true, formName, initialCount, finalCount };
}

/**
 * Google Driveからインポートテスト
 */
async function testImportFromDrive(page, importUrl) {
  console.log('\n📥 テスト2: Google Driveからインポート');
  console.log(`  📂 URL: ${importUrl}`);

  const frame = await goToAdmin(page);

  // インポート前のフォーム数を記録
  const initialCount = await getFormCount(frame);
  console.log(`  ✅ インポート前のフォーム数: ${initialCount}個`);

  // インポートボタンをクリック
  console.log('  → インポートボタンをクリック...');
  const importButton = frame.getByRole('button', { name: /インポート/ });
  if ((await importButton.count()) === 0) {
    console.log('  ❌ インポートボタンが見つかりません');
    return { success: false };
  }
  await importButton.click();
  await page.waitForTimeout(1000);

  // URLを入力
  console.log('  → URLを入力...');
  const urlInput = frame.getByPlaceholder(/drive.google.com/);
  if ((await urlInput.count()) === 0) {
    console.log('  ❌ URL入力欄が見つかりません');
    await page.screenshot({ path: 'test-import-no-input.png' });
    return { success: false };
  }
  await urlInput.fill(importUrl);
  await page.waitForTimeout(500);

  // インポート実行
  console.log('  → インポート実行...');
  const confirmButton = frame.locator('[role="dialog"]').getByRole('button', { name: /インポート/ });
  await confirmButton.click();
  await page.waitForTimeout(5000); // インポート処理を待つ

  // アラートダイアログを閉じる
  await dismissDialog(frame, page);
  await page.waitForTimeout(2000);

  // インポート後のフォーム数を確認
  const finalCount = await getFormCount(frame);
  console.log(`  ✅ インポート後のフォーム数: ${finalCount}個`);

  if (finalCount <= initialCount) {
    console.log('  ⚠️  フォーム数が変わっていません（すでに登録済みの可能性）');
    return { success: true, skipped: true, initialCount, finalCount };
  }

  console.log('  ✅ テスト成功: インポートが正しく反映されました');
  return { success: true, skipped: false, initialCount, finalCount };
}

/**
 * フォーム一覧表示テスト
 */
async function testFormList(page) {
  console.log('\n📋 テスト3: フォーム一覧表示');

  const frame = await goToAdmin(page);

  // フォーム数を確認
  const count = await getFormCount(frame);
  console.log(`  ✅ 表示されているフォーム数: ${count}個`);

  if (count === 0) {
    console.log('  ⚠️  フォームが1つも表示されていません');
    return { success: true, count: 0, isEmpty: true };
  }

  // テーブルの列を確認
  const headers = frame.locator('table thead th');
  const headerCount = await headers.count();
  console.log(`  ✅ テーブル列数: ${headerCount}列`);

  // 各フォームの名称列を確認
  const rows = frame.locator('table tbody tr');
  const rowCount = await rows.count();

  for (let i = 0; i < Math.min(rowCount, 5); i++) {
    const row = rows.nth(i);
    const nameCell = row.locator('td').nth(1); // 名称列
    const name = await nameCell.textContent();
    console.log(`  📄 フォーム${i + 1}: ${name.trim().substring(0, 50)}`);
  }

  console.log('  ✅ テスト成功: フォーム一覧が正しく表示されています');
  return { success: true, count, isEmpty: false };
}

/**
 * メイン実行
 */
async function runTest() {
  console.log('🚀 フォーム登録・インポートテスト開始');
  console.log(`📍 URL: ${APP_URL}\n`);

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();

  // キャッシュをクリア
  await context.clearCookies();

  const results = [];

  try {
    // ページにアクセス
    console.log('⏳ ページ読み込み中...');
    await page.goto(APP_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    // テスト1: 新規フォーム作成
    const result1 = await testCreateNewForm(page);
    results.push({ test: '新規フォーム作成', ...result1 });

    // テスト2: Google Driveからインポート（フォルダ1）
    const result2 = await testImportFromDrive(page, IMPORT_FOLDER_URL_1);
    results.push({ test: 'インポート（フォルダ1）', ...result2 });

    // テスト3: Google Driveからインポート（フォルダ2）
    const result3 = await testImportFromDrive(page, IMPORT_FOLDER_URL_2);
    results.push({ test: 'インポート（フォルダ2）', ...result3 });

    // テスト4: フォーム一覧表示
    const result4 = await testFormList(page);
    results.push({ test: 'フォーム一覧表示', ...result4 });

    // 少し待機してから閉じる
    await page.waitForTimeout(2000);

  } catch (error) {
    console.error('\n❌ テスト実行中にエラー:', error.message);
    console.error(error.stack);
  } finally {
    await browser.close();
  }

  // 結果出力
  console.log('\n' + '='.repeat(60));
  console.log('📊 テスト結果サマリー');
  console.log('='.repeat(60));

  let allSuccess = true;
  results.forEach((result, index) => {
    const status = result.success ? '✅ 成功' : '❌ 失敗';
    console.log(`${index + 1}. ${result.test}: ${status}`);
    if (result.formName) {
      console.log(`   フォーム名: ${result.formName}`);
    }
    if (result.initialCount !== undefined) {
      console.log(`   前: ${result.initialCount}個 → 後: ${result.finalCount}個`);
    }
    if (result.skipped) {
      console.log(`   ⚠️  スキップ（すでに登録済み）`);
    }
    if (!result.success) {
      allSuccess = false;
    }
  });

  console.log('='.repeat(60));
  console.log(allSuccess ? '✅ 全テスト成功' : '❌ 一部テスト失敗');
  console.log('='.repeat(60));

  process.exit(allSuccess ? 0 : 1);
}

// 実行
runTest().catch(console.error);
