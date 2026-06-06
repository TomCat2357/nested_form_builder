# 検索クエリ構文（Claude 向け詳細）

CLAUDE.md から分離した、検索画面のクエリ構文リファレンス。`searchSyntaxPreprocessor.js` / `searchQueryEngine.js` を触るときや検索仕様を確認するときに参照する。

検索バーには 3 モードある:

1. **簡易モード**（プレフィックスなし） — 裸単語・`列名:値` の正規表現/比較。
2. **厳密モード**（先頭 `SEARCH` / `WHERE`） — 単一フォームの WHERE 節相当の式。`FROM`/`JOIN`/`GROUP BY`/サブクエリは不可。
3. **full-SELECT モード**（先頭 `SELECT`） — 本物の SELECT 文。自フォームを `_` で参照し、本文にサブクエリ・別フォーム参照を書ける（親子横断はここで）。

メンタルモデル: 1・2 は「`SELECT 表示列 FROM 対象フォーム WHERE …` の WHERE 節だけが可変」。3 は最上位 SQL 全体を書くが、**結果のうち「自フォームの `id` を持つ行」だけが検索結果（その id のレコード）に対応づく**。

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

- **記号オペレータは全角でも入力可** — `： ＝ ＞ ＜ ！ （ ） ，` は半角 `: = > < ! ( ) ,` に正規化される（`normalizeFullWidthSearchOperators`）。**引用符内の値は保護**され変換しない（例: `氏名="田中：太郎"` の `：` は値として残る）。**簡易モード限定**で、厳密モード（`SEARCH`/`WHERE`）には適用しない（従来どおり半角必須）。
- **自由文（裸単語・`列名:値`）はすべて正規表現として評価する**（`searchQueryEngine.js` が `RegExp(src, "i")` で判定。不正な式は `escapeRegExp` 済みリテラルにフォールバック）。プレーン文字列は部分一致として従来どおりヒットする。
- 旧構文 `列名:/正規表現/`（スラッシュ囲み）は廃止したが、`compilePattern_` が囲みスラッシュを剥がすため後方互換で動く。
- 比較演算子・`in`・真偽・空欄判定・`and/or/not/()` は従来どおり。`LIKE` / `IN ('a','b')` / `IS NULL` / 関数呼び出しは **厳密モード（`SEARCH`/`WHERE`）** で使う。
- **検索範囲はスキーマ全フィールド**（裸単語の全列 OR も、`列名:値` のリーフ名/フルパス解決も）。検索結果テーブルの表示列（`displayFieldSettings` = `isDisplayed`）に出していない深いネスト（条件分岐配下）のフィールドにも届く。`useSearchPageState` が表示列ベースの `searchColumns` に対し、簡易モード用には `buildSimpleSearchColumns(form, searchColumns)` でスキーマ全フィールドを補った superset を式生成へ渡すため（評価行 `entriesToViewTableRows` は元々全フィールドのキーを持つ）。参照実装 `searchQueryEngine.matchesKeyword`（全 entry.data 横断）とパリティ。**厳密モード**は従来どおり表示列ベース（列無し述語の OR 展開範囲。明示的な列参照は行キーへのフォールスルーで全フィールドに届く）。

## 厳密モード（`SEARCH` または `WHERE` プレフィックス）

`SEARCH` と `WHERE` は同義。プレフィックス直後の本体は alasql の WHERE 節相当の式として解釈される。

```text
SEARCH `担当` = '田中' AND `売上日` >= DATE('2020-01-01')
WHERE `氏名` LIKE '%田中%'
SEARCH TIME(`受付時刻`) >= TIME('09:00:00')
SEARCH DATE2ERA(`生年月日`) LIKE '%昭和%'
```

### 厳密モード固有の挙動

- **列無し述語の全列 OR 展開** — `SEARCH > 'aaa'` のように LHS が無い比較・LIKE・IN・IS NULL は、検索対象の全列に対する OR として展開される（`(\`col1\` > 'aaa') OR (\`col2\` > 'aaa') OR …`）。複数列がヒットしてもレコード単位で 1 件に集約。
- **`FROM` / `GROUP BY` / `ORDER BY` / `HAVING` / `LIMIT` / `OFFSET` / `UNION` / `JOIN` は構文エラー** — プレフィックス直後は WHERE 節相当の式のみ受理。
- **検索対象列の制限** — `createdAt` / `createdBy` / `deletedAt` / `deletedBy` / `modifiedBy` は検索対象外。`modifiedAt`（最終更新日時）のみ検索可。
- Stage A 以降、`pid`（親レコード ID）も行に乗るので、子フォームを開いている文脈で `WHERE pid = '...'`（同一フォーム内の親絞り込み）が書ける。**親→子の横断は厳密モードでは不可**（FROM/JOIN/サブクエリ禁止）→ full-SELECT モードを使う。

