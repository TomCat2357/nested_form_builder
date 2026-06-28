# 検索クエリ構文（Claude 向け詳細）

CLAUDE.md から分離した、検索画面のクエリ構文リファレンス。`searchSyntaxPreprocessor.js` / `searchQueryEngine.js` を触るときや検索仕様を確認するときに参照する。

検索バーには 2 モードある:

1. **簡易モード**（プレフィックスなし） — 裸単語・`列名:値` の正規表現/比較。
2. **SQL モード**（先頭 `SELECT`） — 本物の SELECT 文。自フォームを `_form` で参照し、本文にサブクエリ・別フォーム参照を書ける（親子横断はここで）。Question の SQL モードと同じ実行基盤を共有する。

> 旧「厳密モード」（先頭 `SEARCH` / `WHERE`）は廃止した。単一フォームの WHERE 絞り込みは SQL モード（`SELECT * FROM _form WHERE …`）で書く。旧プレフィックス `SEARCH` / `WHERE` は今は特別扱いされず、素の簡易検索テキストとして解釈される。

メンタルモデル: 1 は「`SELECT 表示列 FROM 対象フォーム WHERE …` の WHERE 節だけが可変」。2 は最上位 SQL 全体を書くが、**結果のうち「自フォームの `id` を持つ行」だけが検索結果（その id のレコード）に対応づく**。自フォームは `_form` で参照する。

## 簡易モード（プレフィックスなし）

```text
keyword                   # 裸単語=全列横断の正規表現（大小無視）
列名:keyword              # 列指定の正規表現（例: 氏名:^山田）
keyword1 keyword2         # 空白=暗黙 AND
keyword1 OR keyword2      # OR 結合
列名 = 値 / 列名 >= 値    # 列指定の比較（= != > >= < <= <> ><）
列名:true / 列名:false    # 真偽
列名="" / 列名!=""        # 空欄 / 非空（値は必ず引用符付き空文字）
列名 in (a, b)            # IN リスト
NOT (式)
```

- **記号オペレータは全角でも入力可** — `： ＝ ＞ ＜ ！ （ ） ，` は半角 `: = > < ! ( ) ,` に正規化される（`normalizeFullWidthSearchOperators`）。**引用符内の値は保護**され変換しない（例: `氏名="田中：太郎"` の `：` は値として残る）。SQL モード（先頭 `SELECT`）には適用しない（SQL は半角必須）。
- **自由文（裸単語・`列名:値`）はすべて正規表現として評価する**（`searchQueryEngine.js` が `RegExp(src, "i")` で判定。不正な式は `escapeRegExp` 済みリテラルにフォールバック）。プレーン文字列は部分一致として従来どおりヒットする。
- 旧構文 `列名:/正規表現/`（スラッシュ囲み）は廃止したが、`compilePattern_` が囲みスラッシュを剥がすため後方互換で動く。
- 比較演算子・`in`・真偽・空欄判定・`and/or/not/()` が使える。`LIKE` / `IN ('a','b')` / `IS NULL` / 関数呼び出し・JOIN・集計は **SQL モード（先頭 `SELECT`）** で使う。
- **検索範囲はスキーマ全フィールド**（裸単語の全列 OR も、`列名:値` のリーフ名/フルパス解決も）。検索結果テーブルの表示列（`displayFieldSettings` = `isDisplayed`）に出していない深いネスト（条件分岐配下）のフィールドにも届く。`useSearchPageState` が表示列ベースの `searchColumns` に対し、簡易モード用には `buildSimpleSearchColumns(form, searchColumns)` でスキーマ全フィールドを補った superset を式生成へ渡すため（評価行 `entriesToViewTableRows` は元々全フィールドのキーを持つ）。参照実装 `searchQueryEngine.matchesKeyword`（全 entry.data 横断）とパリティ。
- **検索対象外の固定メタ列** — `createdBy` / `modifiedBy` / `deletedAt` / `deletedBy` は検索対象外（`searchExpressionBuilder.EXCLUDED_META_COLUMN_KEYS`）。`createdAt` / `modifiedAt` は検索可。SQL モードでも同じメタ列がテーブル登録時に落ちる（後述）。

## SQL モード（`SELECT` プレフィックス）

検索バーに最上位 SQL を直接書くモード。Question SQL と同じ実行基盤（`preprocessSql` → `loadFormsIntoAlaSql` → `executeSqlCore` → `runAlaSql`）を共有する。

```sql
SELECT * FROM _form                          -- 自フォーム全件（フィルタなしと同じ）
SELECT [id] FROM _form                        -- 同上（id だけ射影しても結果は同じ）
SELECT * FROM _form WHERE [年齢] >= 20        -- 単一フォームの WHERE 絞り込み
SELECT * FROM _form
WHERE [id] IN (SELECT pid FROM [子フォーム] WHERE MV_EQ([内容], 'ヒグマ'))  -- 子で親を絞る（横断）
```

