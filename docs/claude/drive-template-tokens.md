# テンプレートトークン・パイプ変換（Claude 向け詳細）

CLAUDE.md から分離した、Google Doc テンプレート・ファイル／フォルダ名・Gmail 本文・項目ラベル等で使うトークン置換システムのリファレンス。`driveTemplate.gs` / `pipeEngine.js` / `tokenReplacer.js` を触るときに参照する。

レコードデータを埋め込んだ PDF・Gmail 下書き・Google Doc を自動生成できる。純粋計算 (式パーサ・変換関数・スキャナ・条件式評価) は `gas/pipeEngine.js` に**単一実装**として集約され、GAS バックエンドとフロントエンド (Vite) の双方が CommonJS/ESM 両対応の export 経由で再利用する。プラットフォーム固有のアダプタは GAS 側が `gas/driveTemplate.gs`、フロント側が `builder/src/utils/tokenReplacer.js` に置かれ、`context.resolveRef` / `context.resolveTemplate` コールバックで pipeEngine に注入する。

## 全体像

テンプレートは以下の 2 層で成り立つ。

1. **外側**: `{...}` の外はそのままリテラル文字列として出力される。`\{` `\}` でブレースをエスケープできる。
2. **`{...}` の内側**: **式言語**。値参照・演算子・パイプ・関数呼び出し・ネスト評価ができる。

## 式文法（EBNF）

```
expression   = pipeExpr ;
pipeExpr     = addExpr { "|" pipeCall } ;
pipeCall     = identifier [ ":" pipeArgs ] ;     (* pipeArgs は次の top-level | または }/末尾までの raw 文字列 *)
addExpr      = atom { "+" atom } ;
atom         = fieldRef | functionCall | subExpr | stringLit | numberLit | bareWord ;
functionCall = identifier ":" argList ;          (* 関数はトークン先頭の atom 位置のみ *)
argList      = argExpr { "," argExpr } ;         (* "," はブレース深さ 0 で split *)
subExpr      = "{" expression "}" ;              (* ネスト: 内側が先に評価される *)
fieldRef     = "@" ( quotedName | bareName ) ;
quotedName   = '"' ... '"' | "'" ... "'" ;
stringLit    = '"' ... '"' | "'" ... "'" ;
numberLit    = [ "-" ] digit+ [ "." digit+ ] ;
bareName     = bareChar+ ;                       (* 空白 / + | { } , : " ' @ を含まない *)
identifier   = letter ( letter | digit | "_" )* ;
```

**演算子優先順位:** `+` > `|`。つまり `{@a|f+@b|g}` は `@a | f(+@b|g)` のように解釈されるため、算術したい場合は `{{@a|f}+{@b|g}}` のように**内側 `{}` で明示的に囲む**。

**条件文法 (`if` の第 1 引数):** 既存の `nfbEvaluateIfCondition_` をそのまま再利用。`==` `!=` `<` `<=` `>` `>=` `in` `not` および `_` (パイプ入力) が使える。

## フィールド参照 `@label`

- `@name` — `name` をフィールドラベルまたは予約トークンとして解決。
- **クォート:** ラベル名に空白・`+`・`|`・`{`・`}`・`,`・`:`・`"`・`'`・`@` を含む場合は `@"label with spaces"` や `@'a+b'` のように**シングル/ダブルクォート**で囲む。
- **バックスラッシュ escape:** `@a\+b` は `a+b` という名前のフィールドを参照。
- **空白分離ルール:** bare 名の直後は**ターミネータ文字**（空白 / `+` `|` `{` `}` `,` `:`）または式の終端でなければならない。
  - OK:   `{@所属+@氏名|if:…}` — `+` と `|` が自動的な区切り
  - NG:   `{@氏名in 田中}` — `in` が名前の続きと誤解される。エラー。
  - 修正: `{@氏名 in "田中"}` のように空白を入れる（ただし `in` は条件式内部の演算子。上記は top-level では valid ではない）
- `{@_}` はパイプ入力値を参照する（サブテンプレート内でのみ有効）。

## 予約トークン（`@` プレフィックス必須）

| トークン | 内容 |
| --- | --- |
| `{@_id}` | レコード ID |
| `{@_NOW}` | 現在日時（`yyyy-MM-dd HH:mm:ss`）。`{@_NOW\|time:YYYY年MM月DD日}` のようにパイプで整形可 |
| `{@_record_url}` | レコード閲覧 URL（Gmail 出力時のみ有効） |
| `{@_form_url}` | フォーム入力 URL（Gmail 出力時のみ有効） |

