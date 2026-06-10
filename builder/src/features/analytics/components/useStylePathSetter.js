import { deepClone } from "../../../core/schema.js";

/**
 * ChartStyleControls / TableStyleControls で重複していた「スタイルオブジェクトを base から deep clone し、
 * 指定パスのリーフだけを更新して onChange に渡す」immutable 更新ヘルパー。
 *
 * base はクローン元（Chart は正規化済み chartStyle、Table は未設定なら DEFAULT_TABLE_STYLE）。
 * onChange は省略可能（Chart の optional な onChartStyleChange に合わせて optional chaining で呼ぶ）。
 *
 * @param {Object} base クローン元のスタイルオブジェクト
 * @param {(next: Object) => void} [onChange] 更新後オブジェクトの通知先
 * @returns {{ cloneBase: () => Object, setPath: (path: Array<string>, value: *) => void }}
 *   cloneBase: base の deep clone を返す（呼び出し側で多段の更新を組み立てるとき用）。
 *   setPath: path（["a","b","c"]）のリーフに value を設定して onChange に渡す。
 */
export function useStylePathSetter(base, onChange) {
  const cloneBase = () => deepClone(base);
  const setPath = (path, value) => {
    const next = cloneBase();
    let cur = next;
    for (let i = 0; i < path.length - 1; i += 1) cur = cur[path[i]];
    cur[path[path.length - 1]] = value;
    onChange?.(next);
  };
  return { cloneBase, setPath };
}
