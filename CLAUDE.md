# CLAUDE.md

このファイルは、Claude Codeがこのリポジトリで作業する際のガイダンスを提供します。

## プロジェクト概要

**Nested Form Builder**は、ネストされた階層構造を持つアンケートフォームを視覚的に作成し、スタンドアロンHTMLとして出力できるフォームビルダーです。生成されたフォームの回答はGoogle Sheetsに自動保存されます。

### 技術スタック

- **フロントエンド**: React 19 + Vite 7 (SPA)
- **バックエンド**: Google Apps Script (GAS)
- **データ保存**: Google Sheets
- **デプロイ**: clasp (Google Apps Script CLI)

## プロジェクト構成

```
nested_form_builder/
├── builder/              # Reactフロントエンドアプリケーション
│   ├── src/
│   │   ├── app/         # アプリケーション全体の状態管理
│   │   ├── core/        # コアロジック（バリデーション、スキーマ、displayModes）
│   │   ├── features/    # 機能別コンポーネント（エディタ、検索、プレビュー）
│   │   ├── pages/       # ページコンポーネント
│   │   ├── services/    # 外部サービス連携（GAS APIクライアント）
│   │   └── utils/       # ユーティリティ関数
│   └── index.html       # エントリーポイント
├── gas/                  # Google Apps Script ソースファイル
│   ├── Code.gs          # メインエンドポイント (doGet/doPost)
│   ├── sheets.gs        # Sheets操作ロジック（二分探索最適化）
│   ├── model.gs         # リクエストパース・正規化
│   ├── settings.gs      # 設定管理
│   ├── appsscript.json  # GASプロジェクト設定（ベース）
│   └── scripts/
│       └── bundle.js    # GASファイルを結合するスクリプト
├── dist/                 # ビルド成果物・デプロイ用ディレクトリ
│   ├── Bundle.gs        # GASファイル結合版（自動生成）
│   ├── Index.html       # Reactビルド成果物（自動生成）
│   └── appsscript.json  # GAS設定（gas/からコピー）
├── tests/                # テスト・ツールスクリプト
│   ├── test-playwright.js           # アプリ動作テスト
│   ├── test-new-form-question-add.js # 質問追加テスト
│   └── capture_manual.js            # ドキュメント用スクリーンショット
├── .local/               # ローカル環境専用（.gitignore）
│   └── experiments/     # 実験的スクリプト
├── docs/                # ドキュメント
│   ├── SPECIFICATIONS.md     # 技術仕様
│   ├── user_manual.md        # ユーザーマニュアル
│   └── 検索機能の使い方.md   # 検索クエリ仕様
├── .clasp.json          # clasp設定（rootDir: "dist"）
└── deploy.sh            # デプロイ自動化スクリプト
```

## 主要な開発コマンド

### インストール

```bash
# ルートの依存関係インストール（clasp, playwrightなど）
npm install

# builderの依存関係インストール
npm run builder:install
```

### 開発

```bash
# Reactアプリをローカル開発サーバーで起動（http://localhost:5173）
npm run builder:dev

# Reactアプリをビルド
npm run builder:build

# ビルド後のプレビュー
npm run builder:preview
```

### デプロイ

```bash
# 完全自動デプロイ（推奨）
./deploy.sh

# マニフェスト上書きオプション付きデプロイ
./deploy.sh --manifest-override path/to/override.json

# 手動操作の場合
npm run clasp:login    # 初回のみ
npm run builder:build  # 1. Reactアプリビルド
node gas/scripts/bundle.js  # 2. GASファイル結合
npm run clasp:push     # 3. Google Apps Scriptへプッシュ
npx clasp deploy       # 4. Webアプリとしてデプロイ
```

### デプロイスクリプトの動作

`./deploy.sh` は以下を自動実行します：

1. `builder` のビルド（Vite）
2. GASファイルの結合（`gas/scripts/bundle.js`）
3. `dist/` ディレクトリへの配置
   - `Index.html`（Reactアプリ、`<base target="_top">` タグ追加）
   - `Bundle.gs`（結合されたGASコード）
   - `appsscript.json`（GAS設定）
4. `clasp push`（GASへプッシュ）
5. `clasp deploy`（Webアプリとしてデプロイ）
6. デプロイ情報のキャッシュ（`.gas-deployment.json`）

## アーキテクチャ

### データフロー

1. **フォーム設計**: Reactアプリでフォームスキーマを作成・編集
2. **HTML生成**: スキーマから単一のスタンドアロンHTMLファイルを生成
3. **回答送信**: 生成されたフォームからGAS WebアプリへPOST
4. **データ保存**: GASがGoogle Sheetsにデータを正規化して保存
5. **データ取得**: React管理画面からGAS API経由でデータを取得・検索

### 主要コンポーネント

#### Builder（React SPA）

