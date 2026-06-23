# リンクと保存（Claude 向け詳細）

直近のリンク・保存周りの整理（コミット `fdb2a36` → `c8b7bed` → `2ba9816`）を、コード編集時に参照できる形でまとめる。
識別モデル（id ＝ Drive fileId / 名前 ＝ Drive ファイル名）や同期（①〜⑥）の全体像は [data-model.md](data-model.md) を前提とする。本書はその上で「**参照（リンク）をどう持ち**」「**保存時に何を捨て・何を追従させるか**」を扱う。

## 全体の方針

3 コミットを通じた一貫した狙いは次の 2 点。

1. **参照は fileId 一本に絞る** — リンク（クエスチョン→フォーム `formId` / ダッシュボード→クエスチョン `questionId`）は id（fileId）だけで持ち、名前の二重持ちはやめる。リンク切れ復旧の責務は**中央辞書（マッピングストア）**に集約する。
2. **冗長な値は永続化しない** — fileId から復元できる派生値（`driveFileUrl`）は保存時に捨て、PropertiesService の容量を節約する。

## 1. 保存時に参照先へ整合を適用しリンクを追従（`fdb2a36`）

クエスチョン／ダッシュボードの保存時に、全体同期（①〜⑥）の論理↔物理整合エンジンを**参照先へ部分適用（①〜④）**する。保存した本体だけでなく、それが指すファイルのリンクも同時に正される。

- **クエスチョン保存**: 参照フォーム（`query.gui.formId` / `formSources[].formId`）へ ①〜④ を適用。
- **ダッシュボード保存**: 参照クエスチョン（`cards[].questionId`）と、そのクエスチョンが参照するフォームへ ①〜④ を適用。
- **fileId 変化への追従**: ②外部コピー / ③再採用で参照先の fileId が変わった場合、保存済みファイル（と中間のクエスチョン）のリンク（`formId` / `questionId`）を**新 id へ書き換える**。
- **remap の統一**: 整合エンジンの ③再採用でも旧→新 id を `ctx.remap` に記録するようにし、全体同期の自動再リンクが ③ にも追従するよう統一した（「全体同期も同様」）。
- **安全側 degrade**: base（標準フォルダ）が未解決の kind は no-op に落とす。

実装は `StdFolders_alignReferencesOnSave_`（`gas/standardFoldersAlignRefs.gs`）。`Forms_saveForm_`（`gas/formsStorage.gs`）/ `Analytics_saveTemplate_`（`gas/analyticsCrud.gs`）が保存後に呼び出し、結果を `result.referenceSync` として返す。テストは `tests/gas-alignment-engine.test.cjs` / `tests/gas-analytics-template-actions.test.cjs`。

### 1-1. 逆方向の完全再リンク（論理パス変更時のみ・ゲート付き）

§1 は「保存した本体（と中間クエスチョン）」のリンクだけを書き換えていた。**再配置されたファイルを指す他の参照元**（保存していない別クエスチョン / 別ダッシュボード / 別フォーム）は追従しなかったため、外部コピー（③）で原本が生き続けると各々の保存時に重複コピーが増え、move（②/物理追従）では参照元の論理パスアンカー（`*Path`）が陳腐化していた。

これを解消するため、**論理パスが実際に変わったときだけ**走る逆方向の完全再リンクを追加した（重い全走査なので無変更の保存ではゲートでスキップ）。

- **ゲート判定**: 整合の結果 `ctx.remap`（外部コピー③／再採用で **id 変化**）が非空、または `ctx.pathChanged`（move/物理追従で **`entry.folder` が実際に変化**、または保存本体自身の rename）が非空のときだけ発火。`entry.folder` が同値のまま（例: ② で論理パス不変の物理移動）なら `pathChanged` に積まず、no-op としてスキップする。
- **完全走査**: 発火時は登録済み forms / questions / dashboards 全件を 1 パスで走査し、各参照元に remap（id 振替）と中央辞書からの `*Path` 再 stamp を適用する（`StdFolders_propagateRelinkToAllRefs_` / `StdFolders_relinkRefsInFile_`）。手動の全件整列オーケストレータ `StdFolders_alignAllEntries_`（Phase B）も同じヘルパーに統一した。
- **保存本体の rename 伝播**: 保存層（`Forms_saveForm_` / `Analytics_saveTemplate_`）が保存前後の `folder`/名前を比較し、変化していれば `StdFolders_alignReferencesOnSave_(kind, fileId, selfChangedHint=true)` を渡して、その参照元のパスアンカーも追従させる。
- **冪等・非致命**: 再走査は無変更ファイルを書かない（カウントしない）ので 2 回目以降は 0 件。逆方向再リンクは専用 try/catch でラップし、失敗しても保存は止めない。呼出元の `WithScriptLock_` 内で動くため自前ロックは張らない（二重ロック回避）。

