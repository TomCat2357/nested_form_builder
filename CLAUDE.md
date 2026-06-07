# CLAUDE.md — 開発者向けナビ

Claude（および開発者）がこのリポジトリで作業を始めるための入口。**全体像とテーマ別ドキュメントへの索引**を提供する。詳細仕様は `docs/claude/` 配下のテーマ別ファイルに分離してあるので、編集対象に応じて該当ファイルを開くこと。

## このプロジェクトは何か

最大 11 階層（`core/constants.js` の `MAX_DEPTH = 11`）のネスト構造を持つフォームをブラウザ上で設計し、**単一 HTML を Google Apps Script Web アプリとして配信**するツール。

- **フロント**: React 19 + Vite 7。`vite-plugin-singlefile` で 1 枚の `Index.html` に固める。
- **バック**: Google Apps Script V8。`gas/*.gs`（44 ファイル）を `gas/scripts/bundle.js` が `dist/Bundle.gs` に結合し、`clasp` でデプロイ。
- **保存先**: Google Drive（フォーム/Question/Dashboard 定義 JSON・添付・出力ドキュメント）、Google Sheets（回答レコード）、Properties Service（fileId↔URL マッピング・管理者設定・更新時刻）、IndexedDB（ブラウザキャッシュ）。

## まず押さえる不変条件（コードを触る前に）

- **id ＝ Drive fileId / 名前 ＝ Drive ファイル名**。フォーム・Question・Dashboard の id はその定義 JSON が置かれた Drive ファイルの fileId に統一。保存される `.json` は自分の id も名前も持たず、読み込み時に Drive から導出する。→ [data-model.md](docs/claude/data-model.md)
- **論理フォルダは標準フォルダ配下の物理フォルダをミラーする**（`01_forms` / `02_questions` / `03_dashboards`）。名前の一意性は〈種類 × 論理フォルダ〉単位。→ [data-model.md](docs/claude/data-model.md) / [links-and-save.md](docs/claude/links-and-save.md)
- **階層パスの区切りは `/`**、エスケープは共有コーデック `pathCodec.js`（GAS 双子は `pathCodec.gs`）に統一。テンプレ参照・検索の列名・フィールドパスすべて同じ規則。
- **テンプレートトークンは連続二重ブレース `{{ alasql 式 }}` のみ**（ビュー形式）。単一ブレース `{...}` は廃止＝リテラル文字。旧 `{@field|pipe}` / `[...]` JS 式も廃止。→ [drive-template-tokens.md](docs/claude/drive-template-tokens.md)
- **検索バーは簡易モード（プレフィックスなし）と SQL モード（先頭 `SELECT`）の 2 つ**。旧「厳密モード」（`SEARCH` / `WHERE`）は廃止。SQL モードは Question SQL と同じ実行基盤を共有。→ [search-query-syntax.md](docs/claude/search-query-syntax.md)
- **GAS の公開 API はすべて `executeAction_` の 1 経路に集約**（`doPost` 経由も `google.script.run` 経由も）。→ [apps-script-backend.md](docs/claude/apps-script-backend.md)

## クイックコマンド

```bash
npm install && npm run builder:install   # 依存インストール（ルート + builder）
npm run builder:dev                       # ローカル開発（http://localhost:5173）
npm run builder:build                     # React ビルド
npm run bundle:gas                         # gas/*.gs → dist/Bundle.gs 結合
npm run clasp:push                         # dist/ → Apps Script
npm test                                   # GAS ユニットテスト（tests/**）
npm run test:playwright                    # E2E
.\deploy.ps1                               # Windows: ビルド〜push〜deploy ワンショット
```

非 Windows でのデプロイは `npm run builder:build && npm run bundle:gas && cp gas/appsscript.json dist/ && npm run clasp:push && npx --yes @google/clasp deploy`。

## テーマ別ドキュメント索引（`docs/claude/`）

| 読むタイミング | ドキュメント |
| --- | --- |
| どこに何があるか（トップレベル構成）を掴む | [repo-structure.md](docs/claude/repo-structure.md) |
| フロント／バックのモジュール構成と連携を俯瞰する | [feature-map.md](docs/claude/feature-map.md) |
| データフロー・Provider 構成・保存先の役割分担を知る | [architecture.md](docs/claude/architecture.md) |
| 新しい環境でセットアップする（前提・`.clasp.json`） | [setup.md](docs/claude/setup.md) |
| 日常の開発・ビルド・GAS 同期コマンド | [development-workflow.md](docs/claude/development-workflow.md) |
| `deploy.ps1` と手動デプロイの手順・オプション | [deployment.md](docs/claude/deployment.md) |
| テストの配置と実行（GAS ユニット / フロント / E2E） | [testing.md](docs/claude/testing.md) |
| 画面の URL ルーティングと対応フィールドタイプ | [routing.md](docs/claude/routing.md) |
| フォームスキーマ／シートレイアウト／id＝fileId／ソフトデリート | [data-model.md](docs/claude/data-model.md) |
| IndexedDB キャッシュと差分同期の実装詳細 | [cache-architecture.md](docs/claude/cache-architecture.md) |
| GAS のエントリポイント・アクション定義・公開関数 | [apps-script-backend.md](docs/claude/apps-script-backend.md) |
| リンク（参照）の持ち方・保存時のリンク追従・派生値の非永続化 | [links-and-save.md](docs/claude/links-and-save.md) |
| テンプレートトークン `{{...}}`・alasql 式評価のリファレンス | [drive-template-tokens.md](docs/claude/drive-template-tokens.md) |
| 検索クエリ構文（簡易モード / SQL モード） | [search-query-syntax.md](docs/claude/search-query-syntax.md) |
| ハマりどころとデプロイ情報の確認手順 | [troubleshooting.md](docs/claude/troubleshooting.md) |
| 簡素化リファクタリングの進捗・残タスク（セッション跨ぎの台帳） | [simplification-roadmap.md](docs/claude/simplification-roadmap.md) |

## ディレクトリの最短ガイド

```text
builder/   React 19 + Vite 7 SPA（実装本体）。src/{app,core,features,pages,services,utils}
gas/       Apps Script 分割ソース（44 *.gs）。bundle.js が dist/Bundle.gs に結合
gas_for_spreadsheet/  保存先スプレッドシート用の補助スクリプト
gas_for_webhook/      「外部アクションボタン」の POST 受信 Web アプリ雛形
dist/      clasp push 対象（自動生成・コミットしない）
docs/claude/  本ファイルから分離した開発者向け詳細 15 本
tests/ e2e/  GAS 横断ユニットテスト・Playwright E2E
md2pdf/ scripts/  ユーザーマニュアル生成ツール群（manual/ は gitignore）
deploy.ps1  Windows 用ワンショットデプロイ
```

> フロント側のインラインテストは `builder/src/**/*.test.js` として**ソースと同ディレクトリ**に置く。GAS のユニットテストは `tests/**/*.test.{cjs,js}`。
