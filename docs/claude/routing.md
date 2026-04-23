# ルーティング・対応フィールドタイプ（Claude 向け詳細）

CLAUDE.md から分離した、フロント側の URL ルーティング一覧と、スキーマで使えるフィールドタイプ。画面遷移／スキーマ編集時に参照する。

## ルーティング

| ルート | 画面 | 役割 |
| --- | --- | --- |
| `/` | `MainPage` / `UserRedirect` | フォーム一覧。`formId` 注入時は検索画面へ遷移 |
| `/search` | `SearchPage` | 回答一覧・検索・並び替え・エクスポート・削除/復活 |
| `/form/:formId/new` | `FormPage` | 新規回答入力 |
| `/form/:formId/entry/:entryId` | `FormPage` | 既存回答の閲覧・編集 |
| `/forms` | `AdminDashboardPage` | フォーム管理一覧・インポート/エクスポート・公開/削除 |
| `/forms/new` | `AdminFormEditorPage` | 新規フォーム作成 |
| `/forms/:formId/edit` | `AdminFormEditorPage` | 既存フォーム編集 |
| `/config` | `ConfigPage` | フォーム別・全体設定 |
| `/admin-settings` | `AdminSettingsPage` | 管理者キー・メール設定 |

アクセス制御は `FormsRoute`（`propertyStoreMode=script` で管理者限定）と `AdminSettingsRoute`（管理者設定有効時のみ）が担当する。

## 対応フィールドタイプ

`text` / `number` / `email` / `phone` / `url` / `date` / `time` / `radio` / `select` / `checkboxes` / `weekday` / `textarea` / `regex` / `userName` / `fileUpload` / `message` / `printTemplate` / `substitution`

各タイプのスキーマ上の属性・ネスト構造・選択肢の扱いは [`data-model.md`](./data-model.md) も参照。`substitution` は `templateText` で `{...}` 式言語と `[...]` ブラケット演算式を使い、他フィールド値を組み合わせた文字列・数値計算結果を表示するフィールド。