## 2. 参照は fileId のみ・中央辞書に論理パス `folder` を第一級昇格（`c8b7bed`）

### 2-1. マッピングストアの `folder` 第一級フィールド化

forms / questions / dashboards のマッピングストア（中央辞書）の各 entry に `folder`（**論理パス**）を第一級フィールドとして追加した。保存・走査・import・URL 更新の各経路で `folder` を埋める／維持する。

- `folder` は標準フォルダ配下の物理フォルダ階層をミラーする論理パス（[data-model.md](data-model.md) の「物理/論理フォルダの整合」参照）。
- **`null` は「未バックフィル」の sentinel**。`""`（ルート）とは区別する。`Forms_normalizeMappingValue_`（`gas/formsMappingStore.gs`）は文字列なら正規化、未設定は `null` を返す。

### 2-2. 解決フォールバックを「folder ＋ 名前のパス限定」優先へ

リンク解決のフォールバックを、**名前ツリー全体探索**から **`folder` ＋ 名前のパス限定探索を優先**する方式へ変更した。同名・異フォルダの誤解決を防ぐ。

### 2-3. 名前の二重持ちを廃止

ダッシュボード card / question 参照から `questionName`・`formName` の**二重持ちを廃止**し、保存時に剥がす（読取は寛容に無視＝後方互換）。リンク切れ復旧は**中央辞書（論理パス → fileId）に集約**する。

### 2-4. バックフィル（旧スキーマ救済）

旧スキーマ entry の `folder == null` を Drive 上の `json.folder` から埋める、**冪等なバックフィル手動実行 `Admin_backfillRegistryFolders_`**（`gas/adminMigrations.gs`）を追加。何度走らせても同じ結果になる。

## 3. 保存時は `driveFileUrl` を捨てる正規化（`2ba9816`）

`driveFileUrl` は fileId から復元できるため**永続化しない**。PropertiesService の容量制約に対して保存件数の上限を伸ばすのが狙い。**読取側は従来どおり完全なエントリ**（forms は `fileId` / `driveFileUrl` / `title` / `folder`、questions/dashboards は `fileId` / `driveFileUrl` / `name` / `folder`）を受け取る。**forms / questions / dashboards の 3 ストアすべてで対称**に適用する。

- **永続化用の最小化**:
  - forms: `Forms_normalizeMappingForStorage_`（`gas/formsMappingStore.gs`）が normalize 済みエントリから `driveFileUrl` を捨て、`fileId` / `title` / `folder` だけを残す。
  - questions/dashboards: `Analytics_saveMapping_`（`gas/analyticsApi.gs`）の保存正規化が同様に `driveFileUrl` を捨て、`fileId` / `name` / `folder` だけを残す。
  - いずれも `folder` は sentinel（`null`＝未バックフィル）も含めてそのまま残す。
- **保存経路**: `Forms_saveMapping_` / `Analytics_saveMapping_` が `normalize → driveFileUrl 除去 → JSON.stringify` の順で `{ version, mapping }` を書き込む。
- **読取経路での復元**: `driveFileUrl` は fileId から都度組み立てる（`https://drive.google.com/file/d/<fileId>/view`）。forms は `Forms_normalizeMappingValue_`、questions/dashboards は `Analytics_normalizeMappingValue_`（`Analytics_getMapping_` が読取時に適用）が再構築する。

```text
保存（persist）:  { fileId, driveFileUrl, title, folder }
                    └ minify ─→ { fileId, title, folder }   ← driveFileUrl を落とす
読取（load）:      { fileId, title, folder }
                    └ normalize ─→ { fileId, driveFileUrl(復元), title, folder }
```