### 仕様（結果→検索結果への対応づけ）
- **`_form` は自フォーム**（検索対象フォーム）の別名。`FROM _form` / `JOIN _form` / `_form.[col]` で参照できる。自フォーム名・fileId 直書きでも可。（旧 `_` は廃止。）
- 本文に**サブクエリ・別フォーム参照（`IN (SELECT …)` / `JOIN`）**を書ける。参照した別フォームは自動でロード・登録される。
- 実行結果のうち **`id`（＝自フォームのレコード ID）を持つ行**だけが検索結果（その id のレコード）として表示される。この id 突き合わせにより、次が**自然に**成り立つ:
  - ✅ `SELECT * FROM _form` / `SELECT [id] FROM _form` / `SELECT [id] FROM [自フォーム名]` → 該当レコードを表示。
  - ❌ `SELECT [id以外] FROM _form`（id を射影しない）→ 行に id が無く、対応レコード無し＝0 件。
  - ❌ `SELECT [id] FROM [他フォーム]`（最上位が他フォーム）→ id が自フォームのものと一致せず 0 件。
  - 集計（`COUNT(*)` / `GROUP BY`）も id を伴わないので 0 件（横断の絞り込みは `WHERE [id] IN (...)` のサブクエリで書く）。
- 親子横断・`CHILD_FORM_*` は Question SQL と同じ（`docs/notebooklm/question-sql-rulebook.md` 3.2.1 / 3.2.2）。子の `pid == 親の id`。
- **検索の SQL モードは検索非対象メタ列（`createdBy` / `modifiedBy` / `deletedAt` / `deletedBy`）を登録テーブルから落とす**（`registerFormAsTable` の `excludeMetaColumns`）。これらを `WHERE` で参照しても解決されない。Question / Dashboard の SQL モードは分析用途のため除外せず全列アクセスできる（意図した差）。
- 注意: SQL モードの自フォーム集合は分析用 view（**ソフトデリート除外**）。「削除済みを表示」トグルはこのモードには効かない。

### フォーム修飾付き列参照

複数フォームを JOIN するとき、または列がどのフォームのものかを明示したいときに使う。

```sql
-- [フォーム名].[列名] 形式（角括弧）
SELECT [苦情データ].[受付日] FROM [苦情データ]

-- `フォーム名`.`列名` 形式（バッククォート、同等）
SELECT `苦情データ`.`受付日` FROM `苦情データ`

-- AS alias を使う場合（alias.[列名]、角括弧不要）
SELECT f.[受付日], c.[備考]
FROM [苦情データ] AS f
JOIN [別フォーム] AS c ON c.[pid] = f.[id]

-- _form (自フォーム) の修飾付き参照
SELECT _form.[年齢] FROM _form WHERE _form.[年齢] >= 20
```

**フォーム識別子の書き方**（`FROM` 句と同じ規則）:
- `[タイトル]` — フォームのタイトル名。同名フォームが複数ある場合は曖昧エラー
- `[フォルダ/タイトル]` — フォルダ込みの正規名。同名が複数あるときはこちらを使う
- `[fileId]` — フォームの ID 直書き（例: `[f_complaint]`）
- `AS alias` — `FROM [フォーム] AS f` で付けた SQL エイリアス（`f.[列名]` と書く）
- `_form` — 検索 / Question SQL / テンプレート full-query モードの自フォーム別名（`_form.[列名]`）。旧 `_` は廃止

## 列名の書き方

- **階層列名はスラッシュ `/` 区切りでフルパスを書く**（`AAA/BBB/CCC/DDD`）。`__` に正規化されてから alasql に渡る（`headerKeyToAlaSqlKey`）。
- 日本語・英数字・アンダースコア・`.` のみで構成された列名は、囲み記号なしでそのまま使える（例: `No. >= 10`、`親質問/子質問 = '値'`）。
- スペース・ハイフン等の上記以外の記号を含む列名は `` `列名` `` または `[列名]` で囲む（例: `` `基本情報 区` = '新宿区' ``）。
- **`|` はもう区切りではなく通常文字**。後方互換のため、旧データ（ダッシュボードに保存された `親|子` 形式の列参照）は `headerKeyToAlaSqlKey` が `|` も区切りとして受理し、`/` 形式と同じ `__` 連結に解決する。

### フィールド名に区切り文字（`/` / `,`）が含まれる場合のエスケープ

階層区切り `/`（および IN リストの区切り `,`）を**フィールド名そのものに含めたい**ときは、その 1 セグメントを次のどちらかでエスケープする（両方受理）。

- **クォート**（シングル / ダブル）: `aaa/bbb/'cc/c'`、`aaa/bbb/"cc/c"`（→ セグメント `cc/c`）
- **バックスラッシュ**: `aaa/bbb/cc\/c`（→ セグメント `cc/c`）。`IN` リストのカンマも同様: `区分 in ('松竹, 梅', 特上)` / `区分 in (松竹\, 梅, 特上)`

値側（`'…'` で囲んだ比較値）に含まれる `/` `,` はパス/リスト区切りにならずそのまま保持される（例: `氏名 = '田中/太郎'`）。

