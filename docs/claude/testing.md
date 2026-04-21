# テスト（Claude 向け詳細）

CLAUDE.md から分離した、テストの配置と実行コマンド。テスト追加・実行時に参照する。

## 実行コマンド

```bash
# Playwright E2E テスト
npm run test:playwright

# GAS ユニットテスト (tests/ 配下)
node --experimental-vm-modules tests/gas-sync-records-merge.test.js
node tests/gas-header-normalization.test.cjs
node tests/gas-google-drive-url-parsing.test.cjs
node tests/gas-drive-template-replacement.test.cjs
```

## テスト配置

- `tests/` — GAS バックエンドのユニットテスト。Node の `assert/strict` を使用
- `builder/src/**/*.test.js` — フロント側のインラインテスト。**ソースと同ディレクトリ** に配置（スキーマ、バリデーション、キャッシュ、状態管理等）
