# Nested Form Builder

Nested Form Builder は、ネストしたフォームの設計、公開、回答管理を 1 つの Google Apps Script Web アプリで扱うためのプロジェクトです。フロントエンドは `builder/` の React + Vite、バックエンドは `gas/` の Apps Script で構成され、デプロイ用の成果物は `dist/` に生成されます。

## README の使い分け

| ファイル | 役割 |
| --- | --- |
| `README.md` | リポジトリ全体の入口です。全体像、セットアップ、開発手順、ビルド/デプロイ、関連ドキュメントへの導線をまとめます。 |
| `gas/README.md` | Apps Script バックエンドの実装メモです。`doGet` / `doPost` の責務、`action` 一覧、保存先、`dist/Bundle.gs` との関係を扱います。 |
| `docs/user_manual.md` | 実際の利用者向けマニュアルです。画面説明、操作手順、運用の流れを説明します。 |

迷ったらまずこの `README.md` を見て、バックエンド実装の詳細が必要なときだけ `gas/README.md` に移動する運用にしてください。

## 何をするプロジェクトか

- 階層構造を持つフォームをブラウザ上で作成・編集する
- フォーム定義を Google Drive 上の JSON として管理する
- 回答を Google Sheets に保存し、一覧・検索・編集・削除する
- Apps Script Web アプリとして配布し、一般ユーザー用画面と管理画面を切り替える
- テーマ、表示モード、管理者設定、プロパティ保存先モードを切り替える

## リポジトリ構成

```text
nested_form_builder/
├── builder/                # React 19 + Vite 7 のフロントエンド
├── gas/                    # Apps Script の分割ソース
├── dist/                   # デプロイ用生成物（編集しない）
├── docs/                   # ユーザーマニュアルや補助スクリプト
├── gas_for_spreadsheet/    # 保存先スプレッドシートへ貼り付ける補助ユーティリティ
├── deploy.ps1              # Windows 用のビルド + bundle + clasp deploy
├── package.json            # ルートの npm scripts / clasp / Playwright 依存
└── README.md
```

補足:

- `builder/vite.config.mjs` はビルド出力先を `../dist` に向けています。
- `gas/scripts/bundle.js` は `gas/*.gs` を `dist/Bundle.gs` に結合します。
- `dist/` は生成物です。通常は直接編集せず、`builder/` と `gas/` を修正してください。
- `gas_for_spreadsheet/SpreadsheetUtilities.gs` は、保存先スプレッドシート側で使う任意の補助スクリプトです。

## セットアップ

### 前提

- Node.js 18 以上
- Google アカウント
- `clasp` を利用できる環境
- Google Apps Script API が有効な Google Cloud / Apps Script プロジェクト

### 依存関係のインストール

```powershell
npm install
npm run builder:install
```

- ルートの `npm install` で `@google/clasp` などの共通ツールを入れます。
- `npm run builder:install` で `builder/` 配下のフロントエンド依存関係を入れます。

### `.clasp.json`

ルートに `.clasp.json` を置き、`rootDir` を `dist` に設定します。

```json
{
  "scriptId": "YOUR_SCRIPT_ID",
  "rootDir": "dist"
}
```

### clasp ログイン

```powershell
npm run clasp:login
```

## 開発フロー

### フロントエンドをローカルで触る

```powershell
npm run builder:dev
```

Vite の開発サーバーが起動します。

### 本番相当の成果物を作る

```powershell
npm run builder:build
node gas/scripts/bundle.js
Copy-Item gas/appsscript.json dist/appsscript.json -Force
```

この手順で、少なくとも次の 3 つが `dist/` に揃います。

- `dist/index.html` または `dist/Index.html`
- `dist/Bundle.gs`
- `dist/appsscript.json`

### Apps Script と同期する

```powershell
npm run clasp:push
npm run clasp:pull
```

- `clasp:push` は `dist/` を Apps Script プロジェクトへ反映します。
- `clasp:pull` は `dist/` を最新化します。`gas/` 側の分割ソースとは別物なので、pull 後に `dist/Bundle.gs` をそのまま編集し続けないよう注意してください。

## デプロイ

### 自動デプロイ（Windows / PowerShell）

```powershell
.\deploy.ps1
```

`deploy.ps1` は次をまとめて実行します。

1. `builder/` の `npm install` と `npm run build`
2. `gas/scripts/bundle.js` による `dist/Bundle.gs` 生成
3. `dist/index.html` もしくは `dist/Index.html` への `<base target="_top">` とデプロイ時刻メタ付与
4. `gas/appsscript.json` の `dist/` へのコピー
5. `clasp push`
6. `clasp deploy`

よく使うオプション:

```powershell
.\deploy.ps1 -BundleOnly
.\deploy.ps1 -PropertyStore script
.\deploy.ps1 -PropertyStore user
.\deploy.ps1 -ManifestOverride .\path\to\override.json
```

- `-BundleOnly`: ビルドと bundle だけ実行し、`clasp push/deploy` はしません。
- `-PropertyStore script`: 共有の Script Properties を使います。管理者設定が有効になります。
- `-PropertyStore user`: User Properties を使います。管理者設定は無効になります。
- `-ManifestOverride`: `gas/appsscript.json` に上書き JSON をマージしてから push/deploy します。

### 手動デプロイ

PowerShell スクリプトを使わない場合は、少なくとも次の流れです。

```powershell
npm run builder:build
node gas/scripts/bundle.js
Copy-Item gas/appsscript.json dist/appsscript.json -Force
npm run clasp:push
npx --yes @google/clasp deploy --description "Nested Form Builder"
```

## 運用メモ

- フォーム定義本体は Google Drive 上の JSON ファイルとして保存されます。
- 回答レコードはフォーム設定が指す Google Sheets に保存されます。
- フォームと Drive ファイルの対応付け、最終更新時刻などは Properties Service で管理します。
- `propertyStoreMode=script` のときは共有設定と管理者設定を使う運用、`propertyStoreMode=user` のときはユーザーごとのフォーム管理を使う運用です。

## 関連ドキュメント

- `docs/user_manual.md`: 利用者向けの操作マニュアル
- `gas/README.md`: Apps Script バックエンドの責務と API メモ
- `gas/appsscript.json`: マニフェスト
- `gas_for_spreadsheet/SpreadsheetUtilities.gs`: スプレッドシート側の補助ユーティリティ

## ライセンス

Private
