# テンプレートトークン・式評価（Claude 向け詳細）

CLAUDE.md から分離した、Google Doc テンプレート・ファイル／フォルダ名・Gmail 本文・項目ラベル等で使うトークン置換システムのリファレンス。`driveTemplate.gs` / `expressionEvaluator.gs` / `templateEvaluator.gs` / `tokenReplacer.js` / `templateEvaluator.js` を触るときに参照する。

> **⚠️ alasql 全面移行（PR-4〜PR-8 で完了）**
>
> 旧 `{@field|pipe}` 構文（パイプ変換）と `[...]` JavaScript 演算式は廃止され、`{{ alasql 関数式 }}` に統一済み（テンプレート構文は `{{...}}` のみ。単一ブレース `{...}` は廃止＝リテラル）。
> - **新構文の例**: `` {{`氏名`}} ``、`` {{UPPER(`氏名`)}} ``、`` {{TIME_FORMAT(NOW(), 'YYYY-MM-DD')}} ``、`` {{IIF(`年齢` >= 20, '大人', '子供')}} ``、`` {{`姓` || `名`}} ``、`` {{`売上日`,`担当者`}} ``
> - **メンタルモデル**: `{{...}}` 内側は「`SELECT <内側> FROM this_table WHERE id = this_id`」と仮定した置換として評価される。`this_table` は当該レコードの属するテーブル、`this_id` はそのレコードの id。**`this_table` / `this_id` はあくまで概念モデルであり、SQL 内に書ける識別子ではない**（実装上は当該レコードを単一 row として評価器に渡す）。
> - **トークンは連続二重ブレース `{{...}}`（ビュー形式）のみ**: **単一ブレース `{...}`（旧・元データ形式トークン）は廃止**され、リテラル文字としてそのまま出力される（トークンとして評価されない）。
>   - `{{...}}` は **ビュー形式**の typed view 行で評価する（保存層は元データ方式＝選択肢ごとのマーカー列だが、評価行はそれを畳み込んだ view）。選択肢はラベル（`checkboxes` は codec でエスケープ付きカンマ連結）、`number` は数値型・日付は canonical を保持（`{{`金額` + 50}}` の算術も正しく動く）。
>   - 例: 単一選択肢 `性別` で「男性」を選んだレコードなら `` {{`性別`}} `` → `"男性"`。
>   - 置換フィールド・印刷様式・Gmail 等すべての置換経路（フロント / GAS 双方）に適用。スキャナ（`templateScanner.js` の `describeToken` / GAS 側双子 `gas/templateEvaluator.gs`）は `{{ }}` のみトークンとして認識し、`resolveTemplate` は単一 row で評価する。
>   - 実装: フロント `utils/tokenReplacer.js` の `buildTemplateRow` が typed view 行を 1 本作り `resolveTemplate(text, row)` に渡す。挙動は `templateScanner.test.js` / `templateEvaluator.test.js` / `tests/gas-drive-template-replacement.test.cjs` が担保。
>   - 既存フォーム定義の `{...}` → `{{...}}` 移行は `gas/adminMigrations.gs` の `Admin_migrateSingleBraceToDoubleBraceInForms_`（手動実行・冪等）。印刷様式 Google Doc 本文は対象外なので管理者が手動で書き換える。
> - **カンマ列リスト**: `` {`A`,`B`} `` のようにトップレベルカンマで複数式を並べると、各式を評価して **カンマ単独** で連結する（例: `` {`売上日`,`担当者`} `` → `"2026-04-04,山田太郎"`）。`||` 連結は引き続き利用可（`` {`姓` || `名`} ``）し、両方を併用できる（例: `` {`姓` || `名`, `所属`} `` → `"山田太郎,営業"`）。
>   - 文字列リテラル `'...'` `"..."`、バッククォート識別子 `` `...` ``、括弧 `(...)` / `[...]` / `{...}` 内のカンマは保護され、トップレベルのカンマだけが分割境界となる。
>   - null / undefined は **空文字として連結**、区切り子は保持される（例: `` {`A`,`B`} `` で B が null なら `"A値,"`）。
>   - 末尾カンマ・連続カンマも空要素として連結に反映される（`` {`A`,} `` → `"A値,"`、`` {`A`,,`B`} `` → `"A値,,B値"`）。
>   - 別区切りで連結したい場合は `` {CONCAT_WS(' / ', `A`, `B`)} `` のように **alasql 式として** 書く（単一値扱い）。
>   - 部分式の 1 つでも評価エラーになると、トークン全体が fallback（フロント既定: 空文字 / GAS 既定: トークン原文）に置換される。
> - **フィールド参照** はバッククォートで囲む（` `` `）。
>   - ネストされた子質問は `親|子|孫` のフルパスでバッククォートで囲んで参照する（例: `` `設置場所|設置開始日` ``）。トップレベル質問はパス＝葉ラベル。
>   - 葉ラベル単独参照は廃止。同名の葉ラベルが複数階層に存在し得るため、参照は常に一意のフルパスで明示する（検索バーと同じセマンティクス）。
> - **予約トークン** は `_id` / `_record_url` / `_form_url` をバッククォート付きで参照（`` `_id` `` 等）。
> - **現在時刻** は alasql UDF `NOW()` で取得する（"YYYY-MM-DD_HH:mm:ss.sss" を返す）。例: `` {NOW()} ``、`` {TIME_FORMAT(NOW(), 'YYYY-MM-DD')} ``、`` {YEAR(NOW())} ``。Question SQL モード・検索の AlaSQL モードでも同じ意味で使える。
> - **使用可能な関数** は `builder/src/features/expression/registerNfbUdfs.js`（フロント・GAS 共通の UDF。GAS 側はこれを esbuild バンドルした `gas/generated/nfbAlasqlUdfs.gs` を使う。GAS の独自式評価器は廃止済み）を参照。
>   - alasql 標準: `UPPER`, `LOWER`, `SUBSTRING`/`SUBSTR`, `REPLACE`, `LENGTH`, `CONCAT`, `CONCAT_WS`, `IIF`, `IFNULL`, `NULLIF`, `COALESCE`, `CASE WHEN ... END`, `CAST`, `ROUND`/`CEIL`/`FLOOR`/`ABS`, `LIKE`/`IN`/`IS NULL`
>   - **prefix-less UDF（推奨）**:
>     - 文字列／数値整形: `TIME_FORMAT`, `NUMBER_FORMAT`, `KANA`, `ZEN`, `HAN`, `NOEXT`, `LPAD`, `RPAD`
>     - 予約語衝突回避: `LEFT(...)` / `RIGHT(...)` / `DEFAULT(...)` は preprocessAlaSqlExpression が `STR_LEFT` / `STR_RIGHT` / `STR_DEFAULT` にリネームしてから alasql に渡す（書く側は `LEFT` 等のままで OK）
>     - 日時: `DATE`, `DATETIME`, `TIMESTAMP`, `TIME`, `DATE2ERA`, `DATETIME2ERATIME`, `ERA2DATE`, `ERATIME2DATETIME`, `YEAR`/`MONTH`/`DAY`/`HOUR`/`MINUTE`/`SECOND`
>     - 真偽・数値化: `TO_BOOL`, `TO_NUMBER`
>     - 正規表現（自前 UDF は 2 つだけ）: `REGEXP_MATCH(text, pattern, groupIdx=0)`, `REGEXP_REPLACE(text, pattern, replacement)`
>       - **判定（boolean）はネイティブに委ねる**: `x REGEXP p` 演算子 / `REGEXP_LIKE(x, p[, flags])` 関数を使う。AlaSQL 4.17.x では `RLIKE` 演算子と `NOT REGEXP` は parse error なので使用しない（必要なら `NOT (x REGEXP p)` か `NOT REGEXP_LIKE(...)` を書く）。`REGEXP_LIKE` はデフォルト case-sensitive、第 3 引数 `'i'` で case-insensitive。
>       - `REGEXP_MATCH`: JS 標準 `String.prototype.match` の薄ラッパー。`groupIdx` 省略時は 0（マッチ全体）。**括弧の有無による fullMatch / group(1) 自動分岐は廃止**したので、グループを取りたいときは `REGEXP_MATCH(x, '(\\d+)', 1)` のように明示する。非マッチ・グループ未定義は空文字、`text` が NULL のときは NULL 伝搬。
>       - `REGEXP_REPLACE`: JS 標準 `String.prototype.replace` + `'g'` フラグ。`$&` / `$1`〜`$9` / `$<name>` / `$$` 等の特殊シーケンスがそのまま使える。**部分置換は呼び出し側で明示**（旧 #164 の「括弧ありなら group(1) のみ置換」自動挙動は廃止）: 例 `REGEXP_REPLACE(x, '(prefix)(\\d+)(suffix)', '$1NEW$3')` の形で `$1` バックリファレンスを使う。
>       - 注意: AlaSQL の SQL 文字列リテラル中の `\d` 等のバックスラッシュは 1 段消費されるため、`'\d+'` は実際には `d+` になる。`'[0-9]+'` を使うか `'\\d+'` のように二重エスケープする。
>     - 検索内部: `LIKE_ANY`（preprocessor が裸単語 LIKE で emit）
>     - fileUpload 欄専用: `FILE_NAMES`, `FILE_URLS`, `FOLDER_NAME`, `FOLDER_URL`
>   - **廃止/リネーム済み**（保存済みフォーム・テンプレートは `gas/adminMigrations.gs` の rename テーブルで自動書き換え。新規では使わない）:
>     - `DATE_BIN(x, n)` / `NFB_DATE_BIN(x, n)` → `SUBSTRING(DATETIME(x), 1, n)`（年=4 / 月=7 / 日=10）
>     - `TIME_SECONDS` → 廃止（`TIMESTAMP` で代替）
>     - `DATETIME2ERA` → `DATETIME2ERATIME`、`ERA2DATETIME` → `ERATIME2DATETIME`
>     - `NFB_*` プレフィックス（`NFB_TIME_FORMAT` 等）→ プレフィックスなしへ統一済み（エイリアスも撤去）
>     - `NFB_TO_BOOL` → `TO_BOOL`、`NFB_TO_NUMBER` → `TO_NUMBER`、`NFB_DEFAULT(x,y)` → `DEFAULT(x,y)`（= `IFNULL(NULLIF(x,''),y)`）、`PAD_LEFT`/`PAD_RIGHT` → `LPAD`/`RPAD`、`PARSE_DATE` → `DATE`
>     - 正規表現 UDF 簡素化（PR #164 後継）:
>       - `REGEX_MATCH` → `REGEXP_MATCH`（リネーム。引数・戻り値ともに概ね互換だが、自動分岐挙動はなくなった）
>       - `REGEX_TEST(x, p)` → `REGEXP_LIKE(x, p, 'i')`（case-insensitive 維持。新仕様では自前 UDF は登録せず、AlaSQL ネイティブの `REGEXP_LIKE` に委ねる）
>       - `REGEX_EXTRACT(x, p[, i])` → `REGEXP_MATCH(x, p[, i])`（2/3 引数は自動移行。**4 引数版 `(x, p, i, flags)` は移行不可** — マイグレーションは元式を維持しつつ警告ログを残すので、管理者は印刷テンプレ Doc 本文を含めて手動置換する）
>       - `REGEX_EXTRACT_ALL` → **廃止**（マイグレーション不可。呼び出し側で配列構築するか、用途を見直す）
>   - **UDF 追加ガイド (優先順位)**:
>     ① alasql ネイティブ関数を最優先（再定義しない）。
>     ② JS 標準関数で済むものは `alasql.fn` に薄ラッパーで登録（`registerNfbUdfs.js`）。
>     ③ 上記で表現できない独自セマンティクスのみ JS 実装を登録（最終手段）。registerNfbUdfs.js / dateTime.js / eraConversion.js / kanaTables.js を変更したら `npm run build:gas-udfs` で `gas/generated/nfbAlasqlUdfs.gs` を再生成すること。
>   - **日付の値表現**: `DATE` / `DATETIME` / `TIME` / `ERA2DATE` / `ERATIME2DATETIME` / `NOW()` は **canonical 文字列**（`YYYY-MM-DD` / `YYYY-MM-DD_HH:mm:ss.sss`（日付↔時刻は `_`、ms までゼロ埋め） / `HH:mm:ss.sss`）を返す。辞書順 = 時系列順なので `alasql` の `=` `<` `>` がそのまま機能する。`TIMESTAMP` のみ unix ms（数値）を返す（差分計算用。時刻値は 00:00:00 からのミリ秒）。日時文字列のパースは `_` / 半角スペース / `T` / `/` 区切りを受理し、末尾の TZ 指定子（`Z` / `±HH:MM`）は時差を考慮、無ければ JST 壁時計として解釈（`builder/src/utils/dateTime.js`）。一方、回答スプレッドシートの date/time/datetime セルだけは「数値の日時シリアル値」で書き込み、シートの TZ は `Asia/Tokyo` 固定（`gas/sheetsDatetime.gs`）。検索の値側 (`buildSearchRow`) は日付/時刻列を依然 unix ms 化して alasql に渡すため、検索 SQL では `DATE([列])` / `TIME([列])` で canonical 文字列に揃えてから比較する。
> - **テスト**: `tests/gas-drive-template-replacement.test.cjs`（GAS 側）と `builder/src/utils/tokenReplacer.test.js`（フロント側）が新構文の挙動を担保。新構文の生きた例として参照可。

