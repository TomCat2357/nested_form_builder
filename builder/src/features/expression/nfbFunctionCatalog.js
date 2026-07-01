// Playground「関数一覧」パネルの単一情報源（データのみ・DOM/React 非依存）。
//
// Playground（/admin/playground）の Question SQL・検索・置換テンプレートで使える
// 関数／予約トークンをカテゴリ別に列挙する。掲載範囲は「NFB 独自 UDF ＋ 主要な
// alasql 組込関数 ＋ 予約トークン」。
//
// 各 item:
//   name        表示名（関数名 / トークン名）
//   kind        "udf"    … registerNfbUdfs.js の alasql.fn.* 独自 UDF
//               "aggr"   … registerNfbUdfs.js の alasql.aggr.* 独自集計 UDF
//               "native" … alasql 組込（本ファイルでは登録しない。参考掲載）
//               "token"  … 置換テンプレートの予約トークン（バッククォート参照）
//   signature   引数の形（日本語プレースホルダ）
//   description 1 行の説明
//   example     実際に動く用例（表示用。挿入はしない）
//   snippet     クリック挿入時の素の文字列（省略時は kind に応じて既定生成:
//               関数系 → "NAME()" / token → `NAME`）。囲み（{{ }}）は挿入側でモードに
//               応じて付与するのでここでは付けない。
//   sensitive   true のとき機微トークン（管理者ゲートの外部アクションでのみ展開）
//
// kind:"udf"/"aggr" の name は registerNfbUdfs.js の登録実体と一致していなければならず、
// 乖離は同居の nfbFunctionCatalog.test.js（ドリフト検知）が検出する。説明・用例の典拠は
// docs/claude/drive-template-tokens.md と registerNfbUdfs.js のコメント。

