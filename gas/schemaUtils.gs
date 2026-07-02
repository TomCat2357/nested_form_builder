/**
 * Schema walkers (GAS 側)
 *
 * sheetsHeaders.gs / formsMappingStore.gs から共通的に呼ばれる
 * pure・platform-agnostic なスキーマ走査ヘルパ群。
 *
 * 実装は builder/src/core/schemaUtils.js + fieldValue.js が単一ソース（esbuild で
 * NfbAlasqlRuntime に焼き込み）。以下の nfb* は薄いデリゲートのみ（関数名・呼び出し側は
 * 不変）。配線の等価性は tests/schema-walkers-equivalence.test.cjs が担保。
 * nfbStripSchemaIDs_ のみ GAS 側実装（フロントの stripSchemaIDs は schema.js 側にあり、
 * 正規化器全体をバンドルへ引き込まないためここでは nfbMapSchema_ の上に再実装している）。
 */

/**
 * options ラベル順で childrenByValue のキーを並べ替えて返す。options に無い
 * ラベル (後付け編集でズレた等) は後続に残す。空/非オブジェクトは [] を返す。
 */
function nfbResolveOrderedChildKeys_(field) {
  return NfbAlasqlRuntime.resolveOrderedChildKeys(field);
}

/**
 * 入力タイプのフィールドに値が入っているかを判定する。
 * `children` 配列を表示するかの判断に使う (空のとき子質問は非表示)。
 */
function nfbFieldHasValue_(field, value) {
  return NfbAlasqlRuntime.fieldHasValue(field, value);
}

/**
 * 無条件子質問 (field.children) を表示・走査すべきかを判定する。
 * message は「回答」概念を持たず値が入らないため、子質問は常に表示する (無条件)。
 */
function nfbShouldShowUnconditionalChildren_(field, value) {
  return NfbAlasqlRuntime.shouldShowUnconditionalChildren(field, value);
}

/**
 * Read-only 再帰走査。visitor(field, context) が false を返すとその subtree を
 * 打ち切る。context = { pathSegments, depth, index, indexTrail }。
 *
 * options (all optional):
 *   responses        field.id → 値 を渡すと、checkboxes/radio/select は
 *                    選択分岐のみ辿る。それ以外の分岐型は辿らない。
 *   getChildKeys     (field, context) => keys[] を返す関数で分岐制御を上書き。
 *   fieldSegment     (field, context) => string | null を返す関数。null を返すと
 *                    そのフィールド・その subtree の走査を完全スキップ (visitor
 *                    も呼ばれない)。既定は trimmed label || 質問 X.Y (type)。
 *   branchSegment    (optionKey, parentField, context) => string を返す関数。
 *                    子 childrenByValue[key] を辿るときのパスセグメント。
 *                    既定は optionKey そのまま。
 */
function nfbTraverseSchema_(schema, visitor, options) {
  return NfbAlasqlRuntime.traverseSchema(schema, visitor, options || {});
}

/**
 * スキーマを mapper で再帰変換する。mapper(field, context) が返したノードが
 * 新しいツリーのそのノードとなる。childrenByValue は mapper 適用後の値で走査
 * される (変換後のフィールドに対して子を再帰処理)。
 *
 * 注意: traverse とは異なり fallback ラベルは使わず、素の label をパスに用いる。
 */
function nfbMapSchema_(schema, mapper) {
  return NfbAlasqlRuntime.mapSchema(schema, mapper);
}

/**
 * 各フィールドから id と opts.uiTempKeys[] を削除した新ツリーを返す。
 * options 配列の各エントリからも id を除去する。GAS の Forms_stripSchemaIds_ と
 * フロントの stripSchemaIDs を統一。
 *
 * opts (all optional):
 *   - uiTempKeys  削除する追加キー名リスト (例: 編集中 UI 状態の _savedXxx)
 */
function nfbStripSchemaIDs_(nodes, opts) {
  var uiTempKeys = opts && Array.isArray(opts.uiTempKeys) ? opts.uiTempKeys : [];
  return nfbMapSchema_(nodes, function(field) {
    var base = {};
    if (field && typeof field === "object") {
      for (var key in field) {
        if (!Object.prototype.hasOwnProperty.call(field, key)) continue;
        if (key === "id") continue;
        base[key] = field[key];
      }
    }
    if (Array.isArray(base.options)) {
      var newOpts = [];
      for (var i = 0; i < base.options.length; i++) {
        var opt = base.options[i];
        var optBase = {};
        if (opt && typeof opt === "object") {
          for (var ok in opt) {
            if (!Object.prototype.hasOwnProperty.call(opt, ok)) continue;
            if (ok === "id") continue;
            optBase[ok] = opt[ok];
          }
        }
        newOpts.push(optBase);
      }
      base.options = newOpts;
    }
    for (var u = 0; u < uiTempKeys.length; u++) delete base[uiTempKeys[u]];
    return base;
  });
}