レコードデータを埋め込んだ PDF・Gmail 下書き・Google Doc を自動生成できる。式評価はフロント・GAS とも **同じ alasql エンジン + 同じ UDF セット**を使う（GAS の独自式評価器は廃止）。フロント側は `builder/src/features/expression/templateEvaluator.js`、GAS 側は `gas/expressionEvaluator.gs` がそれぞれ `registerNfbUdfs.js`（GAS は esbuild バンドルした `gas/generated/nfbAlasqlUdfs.gs`）の UDF を登録した alasql を呼ぶ。トークン抽出・`{...}` のカンマ分割・フィールド参照解決などの薄いレイヤだけがプラットフォームごとに分かれる（GAS 側 `gas/templateEvaluator.gs` + `gas/driveTemplate.gs`、フロント側 `builder/src/utils/tokenReplacer.js`）。

> **評価エラー時のフォールバック既定値はフロント / GAS で意図的に異なる**: フロント `resolveTemplate`（`tokenReplacer.js` 経由）は `""`（substitution フィールド表示・印刷プレビュー用途）、GAS `nfbEvaluateTemplate_` / `nfbResolveTemplateTokens_` はトークン原文を残す（Drive ファイル名・Google Doc 置換で問題に気づけるようにするため）。値→文字列変換（`coerceResultToString` ↔ `nfbTplCoerceToString_`）とスキーマ走査（`schemaUtils.js` ↔ `gas/schemaUtils.gs`）は双子実装で、`tests/coerce-to-string-equivalence.test.cjs` / `tests/schema-walkers-equivalence.test.cjs` が等価性を担保。

