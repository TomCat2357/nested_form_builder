# 運用・デプロイ・環境構築ドキュメント

**対象読者**: このプロジェクトを構築・実行・ビルド・デプロイ・復旧する人。

コードの構造や変更方法は [`../developers/`](../developers/README.md) を参照してください。

## 作業順に読む

| フェーズ | やること | 参照先 |
| --- | --- | --- |
| 1. 構築 | Node.js 要件・`npm install` / `clasp login`・`.clasp.json` 作成 | [setup.md](./setup.md) |
| 2. 開発 | ローカル開発（`builder:dev`）・ビルド・GAS 同期（`clasp push/pull`）コマンド | [development-workflow.md](./development-workflow.md) |
| 3. デプロイ | `deploy.ps1` のオプション・テストモード・手動デプロイ手順 | [deployment.md](./deployment.md) |
| 4. 復旧 | デプロイ後アクセス不可・保存失敗・ビルド/clasp エラー等の切り分け | [troubleshooting.md](./troubleshooting.md) |

> テスト実行・E2E（`npm test` / Playwright 保存系）は開発者向けの [`../developers/testing.md`](../developers/testing.md) にまとまっています。デプロイのテストモード前提もそちらと併読してください。
