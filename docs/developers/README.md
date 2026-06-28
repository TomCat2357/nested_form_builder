# 開発者向けドキュメント

**対象読者**: このリポジトリのコードを読む・変更する人。

環境構築・デプロイ・運用の手順は [`../operations/`](../operations/README.md) に、AI エージェント（Claude）向けの規約・絶対ルールは [`../../CLAUDE.md`](../../CLAUDE.md) にあります。

> 💡 コーディング規約（React / GAS の命名・宣言スタイル）・覚えておく定数・影響範囲の広い重要ファイルは、重複を避けるため [`../../CLAUDE.md`](../../CLAUDE.md) を単一情報源としています。コードを書く前に必ず確認してください。

## まず全体像をつかむ

| 知りたいこと | 参照先 |
| --- | --- |
| 全体像・データフロー・Provider・保存先の分担 | [architecture.md](./architecture.md) |
| フロント / バックの機能モジュールを俯瞰する | [feature-map.md](./feature-map.md) |
| ファイルがどこにあるか当たりをつける | [repo-structure.md](./repo-structure.md) |

## バックエンド・データ層

| 知りたいこと | 参照先 |
| --- | --- |
| `doGet` / `doPost` / `ACTION_DEFINITIONS_` / `nfb*` 公開 API・外部アクション payload 契約 | [apps-script-backend.md](./apps-script-backend.md) |
| スキーマ / シートレイアウト / 日時 / ソフトデリート | [data-model.md](./data-model.md) |
| キャッシュ階層・差分同期・オフライン保存 | [cache-architecture.md](./cache-architecture.md) |
| 参照（リンク）の持ち方・保存時の追従・`driveFileUrl` 非永続化 | [links-and-save.md](./links-and-save.md) |

## フロント・機能仕様

| 知りたいこと | 参照先 |
| --- | --- |
| ルート定義・対応フィールドタイプ | [routing.md](./routing.md) |
| 検索クエリ構文（簡易モード / SQL モード） | [search-query-syntax.md](./search-query-syntax.md) |
| テンプレートトークン（alasql 関数式） | [drive-template-tokens.md](./drive-template-tokens.md) |

## 品質・保守

| 知りたいこと | 参照先 |
| --- | --- |
| テスト配置・実行コマンド | [testing.md](./testing.md) |
| リファクタリング進捗・方針 | [simplification-roadmap.md](./simplification-roadmap.md) |
