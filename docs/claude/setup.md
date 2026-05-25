# セットアップ（Claude 向け詳細）

CLAUDE.md から分離した、初回セットアップ手順。新しい環境で開発を始めるとき、または前提条件を確認したいときに参照する。

## 前提

- Node.js 18 以上
- Google アカウント
- `clasp` を利用できる環境
- Google Apps Script API が有効

## インストール

```bash
npm install
npm run builder:install
```

## .clasp.json

ルートに配置し、`rootDir` を `dist` に設定する。

```json
{
  "scriptId": "YOUR_SCRIPT_ID",
  "rootDir": "dist"
}
```

`.clasp.json` はローカル専用（gitignore 対象）。

## clasp ログイン

```bash
npm run clasp:login
```