## 4. 非エンティティ参照の論理パス化（プロジェクト外禁止）

forms / questions / dashboards の**エンティティ間参照**（formLink / Q→Form / D→Q）は中央辞書＋正準ビジターで論理パス化済み（§1〜3）。これに対し、**フォーム/レコードが URL で素のファイル・フォルダを指す参照**（中央辞書も `.json` 葉も持たない）も「プロジェクト外を禁止＝論理パスで指定し、物理 URL は読み取り専用」に統一する。

### 4-1. 統一モデル（全対象共通）

関係する保存時に、エンティティ整合エンジン（`StdFolders_alignEntry_` の ⓪①②③）と**同じ判定**で正規化する。

1. **物理優先で解決**（URL/ID → fileId）。ダメなら**論理パスで解決**（標準フォルダ配下を base から walk）。
2. **ホーム（対象標準フォルダ配下）= 据置** / **プロジェクト内の別フォルダ = move（fileId 保持）** / **プロジェクト外 = copy（新 fileId 採用）**。内外判定は `StdFolders_isFileUnderProjectRoot_`。
3. **論理パスを（再）導出**し、**物理 URL と論理パスの両方を保持**する。

実装は `gas/standardFolders.gs` の統一正規化器:

- ファイル参照: `StdFolders_alignFileRefIntoStdFolder_(key, url/id, path)` → `{ fileId, url, path, status }`（`status: aligned|moved|copiedExternal|recoveredByPath|unresolved|noop`）。`unresolved`/`noop` は呼出側が**既存値を据え置く**。
- フォルダ参照: `StdFolders_alignFolderRefIntoStdFolder_`（外部は**再帰コピー**し、`files[].driveFileId/Url` を新 id へ remap する）。
- 汎用パス解決 `StdFolders_resolvePathToFileId_(key, path)`（`StdFolders_resolveSpreadsheetPathToFileId_` は委譲ラッパー）。drivemap は持たず毎回 base から walk（スプレッドシート前例に倣う）。
- 標準フォルダ root 未解決時は全て **no-op に degrade**（保存は止めない・非致命 try/catch）。

### 4-2. 対象と保存フック

| 対象 | 標準フォルダ | 正規化タイミング | 実装 |
|--|--|--|--|
| 印刷様式 Doc（`settings.standardPrintTemplateUrl` / カード `printTemplateAction.templateUrl`） | `05_report_templates` | フォーム保存 | `StdFolders_normalizePrintTemplateRefsOnSave_`（`Forms_saveForm_` から）。論理パス `standardPrintTemplatePath` / `templatePath` を併設。出力時は `nfbResolveRecordOutputTemplateSourceUrl_` が物理優先・論理フォールバック |
| フォーム→スプレッドシート（`settings.spreadsheetId`） | `04_spreadsheets` | フォーム保存 | `Forms_resolveSpreadsheetSetting_` が `Forms_alignSpreadsheetIntoStd_` で寄せ、`spreadsheetPath` を正本化・`spreadsheetId` をクリア（path-wins） |
| アップロードフォルダ（fileUpload セルの `folderUrl`） | `06_upload_files` | レコード保存（スプレッドシート書込） | `SubmitResponses_` の upsert 前に `StdFolders_normalizeUploadCellsInResponses_`。セルへ `folderName` を併設（詳細は §5）、外部コピー時はファイル id も貼り替え |

### 4-3. UI（厳格運用）

エディタは生 URL 入力欄を廃し、論理パスのピッカーで選ぶ。物理 URL は読み取り専用表示。

- 印刷様式: `ReportTemplateSelectField` / `CustomTemplateUrlFields` は `05_report_templates` 限定のピッカー（生 URL 入力なし）。
- スプレッドシート: 論理パスは `spreadsheetSelect` ピッカー、`spreadsheetId` 欄は `readOnly`（`SettingsField` が `field.readOnly` を尊重）。

外部ファイルは事前にプロジェクト内へ配置する運用。保存時の正規化は**既存データ移行・誤配置の安全網**として働く（旧生 URL を次回保存で取り込み、論理パスを刻む）。

