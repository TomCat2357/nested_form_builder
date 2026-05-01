# データモデル（Claude 向け詳細）

CLAUDE.md から分離した、フォームスキーマ／スプレッドシートレイアウト／ソフトデリートの仕様詳細。コード編集時に参照する。

## フォームスキーマ

フォーム定義は Google Drive 上に JSON として保存され、`formsMappingStore` が ID ↔ ファイル対応を管理する。

```javascript
{
  id: "form_xxx",
  name: "フォーム名",
  description: "説明",
  schema: [
    {
      id: "q1",
      type: "text",              // 後述のフィールドタイプ参照
      label: "質問テキスト",
      required: true,
      placeholder: "入力例",
      isDisplayed: true,         // 表示/非表示制御
      styleSettings: {...},      // フィールドスタイル
      defaultValueMode: "none",  // none, userName, userAffiliation, userTitle, custom
      children: [...],           // ネストされた質問（最大11階層）
      childrenByValue: {...},    // 条件分岐（選択肢ごとの子要素）
      printTemplateAction: {...} // テンプレート出力設定（printTemplate タイプのみ）
    }
  ],
  settings: {
    spreadsheetId: "...",
    sheetName: "Data",
    gasUrl: "https://script.google.com/macros/s/.../exec"
  }
}
```

### フィールドタイプ

`text`, `number`, `email`, `phone`, `url`, `date`, `time`, `radio`, `select`, `checkboxes`, `weekday`, `message`, `fileUpload`, `printTemplate`, `substitution`

`substitution` は他フィールドの値を `{...}` 式言語と `[...]` ブラケット演算式で組み立て、文字列・数値計算結果として保存・表示する読み取り専用フィールド。`templateText` に式を保持し、`excludeFromSearch` / `hideFromRecordView` で表示制御する。

### ネスト関連

- `children` — 質問配下の子要素（最大深さは `MAX_DEPTH = 11` / `NFB_HEADER_DEPTH = 11`）
- `childrenByValue` — 選択肢（`radio` / `select` / `checkboxes` 等）ごとに異なる子要素を出し分ける条件分岐
- スキーマ走査・変換のユーティリティは `builder/src/core/schemaUtils.js`（`traverseSchema`, `mapSchema`）

## スプレッドシートレイアウト

| 行 | 役割 |
|--|--|
| 1〜11 | ヘッダー（`NFB_HEADER_DEPTH = 11` の階層パス） |
| 12〜 | データ行（`NFB_DATA_START_ROW = 12`） |

### 固定列

左から順に:

- `id` — ULID ベースのレコード ID
- `No.` — 連番
- `createdAt` / `modifiedAt` / `deletedAt`
- `createdBy` / `modifiedBy` / `deletedBy`

固定列の定義は `gas/constants.gs` の `NFB_FIXED_HEADER_PATHS`。

ファイルアップロード列のセル JSON には `folderUrl` が埋め込まれており、`parseFileUploadStorage()` で取り出せる。検索表の「フォルダを開く」アクションや印刷時のフォルダコンテキストはここから派生させる。

### 動的列

質問パスをパイプで連結して列名とする。例: `parent|child|question`。
ヘッダーの 11 行は、ルートから末端質問までの各階層を 1 セルずつ占める。

### 関連ファイル

- `gas/sheetsHeaders.gs` — 11 行ヘッダーの整備・正規化
- `gas/sheetsRecords.gs` — レコード CRUD
- `gas/sheetsRowOps.gs` — 行操作（二分探索・upsert）
- `gas/sheetsDatetime.gs` — 日時シリアル変換

## ソフトデリートとリテンション

物理削除はせず、`deletedAt` / `deletedBy` 列にマークする方式。

- `deletedAt` — 削除日時。空でなければ削除扱い
- `deletedBy` — 削除したユーザー
- リテンション期間 — `NFB_DELETED_RECORD_RETENTION_DAYS`（既定 30 日）
- 期限切れ物理削除 — `Sheets_purgeExpiredDeletedRows_`（`gas/sheetsRecords.gs`）

UI 側では既定で削除済みを除外。検索・一覧の表示切替ロジックは `builder/src/features/search/` 配下を参照。
