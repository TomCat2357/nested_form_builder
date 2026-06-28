# キャッシュ・差分同期アーキテクチャ（Claude 向け詳細）

CLAUDE.md から分離した、IndexedDB キャッシュと差分同期の実装詳細。`builder/src/app/state/recordsMemoryStore.js` などを触る際に参照する。

## IndexedDB 構成

| 項目 | 値 |
|--|--|
| データベース名 | `NestedFormBuilder` |
| バージョン | 11 |

定数は `builder/src/core/constants.js`（`DB_NAME` / `DB_VERSION` / `STORE_NAMES`）。スキーマ移行は `builder/src/app/state/dbHelpers.js` の `openDB()` の `onupgradeneeded` に集約。

### ストア（v11 現在）

| ストア | キー | 用途 | 追加版 |
|--|--|--|--|
| `formsCache` | `id` | フォーム定義（スキーマ JSON）一覧キャッシュ（`archived` index 付き） | v1 |
| `settingsStore` | `key` | UI 設定（テーマ、表示設定など） | v1 |
| `analyticsQuestions` | `id` | Question 定義の一覧キャッシュ | v1 |
| `analyticsDashboards` | `id` | Dashboard 定義の一覧キャッシュ | v1 |
| `uploadQueue` | `jobId` | オフライン保存の write-behind アップロードジョブ（`status` / `entityType` / `localId` index 付き） | v8 |
| `openHistory` | `key`（`<entityType>:<entityId>`） | 開いたフォーム / ダッシュボードの履歴。起動時の先行プリフェッチ（`PREFETCH_TOP_N`）の土台 | v9 |
| `registry` | `id` | フロントの参照解決作業キャッシュ。Script Properties registry（`{ fileId, 論理パス }`）のミラー。喪失時は list API / GAS 再構成で再生成可（`kind` index 付き。詳細は [links-and-save.md](./links-and-save.md) §6） | v10 |
| `formNavCache` | `id` | 目次ツリーの軽量キャッシュ。`buildSchemaMapItems` の出力（id/depth/indexLabel/label/children）のみ保存し、フォーム修正画面のサイドバー目次を即表示。ナビ表示専用で喪失時はフォーム本体ロード後に再生成 | v11 |

> **回答レコードは IndexedDB に置かない**。`recordsCache` / `recordsCacheMeta` / `analyticsSnapshots` / `analyticsSnapshotsMeta` は **v5 → v6 で撤去**し、レコードは `recordsMemoryStore.js` のメモリ常駐ストア（セッション内のみ）へ移行した。旧ストアは `onupgradeneeded`（`oldVersion < 6`）で `deleteObjectStore` される。v7 では Dashboard を自由配置スキーマ（v2）へ切り替えたため `analyticsDashboards` を一度クリアする。v9 以降は既存ストアを破壊せず加算（v9=`openHistory` / v10=`registry` / v11=`formNavCache`）。

関連ファイル:
- `builder/src/core/constants.js` — IndexedDB 名・バージョン定数、TTL
- `builder/src/app/state/dbHelpers.js` — `openDB()` / ストア定義 / マイグレーション
- `builder/src/app/state/formsCache.js` — フォーム一覧入出力
- `builder/src/app/state/recordsMemoryStore.js` — 回答レコードのメモリ常駐ストア
- `builder/src/features/analytics/analyticsCache.js` — Question / Dashboard キャッシュ
- `builder/src/features/settings/settingsStore.js` — UI 設定永続化

## SWR（Stale-While-Revalidate）ポリシー

しきい値はキャッシュ種別で分かれる（`builder/src/core/constants.js`）:

| 種別 | 新鮮（裏更新の間隔） | 要再取得（max age） | 定数 |
|--|--|--|--|
| 回答レコード（メモリ常駐） | 5 分 | 30 分 | `RECORD_CACHE_BACKGROUND_REFRESH_MS` / `RECORD_CACHE_MAX_AGE_MS` |
| 一覧（フォーム / Question / Dashboard 共通） | 1 時間 | 24 時間 | `FORM_CACHE_BACKGROUND_REFRESH_MS` / `FORM_CACHE_MAX_AGE_MS` |

- 一覧は **1 時間以内＝そのまま信用**、**1〜24 時間＝即表示しつつ裏で更新確認**、**24 時間超＝同期的に取得し直す**。
- 分析の元レコードテーブルは別途 React メモリに 1 時間キャッシュ（`ANALYTICS_SOURCE_TABLE_CACHE_TTL_MS`）し、フィルタ微調整ごとの再変換を避ける。
- **フロー**:
  1. キャッシュがあれば即座に UI へ返却
  2. 背後で GAS API を叩いて差分取得
  3. 差分があればキャッシュ更新 → UI に再反映
  4. キャッシュミス（無 / 破損）時は GAS への直接フォールバック

