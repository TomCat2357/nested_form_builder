# キャッシュ・差分同期アーキテクチャ（Claude 向け詳細）

CLAUDE.md から分離した、IndexedDB キャッシュと差分同期の実装詳細。`builder/src/app/state/recordsCache.js` などを触る際に参照する。

## IndexedDB 構成

| 項目 | 値 |
|--|--|
| データベース名 | `NestedFormBuilder` |
| バージョン | 4 |

### ストア

| ストア | キー | 用途 |
|--|--|--|
| `formsCache` | `formId` | フォーム定義（スキーマ JSON） |
| `recordsCache` | 複合キー `formId::entryId` | 回答レコード |
| `recordsCacheMeta` | `formId` | `commitToken` / 同期メタ情報 |
| `settingsStore` | 任意 | UI 設定（テーマ、表示設定など） |

関連ファイル:
- `builder/src/core/constants.js` — IndexedDB 名・バージョン定数、TTL
- `builder/src/app/state/recordsCache.js` — レコード入出力
- `builder/src/app/state/formsCache.js` — フォーム入出力
- `builder/src/features/settings/settingsStore.js` — UI 設定永続化

## SWR（Stale-While-Revalidate）ポリシー

レコード・フォームとも同じポリシー:

- **max age**: 30 分 — これを超えたらキャッシュを使いつつバックグラウンドで再取得
- **background refresh**: 5 分 — 新鮮でもこの間隔で裏更新
- **フロー**:
  1. キャッシュがあれば即座に UI へ返却
  2. 背後で GAS API を叩いて差分取得
  3. 差分があればキャッシュ更新 → UI に再反映
  4. キャッシュミス（無 / 破損）時は GAS への直接フォールバック

評価ロジック: `builder/src/app/state/cachePolicy.js`

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

## 注意点

- 複合キー `formId::entryId` を扱うときは、必ず `recordsCache` 内のヘルパー関数を使う（文字列結合を直書きしない）
- `commitToken` が古いとサーバーが「フル同期が必要」と返す場合がある — その分岐も `syncRecordsMerge.js` で処理されている
- IndexedDB バージョンを上げる場合は `builder/src/app/state/` 配下の `onupgradeneeded` ハンドラを忘れず更新