### 4-4. 非エンティティ参照の逆方向再リンク（対象は 05 のみ）

§1-1 の逆方向再リンクはエンティティグラフ（Q→Form / D→Q / Form→childForm）が対象。非エンティティ参照のうち**共有されうる印刷様式（05）だけ**逆方向再リンクの対象とする。

- **印刷様式（05）**: 標準様式 Doc は複数フォームで共有されうる。あるフォームの保存で様式 Doc を再配置（move/外部コピー）したとき、同じ Doc を**旧 fileId で指す他フォーム**の `standardPrintTemplateUrl/Path` ＋ カード `printTemplateAction.templateUrl/Path` を新位置へ張り替える。`StdFolders_normalizePrintTemplateRefsOnSave_` が再配置を `relocations` として返し、`Forms_saveForm_` が `StdFolders_propagateTemplateRelinkToForms_`（**forms マッピング限定の有界走査**・冪等・非致命）を呼ぶ。
- **スプレッドシート（04）・アップロード（06）は対象外**: いずれも **per-form / per-record 設計**で共有が稀（04 は各フォーム専用の回答シート、06 は各レコード専用のアップロードフォルダ）。06 はレコードがスプレッドシート全行に散在するため全シート走査が GAS 6 分制限に抵触する。よって自動の逆方向再リンクは行わず、各オーナーの保存時の自己正規化（`Forms_resolveSpreadsheetSetting_` / `StdFolders_normalizeUploadCellsInResponses_`）と手動の全件整列に委ねる（アップロードの物理優先・論理フォールバック解決の詳細は §5）。

## 5. アップロードファイルも物理ID優先・論理パスフォールバックへ

フォーム/シートのリンクと同様に、レコードの **アップロードファイル**（`fileUpload` フィールド）も
「物理 fileId 優先・論理パス（フォルダ名＋ファイル名）フォールバック」で解決するようにした。
これによりプロジェクトを移動・コピーしてもリンクを貼り直せる。

### 5-1. セル JSON に論理パス `folderName` を同梱

レコードの fileUpload セルは従来 `{ files:[{name, driveFileId, driveFileUrl}], folderUrl }` だったが、
**`folderName`（論理パスのフォルダ部）を追加**して `{ files, folderUrl, folderName }` で保存する。
各ファイルの論理パスは `06_upload_files/<folderName>/<name>`。キャッシュ（recordsMemoryStore）は
セル値をそのまま保持するので、別途のキャッシュ改修なしに論理パスを持つ。

- 直列化/復元: `serializeFileUploadValue` / `parseFileUploadStorage`（`builder/src/core/collect.js`）。
- フォルダ状態: `driveFolderState` に `folderName` を第一級で保持（`builder/src/utils/driveFolderState.js`）。
  オープン時に `collectFileUploadFolderNames`（`builder/src/utils/responses.js`）でセルから復元し、再保存で書き戻す（前進補完）。
- GAS 応答: `nfbBuildDriveFileResponse_` / `nfbFinalizeRecordDriveFolder`（`gas/driveFile.gs` / `gas/driveFolder.gs`）が `folderName` を返す。

### 5-2. フォルダ名はユーザー指定不可・ID 由来固定

論理パスの一意性（衝突耐性）を担保するため、保存先フォルダは常に `06_upload_files` 直下の
一意フォルダ `record_<id>_<uuid8>`（`nfbBuildRecordTempFolderName_`）に固定。旧仕様の
`driveFolderNameTemplate`（フォルダ名テンプレ）／`allowFolderUrlEdit`・`driveRootFolderUrl`（保存先URL変更）は
**廃止**し、`normalizeFileUploadSettings`（`builder/src/core/schema.js`）が残骸を除去する。

### 5-3. 解決（リゾルバ）と配線

- リゾルバ `Nfb_resolveUploadFileEntry_`（`gas/driveFile.gs`）: ① `driveFileId` 生存ならそのまま →
  ② 死亡/空なら自プロジェクトの `06_upload_files` 配下で `folderName` のフォルダ→`name` のファイルを探索 → ③ 不可なら空。
