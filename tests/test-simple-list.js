/**
 * シンプルなフォーム一覧テスト
 */

const { chromium } = require('playwright');

const APP_URL = 'https://script.google.com/macros/s/AKfycbzFCYP79BCMQ3CFi3bO6OqW0R5jv35D3UrI3ILtEph9AxZ_gs6t5GfNYHt6V62r472E/exec';

async function getAppFrame(page) {
  const outerFrame = page.frameLocator('iframe[title="Nested Form Builder"]');
  const innerFrame = outerFrame.frameLocator('iframe[title="Nested Form Builder"]');
  return innerFrame;
}

async function runTest() {
  console.log('🚀 シンプルなフォーム一覧テスト開始');
  console.log(`📍 URL: ${APP_URL}\n`);

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  // コンソールログを監視
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('[dataStore]') || text.includes('[AppDataProvider]')) {
      console.log(`  🔍 Browser Console: ${text}`);
    }
  });

  try {
    console.log('⏳ ページ読み込み中...');
    await page.goto(APP_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    const frame = await getAppFrame(page);

    // 管理画面へ移動
    console.log('\n📋 管理画面へ移動...');
    const adminButton = frame.getByRole('button', { name: '管理画面へ' });
    if ((await adminButton.count()) > 0) {
      await adminButton.click();
      await page.waitForTimeout(3000);
    } else {
      console.log('  ⚠️  管理画面ボタンが見つかりません（すでに管理画面にいる可能性）');
    }

    // ページタイトルを確認
    const title = frame.locator('h1, h2').first();
    if ((await title.count()) > 0) {
      const titleText = await title.textContent();
      console.log(`  📄 ページタイトル: ${titleText}`);
    }

    // フォーム一覧のテーブルを確認
    console.log('\n📊 フォーム一覧を確認...');
    const table = frame.locator('table');
    const tableExists = (await table.count()) > 0;
    console.log(`  ${tableExists ? '✅' : '❌'} テーブルが存在: ${tableExists}`);

    if (tableExists) {
      // 行数をカウント
      const rows = frame.locator('table tbody tr');
      const count = await rows.count();
      console.log(`  📋 行数: ${count}個`);

      // 空メッセージの確認
      const emptyMessage = frame.getByText('フォームが登録されていません');
      const isEmpty = (await emptyMessage.count()) > 0;
      console.log(`  ${isEmpty ? '⚠️' : '✅'} 空メッセージ: ${isEmpty}`);

      if (!isEmpty && count > 0) {
        console.log('\n  📄 表示されているフォーム:');
        for (let i = 0; i < Math.min(count, 5); i++) {
          const row = rows.nth(i);
          const cells = row.locator('td');
          const cellCount = await cells.count();

          if (cellCount > 1) {
            const nameCell = cells.nth(1);
            const name = await nameCell.textContent();
            console.log(`    ${i + 1}. ${name.trim().substring(0, 60)}`);
          }
        }
      }
    }

    // スクリーンショット撮影
    await page.screenshot({ path: 'test-form-list.png', fullPage: true });
    console.log('\n  📸 スクリーンショット保存: test-form-list.png');

    await page.waitForTimeout(2000);

  } catch (error) {
    console.error('\n❌ エラー:', error.message);
    await page.screenshot({ path: 'test-error.png', fullPage: true });
  } finally {
    await browser.close();
  }

  console.log('\n✅ テスト完了');
}

runTest().catch(console.error);
