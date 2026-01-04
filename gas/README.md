# GAS Web アプリケーション

生成したフォーム HTML からの POST を受け取り、Google スプレッドシートへ回答を追記する Apps Script プロジェクトです。`clasp` と `deploy.sh` を利用してデプロイできます。

## ディレクトリ構成

- `appsscript.json` – プロジェクトのマニフェスト
- `Code.gs` – `doGet/doPost` エントリポイントと CORS / API ルーティング
- `model.gs` – リクエストボディのパースと初期バリデーション
- `sheets.gs` – スプレッドシート行の作成・ヘッダー管理
- `forms.gs` – フォーム一覧/作成/更新/削除 API
- `drive.gs` – Google Drive のファイル操作
- `properties.gs` – スクリプト/ユーザープロパティ操作
- `settings.gs` – ユーザー設定の保存/取得
- `scripts/bundle.js` – `gas/*.gs` を `dist/Bundle.gs` に結合するスクリプト

## 初期セットアップ

1. Google Apps Script で新規プロジェクトを作成し、`scriptId` を取得します。
2. リポジトリ直下で `.clasp.json` を設定し、`rootDir` を `dist/` に指定します（現状の設定も `dist`）。
3. `npm install` で `@google/clasp` を取得（または `npm install --global @google/clasp`）
4. `npm run clasp:login`
5. `clasp push` でスクリプトファイルをアップロード（`dist/` 配下が対象）

## スプレッドシートの指定

POST ボディ、もしくはクエリパラメータで以下を指定してください。

- `spreadsheetId` – 保存先スプレッドシート ID（必須）
- `sheetName` – シート名（省略時は `Responses`）

新しいシート名が指定された場合、存在しなければ自動で作成されます。

## デプロイ

`deploy.sh` が `builder` ビルド → `gas/scripts/bundle.js` → `dist/` 生成 → `clasp push/deploy` を一括実行します。

```
./deploy.sh
```

手動で行う場合:

```
npm run builder:build
node gas/scripts/bundle.js
clasp push
clasp deploy --description "Nested Form Builder"
```

デプロイ後に表示される WebApp URL をビルダーの設定パネルに入力してください。

## 返却レスポンス

成功時に以下の JSON を返します。

```json
{
  "ok": true,
  "spreadsheetUrl": "https://docs.google.com/spreadsheets/d/xxxx",
  "sheetName": "Responses",
  "rowNumber": 5,
  "id": "r_1700000000000_xxxxxxxx"
}
```

エラー時は `ok: false` と `error` メッセージを含む JSON を返します。
