# デプロイ（Claude 向け詳細）

CLAUDE.md から分離した、`deploy.ps1` と手動デプロイの手順。デプロイ作業時に参照する。

## 自動デプロイ (Windows / PowerShell)

```powershell
.\deploy.ps1
```

`deploy.ps1` は以下をまとめて実行する。

1. `builder/` の `npm install` と `npm run build`
2. `gas/scripts/bundle.js` による `dist/Bundle.gs` 生成
3. `dist/Index.html` への `<base target="_top">` とデプロイ時刻メタ付与
4. `gas/appsscript.json` の `dist/` へのコピー
5. `clasp push` → `clasp deploy`

オプション:

```powershell
.\deploy.ps1 -BundleOnly                          # ビルドのみ (push/deploy なし)
.\deploy.ps1 -PushOnly                             # push のみ (deploy なし)
.\deploy.ps1 -PropertyStore script                 # 共有 Script Properties (管理者設定有効)
.\deploy.ps1 -PropertyStore user                   # User Properties (管理者設定無効)
.\deploy.ps1 -ManifestOverride .\override.json     # appsscript.json を上書きマージ
.\deploy.ps1 -TestMode                             # テスト公開 (匿名アクセス可・実行=オーナー)
.\deploy.ps1 -Readable                             # minify=off / sourcemap=inline で読めるビルド
```

### `-TestMode`（テスト公開）

`gas/appsscript.test.json`（`executeAs: USER_DEPLOYING` / `access: ANYONE_ANONYMOUS`）を override 適用し、`__NFB_DEPLOY_MODE__="test"` を焼き込む。**Google ログイン無しの匿名アクセスでもフォームの作成・保存が可能**（保存はオーナー権限で走り、オーナーの Drive `01_forms` に入る）。Playwright の保存系 E2E（`npm run test:playwright:save`）はこのモードを前提にする。

- 匿名ユーザーを管理者として通すには `-PropertyStore script`（既定）で、Script Properties の `NFB_ADMIN_KEY` / `NFB_ADMIN_EMAIL` を未設定にする。
- 公開 URL を知る誰でもがオーナー Drive を操作できるため、**使い捨てのテスト用デプロイに限定**する。手順とセキュリティ注意は [`testing.md`](../developers/testing.md) の「テストモードでの保存系 E2E」を参照。

## 手動デプロイ

```bash
npm run builder:build
node gas/scripts/bundle.js
cp gas/appsscript.json dist/appsscript.json
npm run clasp:push
npx --yes @google/clasp deploy --description "Nested Form Builder"
```

デプロイ後のトラブルシュートは [`troubleshooting.md`](./troubleshooting.md) を参照。