## `+` 演算子（JavaScript セマンティクス）

- 両辺が数値なら**算術加算**
- どちらかが文字列なら**文字列連結**

```
{@所属+@氏名}                             # 営業山田（連結）
{{@年齢|parseINT}+1}                      # 31（算術加算）
{{@単価|parseFLOAT}+0.5}                  # 1.75（算術加算）
{{@年齢|parseINT}+" years"}               # 30 years（連結）
```

`parseINT` / `parseFLOAT` は**数値を返す typed-safe pipe**。それ以外の pipe（`upper`, `trim`, `number` など）は入力を必ず文字列化する。よって `+` を算術として使いたい場合は `parseINT` / `parseFLOAT` で片側を数値化する必要がある。

## ネスト `{...}`

内側 `{...}` は外側より先に評価され、結果が外側の atom として使われる。

```
{{@年齢|parseINT}+@年収}                  # 年齢を数値化→年収と文字列連結
{{{@a|parseINT}+{@b|parseINT}}|number:#,##0}  # 両方を数値化→算術加算→桁区切り
```

## 関数形式 `{funcName:arg1,arg2,...}`

トークンの先頭 atom 位置でのみ認識される特別な構文。現状は `if` のみ登録されている。

### `if` — 3 引数条件分岐

```
{if:cond,trueValue,falseValue}
{@x|if:cond,trueValue,falseValue}  # パイプ形式も同じ 3 引数
```

- 条件文法は `==` `!=` `<` `<=` `>` `>=` `in` `not`、`@ref`、`_`（パイプ入力）、`"literal"`、数値リテラル。
- `trueValue` / `falseValue` は**値位置**の特殊記法をサポート: `_` (パイプ入力) / `\_` (リテラル `_`) / `@field` / `{...}` (サブテンプレート) / リテラル文字列。
- 旧 `|ifv:cond,true,false` は廃止。旧 2 引数 `|if:cond,else` も廃止。どちらも新 3 引数 `if` に統一。

```
{if:@x==1,one,other}
{@区分|if:@区分=="済",完了,未完了}
{@結果|if:"記事掲載" in _,■,□}
{@金額|if:@金額>1000,_,未満}             # 一致→パイプ入力、不一致→"未満"
{@状態|if:@状態==完了,({@対応者})完了,未対応}  # サブテンプレート
```

## fileUpload 欄専用パイプ

fileUpload フィールドのラベルを `@` 参照した上で以下のパイプを付けると、その欄のファイル情報を取得できる。

| パイプ | 内容 |
| --- | --- |
| `{@<欄>}` | カンマ区切りファイル名（既定の振る舞い） |
| `{@<欄>\|file_names}` | カンマ区切りファイル名 |
| `{@<欄>\|file_urls}` | カンマ区切りファイル URL |
| `{@<欄>\|folder_name}` | 保存フォルダ名 |
| `{@<欄>\|folder_url}` | 保存フォルダ URL |

## パイプ変換一覧

