# 苦情・通報 PDF / CSV 振り分け（kujo_intake）

苦情・通報を 2 経路で取り込めるスタンドアロン Google Apps Script ウェブアプリです。フォーム
「**R8環境共生担当課_苦情・通報等対応一覧**」のネスト分類へ振り分けた `uploadRecords`(JSON) を生成します。
本体アプリ（`gas/`）には一切手を入れません（`choju_yoshiki/` の兄弟）。

- **PDF**（**市政相談対応票** / **ホームページ問い合わせ** 等）の**リンクを受け取り**、ブラウザの **pdf.js** でテキスト抽出 → 様式駆動でラベル抽出。
- **CSV**（札幌市 CMS「**お問い合わせフォーム**」エクスポート、**Shift-JIS / UTF-8 自動判定**）を**ファイルアップロード**で受け取り、ブラウザがデコード → GAS が**列ヘッダ駆動**でマッピング。**1 データ行 = 1 問い合わせ = 1 レコード**。**内容が同じ行（重複）は取り込まない**（§1 重複の取り込み防止）。

- **外部 AI / API 不使用**: PDF のテキスト抽出は**ブラウザの pdf.js**、CSV のデコードは**ブラウザの TextDecoder**（完全クライアント内）。Gemini 等は使いません。
- **越境書込みなし**: このアプリは Sheets に直接書きません。出力 JSON を返すだけ（Drive はリンク先 PDF の**読み取り専用**。CSV はローカルファイルを直接読むので Drive すら触りません）。
- **反映は choju と同方式**: 出力 JSON を本体アプリの取り込み口（**管理者 > Playground**）で `sync_records` に渡してレコード化します。
- **分類は様式駆動 + 人手レビュー**: 様式（フォーム雛形）／CSV 列ヘッダごとの固定マッピングだけ自動抽出します。相談大分類・対象種・相談種類など
  **ネストの深い意味分類は自動では入りません**。抽出した「相談詳細」を見て、プレビュー/JSON を**人手で補完**してください。

実体は単一ファイル `Combined.gs`（バナーコメントで `Code/codec/schema/extract/csv/mapper/drive/upload/date/setup/Test` に区切り）と、
pdf.js をベンダリングした `pdfjs.html`。

---

## 1. しくみ

### PDF（リンク → pdf.js）

1. `doGet(?page=parse&pdf=<DriveのURL/ID>)` でパースページを開く（`pdf` は省略可。ページ内のテキスト欄に手貼りもできる。複数は改行区切り）。
2. [パース] ボタン → `google.script.run.Kuj_fetchPdfBase64_(ref)` で **GAS がリンク先 PDF の「生バイト」を base64 にして返す**
   （Drive は `DriveApp`、http(s) は `UrlFetchApp`。**GAS は PDF を解析しない＝バイト中継のみ**。ブラウザの CORS 回避のため）。
3. ブラウザの **pdf.js** が base64 → 全文テキスト抽出（`getTextContent` を y 座標で行復元）。`pdfjs.html` を include して使用。
4. `google.script.run.Kuj_parseTextToRecords_(text, name)` → GAS が
   **様式判定**（`Kuj_detectLayout_`）→ **ラベル抽出**（`Kuj_textToCandidate_`）→ `Kuj_candidateToData_` → `Kuj_buildUploadRecords_`。

### CSV（ファイルアップロード → 列ヘッダ駆動）

1. パースページの **CSV ファイル選択**でローカル CSV（複数可）を選ぶ。
2. [パース] ボタン → ブラウザが `file.arrayBuffer()` で読み、**文字コードを自動判定**してテキスト化（`TextDecoder`）。
   判定順: ①UTF-8 BOM → UTF-8、②`fatal:true` の UTF-8 デコードが通れば UTF-8、③通らなければ Shift-JIS。
   （`TextDecoder("shift_jis")` は不正バイトでも例外を投げず文字化けするため、**UTF-8 妥当性を先に判定**して Shift-JIS へフォールバックする。）
