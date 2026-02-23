# Nested Form Builder

ネストされたフォームを設計し、Google Sheetsに回答を保存できるフォームビルダーです。

## 概要

Nested Form Builderは、階層構造を持つアンケートフォームを視覚的に作成し、生成されたフォームの回答をGoogle Spreadsheetsに自動保存できるWebアプリケーションです。

### 主な機能

- **ビジュアルフォームエディタ**: 直感的なUIで質問を追加・編集し、リアルタイムでプレビュー
- **ネスト構造・条件分岐**: 最大11階層までの入れ子と、選択肢ごとの `childrenByValue` をサポート
- **質問タイプと表示モード**: テキスト/数値/日付/時間/選択肢/チェックボックス/正規表現に加え、重要列と `displayMode`（none/normal/compact）を指定可能
- **フォームインポート/エクスポート**: JSONによるスキーマの読み込み/書き出し
- **Google Sheets連携**: 回答を自動でスプレッドシートに保存し、二分探索+IndexedDBキャッシュで高速取得
- **高度な検索機能**: 条件式/正規表現/AND・ORを組み合わせたレコード検索、重要項目の一覧表示
- **レコード管理**: 単一レコード取得、編集、削除、アーカイブ管理、ページネーション
- **一般ユーザーアクセス制限**: 管理者キー/メール設定時に、`?form=xxx` を指定しない一般ユーザーのアクセスを拒否する設定
- **プロパティ保存モード**: GASのプロパティ保存先を ScriptProperties / UserProperties で切り替え可能

### 現在の状態

- `builder/` は React 19 + Vite 7 + `vite-plugin-singlefile` で構築しています。
- `deploy.sh`（macOS/Linux）/ `deploy.ps1`（Windows）が `builder` のインストール/ビルド → `gas/scripts/bundle.js` → `dist/` 生成 → `<base target="_top">` と deploy-time メタ付与 → `clasp push/deploy` を実行し、`.gas-deployment.json` にデプロイ情報をキャッシュします。
- `docs/` に `user_manual.md`/`user_manual.pdf` と `playwright-testing.md`、`shared/` に `payload_contract.md` と `schema_examples/`、`samples/form.json` にサンプルフォーム、`tests/` に Playwright スクリプトとスクリーンショットが揃っています。

### 技術スタック

- **フロントエンド**: React 19 / Vite 7 / vite-plugin-singlefile
- **バックエンド**: Google Apps Script（ES5互換）
- **ストレージ**: Google Sheets、IndexedDB（`formsCache` / `recordsCache` / `settingsStore`）
- **ビルド/デプロイ**: npm scripts、clasp、`deploy.sh` / `deploy.ps1`、`gas/scripts/bundle.js`

## プロジェクト構成

```
nested_form_builder/
├── builder/                        # Reactフロントエンド
│   ├── src/app/
│   │   ├── theme/                  # テーマシステム
│   │   │   ├── theme.js            # テーマ管理（選択・追加・削除）
│   │   │   ├── theme.css           # CSS カスタムプロパティ定義
│   │   │   ├── base.css            # ベーススタイル
│   │   │   ├── preview-overrides.css # プレビュー用上書き
│   │   │   ├── tokens.js           # JSS トークンオブジェクト
│   │   │   └── themes/             # ビルトインテーマCSS
│   │   │       ├── standard.css
│   │   │       ├── matcha.css
│   │   │       ├── sakura.css
│   │   │       ├── warm.css
│   │   │       ├── ocean.css
│   │   │       ├── dark.css
│   │   │       ├── egypt.css
│   │   │       ├── india.css
│   │   │       ├── snow.css
│   │   │       ├── christmas.css
│   │   │       └── forest.css
│   │   └── ...
│   ├── src/core/            # スキーマ検証・displayModes・storage
│   ├── src/features/        # admin/editor/export/preview/search/settings
│   ├── src/pages/           # 画面コンポーネント（ConfigPage: テーマ管理UI）
│   ├── src/services/        # GAS APIクライアント（importThemeFromDrive）
│   └── src/utils/           # download/spreadsheetユーティリティ
├── gas/                     # Google Apps Script ソース（分割ファイル）
│   ├── Code.gs
│   ├── drive.gs
│   ├── forms.gs
│   ├── model.gs
│   ├── properties.gs
│   ├── sheets.gs
│   ├── settings.gs
│   └── README.md
├── dist/                    # deploy.sh / deploy.ps1 が生成する clasp ルート (Bundle.gs, Index.html, appsscript.json)
├── docs/                    # user_manual, playwright-testing, PDF
├── shared/                  # payload_contract と schema_examples
├── samples/                 # form.json（ヒグマは好きかフォーム例）
├── gas/scripts/             # bundle.js（GAS結合ツール）
├── tests/                   # Playwrightテスト/スクリプト/スクリーンショット
├── playwright-report/       # Playwright HTMLレポート出力
├── CLAUDE.md                # AIエージェント向けガイダンス
├── deploy.sh                # 自動デプロイスクリプト
├── deploy.ps1               # 自動デプロイスクリプト（PowerShell）
├── package.json             # ルートnpmスクリプト (clasp, playwright など)
└── builder/package.json     # フロントエンド依存関係
```