評価ロジック: `builder/src/app/state/cachePolicy.js`

## オフラインファースト保存（write-behind / v8）

フォーム / Question / Dashboard の保存は、まず IndexedDB の各一覧キャッシュへ即書き込み、`uploadQueue` に「アップロードジョブ」を 1 件積む。バックグラウンドの `uploadWorker` が逐次 Drive へ送り、成功したらジョブを削除する。ジョブはリロード / オフラインを跨いで残り、再接続・再起動で再開する。

- **逐次・単一 in-flight**: GAS の `LockService` 競合を避けるため 1 件ずつ処理。依存順は **form → question → dashboard**（参照先が先に実 fileId を得てから依存を送る）。
- **仮 ID の付け替え**: 新規は `local_…`（`builder/src/core/ids.js` の `isLocalId`）で保存し、アップロード成功時に実 fileId へ付け替えて参照（Question→Form / Dashboard→Question）を再リンクする。
- **再試行**: 失敗は指数バックオフ（`UPLOAD_RETRY_BASE_MS` 2 秒 〜 `UPLOAD_RETRY_MAX_MS` 5 分 + ジッタ）で自動リトライ。手動「再試行」（`retryNow`）でバックオフを解除して即再開。
- **UI**: `builder/src/app/components/UploadSyncIndicator.jsx` が同期状況を表示。

関連ファイル: `uploadQueue.js`（永続キュー）/ `uploadWorker.js`（逐次ワーカー）/ `globalSyncState.js`（同期状態）。テストは `builder/src/app/state/uploadQueue.pure.test.js`。

## 差分同期

全件再取得ではなく「前回時点以降に変わった分だけ」取ってくる仕組み。

### 使うフィールド

- `NFB_SERVER_MODIFIED_AT` — サーバー側の最終変更時刻
- `commitToken` — 同期トークン。サーバーが最後にコミットした版を表す
- `allIds` — 有効な全レコード ID。**ここに無い ID はクライアント側で削除扱い**（物理削除検出）

### マージロジック

`gas/syncRecordsMerge.js` が中核:

- シート側の最新データとクライアントキャッシュを **last-write-wins** でマージ
- 削除判定は `allIds` 欠落ベース
- 結果を含む差分レスポンスを返し、クライアントが自キャッシュへ反映

エンドポイント: `gas/codeSyncRecords.gs`（`doPost` 経由）

### テスト

差分マージのユニットテスト: `tests/gas-sync-records-merge.test.js`

```bash
node tests/gas-sync-records-merge.test.js
```

## 子フォーム（formLink）データの事前キャッシュ

親レコードを開くと、formLink 項目ごとに子フォームの「件数バッジ」または「子レコード詳細
（includeChildData=ON）」を取得する。schema 自体は一覧キャッシュ（`formsCache`）に全件
格納済みなので子フォームの schema は既に事前キャッシュされている。子の**レコード／件数**だけは
未キャッシュだったため、`builder/src/app/state/childRecordsMemoryStore.js` に per-session
メモリキャッシュを設けた。

- キー: `childFormId::pid`。1 エントリは `{ childData, count, lastSyncedAt }`。
- `detail`（includeChildData=ON）エントリは `count` も持つので count 読みも満たす（逆は不可）。
- SWR 評価はレコードと同じ `cachePolicy.js` の `evaluateCacheForRecords`（30分で要再取得 /
  5分で裏更新）を流用。`PreviewPage.jsx` がキャッシュ即表示 → 裏で再検証する。
- 親再同期（`modifiedAtUnixMs` 変化）時は `forceSync` でハード再取得。
- 無効化: 子レコード保存（`formPageSaveHandler.js`）・子レコード複製（`childRecordCopy.js`）で
  該当 `childFormId` の全 pid を `invalidateChildForm` で破棄。
- reload で消える（`recordsMemoryStore` と同じ揮発キャッシュ）。

## 注意点

- 回答レコードのキャッシュ操作は `recordsMemoryStore.js` のヘルパー（`updateEntryIndex` / `getCachedEntryWithIndex` / `deleteRecordsFromCache` 等）を介し、`formId` と `entryId` を別引数で渡す（キー文字列を直書きしない）
- `commitToken` が古いとサーバーが「フル同期が必要」と返す場合がある — その分岐も `syncRecordsMerge.js` で処理されている
- IndexedDB バージョンを上げる場合は `builder/src/app/state/` 配下の `onupgradeneeded` ハンドラを忘れず更新
