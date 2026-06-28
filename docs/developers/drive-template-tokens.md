# テンプレートトークン・式評価（Claude 向け詳細）

CLAUDE.md から分離した、Google Doc テンプレート・ファイル／フォルダ名・Gmail 本文・項目ラベル等で使うトークン置換システムのリファレンス。`driveTemplate.gs` / `expressionEvaluator.gs` / `templateEvaluator.gs` / `tokenReplacer.js` / `templateEvaluator.js` を触るときに参照する。

> **⚠️ alasql 全面移行（PR-4〜PR-8 で完了）**
>
> 旧 `{@field|pipe}` 構文（パイプ変換）と `[...]` JavaScript 演算式は廃止され、`{{ alasql 関数式 }}` に統一済み（テンプレート構文は `{{...}}` のみ。単一ブレース `{...}` は廃止＝リテラル）。
> - **新構文の例**: `` {{`氏名`}} ``、`` {{UPPER(`氏名`)}} ``、`` {{TIME_FORMAT(NOW(), 'YYYY-MM-DD')}} ``、`` {{IIF(`年齢` >= 20, '大人', '子供')}} ``、`` {{`姓` || `名`}} ``、`` {{`売上日`,`担当者`}} ``
> - **メンタルモデル**: `{{...}}` 内側は「`SELECT <内側> FROM this_table WHERE id = this_id`」と仮定した置換として評価される。`this_table` は当該レコードの属するテーブル、`this_id` はそのレコードの id。**`this_table` / `this_id` はあくまで概念モデルであり、SQL 内に書ける識別子ではない**（実装上は当該レコードを単一 row として評価器に渡す）。
>   - この比喩を**実際の SQL として書きたい**ときは下の **full-query モード**（先頭 `SELECT`）を使う。そこでは現フォーム＝`_form`、現レコード id＝`_id` を実体として書ける（`{{SELECT <内側> FROM _form WHERE [id] = _id}}` が単一式モードとほぼ等価）。
> - **トークンは連続二重ブレース `{{...}}`（ビュー形式）のみ**: **単一ブレース `{...}`（旧・元データ形式トークン）は廃止**され、リテラル文字としてそのまま出力される（トークンとして評価されない）。
>   - `{{...}}` は **ビュー形式**の typed view 行で評価する（保存層は元データ方式＝選択肢ごとのマーカー列だが、評価行はそれを畳み込んだ view）。選択肢はラベル（`checkboxes` は codec でエスケープ付きカンマ連結）、`number` は数値型・日付は canonical を保持（`{{`金額` + 50}}` の算術も正しく動く）。
>   - 例: 単一選択肢 `性別` で「男性」を選んだレコードなら `` {{`性別`}} `` → `"男性"`。
>   - 置換フィールド・印刷様式・Gmail 等すべての置換経路（フロント / GAS 双方）に適用。スキャナ（`templateScanner.js` の `describeToken` / GAS 側双子 `gas/templateEvaluator.gs`）は `{{ }}` のみトークンとして認識し、`resolveTemplate` は単一 row で評価する。
>   - 実装: フロント `utils/tokenReplacer.js` の `buildTemplateRow` が typed view 行を 1 本作り `resolveTemplate(text, row)` に渡す。挙動は `templateScanner.test.js` / `templateEvaluator.test.js` / `tests/gas-drive-template-replacement.test.cjs` が担保。
>   - 既存フォーム定義の `{...}` → `{{...}}` 移行は `gas/adminMigrations.gs` の `Admin_migrateSingleBraceToDoubleBraceInForms_`（手動実行・冪等）。印刷様式 Google Doc 本文は対象外なので管理者が手動で書き換える。
> - **カンマ列リスト**: `` {{`A`,`B`}} `` のようにトップレベルカンマで複数式を並べると、各式を評価して **カンマ単独** で連結する（例: `` {{`売上日`,`担当者`}} `` → `"2026-04-04,山田太郎"`）。`||` 連結は引き続き利用可（`` {{`姓` || `名`}} ``）し、両方を併用できる（例: `` {{`姓` || `名`, `所属`}} `` → `"山田太郎,営業"`）。
>   - 文字列リテラル `'...'` `"..."`、バッククォート識別子 `` `...` ``、括弧 `(...)` / `[...]` / `{...}` 内のカンマは保護され、トップレベルのカンマだけが分割境界となる。
>   - null / undefined は **空文字として連結**、区切り子は保持される（例: `` {{`A`,`B`}} `` で B が null なら `"A値,"`）。
>   - 末尾カンマ・連続カンマも空要素として連結に反映される（`` {{`A`,}} `` → `"A値,"`、`` {{`A`,,`B`}} `` → `"A値,,B値"`）。
>   - 別区切りで連結したい場合は `` {{CONCAT_WS(' / ', `A`, `B`)}} `` のように **alasql 式として** 書く（単一値扱い）。
>   - 部分式の 1 つでも評価エラーになると、トークン全体が fallback（フロント既定: 空文字 / GAS 既定: トークン原文）に置換される。
> - **フィールド参照** はバッククォートで囲む（` `` `）。
>   - ネストされた子質問は **スラッシュ区切り** `親/子/孫` のフルパスでバッククォートで囲んで参照する（例: `` `設置場所/設置開始日` ``）。トップレベル質問はパス＝葉ラベル。フィールド名自体に `/` を含めたいときはバックスラッシュでエスケープする（例: `` `設置場所/区分A\/B` ``）。`|` は区切りではなく通常文字（旧 `親|子` 参照も後方互換で `__` に解決される）。
>   - 葉ラベル単独参照は廃止。同名の葉ラベルが複数階層に存在し得るため、参照は常に一意のフルパスで明示する（検索バーと同じセマンティクス。`docs/developers/search-query-syntax.md` の「列名の書き方」と同一規則・同一コーデック `pathCodec.js`）。
> - **予約トークン** は `_id` / `_record_url` / `_form_url` / `_form_id` / `_form_name` をバッククォート付きで参照（`` `_id` `` 等）。
>   - **外部アクションの URL** も印刷様式と同じ `{{...}}` エンジンで解決する（旧・単括弧固定トークン `{id}` 等は読み込み時に `` {{`_id`}} `` へ自動マップ。対応表は `utils/externalActionUrl.js` の `LEGACY_EXTERNAL_ACTION_TOKEN_MAP`）。URL では解決値が自動で `encodeURIComponent` される（`resolveTemplate` の `opts.valueTransform`）。
>   - **機微予約トークン** `_spreadsheet_id` / `_spreadsheet_url` / `_sheet_name` / `_drive_file_url` / `_user_email` は **adminOnly && isAdmin の 外部アクションでのみ展開**（許可外で参照すると URL を null 化して送信中止。印刷経路には公開しない）。
> - **full-query モード（`{{SELECT ...}}`）**: トークン本文（trim 後）が先頭 `SELECT` のときは、単一スカラ式ではなく **完全な AlaSQL クエリ** として評価する（Question / 検索 SQL と同じ実行基盤を共有）。**参照範囲は自フォーム（`_form`）＋「別フォームを開く（formLink）」で紐づく子フォーム**。自フォーム内の集計（`COUNT` 等）・自己参照に加え、`FROM [子フォーム名]` ＋ `pid` 結合（`子.pid == 親.id`）で子フォームのレコードを引ける（例: `{{SELECT [氏名] FROM [従事者情報] WHERE [pid] = _id}}`）。**それ以外の他フォーム参照（formLink で紐づかない `FROM [別フォーム名]`）はエラー**。子フォームの件数・名前・URL だけなら式トークンの `CHILD_FORM_COUNT` / `CHILD_FORM_NAME` / `CHILD_FORM_URL` UDF でも取得できる（JOIN/サブクエリ不要・`includeChildData=ON` 必須）。スコープ制限は `preprocessSql` の `allowedFormIds`（`runFullQuery` が `{defaultFormId} ∪ {親 schema の formLink childFormId 群}` を渡す）。子フォームは親と同様に **レコードのメモリ常駐キャッシュ＋SWR 更新の対象**にする（`PreviewPage` が formLink 子フォームごとに定義を `previewForms` へ載せ、`recordsMemoryStore` を `dataStore.listEntries` で warm する。`includeChildData` フラグには依存しない）。cacheOnly な full-query は `getRecordsFromCache` から子レコードを引くため、この warming が前提。
>   - **現フォーム = `_form`**（テーブル別名）、**現レコード ID = `_id`**（裸で値として使える。`[id]` は列、`_id` は現レコードの id スカラ）。例: `` {{SELECT [氏名] FROM _form WHERE [id] = _id}} ``、`` {{SELECT COUNT(*) FROM _form WHERE [区] = '中央区'}} ``。検索/Question SQL の現フォーム別名も `_form`（旧 `_` は廃止）。
>   - **`_form` の現レコード行は「入力中のライブ値」で上書きして解決する**（保存済みキャッシュではなく `collectResponses` → `entriesToViewTableRows`＝`buildLiveViewRow` で作る live row を `id` で差し替え）。よって**新規/未保存レコードでも自己参照が成立**し、編集中の値が即時反映される（`PreviewPage` がデバウンスで再 prefetch）。他レコードはキャッシュ（`dataStore.listEntries`）から。
>   - **保存時に値を確定**: `handleSaveToSheet` が prefetch を await → `evaluateAllComputedFields` 再計算 → シリアライズしてシートに保存する（非同期解決が間に合わず保存が空になる問題を回避）。検索カラム・Drive/Gmail 出力はこの保存値を継続利用。
>   - 列名・自フォーム内の親子 JOIN（`pid`）の書き方は検索/Question SQL と同一（`[列名]` / バッククォート。`docs/developers/search-query-syntax.md` / `docs/notebooklm/question-sql-rulebook.md`）。`_id` は文字列リテラル・コメント・`[...]`・`` `...` `` の内側では置換されない（`` `_id` `` は従来どおり予約トークン）。
>   - **結果の畳み込み**: 0 行 → 空文字 / 1 行 1 列 → そのスカラ / それ以外 → 全セルを行優先で `coerceResultToString` し空を除いて `, ` 連結。カンマ列リスト分割は **適用されない**（SELECT リストのカンマを壊さない）。
>   - **解決はクライアント側**（GAS にクエリエンジンは無い）。動く経路: フロントの substitution フィールド表示・印刷プレビュー、Drive 出力ファイル名テンプレート、Gmail 宛先/件名/本文テンプレート。出力時はクライアントが full-query トークンだけを解決し、結果を `\{` `\}` エスケープして payload に載せる（単純な式トークンは従来どおり GAS が payload から解決）。
>   - **制約**: **Google Doc テンプレート本文内の `{{SELECT ...}}` は解決できない**（`gas/driveOutputDocument.gs` が Drive 上の Doc から `getText()` で直接読み、クライアント payload を通らないため）。GAS はリテラル/フォールバックのまま残す（`nfbEvaluateTemplate_` が full-query を式評価に渡さずスキップ）。Doc 本文で自フォーム集計を出したい場合は、いったん substitution フィールドに full-query を置いてその値を Doc から参照する。
>   - 実装: 検出 `templateScanner.js` `isFullQueryBody`（GAS 双子 `nfbTplIsFullQueryBody_`）、`_id` 置換・結果畳み込み `features/expression/fullQuerySql.js`、実行 `analyticsStore.js` `runFullQuery`（`runSearchSelect` 踏襲・`excludeMetaColumns:false`・スコープ `allowedFormIds` = 自フォーム ∪ `collectFormLinkFields(親 schema)` の childFormId）、現レコード live 行注入 `features/analytics/entriesToViewRows.js` `buildLiveViewRow` → `analyticsAlaSql.js` `registerFormAsTable` の `liveRowOverride`、スコープ検査 `utils/sqlPreprocessor.js` `allowedFormIds`（formLink で紐づかない他フォームは `outOfScopeFormError`）、prefetch/出力注入 `utils/tokenReplacer.js`（`prefetchQueryTokens` / `resolveQueryTokensInTemplate` / `injectResolvedQueryTokens`）、ライブ再解決＋保存時確定＋子フォーム定義ロード/レコード warming `features/preview/PreviewPage.jsx`（デバウンス prefetch effect / `handleSaveToSheet` / formLink 子フォームの `getChildFormCached_`＋`dataStore.listEntries` SWR warm → `previewForms`／`recordsMemoryStore`）。同期 `resolveTemplate` は `opts.queryTokenValues`（Map）から full-query 値を引くだけ（未解決警告は `opts.queryTokensReady` で gate）。テスト: `fullQuerySql.test.js` / `templateScanner.test.js` / `templateEvaluator.test.js` / `tokenReplacer.test.js` / `entriesToViewRows.test.js`（`buildLiveViewRow`） / `utils/sqlPreprocessor.test.js`（`allowedFormIds`） / `core/computedFields.fullquery.test.js` / `tests/gas-template-fullquery.test.cjs`。
> - **現在時刻** は alasql UDF `NOW()` で取得する（"YYYY-MM-DD_HH:mm:ss.sss" を返す）。例: `` {{NOW()}} ``、`` {{TIME_FORMAT(NOW(), 'YYYY-MM-DD')}} ``、`` {{YEAR(NOW())}} ``。Question SQL モード・検索の AlaSQL モードでも同じ意味で使える。
> - **使用可能な関数** は `builder/src/features/expression/registerNfbUdfs.js`（フロント・GAS 共通の UDF。GAS 側はこれを esbuild バンドルした `gas/generated/nfbAlasqlUdfs.gs` を使う。GAS の独自式評価器は廃止済み）を参照。
>   - alasql 標準: `UPPER`, `LOWER`, `SUBSTRING`/`SUBSTR`, `REPLACE`, `LENGTH`, `CONCAT`, `CONCAT_WS`, `IIF`, `IFNULL`, `NULLIF`, `COALESCE`, `CASE WHEN ... END`, `CAST`, `ROUND`/`CEIL`/`FLOOR`/`ABS`, `LIKE`/`IN`/`IS NULL`
>   - **prefix-less UDF（推奨）**:
>     - 文字列／数値整形: `TIME_FORMAT`, `NUMBER_FORMAT`, `KANA`, `ZEN`, `HAN`, `NOEXT`, `LPAD`, `RPAD`
>     - 先頭・末尾抽出と既定値: **`STR_LEFT(...)` / `STR_RIGHT(...)` / `STR_DEFAULT(...)` を使う**（Question SQL も含め全経路で統一）。テンプレートでは preprocessAlaSqlExpression が `LEFT`/`RIGHT`/`DEFAULT` を `STR_*` にリネームするため `LEFT()` 等でも通るが、Question SQL では予約語衝突で書けないため `STR_*` に揃える
>     - 日時: `DATE`, `DATETIME`, `TIMESTAMP`, `TIME`, `DATE2ERA`, `DATETIME2ERATIME`, `ERA2DATE`, `ERATIME2DATETIME`, `YEAR`/`MONTH`/`DAY`/`HOUR`/`MINUTE`/`SECOND`, `NENDO`（日本の年度・西暦。4 月始まりで 1〜3 月は前年）
>     - 真偽・数値化: `TO_BOOL`, `TO_NUMBER`
>     - 正規表現（自前 UDF は 2 つだけ）: `REGEXP_MATCH(text, pattern, groupIdx=0)`, `REGEXP_REPLACE(text, pattern, replacement)`
>       - **判定（boolean）はネイティブに委ねる**: `x REGEXP p` 演算子 / `REGEXP_LIKE(x, p[, flags])` 関数を使う。AlaSQL 4.17.x では `RLIKE` 演算子と `NOT REGEXP` は parse error なので使用しない（必要なら `NOT (x REGEXP p)` か `NOT REGEXP_LIKE(...)` を書く）。`REGEXP_LIKE` はデフォルト case-sensitive、第 3 引数 `'i'` で case-insensitive。
>       - `REGEXP_MATCH`: JS 標準 `String.prototype.match` の薄ラッパー。`groupIdx` 省略時は 0（マッチ全体）。**括弧の有無による fullMatch / group(1) 自動分岐は廃止**したので、グループを取りたいときは `REGEXP_MATCH(x, '(\\d+)', 1)` のように明示する。非マッチ・グループ未定義は空文字、`text` が NULL のときは NULL 伝搬。
>       - `REGEXP_REPLACE`: JS 標準 `String.prototype.replace` + `'g'` フラグ。`$&` / `$1`〜`$9` / `$<name>` / `$$` 等の特殊シーケンスがそのまま使える。**部分置換は呼び出し側で明示**（旧 #164 の「括弧ありなら group(1) のみ置換」自動挙動は廃止）: 例 `REGEXP_REPLACE(x, '(prefix)(\\d+)(suffix)', '$1NEW$3')` の形で `$1` バックリファレンスを使う。
>       - 注意: AlaSQL の SQL 文字列リテラル中の `\d` 等のバックスラッシュは 1 段消費されるため、`'\d+'` は実際には `d+` になる。`'[0-9]+'` を使うか `'\\d+'` のように二重エスケープする。
>     - 検索内部: `LIKE_ANY`（preprocessor が裸単語 LIKE で emit）
>     - fileUpload 欄専用: `FILE_NAMES`, `FILE_URLS`, `FOLDER_NAME`, `FOLDER_URL`
>     - formLink（別フォームを開く）欄専用: `CHILD_FORM_NAME`, `CHILD_FORM_ID`, `CHILD_FORM_URL`, `CHILD_FORM_COUNT`。`` `項目名` `` で formLink 項目を参照する。項目編集画面で「子フォームのデータを 外部アクション・印刷様式に渡す」(`includeChildData`) を ON にした項目のみ、このレコードに紐づく子フォーム行（pid==このレコード id）の合成オブジェクト `{ childFormId, childFormName, childFormUrl, count, records:[{id,no,items}] }` が row に注入され、各 UDF がそこから読む。OFF / 子データ未ロード時は空文字 / 0。
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
