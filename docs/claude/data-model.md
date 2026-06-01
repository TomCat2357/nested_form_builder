# データモデル（Claude 向け詳細）

CLAUDE.md から分離した、フォームスキーマ／スプレッドシートレイアウト／ソフトデリートの仕様詳細。コード編集時に参照する。

> リンク（参照）の持ち方・保存時のリンク追従・`driveFileUrl` の非永続化の整理は [links-and-save.md](links-and-save.md)。

## 識別モデル（id ＝ Drive fileId / 名前 ＝ Drive ファイル名）

フォーム・クエスチョン・ダッシュボードの **id は、その定義 JSON が置かれている Google Drive ファイルの fileId** に統一されている。**名前（フォームは `settings.formTitle`、クエスチョン/ダッシュボードは `name`）は Drive 上のファイル名（拡張子 `.json` を除いたもの）**であり、システム上の名前と Drive ファイル名は常に一致する。

- 保存される `.json` は **自分自身の id も名前（ファイル名）も持たない**。識別情報は常に Drive ファイル（fileId・ファイル名）から導出する。読み込み時に `id = fileId`、`name`/`formTitle` = ファイル名 を注入する。
- 新規作成時はクライアントで id を採番せず、保存（ファイル作成）後に GAS が返す fileId を id として採用する。
- フォルダ走査・同期はファイル名で行い、`mapping[fileId] = { fileId, driveFileUrl, name }`（id ＝ fileId）として PropertiesService にレジストリ/キャッシュを保持する。
- リンク（クエスチョン→フォーム `formId` / ダッシュボード→クエスチョン `questionId`）は id（fileId）で解決し、解決できないときは併せて保持した相手の名前（クエスチョンは `formName`、ダッシュボードカードは `questionName`）で標準フォルダ構成内を名前解決する（`Forms_resolveFormRef_` / `Analytics_resolveQuestionRef_`）。
- **フォルダ込み名（`フォルダ/サブ/名前`、区切り `/`）が正規の識別名**。保持名・SQL のフォーム参照（`FROM [フォルダ/フォーム名]`）はフォルダ込みで持ち、別フォルダの同名を一意に識別する。バレ名（フォルダなし）はその名前が全体で一意のときのみ解決し、同名複数のバレ名は曖昧として解決しない（フォルダ込み指定を促す）。フロントは `formQualifiedName` / `buildFormIndex.byPath`、GAS は物理相対フォルダ＋葉名のキーで解決する。残る真の重複は「同一フォルダ＋同名」だけになり、これは同期が最新を残して整理する。
- 構成コピー（別ルートへ複製）では全ファイルが新 fileId になるため、リンクは `idMap`（旧fileId→新fileId）で再マップし、構成外参照は名前フォールバックに委ねる。
- **標準フォルダへの取り込みは move 優先**（`StdFolders_ensureFileInStdFolder_`）。id ＝ fileId 統一下では `makeCopy` は同一性を壊し参照を孤立させるため、まず `file.moveTo`（fileId 保持）で取り込み、移動できない（他者所有等）ときだけ `makeCopy` にフォールバックする。構成内判定（`StdFolders_isFileInStdSubfolder_`）はサブフォルダ配下（`01_forms/ヒグマ/` 等）も再帰的に「構成内」とみなすため、既に構成内のファイルは再コピーされない（冪等）。

### 物理/論理フォルダの整合（forms / questions / dashboards 共通）

フォーム・Question・Dashboard の **論理フォルダ（`folder`）は標準フォルダ配下の物理フォルダ階層をミラーする**。論理パス（概念上）＝ `NN_type/` ＋ `folder` ＋ `/` ＋ 名前 ＋ `.json`（例: `01_forms/higuma/ヒグマフォーム.json`）。論理側（マッピング登録簿）は対応する物理ファイルの fileId を持ち、システム上の名前は物理ファイル名（`.json` 除去）から導出する。

- **物理ミラー**: forms は `formsDriveFolders.gs`（`FormsDrive_*`）、questions/dashboards は `analyticsDriveFolders.gs`（`AnalyticsDrive_*`）が、仮想フォルダパス ↔ 物理フォルダ（`02_questions` / `03_dashboards` 配下）を drivemap（type ごとに別プロパティキー）で O(1) 解決し、フォルダ作成・移動・リネーム・削除・アイテム保存をミラーする。標準フォルダ未解決（auto-organize off）では全操作が安全に no-op。
- **整合チェック（保存/移動/リネーム/インポート）**: 保存・フォルダ移動時に対象ファイルを `folder` に対応する物理フォルダへ揃える。構成内ファイルは move（fileId 保持）、解決不能時は no-op（安全側）。インポートは、物理位置が種類に対応した場所（`02_questions` 等）配下ならその物理サブパスをそのまま論理フォルダとし、管理画面で開いていた論理フォルダが明示指定されていればそれを論理パスとして物理ファイルもそこへ移動する。
- **標準フォルダ作成は純粋**: フォルダ作成機能はそのフォルダ（と祖先）を ensure するだけで、サブフォルダは作らない。
- **fileId 消失時の解決**: 論理側が持つ fileId の物理ファイルが存在しない（消失/ゴミ箱）ときは、論理パス（＝名前）で標準フォルダ配下を探し直して解決し、見つかれば論理側の fileId を上書きする（`Analytics_resolveItemFileOrNull_`）。見つからなければエラー。
- **同期（物理→論理リコンサイル）**: 設定＞管理の「同期」（`StdFolders_rebuildMappings_`）で、物理 Drive フォルダの実構造を正として各 `.json` の `folder` / drivemap / 登録簿を再構築する。forms（`StdFolders_reconcileFormFoldersToPhysical_`）に加え questions/dashboards も対称に処理する（`StdFolders_reconcileAnalyticsFoldersToPhysical_`）。