## 出力ボタン（printTemplate）の出力タイプと印刷様式テンプレート

`printTemplate` フィールド（公開フォーム上の出力ボタン）の `printTemplateAction.outputType` は 3 種類: `pdf`（ブラウザダウンロード）/ `googleDoc`（Google ドキュメントを作成して開くだけ。PDF 化・ゴミ箱移動はしない）/ `gmail`（下書き作成、任意で PDF 添付）。`googleDoc` のバックエンドは `gas/driveOutput.gs` の `nfbCreateGoogleDocOutput_`（`nfbExecuteRecordOutputAction` から分岐）。

印刷様式テンプレート（Google Document URL）は **カード個別 → フォーム共通 `settings.standardPrintTemplateUrl` → 自動生成ドキュメント** の順で解決する（`nfbResolveRecordOutputTemplateSourceUrl_`）。カード個別は `printTemplateAction.useCustomTemplate` が true かつ `templateUrl` が非空のときに有効。`pdf` / `googleDoc` のほか、`gmail` で「PDF を添付」を有効にしたときの添付 PDF にも同じ解決が適用される。印刷様式の出力（`pdf` の一時 Doc・`googleDoc` の成果物・標準印刷出力）は常にマイドライブ直下に作成し、レコードの Drive フォルダには保存しない。

ユーザー向けの構文ガイド・関数一覧は `docs/user_manual.md` §7「テンプレート関数式リファレンス」を参照。