主な補足:

- `builder/src/app/theme/`…テーマシステムの中核
  - `theme.js`：テーマの選択・追加・削除機能、IndexedDB（settingsStore）に保存
  - `theme.css`：全テーマ共通のCSS変数定義
  - `themes/*.css`：ビルトインテーマ（standard/matcha/sakura/warm/ocean/dark/egypt/india/snow/christmas/forest）
- `builder/src/pages/ConfigPage.jsx`…テーマ管理UI（設定ページ）
  - テーマ選択ドロップダウン
  - Google Drive からのテーマCSS インポート機能
  - インポート済みテーマの削除機能
- `builder/src/services/gasClient.js`…GAS APIクライアント
  - `importThemeFromDrive()`：Google Drive URL からテーマCSS を取得
- `builder/src/features/export/`…スキーマJSONのダウンロードUI
- `builder/src/features/admin/SearchPreviewPanel.jsx`…重要項目・表示モードの確認
- `gas/scripts/bundle.js`…`gas/*.gs` を `dist/Bundle.gs` に結合し、`deploy.sh` / `deploy.ps1` から呼び出されます
- `docs/user_manual.md` / `docs/user_manual.pdf` / `docs/playwright-testing.md`…ユーザー/テスト向けドキュメント
- `shared/payload_contract.md`…GASとのPOSTペイロード仕様、`shared/schema_examples/basic.json`…最小構成例

## セットアップ

### 前提条件

- Node.js 18以上
- Google アカウント
- Google Apps Script API有効化

### 1. リポジトリのクローン

```bash
git clone <repository-url>
cd nested_form_builder
```

### 2. 依存関係のインストール

```bash
npm install
npm run builder:install
```

ルートの `npm install` で `@google/clasp` / Playwright などツール類を取得し、`npm run builder:install` で `builder/` 配下のReact依存関係をセットアップします。

### 3. Google Apps Script プロジェクトの設定

```bash
# claspでログイン
npm run clasp:login

# 新規プロジェクトを作成する場合
npx clasp create --type webapp --title "Nested Form Builder"

# 既存プロジェクトを使用する場合は.clasp.jsonを編集
```

`.clasp.json` の例:
```json
{
  "scriptId": "YOUR_SCRIPT_ID",
  "rootDir": "dist"
}
```

### 4. デプロイ

```bash
# macOS/Linux
./deploy.sh

# Windows PowerShell
.\deploy.ps1
```

`deploy.sh` / `deploy.ps1` は `builder` の依存関係インストール→ビルド→`gas/scripts/bundle.js` による `dist/Bundle.gs` 生成→`dist/Index.html` へ `<base target="_top">` と deploy-time メタ付与→`appsscript.json` コピー/上書き→`clasp push`→`clasp deploy` まで自動化し、`.gas-deployment.json` に Deployment ID/URL をキャッシュします。`--manifest-override <path>` を付与すると `gas/appsscript.json` に別JSONをマージしてから push できます。

## 開発

### ローカル開発サーバー起動

```bash
npm run builder:dev
```

ブラウザで `http://localhost:5173` を開きます。

### ビルドとGASバンドル

```bash
npm run builder:build
node gas/scripts/bundle.js
ls dist
```

- `vite build` が `builder/dist` に成果物を出力後、`gas/scripts/bundle.js` が `gas/*.gs` を `dist/Bundle.gs` に結合します。
- `dist/Index.html` が GAS で配信されるReactアプリで、`deploy.sh` / `deploy.ps1` は `<base target="_top">` を自動付与します。
- 手動で `node gas/scripts/bundle.js` を実行すれば `deploy.sh` / `deploy.ps1` なしでも `dist/` を最新化できます。