- 単票オープン: 物理が欠落しているとき公開 API `nfbResolveUploadFiles` を呼んで自己修復（`FileUploadField` の effect → `onChange` → 次回保存で前進補完）。
- 出力（PDF/Doc/Gmail/印刷）: `Nfb_resolveFileUploadMetaUrls_`（`gas/driveOutput.gs`）が `nfbNormalizeRecordTemplateContext_` で
  fileUploadMeta の URL/フォルダURL が空のとき `folderName`＋`rawFileNames` から復元する。

### 5-4. システムごとコピー（copyData=true）は物理を空にして論理に任せる

`makeCopy` はフォルダ名・ファイル名を保持し、リゾルバは常に自プロジェクトの `06_upload_files` を起点にするため、
コピー時にレコードセルの物理（`driveFileId`/`driveFileUrl`/`folderUrl`）を**空にして論理パスだけ残す**だけで、
読取/出力時にコピー先の複製へ自動バインドする（idMap 突合は不要）。実装は `StdFolders_clearUploadPhysicalInSpreadsheet_` /
`StdFolders_clearUploadPhysicalInCell_`（`gas/standardFoldersCopy.gs`）。物理を残すとコピー元を指し続ける（クロスプロジェクト漏れ）ため、必ず空にする。

### 5-5. フォルダ削除時はレコードのリンクもクリア

レコードでアップロードフォルダを削除すると Drive 上はゴミ箱へ行く。これに合わせ、`handleDeleteDriveFolder`
（`builder/src/pages/FormPage.jsx`）が当該フィールドの **レスポンス値（files 配列）もクリア**し、`markDriveFolderForDeletion`
が `folderName` も落とす。保存時にセルが空になり、ゴミ箱を指す死リンクが残らない（実ファイルは `extraTrashFileIds` で確実に trash）。

## 6. Single Source of Truth — 論理＝正本／物理＝キャッシュ、registry の二層化

§1〜5 で「参照は fileId 一本＋論理パス（`*Path`）の復旧アンカー」「`driveFileUrl` は非永続化」まで寄せた。これをさらに「**キャッシュ（IndexedDB）を除き、同じデータを 2 箇所に持たない**」方針へ整理したのが本節。

### 6-1. 確定モデル

- **論理パス＝耐久的な正本**。各エンティティ自身の論理パスは **Script Properties registry**（`{ 物理ID(fileId), 論理パス(folder＋ファイル名) }` のみ）に、各**リンクの宛先**は home ファイル内の `*Path` 復旧アンカー（`formPath`/`questionPath`/`spreadsheetPath`/`standardPrintTemplatePath`/`templatePath`/`folderName`/`childFormPath`）に持つ。
- **物理 fileId ＝消去可能なキャッシュ**。解決は物理優先（速い）→死んでいれば論理で貼り直し→次回保存で物理を前進補完。**コピー時は物理を全消去して論理だけ残す**。
- **registry の二層**: サーバ側（保存/整合/コピー）は **Script Properties registry**（最小・耐久バックストップ）。フロントの参照解決・一覧表示は **IndexedDB registry**（作業キャッシュ・派生再構成可能）。GAS は IndexedDB を読めないため両者は別物で、二重持ちではなく「耐久バックストップ＋作業キャッシュ」の関係。

### 6-2. 相手の「名前」の二重持ちを完全撤去（Phase 1）

§2-3 で名前の二重持ちを「廃止（保存時剥がし）」したが、**読みフォールバックも撤去**した。リンク切れ復旧は registry の `folder＋title/name` アンカーと home の `*Path` に一本化する。

- `Forms_resolveFormRef_`（`gas/formsCrud.gs`）から旧 `ref.formName` 名前フォールバック（Step3）を削除。残すのは id（fileId）解決 + registry（folder+title）アンカー解決。
- `Analytics_resolveItemFileOrNull_`（`gas/analyticsCrud.gs`）の `idFallbackName` を撤去（id 由来の名前探索をやめる）。`entry.name`（registry 内の自分のファイル名アンカー）は保持。
- サーバ側でも保存前に `StdFolders_stripRefNames_`（`gas/standardFoldersAlignRefs.gs`）で `formName`/`questionName`/`childFormName` 残骸を確定的に剥がす（フロント剥がしの二重防御）。`Analytics_saveTemplate_` / `Forms_saveForm_` が `stampRefPaths` の前に呼ぶ。

