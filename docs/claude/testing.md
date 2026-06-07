# テスト（Claude 向け詳細）

CLAUDE.md から分離した、テストの配置と実行コマンド。テスト追加・実行時に参照する。

## 実行コマンド

```bash
# GAS ユニットテスト + 等価性テスト（tests/ 配下）
npm test

# フロント側インラインテスト（builder/src/**/*.test.js）
npm run test:builder
# ※ exceljs / jszip を import する 2 本（excelExport.test.js / listActionsShared.test.js）は
#   先に `npm run builder:install` が必要。それ以外は依存ゼロで実行できる。

# GAS + フロントをまとめて
npm run test:all

# Playwright E2E テスト
npm run test:playwright

# 単体ファイルを直接実行する例（GAS）
node --experimental-vm-modules tests/gas-sync-records-merge.test.js
node tests/gas-header-normalization.test.cjs
```

> フロントのインラインテストはすべて `node:test` で書かれており、ビルド/バンドル不要で
> `node --test` から直接実行できる（vitest 等のランナーは不要）。

## テスト配置

- `tests/` — GAS バックエンドのユニットテスト。Node の `assert/strict` を使用
- `builder/src/**/*.test.js` — フロント側のインラインテスト。**ソースと同ディレクトリ** に配置（スキーマ、バリデーション、キャッシュ、状態管理等）
