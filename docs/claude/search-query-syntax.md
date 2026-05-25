# 検索クエリ構文（Claude 向け詳細）

CLAUDE.md から分離した、検索画面のクエリ構文リファレンス。`searchSyntaxPreprocessor.js` / `searchQueryEngine.js` を触るときや検索仕様を確認するときに参照する。

検索バーは「`SELECT 表示列 FROM 対象フォームのレコード WHERE …` の **WHERE 節だけ** が可変」というメンタルモデル。入力先頭の `SEARCH` または `WHERE` プレフィックスで **alasql 厳密モード** に入る。プレフィックスがなければ従来の **簡易モード**。

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

- **自由文（裸単語・`列名:値`）はすべて正規表現として評価する**（`searchQueryEngine.js` が `RegExp(src, "i")` で判定。不正な式は `escapeRegExp` 済みリテラルにフォールバック）。プレーン文字列は部分一致として従来どおりヒットする。
- 旧構文 `列名:/正規表現/`（スラッシュ囲み）は廃止したが、`compilePattern_` が囲みスラッシュを剥がすため後方互換で動く。
- 比較演算子・`in`・真偽・空欄判定・`and/or/not/()` は従来どおり。`LIKE` / `IN ('a','b')` / `IS NULL` / 関数呼び出しは **厳密モード（`SEARCH`/`WHERE`）** で使う。

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

## 列名の書き方

- 日本語・英数字・アンダースコア・`.`・`|` のみで構成された列名は、囲み記号なしでそのまま使える（例: `No. >= 10`、`親質問|子質問 = '値'`）。
- スペース・ハイフン等の上記以外の記号を含む列名は `` `列名` `` または `[列名]` で囲む（例: `` `基本情報 区` = '新宿区' ``）。
- 識別子の先頭文字は `.` `|` `数字` 不可（誤検知回避のため）。これらは本体位置でのみ許可される。
- 階層列名はパイプ区切りでフルパスを書く（`AAA|BBB|CCC|DDD`）。preprocessor 内で `__` に正規化されてから alasql に渡る。

## 利用可能な関数

`docs/claude/drive-template-tokens.md` の関数一覧を参照。テンプレ評価器と同じ UDF が検索バーでも使える（`TIME` / `DATE2ERA` / `DATETIME2ERATIME` / `ERA2DATE` / `ERATIME2DATETIME` 等）。

正規表現は **判定はネイティブ** `x REGEXP p` 演算子 / `REGEXP_LIKE(x, p[, flags])` 関数、**抽出 / 置換は自前 UDF** `REGEXP_MATCH(x, p[, groupIdx=0])` / `REGEXP_REPLACE(x, p, replacement)` を使う。AlaSQL 4.17.x では `RLIKE` 演算子と `NOT REGEXP` は parse error のため使えない（代わりに `NOT (x REGEXP p)` または `NOT REGEXP_LIKE(...)` を書く）。例:

```text
SEARCH `氏名` REGEXP '^田中'
SEARCH REGEXP_LIKE(`氏名`, '田.*', 'i')
SEARCH REGEXP_MATCH(`メール`, '(.+)@', 1) = 'admin'
```

## 日付型列の比較

`isDateLike` メタが付いた列を日付/時刻リテラル（`YYYY-MM-DD` / `YYYY/MM/DD` / `HH:mm:ss` 等）と比較するとき、preprocessor は両辺を `DATE(...)` で自動ラップする（簡易・厳密どちらでも）。

```text
販売日 >= 2020-04-01      # → DATE(`販売日`) >= DATE('2020-04-01')
modifiedAt >= 2026/01/01   # → DATE(`modifiedAt`) >= DATE('2026/01/01')
```

## 関連ファイル

- alasql 前処理パーサ: `builder/src/features/search/searchSyntaxPreprocessor.js`
- 検索式ビルダ（列メタ構築）: `builder/src/features/search/searchExpressionBuilder.js`
- フォールバック（JSON 走査エンジン）: `builder/src/features/search/searchQueryEngine.js`
- 検索バー UI: `builder/src/features/search/components/SearchToolbar.jsx`

ユーザー向けの詳しい使い方は `docs/user_manual.md` の「8.1 検索する」を参照。
