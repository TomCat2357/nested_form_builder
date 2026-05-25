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
```

## 手動デプロイ

```bash
npm run builder:build
node gas/scripts/bundle.js
cp gas/appsscript.json dist/appsscript.json
npm run clasp:push
npx --yes @google/clasp deploy --description "Nested Form Builder"
```

デプロイ後のトラブルシュートは [`troubleshooting.md`](./troubleshooting.md) を参照。