### リンク診断・修復（同期に内包）

設定＞管理の「構成レポート」と「同期（フォルダ走査）」から実行する。GAS 側は全て `adminOnly`。
かつての単体「参照の再リンク」「同名フォーム重複整理」ボタン（および公開アクション `std_folders_relink_refs` / `std_folders_dedupe_forms`）は廃止し、**同期が両方を内包する**。

- **構成レポート（`nfbBuildLinkReport`）**: 参照ステータスを実行時リゾルバと同じ階層で判定する（`StdFolders_reportRefStatus_`）。id 実在＝`OK（構成内）` / 保持名 or id をファイル名として一意解決＝`名前一致・要再リンク（実行時は解決）`（自動修復可・重大度 auto）/ 同名複数＝`名前重複・要手動再リンク（曖昧）` / マッピングキーのみ＝`要確認` / それ以外＝`未解決（真のリンク切れ）`。`構成外/外部（未検査）` は external。集計は重大度別（manual/auto/external）。エンティティ見出しはフォルダ込み名で表示する。
- **同期（フォルダ走査 / `nfbRebuildMappingsFromFolders` → `StdFolders_alignFolders_`）**: 論理↔物理の整合（①〜⑥）に加え、毎回次を適用する。
  - **参照の再リンク（常時）**: 全 Question/Dashboard の `formId`/`questionId` を `StdFolders_relinkReferences_` で現 fileId へ恒久書換え（remap 優先＋フォルダ込み名/同フォルダ最新で名前解決）。旧実装は id 変化があった回のみ発火していたが、現在は毎回走り既存の腐れ参照も掃く。
  - **同一 fileId の論理パス重複の畳み込み（①〜④ の前）**: 同じ物理ファイル（fileId）に解決される mapping エントリ（＝論理パス）が複数あるとき 1 件へ畳む（`StdFolders_consolidateSameFileIdDuplicates_`）。survivor の優先順位は **①論理パス（`folder`）== 物理パス（`relativeFolderOfFile`）一致 → ②キー==fileId（正規エントリ）→ ③登録順で後勝ち**。余り（loser）の論理パスは登録簿から除去し、旧キー→fileId を remap に積んで参照を survivor へ寄せる。survivor のキーが fileId でなければ fileId キーへ正規化する。同一物理ファイルは 1 つしかないため**削除対象は mapping エントリ（論理パス）のみで、共有する物理ファイルはゴミ箱に入れない**。結果は `fileIdDedup` に件数・除去した論理パス一覧として返る。
  - **同一フォルダ同名の重複整理**: `(相対フォルダ, 葉名)` でグルーピングし、2件以上は**最終更新が新しい方を残す**（`StdFolders_consolidateSameFolderDuplicates_`）。参照は survivor へ寄せ（remap）、登録簿も survivor へ振替え、余り（loser）は削除候補化（⑤新規登録には化けさせない）。
  - **削除はカテゴリ別2段確認**: 走査後フロントが「①同名重複の余り → ②論理に対応先がない不正ファイル(⑥)」の順に確認ダイアログを出し、承認したカテゴリだけを Drive のゴミ箱へ移動する（30日間は復元可）。payload は `applyDeleteDuplicates` / `applyDeleteInvalid`。別フォルダの同名はフォルダ込み名で一意解決され、解決不能時のみ曖昧として手動報告。

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

`text`, `number`, `email`, `phone`, `url`, `date`, `time`, `radio`, `select`, `checkboxes`, `textarea`, `regex`, `userName`, `fileUpload`, `message`, `printTemplate`, `substitution`

（旧 `weekday`（曜日）型は廃止。型ドロップダウンから除去済みで、既存定義に残る weekday フィールドは未知型として無害にスキップされる。）

`substitution` は他フィールドの値を `{{...}}`（ビュー形式）の alasql 式で組み立て、文字列・数値計算結果として保存・表示する読み取り専用フィールド（旧 `[...]` ブラケット演算式・単一ブレース `{...}`（元データ形式）は廃止。データ形式は view 形式に一本化）。`templateText` に式を保持し、`excludeFromSearch` / `hideFromRecordView` で表示制御する。

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

**保存（スプレッドシート）= 元データ方式 / 読取・表示・分析・式 = 完全 view 方式** の二層構成。

- **保存層（raw）**: 選択肢系フィールド（`radio` / `select` / `checkboxes`）は **選択肢ごとに 1 列**（`親|選択肢`）で保存し、選択されたオプション列にマーカー `●` を立てる（`collectResponses` / `collectAllPossiblePaths`、`gas/sheetsHeaders.gs` の `Sheets_buildOrderFromSchema_`）。
- **読取層（view）**: 分析・検索・置換式・テンプレート・印刷・編集ラウンドトリップは、保存層のマーカー列を **選択ラベル文字列へ畳み込んで** 提示する（フォーム 1 列・`checkboxes` は共有 codec `builder/src/utils/multiValue.js` の `joinMultiValue` / `splitMultiValue` で **カンマ `,` 連結・ラベル内の `,`/`\` はバックスラッシュエスケープ**）。collapse は `entriesToViewRows.js`（分析）・`computedFields.js`（式再評価）・`searchTableValues.js`（検索）・`responses.js`（編集ラウンドトリップ）が担う。view 期に保存された「フィールド 1 列」データも互換読取する。
- 分析クエリは常に view 形式の単一テーブル（`data/view` の variant 選択は廃止。SQL の `:view`/`:data` suffix はエラー）。検索（MV_EQ/MV_IN）・分析 view 行・再読込は同一 codec を共有する。

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
