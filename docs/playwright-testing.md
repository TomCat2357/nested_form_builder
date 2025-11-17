# Playwright テストガイド

## 概要

このプロジェクトには、MCP Code Executionパターンに基づいた効率的なPlaywrightテストスクリプトが含まれています。

従来のE2Eテストとは異なり、**大量のDOM情報やスナップショットを出力せず、ページの要点のみを抽出**して表示します。

## 特徴

- ✅ **軽量な出力**: DOM全体ではなく、要素数や存在確認のみ
- ✅ **要約形式**: 件数、カウント、重要なテキストのみ表示
- ✅ **ロバスト**: データがない場合も適切にスキップ
- ✅ **高速**: 必要最小限の情報のみ取得

## 実行方法

```bash
# テスト実行
npm run test:playwright

# 手動実行
node scripts/test-playwright.js
```

## テスト項目

### 1. フォーム一覧ページ
- ページタイトル確認
- フォームカード数のカウント
- 管理画面ボタンの存在確認

### 2. 管理画面
- 操作ボタン数のカウント
- ボタン名の一覧表示
- フォーム一覧テーブルの行数

### 3. フォーム編集画面
- テキストボックス数のカウント
- フォーム名の確認
- プレビュー・編集ボタンの存在確認

### 4. プレビュー機能
- 回答ID生成確認
- 検索プレビューテーブルの表示確認

### 5. 検索機能
- 初期データ件数
- キーワード検索（"男性"）
- 比較演算子検索（"年齢>40"）
- 検索結果の件数変化

### 6. ネストフィールド動的表示
- 初期フィールド数
- ラジオ選択によるフィールド追加
- チェックボックス選択によるさらなる追加
- 動的に追加されたフィールド数

### 7. コンソールエラーチェック
- JavaScriptエラーの検出

## 出力例

```
🚀 Nested Form Builder - Playwright テスト開始
📍 URL: https://script.google.com/...

📋 テスト1: フォーム一覧ページ
  タイトル: フォーム一覧
  フォーム数: 1件
  ✅ 管理画面ボタン: 存在

🔧 テスト2: 管理画面
  タイトル: フォーム管理
  操作ボタン数: 6個
  ボタン: ← 戻る, 新規作成, インポート, エクスポート, アーカイブ, 削除
  フォーム一覧行数: 2行

✏️ テスト3: フォーム編集画面
  タイトル: フォーム修正
  テキストボックス数: 8個
  フォーム名: ヒグマは好きか
  ✅ プレビューボタン: 存在
  ✅ 編集ボタン: 存在

...

============================================================
📊 テストサマリー
============================================================
✅ 成功: 7/7
⏱️ 実行時間: 12.52秒
============================================================
```

## MCP Code Execution パターン

このテストスクリプトは、以下の原則に従っています：

### ❌ 避けるべき方法
```javascript
// 大量のDOM情報を返す
const snapshot = await page.content();
console.log(snapshot); // 数万文字のHTML
```

### ✅ 推奨される方法
```javascript
// 要点のみを抽出
const formCount = await frame.locator('main > div').count();
console.log(`フォーム数: ${formCount}件`); // コンパクトな情報
```

## カスタマイズ

### テストURLの変更

`scripts/test-playwright.js` の先頭部分を編集：

```javascript
const APP_URL = 'https://your-gas-webapp-url.../exec';
```

### タイムアウト調整

ページ読み込みが遅い場合：

```javascript
await page.waitForTimeout(3000); // ← この値を増やす
```

### 追加テスト

既存のテスト関数を参考に、新しいテスト関数を追加：

```javascript
async function testCustomFeature(page) {
  console.log('\n🎯 テスト8: カスタム機能');

  const frame = await getAppFrame(page);

  // 要素の存在確認（boolean）
  const hasButton = await frame.getByRole('button', { name: 'カスタム' }).count() > 0;
  console.log(`  カスタムボタン: ${hasButton ? '存在' : '不在'}`);

  // カウント情報
  const items = frame.locator('.custom-item');
  const count = await items.count();
  console.log(`  アイテム数: ${count}個`);

  return { success: true, count };
}
```

メイン実行部分に追加：

```javascript
results.tests.push({ name: 'カスタム機能', ...(await testCustomFeature(page)) });
```

## トラブルシューティング

### エラー: "Timeout 30000ms exceeded"

**原因**: 要素が見つからない、またはページ読み込みが遅い

**解決策**:
1. `await page.waitForTimeout()` の値を増やす
2. セレクタが正しいか確認
3. iframe構造が変更されていないか確認

### フォームが見つからない

**原因**: テスト環境にフォームデータが存在しない

**解決策**:
- 管理画面で少なくとも1つのフォームを作成
- テストは自動的にスキップするので、エラーにはならない

### ブラウザが起動しない

**原因**: Playwrightのブラウザがインストールされていない

**解決策**:
```bash
npx playwright install chromium
```

## ベストプラクティス

1. **要点のみ出力**: DOM全体ではなく、カウントや存在確認のみ
2. **スキップロジック**: データがない場合も成功として処理
3. **タイムアウト設定**: ページ遷移後は適切な待機時間を設定
4. **エラーハンドリング**: try-catchで全体をラップ済み
5. **サマリー出力**: 最後に全体の成功/失敗をまとめて表示

## 関連ドキュメント

- [MCP_CODE_EXECUTION.md](~/.claude/MCP_CODE_EXECUTION.md): コード実行パターンの詳細
- [Playwright公式ドキュメント](https://playwright.dev/)
- [CLAUDE.md](../CLAUDE.md): プロジェクト全体のガイダンス

## 今後の拡張

- [ ] スクリーンショット保存オプション（失敗時のみ）
- [ ] パフォーマンス計測（各画面の読み込み時間）
- [ ] API呼び出しのインターセプト
- [ ] 並列テスト実行
- [ ] CI/CD統合
