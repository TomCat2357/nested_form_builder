# リポジトリ構成（Claude 向け詳細）

CLAUDE.md から分離した、トップレベルのディレクトリ構成。どこに何があるかを掴むときに参照する。

```text
nested_form_builder/
├── builder/                # React 19 + Vite 7 SPA
│   ├── src/
│   │   ├── app/           # App.jsx, Provider, 状態管理, テーマ
│   │   ├── core/          # スキーマ, バリデーション, displayModes
│   │   ├── features/      # admin, editor, preview, search, nav, settings
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
│   ├── drive*.gs          # Drive連携 (Template/PrintDocument/Folder/Output/GmailOutput/File)
│   ├── forms*.gs          # フォームCRUD, インポート, マッピング, 解析, 公開API
│   ├── sheets*.gs         # ヘッダー構築, 行操作, レコードCRUD, 日時変換
│   ├── code*.gs           # Code.gs / codeAuth.gs / codeHandlers.gs / codeSyncRecords.gs
│   ├── expressionEvaluator.gs # alasql 互換式評価器
│   ├── templateEvaluator.gs   # balanced scanner + テンプレ解決
│   ├── syncRecordsMerge.js # 差分同期の純粋関数群
│   ├── appsscript.json    # GAS マニフェスト
│   └── scripts/bundle.js  # .gs → dist/Bundle.gs 結合スクリプト
├── gas_for_spreadsheet/    # 保存先スプレッドシート用の補助スクリプト
├── gas_for_webhook/        # 「外部アクションボタン」の POST(payload JSON) 受信 Web App テンプレート
├── dist/                   # clasp push 対象 (自動生成・コミットしない)
├── docs/claude/            # 開発者向け詳細ドキュメント (テーマ別 15 本)
├── tests/ / e2e/           # GAS ユニットテスト, Playwright E2E
├── md2pdf/ / scripts/      # ユーザーマニュアル生成ツール (manual/ は gitignore)
├── deploy.ps1              # Windows 用ビルド + deploy
├── package.json            # ルートの npm scripts
├── CLAUDE.md               # 開発者向けナビ (本ファイル群への索引)
└── README.md
```
