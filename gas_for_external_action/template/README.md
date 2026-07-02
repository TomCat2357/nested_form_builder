# 外部アクション受信 Web App テンプレート（template/）

Nested Form Builder の「**外部アクション**」ボタンから送られてくるデータを受け取る、
スタンドアロン Google Apps Script ウェブアプリの**雛形**です。新しい外部アクションを作るときは
このフォルダをコピーして出発点にしてください。本体アプリ（`gas/`）には一切手を入れません。

雛形は「payload を受け取り、実行ログと HTML 画面で中身を確認する」ところまでを実装済みです。
実際の業務処理（シート転記・別 API 呼び出し・Doc 生成など）は `Code.gs` の `handleRecords_` に追記します。
実運用の例は隣の `choju_intake/`（Excel 様式との双方向ブリッジ）・`choju_kyokasho/`・`kujo_intake/` を参照してください。

| ファイル | 役割 |
| --- | --- |
| `Code.gs` | `doPost`（リレー受信・誤送信防止プローブ応答・HTML/JSON 応答）・`doGet`・payload 解析・確認画面レンダラ |
| `Test.gs` | デプロイ不要のテスト。GAS エディタから `testAll` を実行してログで確認 |
| `appsscript.json` | マニフェスト（webapp: アクセス全員 / 実行 USER_DEPLOYING、スコープ: spreadsheets / external_request / userinfo.email） |

---

## 1. しくみ（サーバ間リレー）

外部アクションボタンは、ブラウザから直接この Web App を叩きません。本体 GAS
（`gas/externalAction.gs` の `ExtAction_send_`）が `UrlFetchApp` で **サーバ間リレー**します
（ブラウザの隠しフォーム POST はログインリダイレクトで POST 本文を失う弱点があったため廃止）。

```
POST <この Web App の /exec URL>?nfbRelay=1
Content-Type: application/x-www-form-urlencoded
payload=<JSON 文字列>
```

受信側（このテンプレート）は `doPost(e)` で `e.parameter.payload` を `JSON.parse` して全データを受け取ります。
応答は 2 面構成です:

- **`nfbRelay=1` 付き（本体からのリレー）**: JSON `{ ok, title, message, openUrl }` を返す。
  本体側はこれをアラート表示し、`openUrl` があれば新しいタブで開く（`interpretExternalActionResponse`）。
  取り込み画面など自前 UI へ誘導したいときは `openUrl` に自アプリの URL を入れて返す（`choju_intake` 方式）。
- **`nfbRelay` なし（ブラウザで URL を直接開いた等）**: 従来どおり HTML を返す（動作確認・後方互換用）。

---

## 2. payload 契約

起動元（編集・閲覧画面の単票 / 検索一覧の単一選択 / 検索一覧の複数選択）に依らず**単一フォーマット**で届きます。
受信側は **`recordCount`（= `records` 数）だけ**で単一/複数を判定します（旧 `context` フィールドは廃止済み）。

契約の正（送信側実装）は `builder/src/utils/externalActionPost.js` の `buildExternalActionPayload` と
`docs/claude/apps-script-backend.md` の「外部アクション送信」節です。フロント側を変えたら
このテンプレートのヘッダーコメントと `Test.gs` のダミー payload も更新してください。

### トップレベル

| キー | 型 | 内容 |
| --- | --- | --- |
| `formId` | string | フォーム ID |
| `formName` | string | フォーム名 |
| `generatedAt` | string | 送信時刻（ISO8601・UTC） |
| `recordCount` | number | `records` の件数。単票・検索単一選択 = 1、検索複数選択 = N |
| `records` | array | `{ id, no, items }` の配列 |
| `storage` | object? | **管理者限定ボタン（adminOnly）かつ管理者のときだけ**付く（後述） |

### `records[].items[]`

全フィールドをフラットに並べた配列。各要素は `{ question, value, type, files?, folderUrl?, folderName? }`。

- `question` はヘッダー階層を `/` で連結したパス文字列（例: `講座の種類/ヒグマ講座/実施場所`）。
- **子フォーム（formLink）は items にインライン展開**され、`親カード/#No/子フィールド` 形式で並ぶ
  （`#No` が子レコードのマーカー）。子は 1 階層のみ（孫 formLink は再帰しない）、1 項目あたり最大 200 件。
- **fileUpload 項目**はファイル参照を `files: [{ name, url, driveFileId? }]` に内包し、`folderUrl` / `folderName` も付く。
  届くのは **Drive の URL のみでファイル実体は届かない**。中身（Excel 等）を読むには、対象 Drive ファイルへの
  閲覧権限を持つアカウントで `Drive.Files` を使い Google スプレッドシート等へ変換取り込みしてから読む。

### `storage`（管理者限定ボタンのみ）

`{ spreadsheetId, spreadsheetUrl, sheetName, driveFileUrl, userEmail, childSpreadsheetId, childSpreadsheetUrl, childSheetName }`

親フォームのデータ保存先スプレッドシートと、formLink 子フォームの保存先（`childSheetName` は空なら `"Data"` 既定）。
シートへ直接書き込む系のアクション（`choju_intake` の取り込み等）が使います。
adminOnly でないボタンには付かないので、依存する場合は受信側で存在チェックしてください。

---

## 3. 誤送信防止ハンドシェイク（任意・推奨）