### 6-3. フロント IndexedDB registry（Phase 3）

- IndexedDB（`NestedFormBuilder`）を **v9→v10** に上げ、`registry` ストア（`keyPath: "id"`・`kind` index）を**加算**（既存ストア非破壊）。値は `{ id(=fileId), kind, fileId, folder, name, driveFileUrl }` で 3 種を統合。
- ストアは `builder/src/app/state/registryStore.js`（`upsert`/`fillFromList`/`loadAll`/`get`/`remove`/`clear`/`lastSyncedAt`/`isEmpty`）。`analyticsCache.js` の `makeListCache` パターンを流用。
- 充填フック（非ブロッキング・fail-safe）: 一覧取得（`dataStore.listForms` / analytics の `fetchAndStore_`）でサーバ確定の一覧から `fillFromList(stampSyncTime)`、保存ジョブ完了（`uploadWorker` の `reconcileEntityCache`、local_→実 fileId 確定）で `upsert`。
- 喪失耐性: 空でも list API / GAS 再構成 API（§6-4）から再生成できる（データ損失なし）。

### 6-4. GAS registry 再構成 API（Phase 4）

`Admin_rebuildRegistryFromLogical_`（`gas/adminMigrations.gs`）が標準フォルダ `01_forms`/`02_questions`/`03_dashboards` を走査し、**type はフォルダ位置で確定**（JSON に kind を埋めない）、各 `.json` を folder＋ファイル名で再登録して Script Properties registry を作り直す。registry 喪失・不整合の復旧、コピー先の初回解決ゲート（§6-5）に使う。

### 6-5. プロジェクトコピー＝物理全消去→論理再解決（Phase 5）

§5-4 のアップロードセルと同じ考え方を**エンティティ参照・spreadsheet・印刷様式**にも広げ、コピーは idMap remap をやめて「**物理 ID を全消去・論理（`*Path`）を温存・コピー先で再解決**」へ転換した。

- **コピー時（コピー元で実行）**: `StdFolders_rewireEntityRefsInJson_` がエンティティ参照（`formId`/`questionId`/`childFormId`）を空にし `*Path` を温存。`StdFolders_rewireFormFile_` は `settings.spreadsheetId` / `standardPrintTemplateUrl` / カード `templateUrl` も物理消去し各 `*Path` を温存（いずれも `gas/standardFoldersCopy.gs`）。コピー元 fileId を残すとコピー先がコピー元（別プロジェクトの生存 fileId）を指す事故になるため必ず消す。idMap は「コピー対象に含まれたか」（再解決可能か）の判定だけに使う。
- **コピー先 初回解決ゲート（コピー先で実行）**: `StdFolders_importMapping_`（`gas/standardFolders.gs`）がコピー由来ドキュメント（`sourceRootId` 付き）の取り込み時に、① `Admin_rebuildRegistryFromLogical_` で registry を充填 → ② `Admin_reresolveAllRefsFromLogical_` で全エンティティの空/死 id を `*Path` から `StdFolders_reresolveRefsFromLogical_`（`gas/standardFoldersAlignRefs.gs`）で貼り直す。エンティティ参照は読取時の論理フォールバックが無いためここで物理を確定する（spreadsheet/印刷様式は読取/出力時にも論理フォールバックするが、ゲートでも前進補完する）。
- **正準ビジターの拡張**: `StdFolders_forEachRef_` のゲートを「id か `*Path` の少なくとも一方を持つ」に変更し、物理を全消去され `*Path` だけ残った参照も拾えるようにした。

## まとめ（保存時に何が起きるか）

