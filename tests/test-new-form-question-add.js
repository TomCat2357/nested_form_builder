/**
 * 新規フォーム作成時の質問追加テスト
 *
 * 修正内容の確認：
 * - 新規フォーム作成時にフォーム名を入力しても質問がリセットされないこと
 * - 質問を複数追加できること
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
 * ダイアログを閉じる
 */
async function dismissBlockingDialog(frame, page) {
  const dialog = frame.locator('[role="dialog"][aria-modal="true"]');
  if ((await dialog.count()) === 0) {
    return false;
  }

  const patterns = [
    /保存せずに戻る/,
    /保存して続行/,
    /保存しない/,
    /破棄/,
    /OK/,
    /キャンセル/,
    /閉じる/,
  ];

  for (const pattern of patterns) {
    const button = dialog.getByRole('button', { name: pattern });
    if (await button.count()) {
      await button.first().click();
      await page.waitForTimeout(500);
      return true;
    }
  }

  const fallback = dialog.locator('button').first();
  if (await fallback.count()) {
    await fallback.click();
    await page.waitForTimeout(500);
    return true;
  }

  return false;
}

/**
 * 新規フォーム作成時の質問追加テスト
 */
async function testNewFormQuestionAdd(page) {
  console.log('\n📝 テスト: 新規フォーム作成時の質問追加');

  const frame = await getAppFrame(page);

  // 管理画面へ移動
  console.log('  → 管理画面へ移動中...');
  await frame.getByRole('button', { name: '管理画面へ' }).click();
  await page.waitForTimeout(1500);

  // 新規作成ボタンをクリック
  console.log('  → 新規作成ボタンをクリック...');
  const newFormButton = frame.getByRole('button', { name: '新規作成' });
  if ((await newFormButton.count()) === 0) {
    console.log('  ❌ 新規作成ボタンが見つかりません');
    return { success: false };
  }
  await newFormButton.click();
  await page.waitForTimeout(2000);

  // フォーム名を入力（これでnameが変わる）
  console.log('  → フォーム名を入力...');
  const formNameInput = frame.getByRole('textbox').first();
  await formNameInput.fill('テストフォーム1');
  await page.waitForTimeout(500);

  // 質問を追加（1個目）
  console.log('  → 1個目の質問を追加...');
  const addQuestionButton = frame.getByRole('button', { name: '質問を追加', exact: true });
  if ((await addQuestionButton.count()) === 0) {
    console.log('  ❌ 質問を追加ボタンが見つかりません');
    await page.screenshot({ path: 'test-error-no-button.png' });
    return { success: false };
  }
  await addQuestionButton.click();
  await page.waitForTimeout(2000);

  // 質問カードが存在することを確認（項目名入力欄で判定）
  const questionInputs = frame.getByPlaceholder('項目名を入力');
  const questionCount1 = await questionInputs.count();
  console.log(`  ✅ 質問カード数: ${questionCount1}個`);

  if (questionCount1 === 0) {
    console.log('  ❌ 質問カードが表示されていません（リセットされた可能性）');
    await page.screenshot({ path: 'test-error-no-question-card.png' });
    return { success: false };
  }

  // 1個目の質問に項目名を入力
  console.log('  → 1個目の質問に項目名を入力...');
  const questionInput1 = frame.getByPlaceholder('項目名を入力').first();
  await questionInput1.fill('質問1');
  await page.waitForTimeout(500);

  // フォーム名を変更（これでnameがさらに変わる）
  console.log('  → フォーム名を変更...');
  await formNameInput.fill('テストフォーム2');
  await page.waitForTimeout(500);

  // 質問がまだ存在することを確認
  const questionCount2 = await questionInputs.count();
  console.log(`  ✅ フォーム名変更後の質問カード数: ${questionCount2}個`);

  if (questionCount2 === 0) {
    console.log('  ❌ フォーム名変更後に質問がリセットされました');
    return { success: false };
  }

  // 質問を追加（2個目）
  console.log('  → 2個目の質問を追加...');
  await addQuestionButton.click();
  await page.waitForTimeout(1000);

  // 質問カードが2個になったことを確認
  const questionCount3 = await questionInputs.count();
  console.log(`  ✅ 最終的な質問カード数: ${questionCount3}個`);

  if (questionCount3 < 2) {
    console.log('  ❌ 2個目の質問が追加されませんでした');
    return { success: false };
  }

  // 2個目の質問に項目名を入力
  console.log('  → 2個目の質問に項目名を入力...');
  const questionInput2 = frame.getByPlaceholder('項目名を入力').nth(1);
  await questionInput2.fill('質問2');
  await page.waitForTimeout(500);

  // もう一度フォーム名を変更して質問が残るか確認
  console.log('  → もう一度フォーム名を変更...');
  await formNameInput.fill('テストフォーム3');
  await page.waitForTimeout(500);

  const questionCount4 = await questionInputs.count();
  console.log(`  ✅ 再度フォーム名変更後の質問カード数: ${questionCount4}個`);

  if (questionCount4 < 2) {
    console.log('  ❌ 質問がリセットされました');
    return { success: false };
  }

  console.log('  ✅ テスト成功: 新規フォーム作成時に質問がリセットされない');

  // キャンセルして戻る
  console.log('  → キャンセルして戻る...');
  const cancelButton = frame.getByRole('button', { name: 'キャンセル' });
  if ((await cancelButton.count()) > 0) {
    await cancelButton.click();
    await page.waitForTimeout(500);
    await dismissBlockingDialog(frame, page);
  }

  return { success: true, finalQuestionCount: questionCount4 };
}

/**
 * メイン実行
 */
async function runTest() {
  console.log('🚀 新規フォーム作成時の質問追加テスト開始');
  console.log(`📍 URL: ${APP_URL}\n`);

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    // ブラウザキャッシュを無効化
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();

  // キャッシュをクリア
  await context.clearCookies();

  let result = { success: false };
  const consoleLogs = [];

  // コンソールログを監視
  page.on('console', msg => {
    const text = msg.text();
    consoleLogs.push(text);
    if (text.includes('[FormBuilderWorkspace]') || text.includes('[AdminFormEditorPage]') || text.includes('dirty')) {
      console.log(`  🔍 Browser Console: ${text}`);
    }
  });

  try {
    // ページにアクセス（キャッシュを無視）
    console.log('⏳ ページ読み込み中...');
    await page.goto(APP_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    // テスト実行
    result = await testNewFormQuestionAdd(page);

    // 少し待機してから閉じる
    await page.waitForTimeout(2000);

  } catch (error) {
    console.error('\n❌ テスト実行中にエラー:', error.message);
    result = { success: false, error: error.message };
  } finally {
    await browser.close();
  }

  // 結果出力
  console.log('\n' + '='.repeat(60));
  console.log('📊 テスト結果');
  console.log('='.repeat(60));
  console.log(result.success ? '✅ 成功' : '❌ 失敗');
  if (result.finalQuestionCount) {
    console.log(`📋 最終質問数: ${result.finalQuestionCount}個`);
  }
  console.log('='.repeat(60));

  process.exit(result.success ? 0 : 1);
}

// 実行
runTest().catch(console.error);
