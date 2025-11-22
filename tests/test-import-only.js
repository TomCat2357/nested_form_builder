/**
 * インポート機能のみのテスト
 */

const { chromium } = require('playwright');

const APP_URL = 'https://script.google.com/macros/s/AKfycbzFCYP79BCMQ3CFi3bO6OqW0R5jv35D3UrI3ILtEph9AxZ_gs6t5GfNYHt6V62r472E/exec';
const IMPORT_FOLDER_URL = 'https://drive.google.com/drive/u/0/folders/1aMFYDLuQ86fKM9AhUvLlb8Y0QK4krjcY';

async function getAppFrame(page) {
  const outerFrame = page.frameLocator('iframe[title="Nested Form Builder"]');
  const innerFrame = outerFrame.frameLocator('iframe[title="Nested Form Builder"]');
  return innerFrame;
}

async function dismissDialog(frame, page) {
  await page.waitForTimeout(1000);
  const dialog = frame.locator('[role="dialog"][aria-modal="true"]');
  if ((await dialog.count()) === 0) {
    return false;
  }

  const okButton = dialog.getByRole('button', { name: /OK|閉じる|確認/ });
  if (await okButton.count()) {
    await okButton.first().click();
    await page.waitForTimeout(500);
    return true;
  }

  return false;
}

async function getFormCount(frame) {
  const rows = frame.locator('table tbody tr');
  const count = await rows.count();

  const emptyMessage = frame.getByText('フォームが登録されていません');
  if ((await emptyMessage.count()) > 0) {
    return 0;
  }

  return count;
}

async function runTest() {
  console.log('🚀 インポート機能テスト開始');
  console.log(`📍 URL: ${APP_URL}`);
  console.log(`📂 Import URL: ${IMPORT_FOLDER_URL}\n`);

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  // コンソールログを監視（すべて表示）
  page.on('console', msg => {
    const text = msg.text();
    console.log(`  🔍 Browser Console: ${text}`);
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
    }

    // インポート前のフォーム数を記録
    const initialCount = await getFormCount(frame);
    console.log(`  ✅ インポート前のフォーム数: ${initialCount}個\n`);

    // インポートボタンをクリック
    console.log('📥 インポートを開始...');
    const importButton = frame.getByRole('button', { name: /インポート/ }).first();
    if ((await importButton.count()) === 0) {
      console.log('  ❌ インポートボタンが見つかりません');
      await page.screenshot({ path: 'test-import-error.png' });
      return;
    }

    // ボタンの状態を確認
    const isDisabled = await importButton.isDisabled();
    const isVisible = await importButton.isVisible();
    console.log(`  ボタン状態: disabled=${isDisabled}, visible=${isVisible}`);

    if (isDisabled) {
      console.log('  ⚠️  インポートボタンが無効化されています（GAS環境ではない可能性）');
      await page.screenshot({ path: 'test-import-disabled.png' });
      return;
    }

    await importButton.click();
    await page.waitForTimeout(3000);

    // ダイアログが表示されるまで待機
    const dialog = frame.locator('[role="dialog"][aria-modal="true"]');
    const dialogCount = await dialog.count();
    console.log(`  ダイアログ数: ${dialogCount}`);

    if (dialogCount === 0) {
      console.log('  ❌ ダイアログが表示されませんでした');
      await page.screenshot({ path: 'test-import-no-dialog.png' });
      return;
    }

    await dialog.first().waitFor({ state: 'visible', timeout: 5000 });
    console.log('  ✅ インポートダイアログが表示されました');

    // URLを入力
    console.log('  → URLを入力...');
    const urlInput = frame.getByPlaceholder(/drive.google.com/);
    await urlInput.waitFor({ state: 'visible', timeout: 5000 });
    await urlInput.fill(IMPORT_FOLDER_URL);
    await page.waitForTimeout(1000);

    // スクリーンショット
    await page.screenshot({ path: 'test-import-before.png' });
    console.log('  📸 スクリーンショット: test-import-before.png');

    // インポート実行
    console.log('  → インポート実行...');
    const confirmButton = dialog.getByRole('button', { name: /インポート/ });
    await confirmButton.click();
    await page.waitForTimeout(8000); // インポート処理を待つ

    // アラートダイアログを閉じる
    console.log('  → アラートを確認...');
    await dismissDialog(frame, page);
    await page.waitForTimeout(2000);

    // インポート後のフォーム数を確認
    const finalCount = await getFormCount(frame);
    console.log(`\n✅ インポート後のフォーム数: ${finalCount}個`);

    // 結果の判定
    if (finalCount > initialCount) {
      console.log(`✅ インポート成功！ ${finalCount - initialCount}個のフォームが追加されました`);

      // フォーム一覧を表示
      console.log('\n📋 追加されたフォーム:');
      const rows = frame.locator('table tbody tr');
      for (let i = 0; i < Math.min(finalCount, 10); i++) {
        const row = rows.nth(i);
        const nameCell = row.locator('td').nth(1);
        const name = await nameCell.textContent();
        console.log(`  ${i + 1}. ${name.trim().substring(0, 60)}`);
      }
    } else if (finalCount === initialCount) {
      console.log('⚠️  フォーム数が変わりませんでした（すでに登録済みの可能性）');
    } else {
      console.log('❌ フォーム数が減少しました（予期しない動作）');
    }

    // 最終スクリーンショット
    await page.screenshot({ path: 'test-import-after.png' });
    console.log('\n📸 最終スクリーンショット: test-import-after.png');

    await page.waitForTimeout(2000);

  } catch (error) {
    console.error('\n❌ エラー:', error.message);
    console.error(error.stack);
    await page.screenshot({ path: 'test-import-error.png' });
  } finally {
    await browser.close();
  }

  console.log('\n✅ テスト完了');
}

runTest().catch(console.error);
