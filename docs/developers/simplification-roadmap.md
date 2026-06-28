# 簡素化リファクタリング・ロードマップ（進捗トラッカ）

> このファイルは「コードを最低限機能へ再定義して簡素化する」連続作業の**進捗台帳**。
> セッションを跨いで再開できるよう、完了済み・残タスク・方針・検証手順を 1 箇所に集約する。
> 作業ブランチ: `claude/simplification-roadmap-2p1k1`（Phase 3〜6 を実施）

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
- `docs/developers/testing.md` 更新
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

### Phase 6 — GAS: 多責務ファイルの責務分離（コミット `71ad412`）
GAS 関数はバンドル時にグローバル連結されるため、ファイル分割は**公開名・呼び出しを一切
変えない純粋な再配置**で済む（bundle.js の FILE_ORDER と各テストの `loadGasFiles` 一覧に
新ファイルを追加するだけ）。**振る舞い不変**。
- `adminAuth.gs`(433) → `adminAuthKey.gs`（キー）/ `adminAuthGroupCache.gs`（グループメンバの
  Script Properties キャッシュ）/ `adminAuthEmail.gs`（メール・グループ解決・判定）。
- `driveOutput.gs`(526) → `driveOutput.gs`（出力種別の振り分け・テンプレコンテキスト合成＝
  オーケストレーション）/ `driveOutputDocument.gs`（Google Doc/PDF 生成プリミティブ + テンプレ
  差し込み）。※ ロードマップ当初案の「templateEvaluator.gs / drivePrintDocument.gs へ委譲」は
  それらの既存スコープを濁すため、専用の兄弟ファイル分離に変更。
- `standardFoldersAlign.gs`(356) → `standardFoldersAlign.gs`（(2.6) 整合エンジン）/
  `standardFoldersAlignRefs.gs`（(2.7) 保存時の参照整合）。コメントの節境界をそのまま分割線に。
  ※「ケース①〜④の状態機械化」は副作用を持つ命令的分岐で人工的になりリスクが高いため見送り、
  既に明快な現コードのまま責務分離のみ実施。
- 検証: `npm test`(359) / `npm run bundle:gas`(53 files) 緑。

### Phase 5 — フロント/GAS 双子ロジックの乖離防止（コミット `da14976`）
手作業同期の双子（`pathCodec.js`↔`.gs`、`templateEvaluator.js`↔`.gs`、schema walkers、
coerce-to-string）は既存の等価性テストで担保済み。これを**CI で必須化**して再生成/手動同期
忘れを自動検知する方針（ロードマップが許容する「困難な部分は最低限 CI 化」）を採用。
- `.github/workflows/ci.yml` 追加: `npm test`（GAS+等価性）/ `test:builder`（フロント+等価性）/
  `bundle:gas` / `builder:build` / `build:gas-udfs` 後の `gas/generated/` 差分ゼロ検査。
- `builder/vite.config.mjs`: エントリ HTML が `Index.html`（大文字 I）のため大小区別する
  Linux（CI/コンテナ）で Vite 既定の `index.html` 探索が失敗していた問題を、
  `build.rollupOptions.input` の明示指定で解消（クロスプラットフォーム化・出力名は不変）。
- 見送り: pathCodec.gs / templateEvaluator.gs の IIFE 生成化。GAS グローバル関数名（`Nfb_*` /
  `nfb*`）が全域から直接呼ばれており、生成物化には全呼び出しの書き換え or 薄いラッパー層が必要で
  高churn/高リスク。等価性テストの CI 必須化で乖離は十分に防げると判断。

### Phase 4 — フロント: 巨大ページのロジック分離（一部完了・コミット `5a37676`）
回帰リスクの低い**純ロジック抽出**を先行実施。エディタの保存/変換ロジックを副作用のない
純関数モジュールへ切り出してユニットテストを付けた。**振る舞い不変**。
- `pages/admin/questionEditorPayload.js`: `parseYFields` / `buildRunQuery` / `buildSaveQuery` /
  `buildQuestionVisualization`（+15 tests）。QuestionEditorPage 668→619 行。
- `pages/admin/dashboardEditorPayload.js`: `buildDashboardPayload`（`now` 注入可・+5 tests）。
  DashboardEditorPage 704→689 行。
- 検証: `npm run test:builder`(1418) / `npm run builder:build` 緑。

---

## ⏳ 残タスク

### Phase 3 — 再評価により縮小（当初の重複前提が不成立）
当初仮説「検索SQLモードと分析SQL基盤に重複」「analytics utils が過剰細分化（74ファイル）」を
精査した結果、**いずれも実態と乖離**していた（Phase 2 で normalize 系を過大評価したのと同じ構図）。
- 検索の SQL モードは既に Question SQL と同一実行基盤を共有済み（CLAUDE.md 記載どおり）。
  `searchQueryEngine.js`(905) は**簡易モードのトークナイザ/ハイライト専用**で、分析の SQL
  コンパイル（`compileStages.js` ほか）とは解く問題が異なり重複していない。
