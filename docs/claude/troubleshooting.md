# トラブルシューティング（Claude 向け）

CLAUDE.md から分離した、ハマりどころ一覧とデプロイ情報の確認手順。不具合対応時に参照する。

## デプロイ後にアクセスできない

1. GAS 管理画面でデプロイ設定を確認
2. 「アクセスできるユーザー」を **「全員」** に設定
3. ブラウザのキャッシュをクリア

## データが保存されない

1. `settings.spreadsheetId` が正しく設定されているか確認
2. GAS スクリプトがそのスプレッドシートへの書き込み権限を持っているか確認
3. Apps Script 実行ログ（https://script.google.com）でエラーを確認

## PropertyStore モード関連

1. `deploy.ps1 -PropertyStore script|user` で正しいモードを指定しているか確認
2. `script` モード — 管理者キーが設定されているか確認（AdminSettingsPage）
3. `user` モード — 各ユーザーの PropertiesService に権限があるか確認

`__NFB_PROPERTY_STORE_MODE__` プレースホルダは `deploy.ps1` 実行時に `Bundle.gs` 内で置換される。

## ビルドエラー

```bash
# 依存関係を再インストール
rm -rf builder/node_modules
npm run builder:install
```

## clasp エラー

```bash
# 再ログイン
npm run clasp:login
```

`.clasp.json` は **gitignore 対象** のためローカル作成が必要。`rootDir: "dist"` を指定すること。

```bash
# 現在の Script ID を確認
cat .clasp.json | grep scriptId
```

## デプロイ情報の確認

デプロイ後に生成されるファイル:

- `.gas-deployment.json` — 最新のデプロイ ID・WebApp URL（コミット可）
- `.clasp.json` — Script ID（gitignore 対象、ローカルのみ）

```bash
# 最新のデプロイ情報
cat .gas-deployment.json
```

## テンプレートトークンが置換されない

- `@` プレフィックス忘れ（`{フィールド名}` は空文字に置換される仕様）
- `driveTemplate.gs` / `tokenReplacer.js` の両側で挙動が揃っているか（フロント・GAS で二重実装している）
- ユニットテスト: `tests/gas-drive-template-replacement.test.cjs`

## 同期が壊れた / 古いデータが残る

1. ブラウザの DevTools → Application → IndexedDB → `NestedFormBuilder` を削除
2. ページ再読み込みで全件再取得される
3. それでも直らない場合は `commitToken` を疑う（`gas/syncRecordsMerge.js` と `codeSyncRecords.gs` を確認）