- **AdminDashboardPage**: フォーム一覧・管理画面
- **AdminFormEditorPage**: フォームエディタUI
- **FormPage**: フォーム入力画面
- **SearchPage**: データ検索・閲覧
- **PreviewPage**: フォームプレビュー
- **dataStore**: フォーム・エントリの状態管理（localStorage）
- **gasClient**: GAS API呼び出しクライアント
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
  schema: [
    {
      id: "q1",
      type: "text",           // text, number, date, radio, checkbox, regex
      label: "質問テキスト",
      required: true,
      placeholder: "入力例",
      children: [...]          // ネストされた質問（最大6階層）
    }
  ],
  settings: {
    spreadsheetId: "...",
    sheetName: "Responses",
    gasUrl: "https://script.google.com/macros/s/.../exec"
  }
}
```

#### スプレッドシートレイアウト

- **行1-6**: ヘッダー（最大6階層の質問パス）
- **固定列**: `id`, `No.`, `createdAt`, `modifiedAt`
- **動的列**: 質問パスに基づく列（例: `parent|child|question`）

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

詳細は `docs/検索機能の使い方.md` を参照してください。

## コーディング規約

### React（builder/src/）

- **関数コンポーネント**とHooksを使用
- **JSX**: ダブルクォート使用
- **インデント**: 2スペース
- **命名規則**:
  - コンポーネント: PascalCase
  - 変数・関数: camelCase
  - 定数: UPPER_SNAKE_CASE
- **状態管理**:
  - グローバル状態はlocalStorageベースの`dataStore`
  - レコードキャッシュはIndexedDBの`recordsCache`
- **不要なログ**: 本番環境では`console.log`を使用しない

### Google Apps Script（gas/）

- **ES5互換構文**を使用（GAS制約）
- **変数宣言**: `var`使用（`let`/`const`は非推奨）
- **関数宣言**: `function name() {}` 形式
- **インデント**: 2スペース
- **命名規則**:
  - 公開API関数: 末尾にアンダースコア（例: `SubmitResponses_`）
  - 内部関数: アンダースコアなし（例: `Sheets_FindRowById`）
- **エラーハンドリング**: try-catch必須、ユーザーフレンドリーなメッセージ

## パフォーマンス最適化

- **二分探索**: ID列がソート済みの場合、O(log n)で高速検索
- **バッチ操作**: 複数レコードの一括アーカイブ・削除
- **メモ化**: `React.useCallback`によるコールバック最適化
- **冗長性排除**: 共通処理の統一化によるコード削減

## トラブルシューティング

### デプロイ後にアクセスできない

1. GAS管理画面でデプロイ設定を確認
2. 「アクセスできるユーザー」を「全員」に設定
3. ブラウザのキャッシュをクリア

### データが保存されない

1. `settings` で`spreadsheetId`が正しく設定されているか確認
2. GASスクリプトがスプレッドシートへの書き込み権限を持っているか確認
3. Apps Script実行ログ（https://script.google.com）でエラーを確認

### ビルドエラー

```bash
# 依存関係を再インストール
rm -rf builder/node_modules
npm run builder:install
```

### claspエラー

```bash
# 再ログイン
npm run clasp:login

# .clasp.jsonのscriptIdを確認
cat .clasp.json
```

## 重要なファイル

- **deploy.sh**: デプロイ自動化スクリプト（最も重要）
- **.clasp.json**: clasp設定（`rootDir: "dist"`を変更しない）
- **gas/scripts/bundle.js**: GASファイル結合スクリプト
- **builder/src/core/schema.js**: フォームスキーマ定義とバリデーション
- **builder/src/core/displayModes.js**: 表示モード管理（NEW）
- **gas/sheets.gs**: スプレッドシート操作の中核（二分探索実装）

## 開発時の注意事項

1. **ファイル生成前に確認**: 新規ファイルを作成する前に、必ずユーザーに確認を取る
2. **既存パターンを踏襲**: 既存のコードスタイルと設計パターンに従う
3. **デプロイ前のテスト**: ローカルで十分にテストしてからデプロイ
4. **GAS制約の理解**: ES5互換性、実行時間制限（6分）、配列操作の最適化
5. **二重化を避ける**: distディレクトリのファイルは自動生成されるため、直接編集しない

## 関連リンク

- **clasp公式ドキュメント**: https://github.com/google/clasp
- **Google Apps Script API**: https://developers.google.com/apps-script/api/
- **React公式ドキュメント**: https://react.dev/
- **Vite公式ドキュメント**: https://vitejs.dev/

## デプロイ情報の確認

デプロイ後、以下のファイルに情報が保存されます：

- **.gas-deployment.json**: 最新のデプロイID・WebApp URL
- **.clasp.json**: Script ID

```bash
# 現在のScript IDを確認
cat .clasp.json | grep scriptId

# 最新のデプロイ情報を確認
cat .gas-deployment.json
```