- analytics の非テスト utils は実測 **40ファイル/4,233行**（当初「74」はテスト込みの過大計上）。
  SQL テキスト走査の三点（`sqlLiteralMask.js` / `sqlMaskScanner.js` / `sqlExprParse.js`）は
  `features/expression/` からも使われる**基盤共有モジュール**で、束ねるとかえって grab-bag 化し
  凝集度を下げる。ロードマップ自身の「過剰統合を避ける」原則に反するため**機械的統合は見送り**。
- 残す価値のある作業があるとすれば、小粒な単一用途 util の局所的な同居程度（効果小）。着手する
  場合は「本当に同一の重複だけを畳む」方針を厳守すること。

### Phase 4 残り — 局所的な util 同居（効果小・任意）
JSX サブコンポーネント分離は完了（下記✅）。Phase 3 で言及した「小粒な単一用途 util の
局所的な同居」のみが任意の残作業として残る。着手する場合は「本当に同一の重複だけを畳む」
方針を厳守すること（効果小・優先度低）。

---

## ✅ 完了済み（続き）

### Phase 4 完了 — 巨大ページの JSX サブコンポーネント / カスタムフック分離（振る舞い不変）
当初目標「~300 行」に向けて、各巨大ページ/フックを**振る舞い不変の純粋な再配置**で分離。
副作用のない純ロジックは co-located `*.test.js` 付きで別モジュール化、繰り返し JSX は
プレゼンテーショナル子コンポーネントへ、凝集した state/effect はカスタムフックへ抽出。
DOM 構造・props・className・条件分岐・フック呼び出し順序・依存配列を厳密に維持。
- `pages/QuestionEditorPage.jsx`: **620 → 167 行**。`useQuestionEditor.js`（state/effect/handler）/
  `questionEditorComponents.jsx`（メタ入力・モード fieldset・GUI/SQL パネル）/ `questionEditorState.js`
  （可視化 state 変換・viz プレビュー組み立ての純関数 +12 tests）。
- `pages/admin/DashboardEditorPage.jsx`: **690 → 537 行**。`useDashboardEditorData.js`（2 本の
  `useCancellable` ロードと関連 state）/ `dashboardEditorFilterCards.jsx`（共通/簡易フィルタ行）/
  `dashboardEditorColumns.js`（列メタ集約の純関数 +6 tests）。
- `features/preview/PreviewPage.jsx`: **1024 → 847 行**。`useFormLinkChildData.js`（formLink 子データの
  fetch/subscribe effect と memo）/ `PreviewRecordMeta.jsx`（レコードメタ入力）/ `previewDriveFolder.js`
  ・`previewLiveRow.js`（純関数 +8 tests）。※ full-query/precompile/childForms-warming の effect
  クラスタは `previewForms`/`tokenContext`/`buildLiveRow` への強結合のため**安全側で保留**。
- `features/search/useSearchPageState.js`: **1101 → 967 行**。純ロジックのみ抽出（フック分割なし）:
  `searchPageSettings.js`（表示設定/ページネーション）/ `searchPageUrlParams.js`（?q/?sort/?page）/
  `searchPageColumns.js`（列集合/置換依存列/テンプレ）/ `searchPageRows.js`（行整形/出力名）/
  `searchChildFormResolvers.js`（外部アクション子データの async リゾルバ）+39 tests。
  ※ 子データ/full-query/置換再計算の state クラスタは effect 宣言順依存のため**保留**。
- `pages/FormPage.jsx`: **766 → 755 行**（小幅）。既に `formPage*` 群へ大半委譲済みのため、
  `FormPageContent.jsx`（ツールバー+プレビュー表示）と `formPageViewState.js`（バッジ/確認文言/
  settings 構築の純関数 +10 tests）のみ安全分離。残りはコンポーネント不可分なボイラープレート。
- 検証: `npm run test:builder`(1765 / +75 新規) / `npm run builder:build`(364 modules) / `npm test`(GAS 499)
  すべて緑。純減 928 行（5 ファイル合算 1226 削除 / 298 追加。抽出先の新規モジュールは別途）。

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
git switch claude/simplification-roadmap-2p1k1
git pull origin claude/simplification-roadmap-2p1k1
npm run builder:install
npm run test:all     # 現状の安全網が緑か確認（GAS 359 / フロント 1418）
# → 残タスクは Phase 4 残り（JSXサブコンポーネント分離）と、必要なら Phase 3 の局所的同居のみ
```

> Phase 3〜6 は本ブランチで実施済み（Phase 3 は再評価で縮小、Phase 4 は純ロジック抽出まで）。
> 詳細は上記「完了済み」「残タスク」を参照。
