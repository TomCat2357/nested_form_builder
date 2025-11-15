# GAS Web アプリケーション

生成したフォーム HTML からの POST を受け取り、Google スプレッドシートへ回答を追記する Apps Script プロジェクトです。`clasp` を利用してデプロイできます。

## ディレクトリ構成

- `appsscript.json` – プロジェクトのマニフェスト
- `Code.gs` – `doPost` エントリポイントと CORS / 共通レスポンス
- `model.gs` – リクエストボディのパースと初期バリデーション
- `sheets.gs` – スプレッドシート行の作成・ヘッダー管理

## 初期セットアップ

1. Google Apps Script で新規プロジェクトを作成し、`scriptId` を取得します。
2. リポジトリ直下で `.clasp.json` を設定し、`gas/` ディレクトリを `rootDir` に指定します。
3. `npm install --global @google/clasp`（またはリポジトリの `package.json` / `deploy.sh` を使用）
4. `clasp login`
5. `clasp push` でスクリプトファイルをアップロード

## スプレッドシートの指定

POST ボディ、もしくはクエリパラメータで以下を指定してください。

- `spreadsheetId` – 保存先スプレッドシート ID（必須）
- `sheetName` – シート名（省略時は `Responses`）

新しいシート名が指定された場合、存在しなければ自動で作成されます。

## デプロイ

```
clasp push
clasp deploy --description "Nested Form Builder" 
```

デプロイ後に表示される WebApp URL をビルダーの設定パネルに入力してください。

## 返却レスポンス

成功時 (`201` 換算) に以下の JSON を返します。

```json
{
  "ok": true,
  "spreadsheetUrl": "https://docs.google.com/spreadsheets/d/xxxx",
  "sheetName": "Responses",
  "rowNumber": 5
}
```

エラー時は `ok: false` と `error` メッセージを含む JSON を返します。