### Apps Scriptコードの編集

```bash
# リモートから最新を取得
npm run clasp:pull

# ローカルの変更をプッシュ
npm run clasp:push
```

`.clasp.json` の `rootDir` は `dist/` です。`clasp:pull` を実行すると最新のGASコード/マニフェストが `dist/` に展開されるため、編集後は `gas/scripts/bundle.js` の出力を上書きしないよう注意してください。

### テーマ設定

#### テーマの選択・切り替え

ナビゲーションバーの **「設定」** ページ（歯車アイコン）で テーマ切り替えとインポート機能にアクセスできます。

- **ビルトインテーマ**: `standard`（既定） / `matcha` / `sakura` / `warm` / `ocean` / `dark` / `egypt` / `india` / `snow` / `christmas` / `forest`
- **カスタムテーマ**: インポートしたテーマは「テーマ選択」ドロップダウンに自動表示されます。

選択したテーマは `<html data-theme="...">` 属性に反映され、全体の配色が切り替わります。

#### テーマの作成とインポート

**推奨フォーマット**: CSS ファイルは `:root[data-theme="テーマ名"]` セレクタを含める必要があります（`:root` のみでも自動補正されます）。

##### 例：カスタムテーマ CSS の構造

```css
:root[data-theme="my-dark-theme"] {
  --bg: #1a1a1a;
  --surface: #2d2d2d;
  --text: #f0f0f0;
  --primary: #4a9eff;
  --border: #404040;
  /* その他のトークン... */
}
```

利用可能な全トークン（カスタマイズ対象の変数）は `builder/src/app/theme/theme.css` に定義されています。

##### インポート手順

1. **Google Drive にテーマ CSS ファイルをアップロード**
   - `.css` ファイルとして保存（例: `dark-theme.css`）
   - 公開共有設定か、Google Apps Script が読み取れるように権限設定

2. **設定ページでインポート**
   - 「テーマをインポート」セクション → 「Google Drive URL」に貼り付け
   - `https://drive.google.com/file/d/[FILE_ID]/view` 形式をサポート
   - 「インポート」ボタンをクリック

3. **テーマが自動追加**
   - CSS 内の `data-theme` 値からテーマ名を自動抽出
   - テーマドロップダウンに新しいテーマが表示されます
   - 複数のテーマを同時にインポート可能

#### テーマの削除

設定ページの「インポート済みテーマ」セクションから、カスタムテーマ横の「削除」ボタンで削除できます。ビルトインテーマ（standard/matcha/sakura/warm）は削除できません。

#### テーマ設定の保存先

- **ローカル保存**: テーマ選択とカスタムテーマリストは IndexedDB（`settingsStore`）に保存されます（`nested_form_builder_theme` / `nested_form_builder_theme_custom_list_v1`）。
- **ブラウザ/デバイス単位**: GAS のユーザー設定とは同期されず、ブラウザごとに独立した設定となります。
- **キャッシュ**: カスタムテーマ CSS は `<style id="nfb-custom-themes">` としてDOMに注入されます（旧localStorageから自動移行あり）。

#### テーマの実装詳細

- **テーマシステム**: `builder/src/app/theme/theme.js` で管理
  - `THEME_OPTIONS`: ビルトインテーマ定義（11テーマ）
  - `setCustomTheme()`: カスタムテーマの追加
  - `removeCustomTheme()`: カスタムテーマの削除
  - `applyTheme()`: テーマの即時適用

- **トークン定義**:
  - `builder/src/app/theme/theme.css`: 全テーマ共通のカスタムプロパティベース
  - `builder/src/app/theme/themes/*.css`: ビルトインテーマ（各テーマは差分のみ定義）
  - `builder/src/app/theme/tokens.js`: React コンポーネント内で参照される JSS オブジェクト

- **管理UI**: `builder/src/pages/ConfigPage.jsx`
  - テーマ選択ドロップダウン（フォームごと・全体で設定可能）
  - Google Drive URL からのインポート
  - 削除確認ダイアログ

## テスト

### Playwright 本番環境テスト（推奨）

**MCP Code Executionパターン**に基づいた効率的なテストスクリプトです。大量のDOM情報ではなく、**ページの要点のみ**を抽出して表示します。

```bash
npm run test:playwright
```

**特徴**:
- ✅ 軽量な出力（カウント、存在確認のみ）
- ✅ ロバスト（データがなくても適切にスキップ）
- ✅ 本番環境のGAS Webアプリをテスト