| 変換 | 引数 | 説明 | 例 |
| --- | --- | --- | --- |
| `time` | `format` | 日付＋時刻を書式化。日付: `YYYY` `YY` `MM` `M` `DD` `D` `ddd` `dddd` `gg`（和暦元号）`ee` `e`。時刻: `HH` `H` `mm` `m` `ss` `s` | `{@日付\|time:gg ee年M月D日(ddd)}` |
| `left` | `n` | 先頭 n 文字を取得 | `{@氏名\|left:1}` |
| `right` | `n` | 末尾 n 文字を取得 | `{@コード\|right:4}` |
| `mid` | `start[,length]` | 指定位置から文字列を切り出し | `{@コード\|mid:2,5}` |
| `pad` | `length[,char]` | 左側を埋め文字（デフォルト `0`）で n 桁に | `{@番号\|pad:5}` → `00042` |
| `padRight` | `length[,char]` | 右側を埋め文字（デフォルト半角スペース）で n 桁に | `{@値\|padRight:10}` |
| `upper` | — | 大文字に変換 | `{@名前\|upper}` |
| `lower` | — | 小文字に変換 | `{@メール\|lower}` |
| `trim` | — | 前後の空白を除去 | `{@入力\|trim}` |
| `default` | `fallback` | 空値時の代替値（サブテンプレート可） | `{@備考\|default:なし}` |
| `replace` | `from,to` | 文字列を全置換（リテラル一致、`,` は `\,` でエスケープ） | `{@電話\|replace:-,}` |
| `match` | `pattern[,group]` | 正規表現でマッチし指定グループを抽出（デフォルト 0） | `{@値\|match:\\d+}` |
| `number` | `format` | 数値書式（`#` `0` `,` `.` をサポート、負号・前後の固定文字列可） | `{@金額\|number:¥#,##0}` |
| `if` | `condition,trueValue,falseValue` | **3 引数**条件分岐（新仕様）。旧 2 引数 `if` / 旧 `ifv` は廃止 | `{@区分\|if:@区分=="済",完了,未完了}` |
| `map` | `k1=v1;k2=v2;*=fb` | 値マッピング（`;` 区切り、`*=` でフォールバック） | `{@性別\|map:M=男性;F=女性;*=不明}` |
| `parseINT` | — | **新規**: `parseInt` と同等。数値を返すので `+` 算術が可能 | `{{@年齢\|parseINT}+1}` |
| `parseFLOAT` | — | **新規**: `parseFloat` と同等。数値を返すので `+` 算術が可能 | `{{@単価\|parseFLOAT}+0.5}` |
| `noext` | — | ファイル名から拡張子を除去（カンマ区切り複数対応） | `{@添付\|noext}` |
| `kana` | — | ひらがなをカタカナに変換 | `{@ふりがな\|kana}` |
| `zen` | — | 半角 → 全角に変換（ASCII・スペース・半角カナ・濁点/半濁点合成） | `{@番号\|zen}` |
| `han` | — | 全角 → 半角に変換（ASCII・スペース・全角カナ・濁点/半濁点分解） | `{@カナ\|han}` |
| `file_names` / `file_urls` / `folder_name` / `folder_url` | — | fileUpload 欄専用（上記参照） | `{@添付\|file_urls}` |

## 変換チェーンの例

```
{@氏名|trim|upper}                             # 空白除去→大文字
{@日付|time:YYYY年MM月DD日(ddd)}                # 曜日付き日付書式
{@金額|number:#,##0|default:0}                 # 桁区切り→空なら 0
{@性別|map:M=男性;F=女性;*=不明}                # 値マッピング
{@添付ファイル|noext}                            # 拡張子除去
{@添付ファイル|file_urls}                        # Drive ファイル URL
{@所属+@氏名}                                   # 複数フィールドの連結
{{@年齢|parseINT}+1}                             # 数値加算
{if:@区分=="済",完了,未完了}                    # 関数形式 if
{@区分|if:@区分=="済",完了,未完了}              # パイプ形式 if（3 引数）
{@メモ|if:@_folder_url,_,記載なし}              # 予約トークン存在チェック
```

## パースエラー時の挙動

`{...}` のパース／評価に失敗したときは:

1. **原トークンをそのまま残す** — 出力文字列中に `{...}` がそのまま残るので、author がテンプレート上で原因箇所を見つけやすい。
2. **エラーログを出す** — GAS 側は `Logger.log`、フロント側は `console.warn` に `"[nfb template] <message> in \"{...}\""` を出力。

代表的なエラーメッセージ:

| ケース | メッセージ |
| --- | --- |
| 未閉鎖文字列 | `unterminated string literal near position N` |
| `@` の後が空 | `@ must be followed by a field name` |
| 区切りなくトークンが連続 | `unexpected token '...' after expression` |
| `if` の引数不足 | `if expects 3 arguments (condition, trueValue, falseValue), got N` |
| `+` の直後が空 | `unexpected end of expression after '+'` |
| 未知のパイプ名 | **warn のみ**（素通しで値を保持） |

## 破壊的変更（旧構文からの移行）

| 旧 | 新 | 備考 |
| --- | --- | --- |
| `{plain}` → `""` | `{plain}` → `"plain"` | `@` なしは bare word リテラル |
| `{_NOW}` → `""` | `{_NOW}` → `"_NOW"` | `@` を付けて `{@_NOW}` に |
| `\|ifv:cond,t,f` | `\|if:cond,t,f` | 統一 |
| `\|if:cond,else`（2 引数） | `\|if:cond,_,else`（3 引数） | pipe 入力を明示的に `_` で参照 |
| ラベルに `+` `\|` `{` `}` `,` `:` 空白を含む | `{@"a+b"}` / `{@a\+b}` | クォートかバックスラッシュ escape |