3. `google.script.run.Kuj_parseCsvToRecords_(text, name)` → GAS が **ピュア CSV パース**（`Kuj_parseCsv_`：引用符・フィールド内カンマ/改行・CRLF 対応）→
   **列ヘッダ駆動マッピング**（`Kuj_csvToCandidates_` / `Kuj_csvRowToCandidate_`）→ `Kuj_candidateToData_` → `Kuj_buildUploadRecords_`。**1 データ行 = 1 レコード**、空行・**重複行**はスキップ（下記）。

#### 重複の取り込み防止

次の **12 列がすべて一致する行は同一とみなし、最初の 1 件だけ取り込みます**（`KUJ_CSV_DEDUP_COLS_`）:
`現在の振分先 / 問い合わせ件名 / メールアドレス / 氏名 / ふりがな / 年齢 / 職業 / 住所 / 郵便番号 / 電話番号 / 件名 / 内容`。
**`ステータス`・`問い合わせ日`・`返信者` は判定対象外**（受付状況・受付日時・返信者が違っても、内容が同じなら重複）。

- **ファイル内**: `Kuj_csvToCandidates_` が `Kuj_csvDedupKey_`（上記 12 列を trim して連結したキー）で除外し、`duplicates` 件数と警告を返す。
- **ファイル横断**: ブラウザの `finish()` が各レコードの `dedupKey`（preview に同梱）で、複数 CSV をまとめて選んだときの重複も除外（PDF は `dedupKey=""` で対象外）。
- この外部アクションは**本体フォームの既存レコードを読まない**（越境読込なし）ので、重複判定は**この取り込みバッチ内**で完結する（既に取り込み済みのレコードとの重複は本体側で確認）。

### 共通（PDF / CSV とも）

data キーは `/` 連結ラベルパスを**パスコーデックでエスケープ**、複数選択は `", "` 連結、子キーは親が選ばれたときだけ出力、enum 外は破棄＋警告（`Kuj_candidateToData_`）。そのうえで:

1. 全入力（PDF / CSV）の `uploadRecords` を 1 つにマージし、プレビュー表（様式・問合せ方法・受付日・相談詳細冒頭）と JSON を表示。
2. その JSON を **管理者 > Playground** に貼って `sync_records` 実行 → Data シートにレコード追加。

### 様式駆動マッピング（PDF: `Kuj_textToCandidate_` / CSV: `Kuj_csvRowToCandidate_`）

| 様式 | 判定マーカー | 自動で入る項目 |
| --- | --- | --- |
| **市政相談対応票**（市民の声） | 「市政提案」「市民の声」「受付番号」「申出内容」「NN-NN-NNNN」 | `問合せ方法`=市政相談対応票（固定）, `受付日`(受付番号に隣接の和暦), `問合せ元`=匿名, `備考`=受付番号, `相談詳細`=【内容】本文, `問合せ元　連絡先`=電話/住所(あれば) |
| **ホームページ問い合わせ**（札幌市 CMS・PDF） | 「問い合わせ日」「メールアドレス」「print.php」 | `問合せ方法`=ホームページ（固定）, `受付日`=問い合わせ日, `問合せ元`=氏名, `問合せ元　連絡先`=メール/電話/住所(「, 」連結), `相談詳細`=件名+内容 |
| **お問い合わせフォーム CSV**（札幌市 CMS・CSV） | ヘッダに「問い合わせ日」＋「件名/内容/メールアドレス」 | `問合せ方法`=ホームページ（固定）, `受付日`=問い合わせ日, `問合せ元`=氏名, `問合せ元　連絡先`=メール/電話/郵便番号/住所(「, 」連結), `相談詳細`=(件名\|\|問い合わせ件名)+内容, `担当者`=返信者, `備考`=ふりがな/年齢/職業（あるものをラベル付きで） |
| **不明** | 上記いずれも該当せず | `相談詳細`=全文（人手で全項目を分類） |

> **AI に任せない / 人手で補完**: `相談大分類` と配下ツリー（`/野生鳥獣/対象種`・`/相談種類`・`/回答（簡易）` 等）、
> `現場住所等の区`、`継続/完結`、`タグ`。`受付時間`(defaultNow)・`追加対応`・`message` 系・`添付ファイル` も対象外。

### enum の唯一の真実源

`KUJ_OPTIONS_`（選択肢ラベル）と `KUJ_FIELDS_`（プロパティ ↔ data キー）を、**mapper の enum 防御**と**プレビューの選択肢母集合**で共有します。
**フォームの選択肢を変えたら `KUJ_OPTIONS_`（必要なら `KUJ_FIELDS_`）を更新**してください。未知ラベルは破棄＋警告（壊れず劣化）。