**テスト項目**:
1. フォーム一覧ページ
2. 管理画面
3. フォーム編集画面
4. プレビュー機能
5. 検索機能（キーワード、比較演算子）
6. ネストフィールド動的表示
7. コンソールエラーチェック

詳細は [`docs/playwright-testing.md`](docs/playwright-testing.md) を参照してください。

### Playwright E2E（ローカル開発用）

ルートに `playwright.config.js` を配置しています。初回のみブラウザをインストールしてください。

```bash
npx playwright install
npx playwright test
```

- `webServer` 設定により `npm run builder:preview` が自動で立ち上がり、`http://localhost:4173` に対してテストが実行されます。
- 成果物（スクリーンショット・動画・HTMLレポート）は `test-results/` と `playwright-report/` に保存されます。

## ドキュメント & リソース

- `docs/user_manual.md` / `docs/user_manual.pdf` … 「ヒグマは好きか」サンプルを使った操作マニュアル
- `docs/playwright-testing.md` … Playwrightテストのガイド
- `shared/payload_contract.md` … フォームHTML → GAS へのPOSTペイロード仕様
- `shared/schema_examples/basic.json` / `samples/form.json` … スキーマの最小構成例と運用中フォーム（インポートに利用可能）
- `gas/README.md` … Apps Script 側のエントリポイント/設定

## アーキテクチャ

### データフロー

1. **フォーム設計**: Reactアプリでフォームスキーマを作成
2. **ビルド/デプロイ**: Reactアプリをビルドし、GAS経由で公開
3. **回答送信**: 生成されたフォームからGAS WebアプリへPOST
4. **データ保存**: GASがGoogle Sheetsにデータを正規化して保存
5. **データ取得**: React管理画面からGAS経由でデータを取得・検索

### 主要コンポーネント

#### Builder (React SPA)

- **AdminDashboardPage**: フォーム一覧・管理画面
- **AdminFormEditorPage**: フォームエディタUI
- **FormPage**: フォーム入力画面
- **SearchPage**: データ検索・閲覧
- **PreviewPage**: フォームプレビュー
- **dataStore**: GASとのやり取りとフォーム/レコード処理の窓口（キャッシュ層と連携）
- **gasClient**: GAS API呼び出し
- **formsCache**: IndexedDBによるフォーム一覧キャッシュ
- **recordsCache**: IndexedDBによるレコードキャッシュ

#### GAS Backend

- **doGet/doPost**: HTTPエンドポイント
- **SubmitResponses_**: 回答の保存・更新（upsert）
- **ListRecords_**: 全レコード取得（ID昇順ソート）
- **GetRecordById_**: 単一レコード取得
- **DeleteRecord_**: レコード削除
- **Sheets_***: スプレッドシート操作ヘルパー（二分探索最適化付き）

### データ構造

#### フォームスキーマ
```javascript
{
  id: "form_xxx",
  name: "フォーム名",
  description: "説明",
  schemaHash: "v1-123456",    // 生成HTMLの整合性チェック
  schemaVersion: 1,
  importantFields: ["氏名", "相談内容|生物|動物種|ヒグマ"],
  displayFieldSettings: [
    { path: "氏名", mode: "normal", type: "text" },
    { path: "相談内容|生物|動物種|ヒグマ", mode: "compact", type: "checkboxes" }
  ],
  archived: false,
  createdAt: 45234.12345,
  modifiedAt: 45236.6789,
  schema: [
    {
      id: "q1",
      type: "text",
      label: "質問テキスト",
      required: true,
      important: true,
      displayMode: "normal",     // "none" | "normal" | "compact"
      placeholder: "山田太郎",
      defaultValue: "",
      defaultNow: false,         // date/time 型の現在値
      pattern: "[A-Za-z]+",      // regex 等
      options: [...],            // select/radio/checkboxes
      children: [...],           // 常時ネスト
      childrenByValue: {         // 条件分岐ネスト
        "はい": [...]
      }
    }
  ],
  settings: {
    formTitle: "受付フォーム",
    spreadsheetId: "1AbCdEf...",
    sheetName: "Responses",
    pageSize: 100
  }
}
```

`displayMode` と `important` の組み合わせでデータ一覧での表示有無を制御し、`childrenByValue` により選択肢ごとのネスト質問を定義します。詳細は `builder/src/core/displayModes.js` を参照してください。

#### エントリーペイロード

`shared/payload_contract.md` で定義している、フォームHTMLからGASへ送信されるデータ構造です。

