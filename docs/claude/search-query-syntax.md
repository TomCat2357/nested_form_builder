# 検索クエリ構文（Claude 向け詳細）

CLAUDE.md から分離した、検索画面のクエリ構文リファレンス。`searchQueryEngine.js` を触るときや検索仕様を確認するときに参照する。

```
keyword                   # キーワード検索
列名:keyword              # 列指定検索
列名>値 / 列名>=値         # 比較演算
列名<値 / 列名<=値
列名=値 / 列名!=値
条件1 AND 条件2            # AND 結合
条件1 OR 条件2             # OR 結合
列名 ~ /パターン/          # 正規表現
```

ユーザー向けの詳しい使い方は `docs/検索機能の使い方.md` を参照。パーサー本体は `builder/src/features/search/searchQueryEngine.js`。
