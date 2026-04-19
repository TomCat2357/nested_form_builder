# Nested Form Builder — Design Export

Claude Design に取り込ませるためにまとめた、UI/デザイン関連のソースコード一式です。

## 構成

```
design-export/
├── README.md                       # 本ファイル
├── theme/                          # テーマ・デザイントークン本体
│   ├── base.css                    # 全アプリ共通のベーススタイル（1527行、最重要）
│   ├── theme.css                   # テーマ適用用 CSS エントリ
│   ├── preview-overrides.css       # 生成フォーム用のプレビュー上書き
│   ├── theme.js                    # テーマ切替ロジック（適用・永続化・カスタムテーマ）
│   ├── tokens.js                   # デザイントークン定義（CSS変数への参照）
│   └── themes/                     # ビルトインテーマ（11種類）
│       ├── standard.css            # Standard（デフォルト）
│       ├── dark.css                # Dark
│       ├── ocean.css               # Ocean
│       ├── forest.css              # Forest
│       ├── sakura.css              # Sakura
│       ├── matcha.css              # Matcha
│       ├── warm.css                # Warm
│       ├── snow.css                # Snow
│       ├── christmas.css           # Christmas
│       ├── egypt.css               # Egypt
│       └── india.css               # India
└── support/                        # 補助的なスタイル関連コード
    ├── styleSettings.js            # フィールド単位のスタイル設定モデル
    ├── styles.js                   # エディタの className ヘルパー
    └── themeSyncRules.js           # テーマと設定値の同期ルール
```

## 主要ファイル概要

### `theme/base.css`
アプリ全体を覆うグローバルスタイル。入力要素・ボタン・ダイアログ・レイアウト等の
コアなルールが定義されています。`:root` には多数の CSS 変数（`--bg`, `--surface`,
`--primary` 等）が宣言されており、各テーマ CSS がこの変数群を上書きする構造です。

### `theme/tokens.js`
`base.css` で宣言された CSS 変数を JS 側から参照するためのトークンマップ
（`theme.primary → "var(--primary)"` 等）。`theme.fontSans`, `theme.surface`,
`theme.radiusMd`, `theme.shadowLg` 等、デザインシステムのカテゴリが揃っています。

### `theme/theme.js`
- `DEFAULT_THEME`: `"standard"`
- `THEME_OPTIONS`: ビルトインテーマ 11 種のラベル付きリスト
- テーマ ID を `:root[data-theme="..."]` に適用 / IndexedDB に永続化するロジック
- カスタムテーマ（Drive 由来）の動的注入もサポート

### `theme/themes/*.css`
各テーマは `:root[data-theme="<id>"] { ... }` スコープで CSS 変数を上書きする形式。
`base.css` のトークンを差し替えることで、同一レイアウトのまま配色・質感を切替可能。

### `support/styleSettings.js`
フォームの各フィールドに紐付く個別スタイル設定（色・サイズ等）の既定値と
バリデータ。

### `support/themeSyncRules.js`
テーマと設定値（フォント・背景など）を同期させるためのルール定義。

## 使い方（Claude Design への取り込み）

1. 本ディレクトリ直下の zip (`design-export.zip`) を解凍する
2. まず `theme/base.css` と `theme/themes/standard.css` を読み込ませ、
   デザイントークンの全体像を把握させる
3. 追加のテーマバリエーションや `tokens.js` で、デザインシステムとしての
   トークン設計を伝える

## 由来

- リポジトリ: `nested_form_builder`
- ブランチ: `claude/extract-design-code-lEBwF`
- 抽出日: 2026-04-19
