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

実装は `StdFolders_alignReferencesOnSave_`（`gas/standardFoldersAlign.gs`）。`Analytics_saveTemplate_`（`gas/analyticsCrud.gs`）が保存後に呼び出し、結果を `result.referenceSync` として返す。テストは `tests/gas-alignment-engine.test.cjs` / `tests/gas-analytics-template-actions.test.cjs`。

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

`driveFileUrl` は fileId から復元できるため**永続化しない**。PropertiesService の容量制約に対して保存件数の上限を伸ばすのが狙い。**読取側は従来どおり完全なエントリ**（`fileId` / `driveFileUrl` / `title` / `folder`）を受け取る。

- **永続化用の最小化**: `Forms_minifyMappingForPersist_`（`gas/formsMappingStore.gs`）が normalize 済みエントリから `driveFileUrl` を捨て、`fileId` / `title` / `folder` だけを残す。`folder` は sentinel（`null`＝未バックフィル）も含めてそのまま残す。
- **保存経路**: `Forms_saveMapping_` が `normalize → minify → JSON.stringify` の順で `{ version, mapping }` を書き込む。
- **読取経路での復元**: `driveFileUrl` は `Forms_buildDriveFileUrlFromId_(fileId)`（`https://drive.google.com/file/d/<fileId>/view`）で都度組み立てる。

```text
保存（persist）:  { fileId, driveFileUrl, title, folder }
                    └ minify ─→ { fileId, title, folder }   ← driveFileUrl を落とす
読取（load）:      { fileId, title, folder }
                    └ normalize ─→ { fileId, driveFileUrl(復元), title, folder }
```

## まとめ（保存時に何が起きるか）

| 観点 | 振る舞い | 実装 |
|--|--|--|
| 参照の持ち方 | id（fileId）のみ。名前（`formName`/`questionName`）は保存時に剥がす | `c8b7bed` |
| リンク切れ復旧 | 中央辞書（論理パス `folder` ＋ 名前 → fileId）で解決。folder＋名前のパス限定を優先 | `c8b7bed` |
| 保存時の参照追従 | 参照先へ ①〜④ 整合を部分適用し、fileId 変化を `formId`/`questionId` へ追従（remap） | `fdb2a36` |
| 永続化の最小化 | `driveFileUrl` を捨て fileId から都度復元。読取は完全なエントリ | `2ba9816` |
| 旧データ救済 | `folder == null`（未バックフィル sentinel）を Drive json から冪等に埋める | `c8b7bed` |

## 関連ファイル

- `gas/formsMappingStore.gs` — forms マッピングストア。normalize / minify / save / URL 復元
- `gas/formsFolderStore.gs` / `gas/analyticsFolderStore.gs` — folder 第一級フィールドの保持
- `gas/standardFoldersAlign.gs` — 整合エンジン（①〜⑥）と保存時の参照整合 `StdFolders_alignReferencesOnSave_`
- `gas/analyticsCrud.gs` — `Analytics_saveTemplate_`（保存後に参照整合を呼び出し `referenceSync` を返す）
- `gas/adminMigrations.gs` — `Admin_backfillRegistryFolders_`（folder バックフィル）
- 詳細な識別モデル・同期（①〜⑥）・リンク診断/修復は [data-model.md](data-model.md)
