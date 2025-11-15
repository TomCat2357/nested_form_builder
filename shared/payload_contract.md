# Nested Form Builder → GAS ペイロード仕様

フォーム HTML から Google Apps Script へ送信される JSON ボディの仕様です。

## 基本構造

```json
{
  "version": 1,
  "formTitle": "受付フォーム",
  "schemaHash": "v1-123456",
  "id": "r_f0d1c2b3a4e5",
  "spreadsheetId": "1AbCdEf...",
  "sheetName": "Responses",
  "responses": {
    "氏名": "山田太郎",
    "色|赤": true
  },
  "order": ["氏名", "色|赤"]
}
```

- `version` – 生成 HTML のフォーマットバージョン
- `formTitle` – ビルダーで指定したフォームタイトル
- `schemaHash` – スキーマ内容を元にしたハッシュ値（差分検知用）
- `id` – 回答レコードID（クライアントで生成。更新時は既存IDを指定）
- `spreadsheetId` – 保存先スプレッドシート ID
- `sheetName` – 保存先シート名（任意、既定値 `Responses`）
- `responses` – 質問ラベルを `|` 連結したキー → 回答値
- `order` – スプレッドシートに並べたい列順。未指定の場合は `responses` のキー順

## HTTP ヘッダー

```
Content-Type: text/plain;charset=utf-8
```

## エンドポイント

ビルダー設定に入力した GAS WebApp URL (`https://script.google.com/macros/s/<deploymentId>/exec`) へ POST します。追加でクエリパラメータを指定する必要はありません。