URL の打ち間違いなどで無関係な宛先へデータが飛ぶのを防ぐ仕組みです。有効化すると、本体はデータ送信の**直前**に
機微データを含まない軽量プローブ `{ nfbProbe: "1", nonce }` を投げ、受信側が共有シークレットで
`HMAC-SHA256(nonce)` を署名して返せたときだけ本データを送ります（返せないと `DEST_UNVERIFIED` で送信中止）。

有効化の手順:

1. この GAS プロジェクトの **Script Properties** に `NFB_EXT_ACTION_SECRET` を登録する。
2. 本体アプリの管理者設定（`NFB_EXT_ACTION_SECRET`）に**同じ値**を入れる。

どちらか未設定なら従来どおり検証なしで届きます（後方互換）。プローブ応答は `doPost` 冒頭で処理済みで、
業務処理（`handleRecords_`）には入りません。署名関数 `Recv_hmacHex_` は本体側 `ExtAction_hmacHex_`
（`gas/externalAction.gs`）と**同一実装であること**が必須です — 変えると署名が一致せず全送信が拒否されます。

---

## 4. セットアップ（初回のみ）

1. このフォルダを丸ごとコピーして新しいプロジェクトを作る（例: `gas_for_external_action/my_action/`）。
   `clasp create --type webapp --rootDir .` などで GAS プロジェクトに紐付ける。
   **`.clasp.json` はローカル専用**（コミットしない。`choju_kyokasho/.gitignore` 参照）。
2. `clasp push` でコードを反映する（`appsscript.json` のスコープはそのままで動く。
   Drive のファイル実体を読むなど権限を増やす場合はスコープを追加する）。
3. **ウェブアプリとしてデプロイ**（アクセス: **全員** / 実行: **自分**）。`/exec` URL を控える。
   ⚠️ `/dev` URL はサーバ間リレーでは動かない — 必ず `/exec` を使う。
4. 本体アプリの対象フォーム設定 →「外部アクション」にボタンを追加し、URL に `/exec` を登録する。
   `storage`（保存先スプレッドシート情報）が必要なアクションは **adminOnly=ON** にする。
5. （任意）誤送信防止シークレットを設定する（§3）。

コードを更新したら `clasp push` 後に**デプロイを更新**（新バージョン発行）しないと `/exec` に反映されない点に注意。

---

## 5. テスト（デプロイ不要）

`Test.gs` は `doPost(e)` を模擬イベントで直接呼び出すため、デプロイせずに動作確認できます。

1. GAS エディタで関数 **`testAll`** を選択して実行する（初回は権限承認）。
2. 「実行ログ」に各 payload の受信内容と PASS/FAIL、最後に `テスト結果: n / 6 PASS` が出る。

個別に実行することもできます:

| テスト関数 | 確認内容 |
| --- | --- |
| `testDoPost_singleRecord` | 単一レコード（単票 / 検索単一選択）。ネスト質問・fileUpload・子フォーム `#No` 込み |
| `testDoPost_multiRecords` | 複数レコード（検索複数選択、`recordCount=2`） |
| `testDoPost_adminStorage` | 管理者限定ボタンの `storage`（child* 含む）が届くケース |
| `testDoPost_missingPayload` | `payload` パラメータ欠落の異常系 |
| `testDoPost_badJson` | `payload` が壊れた JSON の異常系 |
| `testDoPost_probe` | 誤送信防止プローブ（シークレット設定あり/なしの両方） |

GAS サービス（Sheets/Drive 等）に依存する業務処理を追加したら、デプロイ後に本体アプリの実ボタンから
手動 E2E（ボタン押下 → 応答アラート → 処理結果の確認）も行ってください。

---

## 6. カスタマイズの手引き

- **業務処理は `handleRecords_` に書く**（`Code.gs` の `TODO` コメント箇所）。ログ出力・確認画面の
  レンダリングはテスト用なので、実装が固まったら適宜削ってよい。
- **単一レコード専用のアクション**は `handleRecords_` 冒頭のコメント例のとおり
  `recordCount !== 1` で弾く。
- **戻り値の契約**: `handleRecords_` は `{ ok: true, title, message, openUrl? }` または
  `{ ok: false, error }` を返す。`title`/`message` は本体側のアラートに、`openUrl` は新規タブで開く URL に使われる。
- **項目の探し方**: `items[].question` のパス文字列で対象フィールドを特定する（完全一致 or 前方一致）。
  フォーム側で質問ラベルや階層を変えると `question` パスも変わるため、パス定数は 1 箇所にまとめておくとよい。
- **ファイルを読む処理**: `item.files[].url`（または `driveFileId`）が指す Drive ファイルを、閲覧権限を持つ
  アカウント（= この Web App の実行者）で開く。xlsx などは Advanced Drive Service で
  Google スプレッドシートへ変換取り込みしてから読む（実装例: `choju_intake/Combined.gs`）。
- **フロント側の payload を変更したら**、`Code.gs` ヘッダーコメント・`Test.gs` のダミー payload・
  この README の §2 を合わせて更新する。

---

## 7. コーディング規約

本体 `gas/` に合わせています。`var` + `function name(){}` スタイル（`let` / `const` / arrow は使わない）、
内部ヘルパは末尾アンダースコア（例: `parsePayload_` / `handleRecords_`）。
プロジェクト固有の関数接頭辞（例: `Cho_` / `Kujo_`）を決めて衝突を避けるのが実例フォルダの慣例です。