export const NFB_FUNCTION_CATALOG = [
  {
    category: "日付・時刻",
    items: [
      { name: "DATE", kind: "udf", signature: "DATE(値)", description: "日付を canonical 文字列 \"YYYY-MM-DD\" に整形する。", example: "DATE([受付日]) → \"2026-07-01\"" },
      { name: "DATETIME", kind: "udf", signature: "DATETIME(値)", description: "日時を \"YYYY-MM-DD_HH:mm:ss.SSS\" に整形する。", example: "DATETIME([作成日時])" },
      { name: "TIME", kind: "udf", signature: "TIME(値)", description: "時刻を \"HH:mm:ss.SSS\" に整形する（TIMEMS と同義）。", example: "TIME([開始時刻])" },
      { name: "TIMEMS", kind: "udf", signature: "TIMEMS(値)", description: "TIME と同義。時刻を \"HH:mm:ss.SSS\"（ミリ秒まで）で返す。", example: "TIMEMS([開始時刻])" },
      { name: "TIMES", kind: "udf", signature: "TIMES(値)", description: "時刻を \"HH:mm:ss\"（秒まで）に整形する。", example: "TIMES([開始時刻])" },
      { name: "TIMEM", kind: "udf", signature: "TIMEM(値)", description: "時刻を \"HH:mm\"（分まで）に整形する。", example: "TIMEM([開始時刻])" },
      { name: "TIMESTAMP", kind: "udf", signature: "TIMESTAMP(値)", description: "日時を unix ミリ秒（数値）に変換する。差分計算用。", example: "TIMESTAMP([終了]) - TIMESTAMP([開始])" },
      { name: "YEAR", kind: "udf", signature: "YEAR(値)", description: "年（数値）を取り出す。", example: "YEAR([受付日]) → 2026" },
      { name: "MONTH", kind: "udf", signature: "MONTH(値)", description: "月（数値）を取り出す。", example: "MONTH([受付日])" },
      { name: "DAY", kind: "udf", signature: "DAY(値)", description: "日（数値）を取り出す。", example: "DAY([受付日])" },
      { name: "HOUR", kind: "udf", signature: "HOUR(値)", description: "時（数値）を取り出す。", example: "HOUR([開始時刻])" },
      { name: "MINUTE", kind: "udf", signature: "MINUTE(値)", description: "分（数値）を取り出す。", example: "MINUTE([開始時刻])" },
      { name: "SECOND", kind: "udf", signature: "SECOND(値)", description: "秒（数値。ミリ秒があれば小数）を取り出す。", example: "SECOND([開始時刻])" },
      { name: "NENDO", kind: "udf", signature: "NENDO(値)", description: "日本の年度（西暦・数値）。4 月始まりで 1〜3 月は前年。", example: "NENDO([受付日]) → 2026" },
      { name: "NOW", kind: "udf", signature: "NOW()", description: "現在時刻を \"YYYY-MM-DD_HH:mm:ss.SSS\"（JST）で返す。", example: "{{NOW()}}" },
      { name: "TIME_FORMAT", kind: "udf", signature: "TIME_FORMAT(値, 書式)", description: "日時を書式整形（和暦 gg / 曜日 dddd,ddd / YYYY MM DD HH mm ss 等）。", example: "TIME_FORMAT(NOW(), 'YYYY年M月D日(ddd)')", snippet: "TIME_FORMAT(, '')" },
    ],
  },
  {
    category: "和暦",
    items: [
      { name: "DATE2ERA", kind: "udf", signature: "DATE2ERA(値)", description: "日付を和暦文字列に変換する（例「令和元年5月1日」）。", example: "DATE2ERA([受付日])" },
      { name: "DATETIME2ERATIME", kind: "udf", signature: "DATETIME2ERATIME(値)", description: "日時を和暦＋時分秒に変換する（例「令和2年4月15日 10時22分00秒」）。", example: "DATETIME2ERATIME([作成日時])" },
      { name: "ERA2DATE", kind: "udf", signature: "ERA2DATE(和暦文字列)", description: "和暦文字列を \"YYYY-MM-DD\" に変換する（DATE2ERA の逆）。", example: "ERA2DATE('令和2年4月15日')" },
      { name: "ERATIME2DATETIME", kind: "udf", signature: "ERATIME2DATETIME(和暦文字列)", description: "和暦文字列を canonical 日時に変換する（DATETIME2ERATIME の逆）。", example: "ERATIME2DATETIME('令和2年4月15日 10時')" },
    ],
  },
  {
    category: "文字列",
    items: [
      { name: "UPPER", kind: "native", signature: "UPPER(値)", description: "英字を大文字化する（alasql 組込）。", example: "UPPER([記号])" },
      { name: "LOWER", kind: "native", signature: "LOWER(値)", description: "英字を小文字化する（alasql 組込）。", example: "LOWER([記号])" },
      { name: "SUBSTRING", kind: "native", signature: "SUBSTRING(値, 開始, 長さ)", description: "部分文字列を取り出す（1 始まり。alasql 組込）。", example: "SUBSTRING([氏名], 1, 2)", snippet: "SUBSTRING(, , )" },
      { name: "REPLACE", kind: "native", signature: "REPLACE(値, 検索, 置換)", description: "文字列を単純置換する（alasql 組込）。", example: "REPLACE([住所], '　', ' ')", snippet: "REPLACE(, , )" },
      { name: "LENGTH", kind: "native", signature: "LENGTH(値)", description: "文字数を返す（alasql 組込）。", example: "LENGTH([氏名])" },
      { name: "CONCAT", kind: "native", signature: "CONCAT(a, b, ...)", description: "文字列を連結する（alasql 組込。|| でも可）。", example: "CONCAT([姓], [名])", snippet: "CONCAT(, )" },
      { name: "CONCAT_WS", kind: "native", signature: "CONCAT_WS(区切り, a, b, ...)", description: "区切り文字を挟んで連結する（alasql 組込）。", example: "CONCAT_WS(' / ', [姓], [名])", snippet: "CONCAT_WS(' / ', , )" },
      { name: "KANA", kind: "udf", signature: "KANA(値)", description: "ひらがなをカタカナに変換する。", example: "KANA([ふりがな])" },
      { name: "ZEN", kind: "udf", signature: "ZEN(値)", description: "半角文字を全角に変換する（濁点・半濁点対応）。", example: "ZEN([番号])" },
      { name: "HAN", kind: "udf", signature: "HAN(値)", description: "全角文字を半角に変換する。", example: "HAN([番号])" },
      { name: "STR_LEFT", kind: "udf", signature: "STR_LEFT(値, n)", description: "先頭 n 文字を返す（予約語 LEFT の代替）。", example: "STR_LEFT([郵便番号], 3)", snippet: "STR_LEFT(, )" },
      { name: "STR_RIGHT", kind: "udf", signature: "STR_RIGHT(値, n)", description: "末尾 n 文字を返す（予約語 RIGHT の代替）。", example: "STR_RIGHT([郵便番号], 4)", snippet: "STR_RIGHT(, )" },
      { name: "STR_DEFAULT", kind: "udf", signature: "STR_DEFAULT(値, 既定)", description: "空値（null / undefined / 空文字）なら既定値を返す。", example: "STR_DEFAULT([備考], '（なし）')", snippet: "STR_DEFAULT(, '')" },
      { name: "LPAD", kind: "udf", signature: "LPAD(値, 桁, 文字=' ')", description: "左詰めパディング（ゼロ埋め等）。", example: "LPAD([番号], 5, '0')", snippet: "LPAD(, , '0')" },
      { name: "RPAD", kind: "udf", signature: "RPAD(値, 桁, 文字=' ')", description: "右詰めパディング。", example: "RPAD([コード], 8, ' ')", snippet: "RPAD(, , ' ')" },
      { name: "NOEXT", kind: "udf", signature: "NOEXT(値)", description: "ファイル名から拡張子を除去する（\", \" 区切りの複数対応）。", example: "NOEXT(FILE_NAMES([添付]))" },
      { name: "UNIQUE_CSV", kind: "udf", signature: "UNIQUE_CSV(値)", description: "カンマ区切り文字列を初出順でユニーク化する（空要素除外・各要素 trim）。", example: "UNIQUE_CSV('a, b,,a,c') → \"a,b,c\"" },
    ],
  },
  {
    category: "数値",
    items: [
      { name: "NUMBER_FORMAT", kind: "udf", signature: "NUMBER_FORMAT(値, 書式)", description: "数値を書式整形する（例 \"#,##0.00円\" / \"$#,##0\"）。", example: "NUMBER_FORMAT([金額], '#,##0円')", snippet: "NUMBER_FORMAT(, '#,##0')" },
      { name: "ROUND", kind: "native", signature: "ROUND(値, 桁)", description: "四捨五入する（alasql 組込）。", example: "ROUND([単価] * 1.1, 0)", snippet: "ROUND(, 0)" },
      { name: "CEIL", kind: "native", signature: "CEIL(値)", description: "切り上げる（alasql 組込）。", example: "CEIL([数量])" },
      { name: "FLOOR", kind: "native", signature: "FLOOR(値)", description: "切り捨てる（alasql 組込）。", example: "FLOOR([数量])" },
      { name: "ABS", kind: "native", signature: "ABS(値)", description: "絶対値を返す（alasql 組込）。", example: "ABS([差分])" },
    ],
  },
  {
    category: "型変換・真偽",
    items: [
      { name: "TO_BOOL", kind: "udf", signature: "TO_BOOL(値)", description: "真偽化する。空 / \"false\" / \"0\" / 0 / null は false、それ以外は true。", example: "IIF(TO_BOOL([同意]), '済', '未')" },
      { name: "TO_NUMBER", kind: "udf", signature: "TO_NUMBER(値)", description: "数値化する（失敗時は NULL）。", example: "TO_NUMBER([金額文字列]) + 100" },
      { name: "CAST", kind: "native", signature: "CAST(値 AS 型)", description: "型変換する（alasql 組込。INT / FLOAT / STRING 等）。", example: "CAST([金額] AS INT)", snippet: "CAST( AS INT)" },
    ],
  },
  {
    category: "条件・NULL",
    items: [
      { name: "IIF", kind: "native", signature: "IIF(条件, 真の値, 偽の値)", description: "三項条件（alasql 組込）。", example: "IIF([年齢] >= 20, '大人', '子供')", snippet: "IIF(, , )" },
      { name: "IFNULL", kind: "native", signature: "IFNULL(値, 既定)", description: "値が null なら既定値を返す（alasql 組込）。", example: "IFNULL([備考], '')", snippet: "IFNULL(, )" },
      { name: "NULLIF", kind: "native", signature: "NULLIF(値, 比較)", description: "値が比較と等しければ null を返す（alasql 組込）。", example: "NULLIF([区分], '')", snippet: "NULLIF(, )" },
      { name: "COALESCE", kind: "native", signature: "COALESCE(a, b, ...)", description: "最初の非 null を返す（alasql 組込）。", example: "COALESCE([携帯], [固定電話])", snippet: "COALESCE(, )" },
      { name: "CASE WHEN", kind: "native", signature: "CASE WHEN 条件 THEN 値 ... ELSE 値 END", description: "多分岐の条件式（alasql 組込）。", example: "CASE WHEN [得点] >= 80 THEN 'A' ELSE 'B' END", snippet: "CASE WHEN  THEN  ELSE  END" },
    ],
  },
  {
    category: "正規表現",
    items: [
      { name: "REGEXP_MATCH", kind: "udf", signature: "REGEXP_MATCH(文字列, パターン, グループ番号=0)", description: "一致部分（またはグループ）を抽出する。非一致は空文字。グループは番号で明示。", example: "REGEXP_MATCH([電話], '([0-9]+)', 1)", snippet: "REGEXP_MATCH(, '')" },
      { name: "REGEXP_REPLACE", kind: "udf", signature: "REGEXP_REPLACE(文字列, パターン, 置換)", description: "正規表現で置換する（g フラグ。$1〜$9 / $& 等使用可）。", example: "REGEXP_REPLACE([コード], '[^0-9]', '')", snippet: "REGEXP_REPLACE(, '', '')" },
      { name: "REGEXP_LIKE", kind: "native", signature: "REGEXP_LIKE(文字列, パターン[, 'i'])", description: "一致判定（真偽。alasql 組込）。第 3 引数 'i' で大小無視。", example: "REGEXP_LIKE([氏名], '^山', 'i')", snippet: "REGEXP_LIKE(, '')" },
    ],
  },
  {
    category: "多値・検索",
    items: [
      { name: "MV_EQ", kind: "udf", signature: "MV_EQ(セル, 値)", description: "複数値セル（チェックボックス等）が指定値を含むか判定する。", example: "MV_EQ([対応], '完了')", snippet: "MV_EQ(, '')" },
      { name: "MV_IN", kind: "udf", signature: "MV_IN(セル, 値1, 値2, ...)", description: "複数値セルがいずれかの値を含むか判定する。", example: "MV_IN([区], '中央区', '北区')", snippet: "MV_IN(, '')" },
      { name: "LIKE_ANY", kind: "udf", signature: "LIKE_ANY(キーワード, 列1, 列2, ...)", description: "複数列を横断して部分一致判定する（検索の裸単語用。* でワイルドカード）。", example: "LIKE_ANY('山田', [氏名], [備考])", snippet: "LIKE_ANY(, )" },
    ],
  },
  {
    category: "fileUpload 項目",
    items: [
      { name: "FILE_NAMES", kind: "udf", signature: "FILE_NAMES(ファイル項目)", description: "添付ファイル名をカンマ連結で返す（拡張子付き。NOEXT で除去可）。", example: "FILE_NAMES([添付])" },
      { name: "FILE_URLS", kind: "udf", signature: "FILE_URLS(ファイル項目)", description: "添付ファイルの Drive URL をカンマ連結で返す。", example: "FILE_URLS([添付])" },
      { name: "FOLDER_NAME", kind: "udf", signature: "FOLDER_NAME(ファイル項目)", description: "添付の保存フォルダ名を返す。", example: "FOLDER_NAME([添付])" },
      { name: "FOLDER_URL", kind: "udf", signature: "FOLDER_URL(ファイル項目)", description: "添付の保存フォルダ URL を返す。", example: "FOLDER_URL([添付])" },
    ],
  },
  {
    category: "formLink（子フォーム）項目",
    items: [
      { name: "CHILD_FORM_NAME", kind: "udf", signature: "CHILD_FORM_NAME(項目)", description: "紐づく子フォーム名を返す（項目の includeChildData=ON が前提）。", example: "CHILD_FORM_NAME([従事者])" },
      { name: "CHILD_FORM_ID", kind: "udf", signature: "CHILD_FORM_ID(項目)", description: "紐づく子フォームの ID を返す。", example: "CHILD_FORM_ID([従事者])" },
      { name: "CHILD_FORM_URL", kind: "udf", signature: "CHILD_FORM_URL(項目)", description: "子フォームを開く URL を返す。", example: "CHILD_FORM_URL([従事者])" },
      { name: "CHILD_FORM_COUNT", kind: "udf", signature: "CHILD_FORM_COUNT(項目)", description: "このレコードに紐づく子レコードの件数を返す。", example: "CHILD_FORM_COUNT([従事者])" },
    ],
  },
  {
    category: "集計（SQL / full-query）",
    items: [
      { name: "COUNT", kind: "native", signature: "COUNT(*)", description: "件数を数える（alasql 組込）。", example: "SELECT COUNT(*) FROM _form", snippet: "COUNT(*)" },
      { name: "SUM", kind: "native", signature: "SUM(列)", description: "合計する（alasql 組込）。", example: "SELECT SUM([金額]) FROM _form", snippet: "SUM()" },
      { name: "AVG", kind: "native", signature: "AVG(列)", description: "平均する（alasql 組込）。", example: "SELECT AVG([得点]) FROM _form", snippet: "AVG()" },
      { name: "MIN", kind: "native", signature: "MIN(列)", description: "最小値（数値列。alasql 組込）。日付文字列など非数値列は STR_MIN。", example: "SELECT MIN([金額]) FROM _form", snippet: "MIN()" },
      { name: "MAX", kind: "native", signature: "MAX(列)", description: "最大値（数値列。alasql 組込）。日付文字列など非数値列は STR_MAX。", example: "SELECT MAX([金額]) FROM _form", snippet: "MAX()" },
      { name: "STR_MAX", kind: "aggr", signature: "STR_MAX(列)", description: "辞書順の最大を返す集計（canonical 日付文字列など非数値列用）。", example: "SELECT STR_MAX([受付日]) FROM _form", snippet: "STR_MAX()" },
      { name: "STR_MIN", kind: "aggr", signature: "STR_MIN(列)", description: "辞書順の最小を返す集計（非数値列用）。", example: "SELECT STR_MIN([受付日]) FROM _form", snippet: "STR_MIN()" },
    ],
  },
  {
    category: "予約トークン（置換テンプレート）",
    items: [
      { name: "_id", kind: "token", signature: "`_id`", description: "このレコードの id。", example: "{{`_id`}}" },
      { name: "_record_url", kind: "token", signature: "`_record_url`", description: "このレコードを開く URL（外部アクション / Gmail 経路）。", example: "{{`_record_url`}}" },
      { name: "_form_url", kind: "token", signature: "`_form_url`", description: "フォームの URL。", example: "{{`_form_url`}}" },
      { name: "_form_id", kind: "token", signature: "`_form_id`", description: "フォームの ID。", example: "{{`_form_id`}}" },
      { name: "_form_name", kind: "token", signature: "`_form_name`", description: "フォーム名。", example: "{{`_form_name`}}" },
      { name: "_spreadsheet_id", kind: "token", sensitive: true, signature: "`_spreadsheet_id`", description: "保存先スプレッドシートの ID。管理者ゲートの外部アクションでのみ展開。", example: "{{`_spreadsheet_id`}}" },
      { name: "_spreadsheet_url", kind: "token", sensitive: true, signature: "`_spreadsheet_url`", description: "保存先スプレッドシートの URL（機微・管理者ゲートのみ）。", example: "{{`_spreadsheet_url`}}" },
      { name: "_sheet_name", kind: "token", sensitive: true, signature: "`_sheet_name`", description: "保存先シート名（機微・管理者ゲートのみ）。", example: "{{`_sheet_name`}}" },
      { name: "_drive_file_url", kind: "token", sensitive: true, signature: "`_drive_file_url`", description: "フォーム定義ファイルの Drive URL（機微・管理者ゲートのみ）。", example: "{{`_drive_file_url`}}" },
      { name: "_user_email", kind: "token", sensitive: true, signature: "`_user_email`", description: "実行ユーザーのメールアドレス（機微・管理者ゲートのみ）。", example: "{{`_user_email`}}" },
    ],
  },
];

// クリック挿入時の素の文字列を組み立てる（囲み {{ }} はモードに応じて呼び出し側が付与）。
//   関数系: item.snippet ?? "NAME()"
//   token : バッククォート参照 `NAME`
export function catalogInsertSnippet(item) {
  if (!item) return "";
  if (item.kind === "token") return "`" + item.name + "`";
  return item.snippet != null ? item.snippet : item.name + "()";
}
