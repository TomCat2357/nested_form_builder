# ドキュメント・ハブ

このリポジトリのドキュメントは **読者層ごとに分離** しています。自分に合った入口から読み進めてください。

| あなたは… | 入口 | 何が書いてあるか |
| --- | --- | --- |
| 🧑‍💻 **アプリを使う人**（利用者） | 生成 PDF マニュアル（下記） | フォーム作成・回答・検索・出力の操作方法 |
| 🛠 **コードを読む / 変更する人**（開発者） | [`developers/`](./developers/README.md) | アーキ・データモデル・公開 API・検索/テンプレ仕様・テスト |
| 🚀 **環境構築・デプロイ・運用する人** | [`operations/`](./operations/README.md) | セットアップ・開発コマンド・`deploy.ps1`・トラブルシュート |
| 🤖 **AI エージェント（Claude）** | [`../CLAUDE.md`](../CLAUDE.md) | コーディング規約・絶対ルール・定数・タスク別ナビ |

## 🧑‍💻 利用者向けマニュアルについて

利用者向けの操作マニュアルは `manual/user_manual.pdf`（生成元 `docs/user_manual.md`）で、`scripts/` と `md2pdf/` のツール群で生成する成果物です。`manual/` と `docs/user_manual.md` は `.gitignore` 対象のためリポジトリには含まれません。検索構文・テンプレート関数式の仕様そのものは、開発者向けの [`developers/search-query-syntax.md`](./developers/search-query-syntax.md) / [`developers/drive-template-tokens.md`](./developers/drive-template-tokens.md) にあります。

## フォルダの責任分解

- **`developers/`** … 「コードがどう作られているか・どう変更するか」。アーキテクチャ、機能マップ、データモデル、キャッシュ、リンク解決、公開 API、ルーティング、検索/テンプレ仕様、テスト、簡素化ロードマップ。
- **`operations/`** … 「どう構築・実行・ビルド・デプロイ・復旧するか」。初回セットアップ、日常の開発コマンド、`deploy.ps1`、トラブルシュート。
- **`../CLAUDE.md`** … AI エージェント（Claude Code）専用の操作契約。人間の開発者も規約の単一情報源として参照可。
