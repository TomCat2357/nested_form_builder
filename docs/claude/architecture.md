# アーキテクチャ（Claude 向け詳細）

CLAUDE.md から分離した、データフロー・Provider 構成・保存先の役割分担の仕様詳細。全体像を把握したいときに参照する。

## データフロー概要

1. `gas/Code.gs` の `doGet(e)` が `dist/Index.html` を配信し、`window.__IS_ADMIN__` 等の初期値を HTML に注入
2. `builder/src/app/main.jsx` が React アプリを起動し、`HashRouter` で画面を構築
3. React は `gasClient.js` 経由で `google.script.run` を呼び、Apps Script の公開関数と通信
4. フォーム定義は Drive、回答は Sheets、対応表・設定は Properties Service、ブラウザ側キャッシュは IndexedDB に保存

## Provider と状態管理

`App.jsx` で 3 つの Provider がアプリ全体を包む。

- **`AuthProvider`** — `doGet` が注入する `window.__IS_ADMIN__` / `__FORM_ID__` / `__PROPERTY_STORE_MODE__` 等を React 側へ渡す
- **`AppDataProvider`** — フォーム一覧のロード・CRUD・IndexedDB キャッシュ・楽観的 UI
- **`AlertProvider`** — アラート・確認ダイアログ・トーストの表示窓口

### データフローとキャッシュ

- `dataStore.js` — フォーム・回答の取得先を一元化し、GAS 通信とメモリストアの差を吸収
- `gasClient.js` — `google.script.run` を Promise 化した GAS RPC ラッパー
- `useEntries.js` — 検索・入力画面共通の回答取得フック。メモリ常駐 + 差分同期
- `recordsMemoryStore.js` — 回答レコードのメモリ常駐ストア（`Map<formId, store>`、セッション内のみ。IndexedDB には置かない）
- `formsCache.js` / `analyticsCache.js` — フォーム / Question / Dashboard 一覧の IndexedDB キャッシュ
- `uploadQueue.js` / `uploadWorker.js` — オフラインファースト保存の write-behind キューと逐次アップロードワーカー
- `settingsStore.js` — テーマ・ページサイズ等の UI 設定を IndexedDB に保存

## 保存先の分担

| 保存先 | 内容 |
| --- | --- |
| Google Drive | フォーム定義 JSON、アップロードファイル、出力ドキュメント |
| Google Sheets | 回答レコード |
| Properties Service | フォーム↔Drive ファイル対応表、管理者キー/メール、最終更新時刻 |
| IndexedDB (ブラウザ) | フォーム / Question / Dashboard 一覧キャッシュ、オフライン保存キュー（`uploadQueue`）、UI 設定。**回答レコードはメモリ常駐で IndexedDB には置かない** |

差分同期・キャッシュ戦略の詳細は [`cache-architecture.md`](./cache-architecture.md) を参照。
