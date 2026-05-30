# データモデル（Claude 向け詳細）

CLAUDE.md から分離した、フォームスキーマ／スプレッドシートレイアウト／ソフトデリートの仕様詳細。コード編集時に参照する。

## 識別モデル（id ＝ Drive fileId / 名前 ＝ Drive ファイル名）

フォーム・クエスチョン・ダッシュボードの **id は、その定義 JSON が置かれている Google Drive ファイルの fileId** に統一されている。**名前（フォームは `settings.formTitle`、クエスチョン/ダッシュボードは `name`）は Drive 上のファイル名（拡張子 `.json` を除いたもの）**であり、システム上の名前と Drive ファイル名は常に一致する。

- 保存される `.json` は **自分自身の id も名前（ファイル名）も持たない**。識別情報は常に Drive ファイル（fileId・ファイル名）から導出する。読み込み時に `id = fileId`、`name`/`formTitle` = ファイル名 を注入する。
- 新規作成時はクライアントで id を採番せず、保存（ファイル作成）後に GAS が返す fileId を id として採用する。
- フォルダ走査・同期はファイル名で行い、`mapping[fileId] = { fileId, driveFileUrl, name }`（id ＝ fileId）として PropertiesService にレジストリ/キャッシュを保持する。
- リンク（クエスチョン→フォーム `formId` / ダッシュボード→クエスチョン `questionId`）は id（fileId）で解決し、解決できないときは併せて保持した相手の名前（クエスチョンは `formName`、ダッシュボードカードは `questionName`）で標準フォルダ構成内を名前解決する（`Forms_resolveFormRef_` / `Analytics_resolveQuestionRef_`）。
- 構成コピー（別ルートへ複製）では全ファイルが新 fileId になるため、リンクは `idMap`（旧fileId→新fileId）で再マップし、構成外参照は名前フォールバックに委ねる。
- エディタには普段は隠している「リンク先URL（保存先）」欄があり、指定すると別の Drive ファイル/フォルダへ保存（リンク先付け替え）する。ファイル URL は上書き、フォルダ URL は複製。保存先 fileId が変わると id も付け替わる。
- **標準フォルダへの取り込みは move 優先**（`StdFolders_ensureFileInStdFolder_`）。id ＝ fileId 統一下では `makeCopy` は同一性を壊し参照を孤立させるため、まず `file.moveTo`（fileId 保持）で取り込み、移動できない（他者所有等）ときだけ `makeCopy` にフォールバックする。構成内判定（`StdFolders_isFileInStdSubfolder_`）はサブフォルダ配下（`01_forms/ヒグマ/` 等）も再帰的に「構成内」とみなすため、既に構成内のファイルは再コピーされない（冪等）。

### リンク診断・修復（管理者ツール）

設定＞管理の「構成レポート」「リンク修復」から実行する。GAS 側は全て `adminOnly`。

- **構成レポート（`nfbBuildLinkReport`）**: 参照ステータスを実行時リゾルバと同じ階層で判定する（`StdFolders_reportRefStatus_`）。id 実在＝`OK（構成内）` / 保持名 or id をファイル名として一意解決＝`名前一致・要再リンク（実行時は解決）`（自動修復可・重大度 auto）/ 同名複数＝`名前重複・要手動再リンク（曖昧）` / マッピングキーのみ＝`要確認` / それ以外＝`未解決（真のリンク切れ）`。`構成外/外部（未検査）` は external。集計は重大度別（manual/auto/external）。
- **参照の再リンク（`nfbRelinkReferences`）**: 全 Question/Dashboard の `formId`/`questionId` を解決して現 fileId へ JSON を恒久書換え（非破壊）。`mode:"dryRun"`（既定）は変更予定のみ返す。曖昧（同名複数）・未解決は変更せず報告。
- **同名フォーム重複整理（`nfbDedupeForms`）**: `01_forms` 配下の同名フォーム群から canonical を 1 つ残し（override > 参照されている > 物理パスが深い > 古い、の優先順）、Question の参照を canonical へ寄せ、残りをゴミ箱へ。`mode:"dryRun"`（既定）でプレビュー。推奨運用順は **同期（マッピング再構築）→ 重複整理(apply) → 再リンク(apply)**。

## フォームスキーマ

フォーム定義は Google Drive 上に JSON として保存され、`formsMappingStore` が ID ↔ ファイル対応を管理する（id ＝ fileId）。

> 注: 下記はアプリ内で扱うフォームオブジェクトの形。`id`（＝Drive fileId）と `settings.formTitle`（＝Drive ファイル名）は **保存される .json には書かれず**、読み込み時に Drive の fileId / ファイル名から注入される。

```javascript
{
  id: "<Drive fileId>",        // 保存 .json には含めない（読込時に fileId から注入）
  name: "フォーム名",            // legacy。表示名は settings.formTitle（＝ファイル名由来）
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
      printTemplateAction: {...} // 出力ボタン設定（printTemplate タイプのみ）
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

`text`, `number`, `email`, `phone`, `url`, `date`, `time`, `radio`, `select`, `checkboxes`, `weekday`, `textarea`, `regex`, `userName`, `fileUpload`, `message`, `printTemplate`, `substitution`

`substitution` は他フィールドの値を `{...}`（元データ形式）/ `{{...}}`（ビュー形式）の alasql 式で組み立て、文字列・数値計算結果として保存・表示する読み取り専用フィールド（旧 `[...]` ブラケット演算式は廃止）。`templateText` に式を保持し、`excludeFromSearch` / `hideFromRecordView` で表示制御する。

`printTemplate`（出力ボタン）の `printTemplateAction`:

| キー | 説明 |
|--|--|
| `outputType` | `"pdf"`（ブラウザダウンロード） / `"googleDoc"`（Google ドキュメントを作成して開く） / `"gmail"`（下書き作成） |
| `useCustomTemplate` / `templateUrl` | カード個別の印刷様式 Google Document URL。`useCustomTemplate` が true かつ `templateUrl` が非空ならそれを使い、未指定なら `settings.standardPrintTemplateUrl` →（それも未設定なら）自動生成ドキュメントへフォールバック。`gmail` で「PDF を添付」を有効にしたときの添付 PDF にも同じ解決が適用される。 |
| `fileNameTemplate` | カード個別の出力ファイル名規則（`{...}` 式可）。`pdf` / `googleDoc` で「カード個別 > `settings.standardPrintFileNameTemplate` > 既定値」で解決。 |
| `gmailAttachPdf` / `gmailTemplateTo` / `gmailTemplateCc` / `gmailTemplateBcc` / `gmailTemplateSubject` / `gmailTemplateBody` | Gmail 下書き用の宛先・件名・本文テンプレートと PDF 添付有無。 |

印刷様式の出力（`pdf` の一時 Doc・`googleDoc` の成果物・標準印刷出力）は常にマイドライブ直下に作成し、レコードの Drive フォルダには保存しない。

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
