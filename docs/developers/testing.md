# テスト（Claude 向け詳細）

CLAUDE.md から分離した、テストの配置と実行コマンド。テスト追加・実行時に参照する。

## 実行コマンド

```bash
# GAS ユニットテスト + 等価性テスト（tests/ 配下）
npm test

# フロント側インラインテスト（builder/src/**/*.test.js）
npm run test:builder
# ※ exceljs / jszip を import する 2 本（excelExport.test.js / listActionsShared.test.js）は
#   依存を動的 import し、未インストール時は失敗ではなく skip する（`npm run builder:install`
#   後に実際に実行される）。それ以外は依存ゼロで実行できる。

# GAS + フロントをまとめて
npm run test:all

# Playwright E2E テスト（読み取り専用スモーク：匿名アクセス・検索・レコード往復）
npm run test:playwright

# Playwright E2E テスト（保存系：フォーム新規作成→保存→Drive 到達検証→後片付け）
# 実 Drive にフォームを作成・削除するため PLAYWRIGHT_ALLOW_WRITE=1 のときだけ走る
# PowerShell: $env:PLAYWRIGHT_ALLOW_WRITE = "1"; npm run test:playwright:save
npm run test:playwright:save

# 単体ファイルを直接実行する例（GAS）
node --experimental-vm-modules tests/gas-sync-records-merge.test.js
node tests/gas-header-normalization.test.cjs
```

## テストモードでの保存系 E2E（フォーム登録の自動検証）

`npm run test:playwright:save`（[`tests/test-playwright-save.js`](../../tests/test-playwright-save.js)）は、**デプロイ済みのテストモード Web アプリ**に匿名でアクセスし、フォームの「新規作成→保存→別コンテキストでの Drive 到達検証→後片付け（Drive 削除）」を回す。ローカル dev では `google.script.run` が無く保存できないため、必ずデプロイ済み URL を対象にする。

### なぜテストモードで匿名でも保存できるのか

`./deploy.ps1 -TestMode` は [`gas/appsscript.test.json`](../../gas/appsscript.test.json)（`executeAs: USER_DEPLOYING` / `access: ANYONE_ANONYMOUS`）を override 適用する。**`executeAs=USER_DEPLOYING` なので保存処理はデプロイしたオーナーの権限で走り、フォーム JSON はオーナーの Drive `01_forms` に保存される**。訪問者は Google アカウントも Drive も不要。`__NFB_DEPLOY_MODE__="test"` が焼き込まれ、レート制限が匿名（email 空）でも通る（[`gas/Code.gs`](../../gas/Code.gs) の `Nfb_isTestModeDeploy_` / `Nfb_checkRateLimit_`）。

### 実行手順

1. `./deploy.ps1 -TestMode`（`-PropertyStore` は既定の `script` のまま）で push & deploy。
2. 初回はオーナーがブラウザでアプリを開き OAuth スコープを承認する。
3. テスト用デプロイの Script Properties で `NFB_ADMIN_KEY` / `NFB_ADMIN_EMAIL` を**未設定（空）**にする（匿名を管理者にするため）。
4. `$env:PLAYWRIGHT_ALLOW_WRITE = "1"; npm run test:playwright:save`。対象 URL は `PLAYWRIGHT_APP_URL` → `.gas-deployment.json` → `clasp deployments` の順で解決する。

> **セキュリティ**: テストモードの公開 URL を知る誰でもがオーナー Drive にフォームを作成・操作できる。**使い捨てのテスト用デプロイに限定**し、本番デプロイ（既定 `appsscript.json` = `executeAs: USER_ACCESSING` / `access: ANYONE`）とは別物として扱い、検証後はデプロイを無効化／削除する。

### 「保存できない／詰んだ」ときの切り分け

| 場所 | 原因 | 対処 |
| --- | --- | --- |
| ローカル dev / preview（localhost） | `google.script.run` が無く `hasScriptRun()`=false。保存が即失敗（UI 上は作成できたように見えるが裏のアップロードが永久失敗） | ローカルでは保存検証しない。デプロイ済みテスト URL で検証する |
| デプロイ済みテスト URL | `NFB_ADMIN_KEY` / `NFB_ADMIN_EMAIL` が設定済み | 匿名が管理者になれず一覧に入れない。Script Properties で両方を空にする |
| デプロイ済みテスト URL | `-PropertyStore user` でデプロイ | 管理者設定が無効化され門前払い。`-PropertyStore script`（既定）でデプロイ |
| デプロイ済みテスト URL | OAuth スコープ未承認 | オーナーが一度ブラウザで開いて Drive 等のスコープを承認する |

> フロントのインラインテストはすべて `node:test` で書かれており、ビルド/バンドル不要で
> `node --test` から直接実行できる（vitest 等のランナーは不要）。

## テスト配置

- `tests/` — GAS バックエンドのユニットテスト。Node の `assert/strict` を使用
- `builder/src/**/*.test.js` — フロント側のインラインテスト。**ソースと同ディレクトリ** に配置（スキーマ、バリデーション、キャッシュ、状態管理等）