## full-SELECT モード（`SELECT` プレフィックス）

検索バーに最上位 SQL を直接書くモード。Question SQL と同じ実行基盤（`preprocessSql` → `loadFormsIntoAlaSql` → `runAlaSql`）を共有する。

```sql
SELECT * FROM _                              -- 自フォーム全件（フィルタなしと同じ）
SELECT [id] FROM _                           -- 同上（id だけ射影しても結果は同じ）
SELECT * FROM _
WHERE [id] IN (SELECT pid FROM [子フォーム] WHERE MV_EQ([内容], 'ヒグマ'))  -- 子で親を絞る（横断）
```

### 仕様（結果→検索結果への対応づけ）
- **`_` は自フォーム**（検索対象フォーム）の別名。`FROM _` / `JOIN _` / `_.[col]` で参照できる。自フォーム名・fileId 直書きでも可。
- 本文に**サブクエリ・別フォーム参照（`IN (SELECT …)` / `JOIN`）**を書ける。参照した別フォームは自動でロード・登録される。
- 実行結果のうち **`id`（＝自フォームのレコード ID）を持つ行**だけが検索結果（その id のレコード）として表示される。この id 突き合わせにより、次が**自然に**成り立つ:
  - ✅ `SELECT * FROM _` / `SELECT [id] FROM _` / `SELECT [id] FROM [自フォーム名]` → 該当レコードを表示。
  - ❌ `SELECT [id以外] FROM _`（id を射影しない）→ 行に id が無く、対応レコード無し＝0 件。
  - ❌ `SELECT [id] FROM [他フォーム]`（最上位が他フォーム）→ id が自フォームのものと一致せず 0 件。
  - 集計（`COUNT(*)` / `GROUP BY`）も id を伴わないので 0 件（横断の絞り込みは `WHERE [id] IN (...)` のサブクエリで書く）。
- 親子横断・`CHILD_FORM_*` は Question SQL と同じ（`docs/notebooklm/question-sql-rulebook.md` 3.2.1 / 3.2.2）。子の `pid == 親の id`。
- 注意: full-SELECT の自フォーム集合は分析用 view（**ソフトデリート除外**）。「削除済みを表示」トグルはこのモードには効かない。

## 列名の書き方

- **階層列名はスラッシュ `/` 区切りでフルパスを書く**（`AAA/BBB/CCC/DDD`）。preprocessor 内で `__` に正規化されてから alasql に渡る（`headerKeyToAlaSqlKey`）。
- 日本語・英数字・アンダースコア・`.` のみで構成された列名は、囲み記号なしでそのまま使える（例: `No. >= 10`、`親質問/子質問 = '値'`）。
- スペース・ハイフン等の上記以外の記号を含む列名は `` `列名` `` または `[列名]` で囲む（例: `` `基本情報 区` = '新宿区' ``）。
- 識別子の先頭文字は `.` `数字` 不可（誤検知回避のため）。これらは本体位置でのみ許可される。
- **`|` はもう区切りではなく通常文字**。後方互換のため、旧データ（ダッシュボードに保存された `親|子` 形式の列参照）は `headerKeyToAlaSqlKey` が `|` も区切りとして受理し、`/` 形式と同じ `__` 連結に解決する。

### フィールド名に区切り文字（`/` / `,`）が含まれる場合のエスケープ

階層区切り `/`（および IN リストの区切り `,`）を**フィールド名そのものに含めたい**ときは、その 1 セグメントを次のどちらかでエスケープする（両方受理）。

- **クォート**（シングル / ダブル）: `aaa/bbb/'cc/c'`、`aaa/bbb/"cc/c"`（→ セグメント `cc/c`）
- **バックスラッシュ**: `aaa/bbb/cc\/c`（→ セグメント `cc/c`）。`IN` リストのカンマも同様: `区分 in ('松竹, 梅', 特上)` / `区分 in (松竹\, 梅, 特上)`

バッククォート `` `…` `` 内では、埋め込みの `/` はバックスラッシュで `` `親/cc\/c` `` のようにエスケープする（バッククォート内のクォートはリテラル扱い）。値側（`'…'` で囲んだ比較値）に含まれる `/` `,` はパス/リスト区切りにならずそのまま保持される（例: `氏名 = '田中/太郎'`）。

> 共有コーデック `builder/src/utils/pathCodec.js`（GAS 双子 `gas/pathCodec.gs`）が区切り `/`・エスケープ・複数値カンマ（`multiValue.js`）を一元管理する。等価性は `tests/path-codec-equivalence.test.cjs` が担保。

