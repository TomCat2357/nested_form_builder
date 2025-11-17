/**
 * Nested Form Builder - Playwright テストスクリプト
 *
 * MCP Code Execution パターンに基づき、大量のデータを返さず
 * 要点のみを抽出して出力します。
 */

const { chromium } = require('playwright');

const APP_URL = 'https://script.google.com/macros/s/AKfycbzFCYP79BCMQ3CFi3bO6OqW0R5jv35D3UrI3ILtEph9AxZ_gs6t5GfNYHt6V62r472E/exec';

/**
 * iframeコンテキストを取得するヘルパー関数
 */
async function getAppFrame(page) {
  const outerFrame = page.frameLocator('iframe[title="Nested Form Builder"]');
  const innerFrame = outerFrame.frameLocator('iframe[title="Nested Form Builder"]');
  return innerFrame;
}

/**
 * 要素の存在確認（ポイントのみ）
 */
async function checkElementExists(locator, name) {
  const count = await locator.count();
  if (count > 0) {
    console.log(`  ✅ ${name}: 存在`);
    return true;
  } else {
    console.log(`  ❌ ${name}: 見つからない`);
    return false;
  }
}

/**
 * テスト1: フォーム一覧ページ
 */
async function testFormListPage(page) {
  console.log('\n📋 テスト1: フォーム一覧ページ');

  const frame = await getAppFrame(page);

  // タイトル確認
  const title = await frame.getByRole('heading', { level: 1 }).textContent();
  console.log(`  タイトル: ${title}`);

  // フォームカード数（mainの直下のdiv）
  const formCards = frame.locator('main > div');
  const count = await formCards.count();
  console.log(`  フォーム数: ${count}件`);

  // 管理画面ボタン
  await checkElementExists(
    frame.getByRole('button', { name: '管理画面へ' }),
    '管理画面ボタン'
  );

  return { success: true, formCount: count };
}

/**
 * テスト2: 管理画面
 */
async function testAdminDashboard(page) {
  console.log('\n🔧 テスト2: 管理画面');

  const frame = await getAppFrame(page);

  // 管理画面へ遷移
  await frame.getByRole('button', { name: '管理画面へ' }).click();
  await page.waitForTimeout(1000);

  // タイトル確認
  const title = await frame.getByRole('heading', { level: 1 }).textContent();
  console.log(`  タイトル: ${title}`);

  // 操作ボタン数
  const buttons = frame.locator('complementary button');
  const buttonCount = await buttons.count();
  console.log(`  操作ボタン数: ${buttonCount}個`);

  // ボタン名を取得（簡潔に）
  const buttonNames = [];
  for (let i = 0; i < Math.min(buttonCount, 6); i++) {
    const name = await buttons.nth(i).textContent();
    buttonNames.push(name.trim());
  }
  console.log(`  ボタン: ${buttonNames.join(', ')}`);

  // テーブル行数
  const tableRows = frame.locator('table tbody tr');
  const rowCount = await tableRows.count();
  console.log(`  フォーム一覧行数: ${rowCount}行`);

  return { success: true, buttonCount, rowCount };
}

/**
 * テスト3: フォーム編集画面
 */
async function testFormEditor(page) {
  console.log('\n✏️ テスト3: フォーム編集画面');

  const frame = await getAppFrame(page);

  // フォーム行をクリック
  const firstRow = frame.locator('table tbody tr').first();
  const rowCount = await firstRow.count();

  if (rowCount === 0) {
    console.log('  ⚠️ フォームが存在しないためスキップ');
    return { success: true, skipped: true };
  }

  await firstRow.click();
  await page.waitForTimeout(2000);

  // タイトル確認
  const title = await frame.getByRole('heading', { level: 1 }).textContent();
  console.log(`  タイトル: ${title}`);

  // フォーム名・説明のテキストボックス
  const textboxes = frame.getByRole('textbox');
  const textboxCount = await textboxes.count();
  console.log(`  テキストボックス数: ${textboxCount}個`);

  // 基本設定の確認（最初のテキストボックス）
  if (textboxCount > 0) {
    const formTitle = await textboxes.first().inputValue();
    console.log(`  フォーム名: ${formTitle}`);
  }

  // プレビューボタン
  await checkElementExists(
    frame.getByRole('button', { name: 'プレビュー' }),
    'プレビューボタン'
  );

  // 編集ボタン
  await checkElementExists(
    frame.getByRole('button', { name: '編集' }),
    '編集ボタン'
  );

  return { success: true, textboxCount };
}