---

## 2. 文字化け対策（部首コードポイント / 行復元）

- 一部 PDF フォントは「長→⾧」「日→⽇」「氏→⽒」「鳥獣行政→⿃獣⾏政」のように **Kangxi/CJK 部首コードポイント**を吐きます。
  `Kuj_normalizeText_` が該当範囲（U+2E80–U+2EFF, U+2F00–U+2FDF）を **NFKC で通常の漢字に復元**します（全角！？（）等の表記は保持）。
- pdf.js の `getTextContent` はテキスト片を座標付きで返すため、**同一行を y 座標でグルーピング（|Δy|≤2）→ x 昇順 → "" 連結**して
  行を復元します（ブラウザ側 `reconstruct` と node fixture 生成は同一アルゴリズム）。これにより「受付番号＋受付日」が同一行に並び、受付日の隣接抽出が効きます。

---

## 3. セットアップ

1. **clasp push**: このフォルダを `rootDir` にして新規 GAS プロジェクトへプッシュ（`Combined.gs` + `pdfjs.html` + `appsscript.json`）。
   - `appsscript.json` のスコープは `drive.readonly`（リンク先 PDF の読み取り）+ `script.external_request`（http(s) URL の取得）。**CSV はブラウザのローカル読込なので新スコープ不要＝再認証なし**。
   - スコープ変更で再認証が要るのは**このツールを使う管理者本人のみ**。本体アプリのユーザーには影響しません。
2. **設定登録（任意）**: GAS エディタで

   ```js
   Kuj_registerSettings("<このフォームの formId>", "")
   ```

   を実行（`Kuj_checkSetup()` で確認）。
   - `formId` は任意（出力 JSON の整合用。Playground でフォームを選ぶため必須ではない。form_test JSON には id が無い）。
   - 第 2 引数 `accessKey` を入れるとパースページに `?k=<accessKey>` を要求（任意・既定 OFF）。
3. **ウェブアプリとしてデプロイ**（アクセス: 全員 / 実行: 自分）。`/exec` URL を控える。
4. `<exec>?page=parse` を開く → **PDF** はリンク（`?pdf=<DriveのURL/ID>` で prefill・手貼りも可）、**CSV** は「CSV ファイル」選択（複数可）→ [パース] → プレビューと JSON を確認。
5. ネスト分類（相談大分類など）を人手で補完 → JSON を **管理者 > Playground** に貼って `sync_records` 実行。

---

## 4. pdf.js のベンダリング（`pdfjs.html`）

- `pdfjs-dist` の **legacy UMD ビルド**（`pdf.min.js` が `globalThis.pdfjsLib` を定義）を `pdfjs.html` に同梱。CDN 等の外部取得はしません。
- **worker** は別ファイルを持てないため、worker ソースを `<script id="kuj-pdf-worker" type="text/js-worker">`（非実行）に同梱し、
  パースページが `textContent` を **Blob URL 化**して `GlobalWorkerOptions.workerSrc` に設定します。
- **CMap 不要**: 検証した 2 PDF はテキストレイヤを持ち、CMap 無しで抽出できます（CMap データは同梱していません）。
- **更新方法**: `npm i pdfjs-dist@<ver>` の `legacy/build/{pdf.min.js,pdf.worker.min.js}` を `pdfjs.html` の各 `<script>` に貼り直す
  （`</script>` を含まないことを確認。リポジトリの `scripts/buildpdfjs` 相当の手順で再生成可）。

---

## 5. テスト