## 利用可能な関数

`docs/claude/drive-template-tokens.md` の関数一覧を参照。テンプレ評価器と同じ UDF が検索バーでも使える（`TIME` / `DATE2ERA` / `DATETIME2ERATIME` / `ERA2DATE` / `ERATIME2DATETIME` 等）。

正規表現は **判定はネイティブ** `x REGEXP p` 演算子 / `REGEXP_LIKE(x, p[, flags])` 関数、**抽出 / 置換は自前 UDF** `REGEXP_MATCH(x, p[, groupIdx=0])` / `REGEXP_REPLACE(x, p, replacement)` を使う。AlaSQL 4.17.x では `RLIKE` 演算子と `NOT REGEXP` は parse error のため使えない（代わりに `NOT (x REGEXP p)` または `NOT REGEXP_LIKE(...)` を書く）。例:

```text
SEARCH `氏名` REGEXP '^田中'
SEARCH REGEXP_LIKE(`氏名`, '田.*', 'i')
SEARCH REGEXP_MATCH(`メール`, '(.+)@', 1) = 'admin'
```

## 遅延検索（デバウンス）

検索バーへの入力は表示だけ即時反映し、検索実行（onCommit）だけを遅延させる（`useDebouncedSearchInput.js`）。

- 遅延時間は全フォーム共通設定 `settings.searchDebounceMs`（`settingsStore`、既定 `DEFAULT_SEARCH_DEBOUNCE_MS = 300` ms）。設定画面の「検索の遅延時間（ミリ秒）」（`SettingsGeneralTab.jsx`）で変更でき、`0` で即時実行。
- **IME 変換中（compositionstart〜compositionend）はスケジュールしない** — 確定時（compositionend）にのみコミットする。日本語入力中の中間文字列で検索が走らない。
- 外部から `value`（URL の `q` など）が自分のコミット以外で変わったときは表示へ同期する。

## 検索ヒット箇所表示

ヒットしたレコードに「どこが一致したか」を出す処理は `searchQueryEngine.js`。部分一致だけでなく**列指定の条件（COMPARE `=`/`>=` 等・`IN`・真偽・空欄/非空）が成立した列**も、`collectConditionColumns` が値付きでヒット箇所として収集する（非表示フィールドも対象）。これにより条件のみマッチ時に「(他の項目に一致)」へ落ちる回帰を解消している。

## 日付型列の比較

`isDateLike` メタが付いた列を日付/時刻リテラル（`YYYY-MM-DD` / `YYYY/MM/DD` / `HH:mm:ss` 等）と比較するとき、preprocessor は**列は丸めず、リテラル側のみ** canonical 文字列に正規化する（簡易・厳密どちらでも）。canonical は日付=ハイフン `YYYY-MM-DD`、日付↔時刻=アンダースコア（`YYYY-MM-DD_HH:mm:ss.SSS`）、時刻=`HH:mm:ss.SSS`。値側（`buildSearchRow` / `entriesToViewTableRows`）も日付/時刻列を同じ canonical 文字列で渡すため、固定幅の辞書順比較がそのまま時系列比較になる。旧スラッシュ/半角スペース入力もハイフン/`_` へ正規化される。

```text
販売日 >= 2020-04-01      # → `販売日` >= '2020-04-01'
modifiedAt >= 2026/01/01   # → `modifiedAt` >= '2026-01-01'（旧スラッシュ入力もハイフンへ正規化）
```

## 関連ファイル

- alasql 前処理パーサ / モード判定（`STRICT_PREFIX_RE` / `FULL_SELECT_RE`）: `builder/src/features/search/searchSyntaxPreprocessor.js`
- full-SELECT 実行（`_` 解決・別フォーム自動登録・実行）: `builder/src/features/analytics/analyticsStore.js` の `runSearchSelect` / `sqlPreprocessor.js`
- full-SELECT のモード分岐・id 突き合わせ: `builder/src/features/search/useSearchPageState.js`
- 簡易モードの全フィールド superset 構築: `builder/src/features/search/searchTable.js` の `buildSimpleSearchColumns`
- 検索式ビルダ（列メタ構築）: `builder/src/features/search/searchExpressionBuilder.js`
- フォールバック（JSON 走査エンジン）: `builder/src/features/search/searchQueryEngine.js`
- 検索バー UI: `builder/src/features/search/components/SearchToolbar.jsx`
- 遅延検索（デバウンス）フック: `builder/src/features/search/useDebouncedSearchInput.js`

ユーザー向けの詳しい使い方は `docs/user_manual.md` の「8.1 検索する」を参照。