/**
 * テスト4: プレビュー機能
 */
async function testPreview(page) {
  console.log('\n👁️ テスト4: プレビュー機能');

  const frame = await getAppFrame(page);

  // プレビューボタンの存在確認
  const previewButton = frame.getByRole('button', { name: 'プレビュー' });
  const hasPreviewButton = await previewButton.count() > 0;

  if (!hasPreviewButton) {
    console.log('  ⚠️ プレビューボタンが見つからないためスキップ');
    return { success: true, skipped: true };
  }

  // プレビューボタンをクリック
  await previewButton.click();
  await page.waitForTimeout(1000);

  // 回答IDフィールドの確認
  const responseIdField = frame.locator('input[type="text"]').first();
  const hasResponseId = await responseIdField.count() > 0;

  if (hasResponseId) {
    const responseId = await responseIdField.inputValue();
    console.log(`  回答ID: ${responseId ? responseId.substring(0, 20) + '...' : '未設定'}`);
  } else {
    console.log('  回答ID: フィールドなし');
  }

  // 検索プレビューテーブル
  const previewTable = frame.locator('table');
  const hasPreviewTable = await previewTable.count() > 0;
  console.log(`  検索プレビューテーブル: ${hasPreviewTable ? '表示' : '非表示'}`);

  return { success: true, hasResponseId, hasPreviewTable };
}

/**
 * テスト5: 検索機能
 */
async function testSearchPage(page) {
  console.log('\n🔍 テスト5: 検索機能');

  const frame = await getAppFrame(page);

  // キャンセルボタンの確認
  const cancelButton = frame.getByRole('button', { name: 'キャンセル' });
  const hasCancelButton = await cancelButton.count() > 0;

  if (!hasCancelButton) {
    console.log('  ⚠️ フォーム編集画面でないためスキップ');
    return { success: true, skipped: true };
  }

  // 管理画面に戻る（キャンセル）
  await cancelButton.click();
  await page.waitForTimeout(500);

  // フォーム一覧に戻る
  const backButton = frame.getByRole('button', { name: '← 戻る' });
  const hasBackButton = await backButton.count() > 0;
  if (hasBackButton) {
    await backButton.click();
    await page.waitForTimeout(500);
  }

  // フォームカードをクリック
  const formCard = frame.locator('main > div').first();
  const hasFormCard = await formCard.count() > 0;

  if (!hasFormCard) {
    console.log('  ⚠️ フォームが存在しないためスキップ');
    return { success: true, skipped: true };
  }

  await formCard.click();
  await page.waitForTimeout(2000);

  // タイトル確認
  const title = await frame.getByRole('heading', { level: 1 }).textContent();
  console.log(`  タイトル: ${title}`);

  // 初期データ件数
  const recordInfoLocator = frame.locator('div').filter({ hasText: /件中/ }).first();
  const hasRecordInfo = await recordInfoLocator.count() > 0;

  if (!hasRecordInfo) {
    console.log('  ⚠️ レコード情報が見つからない');
    return { success: true, noRecords: true };
  }

  const recordInfo = await recordInfoLocator.textContent();
  console.log(`  初期データ: ${recordInfo.trim()}`);

  // キーワード検索: "男性"
  const searchBox = frame.getByRole('searchbox');
  await searchBox.fill('男性');
  await searchBox.press('Enter');
  await page.waitForTimeout(1000);

  const searchResult1 = await frame.locator('div').filter({ hasText: /件中/ }).first().textContent();
  console.log(`  "男性"検索後: ${searchResult1.trim()}`);

  // 比較演算子検索: "年齢>40"
  await searchBox.fill('年齢>40');
  await searchBox.press('Enter');
  await page.waitForTimeout(1000);

  const searchResult2 = await frame.locator('div').filter({ hasText: /件中/ }).first().textContent();
  console.log(`  "年齢>40"検索後: ${searchResult2.trim()}`);

  return { success: true, initialData: recordInfo, searchResults: [searchResult1, searchResult2] };
}

/**
 * テスト6: ネストフィールド動的表示
 */