- **node（推奨・デプロイ不要・実 PDF / 実 CSV 不要）**: `node scripts/test_mapping.mjs`
  - `Combined.gs` を vm ロードし、純関数を検証：
    マッパー（エスケープ / 複数値連結 / 子・孫ゲーティング / 紹介先 / 空値除去 / 日付 / uploadRecords 形 / enum 防御）、
    **部首正規化・様式判定・ラベル抽出**（`scripts/fixtures/*.txt` ＝ ブラウザ pdf.js が出力する生テキストの再現）、
    **CSV パース・列ヘッダ駆動マッピング・重複排除**（`Kuj_parseCsv_` の引用符内カンマ/改行・CRLF、`Kuj_csvToCandidates_` / `Kuj_parseCsvToRecords_`、`Kuj_csvDedupKey_`）、
    `parseTextToRecords` 一気通貫、`Kuj_extractDriveId_`。
  - `scripts/fixtures/shisei_taiouhyou.txt` / `homepage_toiawase.txt` は `form_test/` の 2 PDF を pdf.js で抽出した**生テキスト**（部首字を含む raw）。
  - `scripts/fixtures/homepage_csv.csv` は「お問い合わせフォーム」CSV を再現した小サンプル（**架空の個人情報**・引用符内カンマ/改行・末尾空行・**ステータス/日付だけ違う重複行**を含む UTF-8。Shift-JIS デコードはブラウザ側の責務なので fixture は UTF-8）。
- **GAS エディタ**: `testMapping()`（同等の最小チェック。Drive/HtmlService 不使用。CSV チェックも含む）。

> **ライブ PDF × ブラウザ pdf.js／実 CSV × ブラウザ TextDecoder の結合は手動**（本番投入前に実ファイルと実 Playground で番地・パスを突き合わせる）。
> 期待マッピング例:
> - カラス PDF → `問合せ方法=市政相談対応票`, `受付日=2026-06-23`, `問合せ元=匿名`, `備考`に受付番号 00-12-2264, `相談詳細`=申出内容本文。
>   相談大分類=野生鳥獣 / 対象種=カラス / 相談種類=攻撃・威嚇 は**人手で選択**。
> - 問い合わせ PDF → `問合せ方法=ホームページ`, `受付日=2026-06-26`, `問合せ元=古賀達也`,
>   `問合せ元　連絡先=koga_…@ffpri.go.jp, 茨城県つくば市松の里1`, `相談詳細`=件名+内容。相談大分類は**人手で選択**（アンケート依頼＝苦情か要判断）。
> - お問い合わせフォーム CSV（N 行）→ **重複を除いた N レコード**。各行 `問合せ方法=ホームページ`, `受付日`=問い合わせ日（canonical）, `問合せ元`=氏名,
>   `問合せ元　連絡先`=メール/電話/郵便番号/住所, `相談詳細`=件名+内容, `担当者`=返信者, `備考`=ふりがな/年齢/職業。**Shift-JIS が文字化けしないこと**と**重複行が除外されること**を実 CSV で確認。相談大分類は**人手で選択**。

---

## 6. リスクと対処

| リスク | 対処 |
| --- | --- |
| pdf.js が単一ページで動かない / worker | ベンダリング＋blob-worker。実 PDF で早期検証（§5）。`</script>` を含まないことを確認済み。 |
| ブラウザから Drive PDF を直接 fetch 不可（CORS） | `Kuj_fetchPdfBase64_` がバイト中継（DriveApp/UrlFetchApp）。**解析はしない**ので「GAS で PDF 処理不可」に抵触しない。 |
| 抽出テキストの行崩れ・ラベル揺れ | 行復元（y グルーピング）＋様式判定＋複数候補ラベル。取り漏れは相談詳細＋人手で補完。fixture を更新して正規表現を調整。 |
| 様式不明・スキャン画像 PDF | 様式不明は全文を相談詳細に入れ人手へ。テキスト抽出が空なら「スキャン画像 PDF の可能性」を警告。 |
| ネスト分類は自動化しない＝精度は人依存 | プレビューに様式・問合せ方法・受付日・相談詳細冒頭を表示し、JSON を直接編集して補完。 |
| enum ドリフト（選択肢変更） | `KUJ_OPTIONS_` 一元管理。未知ラベルは破棄＋警告（壊れず劣化）。 |
| 多 PDF / 6 分制限 | バイト中継は **1 リンク 1 回**（ブラウザが逐次呼ぶ）。~30MB 超は拒否。 |

---

## 7. コーディング規約

本体 `gas/` に合わせています。`var` + `function name(){}` スタイル、内部ヘルパは末尾アンダースコア、
関数接頭辞 `Kuj_`、定数 `KUJ_`。構造 HTML は doGet の自前ページのみ（本体の単一 HTML 配信とは別経路）。
