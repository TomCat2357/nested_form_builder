/**
 * Schema walkers (GAS 側)
 *
 * sheetsHeaders.gs / formsMappingStore.gs から共通的に呼ばれる
 * pure・platform-agnostic なスキーマ走査ヘルパ群。
 *
 * フロント側の双子実装は builder/src/core/schemaUtils.js。
 * 振る舞いを変える場合は両側を揃えること。
 */

/**
 * options ラベル順で childrenByValue のキーを並べ替えて返す。options に無い
 * ラベル (後付け編集でズレた等) は後続に残す。空/非オブジェクトは [] を返す。
 */
function nfbResolveOrderedChildKeys_(field) {
  var branches = field && field.childrenByValue;
  if (!branches || typeof branches !== "object" || Array.isArray(branches)) return [];
  var keys = [];
  for (var k in branches) {
    if (Object.prototype.hasOwnProperty.call(branches, k)) keys.push(k);
  }
  if (!keys.length) return [];

  var ordered = [];
  var seen = {};
  var options = (field && Array.isArray(field.options)) ? field.options : [];
  for (var i = 0; i < options.length; i++) {
    var opt = options[i];
    var label = (opt && typeof opt.label === "string") ? opt.label : "";
    if (!label || seen[label] || !Object.prototype.hasOwnProperty.call(branches, label)) continue;
    ordered.push(label);
    seen[label] = true;
  }
  for (var j = 0; j < keys.length; j++) {
    if (seen[keys[j]]) continue;
    ordered.push(keys[j]);
    seen[keys[j]] = true;
  }
  return ordered;
}

function nfbDefaultFieldSegment_(field, indexTrail) {
  var rawLabel = field && field.label !== undefined && field.label !== null
    ? String(field.label) : "";
  var trimmed = rawLabel.replace(/^\s+|\s+$/g, "");
  if (trimmed) return trimmed;
  var type = field && field.type !== undefined && field.type !== null
    ? String(field.type) : "unknown";
  return "質問 " + indexTrail.join(".") + " (" + type + ")";
}

/**
 * 入力タイプのフィールドに値が入っているかを判定する。
 * `children` 配列を表示するかの判断に使う (空のとき子質問は非表示)。
 */
function nfbFieldHasValue_(field, value) {
  if (!field || typeof field !== "object") return false;
  var type = field.type;
  if (type === "text" || type === "email" || type === "url") {
    return typeof value === "string" && value.replace(/^\s+|\s+$/g, "") !== "";
  }
  if (type === "phone") {
    if (typeof value !== "string") return false;
    return value.replace(/[\s\-()]/g, "") !== "";
  }
  if (type === "number") {
    if (value === "" || value === null || value === undefined) return false;
    return !isNaN(Number(value));
  }
  if (type === "date" || type === "time") {
    return typeof value === "string" && value !== "";
  }
  if (type === "fileUpload") {
    return Array.isArray(value) && value.length > 0;
  }
  return false;
}

/**
 * 無条件子質問 (field.children) を表示・走査すべきかを判定する。
 * message は「回答」概念を持たず値が入らないため、子質問は常に表示する (無条件)。
 * それ以外の入力タイプは値が入っているとき (nfbFieldHasValue_) に表示する。
 * フロント双子は shouldShowUnconditionalChildren (builder/src/core/fieldValue.js)。
 * 振る舞いを変える場合は両側を揃えること (tests/schema-walkers-equivalence.test.cjs)。
 */