```json
{
  "version": 1,
  "formTitle": "受付フォーム",
  "schemaHash": "v1-123456",
  "id": "r_f0d1c2b3a4e5",
  "spreadsheetId": "1AbCdEf...",
  "sheetName": "Responses",
  "responses": {
    "氏名": "山田太郎",
    "相談内容|生物|動物種|ヒグマ": true
  },
  "order": ["氏名", "相談内容|生物|動物種|ヒグマ"]
}
```

`responses` のキーは `|` で連結した質問パスで、`order` がスプレッドシートの列順になります。

#### スプレッドシートレイアウト

- 行1-11: ヘッダー（最大11階層）
- 固定列: `id`, `No.`, `createdAt`, `modifiedAt`
- 動的列: 質問パスに基づく列（例: `parent|child|question`）

### 保存先まとめ

#### IndexedDB（DB名: `NestedFormBuilder`）

| ストア名 | 何を保存するか | キー例 |
|---|---|---|
| `settingsStore` | ビルダー設定（pageSize、spreadsheetId 等） | `nested_form_builder_settings_v1` |
| `settingsStore` | 選択中テーマ名 | `nested_form_builder_theme` |
| `settingsStore` | カスタムテーマ一覧（CSS・URL を含む） | `nested_form_builder_theme_custom_list_v1` |
| `formsCache` | フォーム一覧のローカルキャッシュ | formId |
| `recordsCache` | レコードのローカルキャッシュ | entryId |
| `recordsCacheMeta` | キャッシュのメタ情報 | formId |

#### GAS ScriptProperties / UserProperties

プロパティ保存先は管理者設定画面で **ScriptProperties**（スクリプト共有）/ **UserProperties**（ユーザー固有）を切り替えられます。

| キー | 何を保存するか |
|---|---|
| `nfb.forms.mapping` | formId → Google Drive ファイル ID/URL のマッピング |
| `FORM_URLS_MAP` | 同上（旧形式、レガシー） |
| `ADMIN_KEY` | 管理者キー |
| `ADMIN_EMAIL` | 管理者メールアドレス |
| `RESTRICT_TO_FORM_ONLY` | 一般ユーザーを個別フォームのみに制限するフラグ |
| `NFB_PROPERTY_STORE_MODE` | プロパティ保存先モード（`script` / `user`） |

#### Google Drive（JSON ファイル）

| 何 | 詳細 |
|---|---|
| フォームの構造データ本体 | `form_xxx.json`。スキーマ・設定（spreadsheetId 等）を含む |

#### Google Sheets（スプレッドシート）

| 何 | 詳細 |
|---|---|
| 回答レコード | フォームデータ内の `settings.spreadsheetId` が指すスプレッドシート |

## 検索機能

高度な検索クエリをサポート：

```
# キーワード検索
keyword

# 列指定検索
列名:keyword

# 比較演算
列名>値
列名>=値
列名<値
列名<=値
列名=値
列名!=値

# AND/OR演算
条件1 AND 条件2
条件1 OR 条件2

# 正規表現
列名 ~ /パターン/
```

詳細はこのREADMEのクエリ例を参照してください。

## トラブルシューティング

### デプロイ後にアクセスできない

1. GAS管理画面でデプロイ設定を確認
2. 「アクセスできるユーザー」を「全員」に設定
3. ブラウザのキャッシュをクリア

### データが保存されない

1. `settings` でspreadsheetIdが正しく設定されているか確認
2. GASスクリプトがスプレッドシートへの書き込み権限を持っているか確認
3. Apps Script実行ログでエラーを確認

### ビルドエラー

```bash
# 依存関係を再インストール
rm -rf builder/node_modules
npm run builder:install
```

## 技術仕様

### パフォーマンス最適化

- **二分探索**: ID列がソート済みの場合、O(log n)で高速検索
- **バッチ操作**: 複数レコードの一括アーカイブ・削除
- **メモ化**: React.useCallbackによるコールバック最適化
- **冗長性排除**: 共通処理の統一化によるコード削減

### コーディング規約

- **React**: 関数コンポーネント、Hooks使用、JSXはダブルクォート
- **Apps Script**: ES5互換構文、var使用、関数宣言
- **インデント**: 2スペース
- **命名**: camelCase（変数）、PascalCase（コンポーネント）
- **不要なログ**: console.logは本番環境では使用しない

## ライセンス

Private

## サポート

問題が発生した場合は、Issueを作成してください。
