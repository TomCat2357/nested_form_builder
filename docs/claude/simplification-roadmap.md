# 簡素化リファクタリング・ロードマップ（進捗トラッカ）

> このファイルは「コードを最低限機能へ再定義して簡素化する」連続作業の**進捗台帳**。
> セッションを跨いで再開できるよう、完了済み・残タスク・方針・検証手順を 1 箇所に集約する。
> 作業ブランチ: `claude/code-simplification-refactor-bvRmf`

## 背景（なぜやるか）

開発の累積でコードが肥大化（フロント `builder/src` 約59,000行/363ファイル、GAS `gas/` 約12,700行/45ファイル）。
**機能（振る舞い）は維持したまま**、重複・過剰分割・巨大ファイルを整理してコード量と複雑性を減らす。

確定した前提（ユーザー合意）:
- **方針**: 機能維持・重複削減リファクタ（オプション機能の削除はしない）
- **動作保証**: コア機能（フォームCRUD・ネスト編集・回答入力・検索・Drive/Sheets保存）の振る舞いは維持。細部UI/エッジ挙動の軽微な変更は許容。
- 「効果が大きく・リスクが低い」順に進める。各フェーズは独立してコミット・テスト可能な単位。

## お手本にする既存パターン（新規発明より優先して流用）

- **型汎用コア＋アダプタ**: `gas/sharedFolderStore.gs`、`gas/sharedDriveFolders.gs`、`gas/sharedEntityCrud.gs`（本作業で追加）。
- **共用ヘルパ**: `Nfb_resolveFileIdFromEntry_` / `Nfb_dedupeMappingByFileId_` / `Nfb_nameFromFile_`（`gas/formsCrud.gs`）。
- **フロント走査・コーデックの正本**: `builder/src/core/schemaUtils.js`、`builder/src/utils/pathCodec.js`、`builder/src/utils/numbers.js`。

## 検証コマンド（各フェーズ後に必ず緑を確認）

```bash
npm test            # GASユニット + 等価性テスト（359件）
npm run test:builder # フロントのインラインテスト（約1,396件。exceljs/jszip 依存の2本のみ builder:install 前提）
npm run test:all     # 上記まとめて
npm run bundle:gas   # gas/*.gs → dist/Bundle.gs 結合が通るか
npm run builder:build # フロントビルドが通るか（vite。要 builder:install）
npm run test:playwright # E2E（Phase 4 で重点）
```

---

## ✅ 完了済み

### Phase 0 — 安全網の有効化（コミット `2935949`）
重要発見: `builder/src/**/*.test.js` 105ファイル・約1,396テストは全て `node:test` で書かれ依存ゼロで動くのに、**npmスクリプトに配線されておらず実行されていなかった**。
- `package.json` に `test:builder` / `test:all` を追加（既存 `test` は不変＝後方互換）
- `docs/claude/testing.md` 更新
- → これで Phase 2〜5（フロント中心）を回帰検知しながら進められる

### Phase 1 — GAS: 物理ファイル解決ロジックの共通コア化（コミット `bb001f8`）
`Forms_resolveFormFileOrNull_` と `Analytics_resolveItemFileOrNull_` が二重実装していた多段解決
（fileId生存→URL救済→folderスコープ名前一致→名前ツリー探索→id名フォールバック）を
新規 `gas/sharedEntityCrud.gs` の `SharedCrud_resolveEntityFileOrNull_` に集約。各 public 関数は
Driveバックエンド差分を opts コールバックで注入する薄いラッパーに。**振る舞い不変**。
- `gas/scripts/bundle.js` と 関連テスト2本（`tests/gas-forms-save-actions.test.cjs` /
  `tests/gas-analytics-template-actions.test.cjs`）のロード一覧に新ファイルを追加。

### Phase 2 — フロント: 有限数値coerce(既定0)の集約（コミット `446adf3`）
`Number.isFinite(Number(x)) ? Number(x) : 0` の同一coerceが状態/同期5箇所に散在 →
`builder/src/utils/numbers.js` に `toFiniteNumberOr(raw, fallback)` を追加し置換。**振る舞い不変**。
- 対象: `dataStoreHelpers.js`(3) / `globalSyncState.js`(1) / `syncUploadPlan.js`(1)
- 注: `getUnsyncedState` の `""`→0 とみなすフォールバック連鎖は意味論が異なるため**対象外**。

> スコープ補足: 当初調査の「normalize系13ファイルの大量重複」は実態としては過大だった。
> フロントは小さな ad-hoc coerce の散在が主で、機械的な一括統合はかえって複雑化する。
> 本当に同一の箇所だけを統合する方針（過剰統合を避ける）。

---

## ⏳ 残タスク

