# ルーティング・対応フィールドタイプ（Claude 向け詳細）

CLAUDE.md から分離した、フロント側の URL ルーティング一覧と、スキーマで使えるフィールドタイプ。画面遷移／スキーマ編集時に参照する。

## ルーティング

### 主要ルート

| ルート | 画面 | 役割 |
| --- | --- | --- |
| `/` | `HomePage` / `UserRedirect` | ホーム（フォーム一覧 / ダッシュボード一覧のタブ）。`formId` 注入時は検索画面へ遷移 |
| `/?view=dashboards` | `HomePage` | ホームの「ダッシュボード一覧」タブ選択状態 |
| `/search?form=:formId` | `SearchPage` | 回答一覧・検索・並び替え・エクスポート・削除/復活 |
| `/form/:formId/new` | `FormPage` | 新規回答入力 |
| `/form/:formId/entry/:entryId` | `FormPage` | 既存回答の閲覧・編集 |
| `/dashboards/:dashboardId` | `DashboardViewPage` | ダッシュボード閲覧（誰でも可・Question 名は管理者のみ表示） |

### 設定

| ルート | 画面 | 役割 |
| --- | --- | --- |
| `/settings` | `SettingsPage` | 統合設定。`?tab=general`（既定） / `?tab=admin`（管理者のみ）で切替 |
| `/forms/:formId/settings` | `FormSettingsPage` | フォーム別設定（テーマ・保存後動作） |

### 管理者専用（`/admin/*`）

| ルート | 画面 | 役割 |
| --- | --- | --- |
| `/admin` | `AdminHubPage` | 管理ハブ。フォーム / ダッシュボード / Question 管理への 3 カード分岐 |
| `/admin/forms` | `AdminFormListPage` | フォーム管理一覧・インポート/エクスポート・アーカイブ/参照のみ/削除 |
| `/admin/forms/new` | `AdminFormEditorPage` | 新規フォーム作成 |
| `/admin/forms/:formId/edit` | `AdminFormEditorPage` | 既存フォーム編集 |
| `/admin/dashboards` | `AdminDashboardListPage` | ダッシュボード管理一覧 |
| `/admin/dashboards/new` | `DashboardEditorPage` | 新規ダッシュボード作成 |
| `/admin/dashboards/:dashboardId/edit` | `DashboardEditorPage` | ダッシュボード編集 |
| `/admin/questions` | `AdminQuestionListPage` | Question 管理一覧 |
| `/admin/questions/new` | `QuestionEditorPage` | 新規 Question 作成 |
| `/admin/questions/:questionId` | `QuestionEditorPage` | Question 編集 |

アクセス制御は `App.jsx` の以下のラッパーが担当:
- `FormsRoute` — `/admin/forms*`。`propertyStoreMode=user` は全ユーザー許可、`script` は管理者のみ
- `AdminRoute` — `/admin`, `/admin/dashboards*`, `/admin/questions*`。管理者のみ

非管理者は `/admin*` 配下に直接アクセスしてもホームへリダイレクトされる。Question は概念ごと隠蔽するため、ホームのダッシュボードタブと `/dashboards/:id` 閲覧画面では Question 名が出ない。

### 旧URLからのリダイレクト（後方互換）

| 旧 | 新 |
| --- | --- |
| `/config` | `/settings`（form クエリありなら `/forms/:formId/settings`） |
| `/admin-settings` | `/settings?tab=admin` |
| `/forms` | `/admin/forms` |
| `/forms/new` | `/admin/forms/new` |
| `/forms/:formId/edit` | `/admin/forms/:formId/edit` |
| `/analytics` | 管理者: `/admin` / 非管理者: `/?view=dashboards` |
| `/analytics/dashboards/new` | `/admin/dashboards/new` |
| `/analytics/dashboards/:id` | `/dashboards/:id` |
| `/analytics/dashboards/:id/edit` | `/admin/dashboards/:id/edit` |
| `/analytics/questions/new` | `/admin/questions/new` |
| `/analytics/questions/:id` | `/admin/questions/:id` |

## 対応フィールドタイプ

`text` / `number` / `email` / `phone` / `url` / `date` / `time` / `radio` / `select` / `checkboxes` / `weekday` / `textarea` / `regex` / `userName` / `fileUpload` / `message` / `printTemplate` / `substitution`

各タイプのスキーマ上の属性・ネスト構造・選択肢の扱いは [`data-model.md`](./data-model.md) も参照。`substitution` は `templateText` で `{{...}}`（ビュー形式）の alasql 式を使い、他フィールド値を組み合わせた文字列・数値計算結果を表示するフィールド（旧 `[...]` ブラケット演算式・単一ブレース `{...}` は廃止。データ形式は view 形式に一本化。トークン構文は [`drive-template-tokens.md`](./drive-template-tokens.md) 参照）。

## 外部リンク URL の組み立て（二重 iframe 対策）

GAS Web App は二重 iframe 構造（外側 `script.google.com/.../dev` で `doGet` が動き、内側 `googleusercontent.com/...` で React が走る）で配信される。外側 URL に `#/admin/foo` を付けても **内側 iframe には伝播しない**（HashRouter は内側 iframe の `window.location.hash` を読むため）。

そのため、管理一覧の「URL コピー」など SPA 内パスを新タブで開く絶対 URL は必ず `buildAppUrl(hashPath)`（`builder/src/utils/appUrl.js`）で組み立てる。`buildAppUrl` は `window.__GAS_WEBAPP_URL__` がある本番では `?route=<encoded path>` 形式に変換し、`doGet` が `window.__INITIAL_HASH__` として注入 → React 起動直前に `applyInitialHashFromGas()` が `window.location.hash` へ書き戻す。dev（Vite）では iframe が無いので従来どおり `#/...` を返す。`baseUrl + "#/dashboards/:id"` の直結はしないこと。