| 観点 | 振る舞い | 実装 |
|--|--|--|
| 参照の持ち方 | id（fileId）＋論理パス（`*Path`）のみ。相手の名前（`formName`/`questionName`/`childFormName`）は保存時に剥がし、**読みフォールバックも撤去**（§6-2） | `c8b7bed` / 本節 §6 |
| リンク切れ復旧 | registry（論理パス `folder` ＋ 名前 → fileId）と home の `*Path` で解決。folder＋名前のパス限定を優先 | `c8b7bed` |
| 論理＝正本／物理＝キャッシュ | 物理 fileId は消去可能なキャッシュ。コピー時は物理全消去→コピー先で `*Path` から再解決（§6-5）。registry は Props 最小＋IndexedDB キャッシュの二層（§6-1/§6-3） | 本節 §6 |
| 保存時の参照追従 | 参照先へ ①〜④ 整合を部分適用し、fileId 変化を `formId`/`questionId` へ追従（remap） | `fdb2a36` |
| 逆方向の完全再リンク | **論理パスが変わったときだけ**（remap または move/rename でゲート）登録済み全エンティティを走査し、再配置ファイルを指す全参照元の id（remap）と `*Path`（再 stamp）を追従。05 印刷様式は forms 限定で逆張り替え。04/06 は per-form/per-record のため対象外 | 本節 §1-1 / §4-4 |
| 永続化の最小化 | `driveFileUrl` を捨て fileId から都度復元。読取は完全なエントリ。forms / questions / dashboards の 3 ストアで対称 | `2ba9816` |
| 旧データ救済 | `folder == null`（未バックフィル sentinel）を Drive json から冪等に埋める | `c8b7bed` |

## 関連ファイル

- `gas/formsMappingStore.gs` — forms マッピングストア。normalize / minify / save / URL 復元
- `gas/formsFolderStore.gs` / `gas/analyticsFolderStore.gs` — folder 第一級フィールドの保持。登録簿 CRUD の本体は型汎用コア `gas/sharedFolderStore.gs`（`StdFolderStore_*`）に集約し、両者は型別 adapter を渡す薄いラッパー
- `gas/sharedDriveFolders.gs`（`SharedDrive_*`）— forms/analytics 共通の仮想↔物理フォルダミラーコア（`FormsDrive_*` / `AnalyticsDrive_*` が descriptor を渡して委譲）
- `gas/standardFoldersAlign.gs` — 整合エンジン（`StdFolders_alignEntry_`）と全件整列 `StdFolders_alignAllEntries_`、逆方向の完全再リンク `StdFolders_propagateRelinkToAllRefs_`（§1-1）
- `gas/standardFoldersAlignRefs.gs` — 保存時の参照整合 `StdFolders_alignReferencesOnSave_`（`selfChangedHint` で本体 rename も伝播）、参照ビジター、`StdFolders_relinkRefsInFile_` / `StdFolders_refreshRefPathsInFile_`
- `gas/standardFolders.gs` — 非エンティティ参照の統一正規化（`StdFolders_alignFileRefIntoStdFolder_` / `StdFolders_alignFolderRefIntoStdFolder_` / `StdFolders_normalizePrintTemplateRefsOnSave_` / `StdFolders_normalizeUploadCellsInResponses_`）と 05 逆方向再リンク `StdFolders_propagateTemplateRelinkToForms_`（§4）。フック元は `gas/formsStorage.gs`（フォーム保存）/ `gas/codeHandlers.gs`（レコード保存）/ `gas/driveOutput.gs`（出力時解決）
- `gas/standardFoldersDiagnostics.gs` — 構成リンク診断レポート + 参照の恒久再リンク（`standardFolders.gs` から分離）
- `gas/analyticsCrud.gs` — `Analytics_saveTemplate_`（保存後に参照整合を呼び出し `referenceSync` を返す。保存前に `StdFolders_stripRefNames_` で相手名を剥がす）
- `gas/standardFoldersCopy.gs` — プロジェクトコピー本体。`StdFolders_rewireEntityRefsInJson_` / `StdFolders_rewireFormFile_` が物理全消去・論理温存（§6-5）
- `gas/adminMigrations.gs` — `Admin_backfillRegistryFolders_`（folder バックフィル）、`Admin_rebuildRegistryFromLogical_`（registry 再構成・§6-4）、`Admin_reresolveAllRefsFromLogical_`（コピー先の論理→物理 再解決・§6-5）
- `builder/src/app/state/registryStore.js` — フロント IndexedDB registry 作業キャッシュ（§6-3）。充填フックは `dataStore.listForms` / `analyticsStore.fetchAndStore_` / `uploadWorker.reconcileEntityCache`
- 詳細な識別モデル・同期（①〜⑥）・リンク診断/修復は [data-model.md](data-model.md)
