# リポジトリ構成（Claude 向け詳細）

CLAUDE.md から分離した、トップレベルのディレクトリ構成。どこに何があるかを掴むときに参照する。

```text
nested_form_builder/
├── builder/                # React 19 + Vite 7 SPA
│   ├── src/
│   │   ├── app/           # App.jsx, Provider, 状態管理, テーマ
│   │   ├── core/          # スキーマ, バリデーション, displayModes
│   │   ├── features/      # admin, editor, preview, search, nav, export, settings
│   │   ├── pages/         # ページコンポーネント
│   │   ├── services/      # gasClient.js (GAS RPC ラッパー)
│   │   └── utils/         # dateTime, excelExport, formPaths 等
│   ├── Index.html         # エントリ HTML
│   └── package.json
├── gas/                    # Apps Script 分割ソース
│   ├── Code.gs            # doGet / doPost, アクション定義, ルーティング
│   ├── constants.gs       # ULID生成, プロパティキー, シート定数
│   ├── errors.gs          # エラー型, レスポンス整形
│   ├── model.gs           # リクエスト解析, コンテキスト構築
│   ├── settings.gs        # 管理者設定 (adminKey, adminEmail)
│   ├── properties.gs      # Properties Service 抽象化
│   ├── drive.gs           # Drive連携, 印刷, テンプレート, ファイルアップロード
│   ├── forms*.gs          # フォームCRUD, インポート, マッピング, 解析, API
│   ├── sheets*.gs         # ヘッダー構築, 行操作, レコードCRUD, エクスポート, 差分同期
│   ├── appsscript.json    # GAS マニフェスト
│   └── scripts/bundle.js  # .gs → dist/Bundle.gs 結合スクリプト
├── gas_for_spreadsheet/    # 保存先スプレッドシート用の補助スクリプト
├── dist/                   # clasp push 対象 (自動生成)
├── docs/                   # ユーザーマニュアル, 画像
├── tests/                  # Playwright E2E, GAS ユニットテスト
├── deploy.ps1              # Windows 用ビルド + deploy
├── package.json            # ルートの npm scripts
└── README.md
```