function nfbShouldShowUnconditionalChildren_(field, value) {
  return (field && field.type === "message") || nfbFieldHasValue_(field, value);
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
  var opts = options || {};
  var hasGetChildKeys = typeof opts.getChildKeys === "function";
  var hasResponses = !!opts.responses;
  var fieldSegmentFn = typeof opts.fieldSegment === "function" ? opts.fieldSegment : null;
  var branchSegmentFn = typeof opts.branchSegment === "function" ? opts.branchSegment : null;

  function walk(nodes, pathSegments, depth, indexTrail) {
    var list = Array.isArray(nodes) ? nodes : [];
    for (var i = 0; i < list.length; i++) {
      var field = list[i];
      if (field === undefined || field === null) continue;
      var currentIndexTrail = indexTrail.concat(i + 1);
      var segmentCtx = {
        pathSegments: pathSegments,
        index: i,
        depth: depth,
        indexTrail: currentIndexTrail
      };
      var segment = fieldSegmentFn
        ? fieldSegmentFn(field, segmentCtx)
        : nfbDefaultFieldSegment_(field, currentIndexTrail);
      if (segment === null || segment === undefined) continue;
      var currentPath = pathSegments.concat(segment);
      var context = {
        pathSegments: currentPath,
        index: i,
        depth: depth,
        indexTrail: currentIndexTrail
      };
      var shouldContinue = visitor(field, context);
      if (shouldContinue === false) continue;

      if (field.childrenByValue && typeof field.childrenByValue === "object"
          && !Array.isArray(field.childrenByValue)) {
        var childKeys;
        if (hasGetChildKeys) {
          var custom = opts.getChildKeys(field, context);
          childKeys = Array.isArray(custom) ? custom : [];
        } else if (hasResponses) {
          var value = opts.responses[field.id];
          if (field.type === "checkboxes" && Array.isArray(value)) {
            var selected = {};
            for (var s = 0; s < value.length; s++) selected[value[s]] = true;
            var all = nfbResolveOrderedChildKeys_(field);
            childKeys = [];
            for (var a = 0; a < all.length; a++) {
              if (selected[all[a]]) childKeys.push(all[a]);
            }
          } else if ((field.type === "radio" || field.type === "select")
                     && typeof value === "string" && value) {
            childKeys = field.childrenByValue[value] ? [value] : [];
          } else {
            childKeys = [];
          }
        } else {
          childKeys = nfbResolveOrderedChildKeys_(field);
        }

        for (var ci = 0; ci < childKeys.length; ci++) {
          var key = childKeys[ci];
          var branchSegment = branchSegmentFn ? branchSegmentFn(key, field, context) : key;
          var childPath = (branchSegment === null || branchSegment === undefined)
            ? currentPath : currentPath.concat(branchSegment);
          walk(field.childrenByValue[key], childPath, depth + 1, currentIndexTrail);
        }
      }

      if (Array.isArray(field.children) && field.children.length > 0) {
        var traverseChildren = true;
        if (hasResponses) {
          var inputValue = opts.responses[field.id];
          traverseChildren = nfbShouldShowUnconditionalChildren_(field, inputValue);
        }
        if (traverseChildren) {
          walk(field.children, currentPath, depth + 1, currentIndexTrail);
        }
      }
    }
  }

  walk(Array.isArray(schema) ? schema : [], [], 1, []);
}

/**
 * スキーマを mapper で再帰変換する。mapper(field, context) が返したノードが
 * 新しいツリーのそのノードとなる。childrenByValue は mapper 適用後の値で走査
 * される (変換後のフィールドに対して子を再帰処理)。
 *
 * 注意: traverse とは異なり fallback ラベルは使わず、素の label をパスに用いる。
 */
function nfbMapSchema_(schema, mapper) {
  function walk(nodes, pathSegments, depth) {
    var list = Array.isArray(nodes) ? nodes : [];
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var field = list[i];
      var rawLabel = field && field.label !== undefined && field.label !== null
        ? String(field.label) : "";
      var trimmed = rawLabel.replace(/^\s+|\s+$/g, "");
      var currentPath = pathSegments.concat(trimmed);
      var context = { pathSegments: currentPath, index: i, depth: depth };
      var newField = mapper(field, context);
      if (newField && newField.childrenByValue && typeof newField.childrenByValue === "object"
          && !Array.isArray(newField.childrenByValue)) {
        var newChildren = {};
        var orderedKeys = nfbResolveOrderedChildKeys_(newField);
        for (var k = 0; k < orderedKeys.length; k++) {
          var optLabel = orderedKeys[k];
          newChildren[optLabel] = walk(
            newField.childrenByValue[optLabel],
            currentPath.concat(optLabel),
            depth + 1
          );
        }
        newField.childrenByValue = newChildren;
      }
      if (newField && Array.isArray(newField.children)) {
        newField.children = walk(newField.children, currentPath, depth + 1);
      }
      out.push(newField);
    }
    return out;
  }
  return walk(Array.isArray(schema) ? schema : [], [], 1);
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