> 共有コーデック `builder/src/utils/pathCodec.js`（GAS 双子 `gas/pathCodec.gs`）が区切り `/`・エスケープ・複数値カンマ（`multiValue.js`）を一元管理する。等価性は `tests/path-codec-equivalence.test.cjs` が担保。

## 利用可能な関数

`docs/developers/drive-template-tokens.md` の関数一覧を参照。テンプレ評価器と同じ UDF が SQL モードでも使える（`TIME` / `DATE2ERA` / `DATETIME2ERATIME` / `ERA2DATE` / `ERATIME2DATETIME` 等）。SQL モードは Question SQL と同じ実行コア（`executeSqlCore`）・同じ alasql シングルトンを共有するので、使える関数は両者で一致する。

正規表現は **判定はネイティブ** `x REGEXP p` 演算子 / `REGEXP_LIKE(x, p[, flags])` 関数、**抽出 / 置換は自前 UDF** `REGEXP_MATCH(x, p[, groupIdx=0])` / `REGEXP_REPLACE(x, p, replacement)` を使う。AlaSQL 4.17.x では `RLIKE` 演算子と `NOT REGEXP` は parse error のため使えない（代わりに `NOT (x REGEXP p)` または `NOT REGEXP_LIKE(...)` を書く）。例:

```sql
SELECT * FROM _form WHERE `氏名` REGEXP '^田中'
SELECT * FROM _form WHERE REGEXP_LIKE(`氏名`, '田.*', 'i')
SELECT * FROM _form WHERE REGEXP_MATCH(`メール`, '(.+)@', 1) = 'admin'
```

## 遅延検索（デバウンス）

検索バーへの入力は表示だけ即時反映し、検索実行（onCommit）だけを遅延させる（`useDebouncedSearchInput.js`）。

- 遅延時間は全フォーム共通設定 `settings.searchDebounceMs`（`settingsStore`、既定 `DEFAULT_SEARCH_DEBOUNCE_MS = 300` ms）。設定画面の「検索の遅延時間（ミリ秒）」（`SettingsGeneralTab.jsx`）で変更でき、`0` で即時実行。
- **IME 変換中（compositionstart〜compositionend）はスケジュールしない** — 確定時（compositionend）にのみコミットする。日本語入力中の中間文字列で検索が走らない。
- 外部から `value`（URL の `q` など）が自分のコミット以外で変わったときは表示へ同期する。

## 検索ヒット箇所表示

ヒットしたレコードに「どこが一致したか」を出す処理は `searchQueryEngine.js`。部分一致だけでなく**列指定の条件（COMPARE `=`/`>=` 等・`IN`・真偽・空欄/非空）が成立した列**も、`collectConditionColumns` が値付きでヒット箇所として収集する（非表示フィールドも対象）。これにより条件のみマッチ時に「(他の項目に一致)」へ落ちる回帰を解消している。ヒット箇所表示は簡易モード専用で、SQL モード（先頭 `SELECT`）では収集しない。

## 日付型列の比較

簡易モードの日付/時刻列比較は、列値（`buildSearchRow` / `entriesToViewTableRows`）も日付/時刻列を canonical 文字列で渡すため、固定幅の辞書順比較がそのまま時系列比較になる。canonical は日付=ハイフン `YYYY-MM-DD`、日付↔時刻=アンダースコア（`YYYY-MM-DD_HH:mm:ss.SSS`）、時刻=`HH:mm:ss.SSS`。

```text
販売日 >= 2020-04-01      # 簡易モード: 列は canonical 文字列で辞書順比較
modifiedAt >= 2026/01/01   # createdAt / modifiedAt（datetime メタ列）も検索可
```

## 関連ファイル

- モード判定ヘルパー（`normalizeFullWidthSearchOperators` / `SQL_MODE_RE`）: `builder/src/features/search/searchSyntaxPreprocessor.js`
- SQL モード実行（`_form` 解決・別フォーム自動登録・実行）: `builder/src/features/analytics/analyticsStore.js` の `runSearchSelect` / `executeSqlCore` / `sqlPreprocessor.js`
- メタ列除外（検索 SQL モードのみ）: `builder/src/features/analytics/analyticsAlaSql.js` の `registerFormAsTable`（`excludeMetaColumns`）
- SQL モードのモード分岐・id 突き合わせ: `builder/src/features/search/useSearchPageState.js`
- 簡易モードの全フィールド superset 構築: `builder/src/features/search/searchTable.js` の `buildSimpleSearchColumns`
- 簡易検索の WHERE 翻訳: `builder/src/features/search/searchSimpleTranslate.js`
- 検索式ビルダ（列メタ構築）: `builder/src/features/search/searchExpressionBuilder.js`
- フォールバック（JSON 走査エンジン）/ トークナイザ: `builder/src/features/search/searchQueryEngine.js`
- 検索バー UI: `builder/src/features/search/components/SearchToolbar.jsx`
- 遅延検索（デバウンス）フック: `builder/src/features/search/useDebouncedSearchInput.js`

ユーザー向けの詳しい使い方は `docs/user_manual.md` の「8.1 検索する」を参照。