### Phase 3 — フロント: analytics ユーティリティの再集約（高効果・中リスク）
問題: `builder/src/features/analytics/` が全体の約35%（113ファイル/16,700行）。`utils` だけで
74ファイル（`compileStages.js` 505行、`sqlPreprocessor.js`、`sqlColumnInference.js`、
`columnValueInference.js` 等）に過剰細分化。検索SQLモード（`features/search/searchQueryEngine.js`
905行）と分析SQL基盤に重複の疑い。
- 着手前に: analytics の特性化テストを確認/補強（既存テストの網羅範囲を先に把握）。
- approach: 74個を責務別に5〜8モジュールへ統合（SQLコンパイル/前処理・列推論・値整形・テーブル登録）。
  1関数1ファイルの過剰分割を解消。検索SQLモードと Question SQL の実行入口を1本化できるか実検証。
- 既存の共通基盤: `features/analytics/utils/computeShared.js`（`toFiniteNumberOrNull` 等を再輸出）、
  `utils/numbers.js`。
- 検証: `node --test "builder/src/features/analytics/**/*.test.js"` /
  `searchQueryEngine.test.js` / `template-equivalence.test.cjs`。

### Phase 4 — フロント: 巨大ページのロジック分離（中効果・中リスク）
問題: 多責務の単一ファイル。`pages/FormPage.jsx`(755) /
`pages/admin/DashboardEditorPage.jsx`(704) / `pages/admin/QuestionEditorPage.jsx`(668) /
`features/search/useSearchPageState.js`(664) / `features/preview/PreviewPage.jsx`(610)。
- approach: データ取得・保存・キャッシュ同期・印刷・フォルダ操作などの非UIロジックを
  カスタムフック/純関数へ抽出（FormPage は既存 `formPageActionHandlers.js` 系の分割を強化）。
  Dashboard/Question エディタは CRUD・SQL編集・プレビューをフック化し共通部分を共有化。
- 目標: 各ファイル ~300行以下、UIは描画に専念。
- 検証: フロントテスト + `npm run test:playwright`（または verify スキル）でフォーム読込・保存・
  検索・ダッシュボード表示を確認。

### Phase 5 — フロント/GAS 双子ロジックの同期自動化（中効果・中リスク）
問題: 手作業同期している双子 — `pathCodec.js`↔`pathCodec.gs`、
`templateEvaluator.js`↔`templateEvaluator.gs`（バランスブレースscannerを二重実装）、
`headerKeyToAlaSqlKey`。等価性テストで担保しているが手動同期は漏れの温床。
- approach: 既存の「フロントJS→esbuild生成」方式（`builder/src/features/expression/gasRuntimeEntry.js`
  → `gas/generated/nfbAlasqlUdfs.gs`、`npm run build:gas-udfs`）を pathCodec と templateEvaluator の
  scanner にも拡張し GAS版を生成物化。困難な部分は最低限「等価性テストの必須CI化」で乖離防止。
- 検証: `path-codec-equivalence.test.cjs` / `template-equivalence.test.cjs` / `npm run bundle:gas`。

### Phase 6 — GAS: 多責務ファイルの責務分離（中効果・低〜中リスク）
問題: `gas/adminAuth.gs`(432行)＝キー管理＋メール管理＋Googleグループ解決＋キャッシュの多責務。
`gas/driveOutput.gs`(526行)＝テンプレ解決＋PDF生成＋メタ刻印が混在。
`gas/standardFoldersAlign.gs`(355行)＝整合エンジンのケース判定が冗長。
- approach: `adminAuth.gs` を責務単位に分割（キー / メール・グループ解決 / キャッシュ。public関数名は維持）。
  `driveOutput.gs` のテンプレ解決→`templateEvaluator.gs`、PDF生成→`drivePrintDocument.gs` へ委譲し
  オーケストレーションに専念。`standardFoldersAlign.gs` のケース①〜④判定を表/状態機械化。
  分割ファイルは `gas/scripts/bundle.js` のロード一覧へ追加すること。
- 検証: `gas-standard-folders.test.cjs` / `gas-alignment-engine.test.cjs` /
  `gas-drive-template-replacement.test.cjs` / `npm run bundle:gas`。

---

## 運用ルール

- **1フェーズ＝1コミット群**。各フェーズ完了時に該当テスト（GAS/フロント）緑を確認してコミット。
- GAS ファイルを新規追加したら **必ず `gas/scripts/bundle.js` のロード一覧へ追加**し、
  関連テストの VM ロード一覧（`tests/*.test.cjs` の `filesToLoad` / `loadGasFiles`）にも追加する。
- PRはユーザー明示時のみ作成。
- 振る舞いはコア機能で維持。挙動が変わりうる箇所はコミットメッセージ/PR説明に明記。
- 依存順の目安: Phase 2の正本ヘルパが Phase 3/4で使われる。Phase 5はビルド基盤に触るため後段。
  Phase 1/2/6 は相互独立。

## 再開時のクイックスタート

```bash
git switch claude/code-simplification-refactor-bvRmf
git pull origin claude/code-simplification-refactor-bvRmf
npm run test:all     # 現状の安全網が緑か確認（要 builder:install で2本の依存解消）
# → 本ファイルの「残タスク」から次フェーズを選んで着手
```