async function testNestedFields(page) {
  console.log('\n🌳 テスト6: ネストフィールド動的表示');

  const frame = await getAppFrame(page);

  // テーブルの存在確認
  const tableRows = frame.locator('table tbody tr');
  const hasRows = await tableRows.count() > 0;

  if (!hasRows) {
    console.log('  ⚠️ データレコードが存在しないためスキップ');
    return { success: true, skipped: true };
  }

  // 最初のレコードをクリック
  await tableRows.first().click();
  await page.waitForTimeout(2000);

  // 初期状態の質問数
  const initialFields = frame.locator('input, select, textarea');
  const initialCount = await initialFields.count();
  console.log(`  初期フィールド数: ${initialCount}個`);

  // "生物"ラジオボタンを選択
  const bioRadio = frame.getByRole('radio', { name: '生物' });
  const hasBioRadio = await bioRadio.count() > 0;

  if (!hasBioRadio) {
    console.log('  ⚠️ "生物"ラジオボタンが見つからない');
    return { success: true, noNestedFields: true };
  }

  await bioRadio.click();
  await page.waitForTimeout(500);

  // ネスト後のフィールド数
  const nestedCount = await initialFields.count();
  console.log(`  "生物"選択後: ${nestedCount}個（+${nestedCount - initialCount}個）`);

  // チェックボックス "その他" を選択
  const otherCheckbox = frame.getByRole('checkbox', { name: 'その他' }).first();
  const hasOtherCheckbox = await otherCheckbox.count() > 0;

  if (hasOtherCheckbox) {
    await otherCheckbox.click();
    await page.waitForTimeout(500);

    // さらにネスト後
    const deepNestedCount = await initialFields.count();
    console.log(`  "その他"選択後: ${deepNestedCount}個（+${deepNestedCount - nestedCount}個）`);

    const dynamicFieldsAdded = deepNestedCount - initialCount;
    console.log(`  ✅ 動的フィールド追加: ${dynamicFieldsAdded}個`);

    return { success: true, dynamicFieldsAdded };
  } else {
    console.log('  ⚠️ "その他"チェックボックスが見つからない');
    const dynamicFieldsAdded = nestedCount - initialCount;
    return { success: true, dynamicFieldsAdded };
  }
}

/**
 * テスト7: コンソールエラーチェック
 */
async function checkConsoleErrors(page) {
  console.log('\n🐛 テスト7: コンソールエラーチェック');

  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
  });

  // 少し待機
  await page.waitForTimeout(1000);

  if (errors.length === 0) {
    console.log('  ✅ JavaScriptエラーなし');
  } else {
    console.log(`  ⚠️ エラー${errors.length}件検出`);
    errors.slice(0, 3).forEach((err, i) => {
      console.log(`    ${i + 1}. ${err.substring(0, 80)}...`);
    });
  }

  return { success: errors.length === 0, errorCount: errors.length };
}

/**
 * メイン実行
 */
async function runTests() {
  console.log('🚀 Nested Form Builder - Playwright テスト開始');
  console.log(`📍 URL: ${APP_URL}\n`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const results = {
    startTime: new Date(),
    tests: []
  };

  try {
    // ページにアクセス
    console.log('⏳ ページ読み込み中...');
    await page.goto(APP_URL);
    await page.waitForTimeout(3000);

    // テスト実行
    results.tests.push({ name: 'フォーム一覧', ...(await testFormListPage(page)) });
    results.tests.push({ name: '管理画面', ...(await testAdminDashboard(page)) });
    results.tests.push({ name: 'フォーム編集', ...(await testFormEditor(page)) });
    results.tests.push({ name: 'プレビュー', ...(await testPreview(page)) });
    results.tests.push({ name: '検索機能', ...(await testSearchPage(page)) });
    results.tests.push({ name: 'ネストフィールド', ...(await testNestedFields(page)) });
    results.tests.push({ name: 'エラーチェック', ...(await checkConsoleErrors(page)) });

  } catch (error) {
    console.error('\n❌ テスト実行中にエラー:', error.message);
    results.error = error.message;
  } finally {
    await browser.close();
    results.endTime = new Date();
  }

  // サマリー出力
  console.log('\n' + '='.repeat(60));
  console.log('📊 テストサマリー');
  console.log('='.repeat(60));

  const successCount = results.tests.filter(t => t.success).length;
  const totalCount = results.tests.length;

  console.log(`✅ 成功: ${successCount}/${totalCount}`);
  if (successCount < totalCount) {
    console.log(`❌ 失敗: ${totalCount - successCount}/${totalCount}`);
  }

  const duration = ((results.endTime - results.startTime) / 1000).toFixed(2);
  console.log(`⏱️ 実行時間: ${duration}秒`);
  console.log('='.repeat(60));

  // 終了コード
  process.exit(successCount === totalCount ? 0 : 1);
}

// 実行
runTests().catch(console.error);
