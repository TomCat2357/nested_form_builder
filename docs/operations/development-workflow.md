# 開発フロー（Claude 向け詳細）

CLAUDE.md から分離した、ローカル開発・ビルド・GAS 同期のコマンド一覧。普段の開発サイクルで参照する。

## ローカル開発

```bash
npm run builder:dev
```

Vite 開発サーバーが `http://localhost:5173` で起動する。`google.script.run` は存在しないため、GAS 通信を伴う処理は Web アプリ上での確認が必要。`AuthProvider` は GAS 外では管理者扱いの既定値を使うため、画面構成やスタイル確認はローカルでも可能。

## ビルド

```bash
npm run builder:build
node gas/scripts/bundle.js
```

## GAS との同期

```bash
npm run clasp:push    # dist/ → Apps Script
npm run clasp:pull    # Apps Script → dist/
```
