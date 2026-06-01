import { compileNameMatcher } from "../../utils/folderTree.js";
import { compareStrings } from "../../features/search/searchTableValues.js";

/**
 * options をフォルダ順 → label 順に並べ替え、query で絞り込む純関数。
 * label はフォルダ込み名なので、同一フォルダ内では label 比較が実質「名前順」になる。
 * value（選択中）が絞り込みで消えた場合は selectedOption を先頭に補完して、
 * select が空表示になる事故を防ぐ。
 */
export function sortAndFilterOptions(options, query, value) {
  const list = Array.isArray(options) ? options.slice() : [];
  list.sort((a, b) => {
    const byFolder = compareStrings(a.folder || "", b.folder || "");
    if (byFolder !== 0) return byFolder;
    return compareStrings(a.label || "", b.label || "");
  });
  const matcher = compileNameMatcher(query);
  const filtered = list.filter((o) => matcher(o.label));
  if (value && !filtered.some((o) => o.value === value)) {
    const selected = list.find((o) => o.value === value);
    if (selected) return [selected, ...filtered];
  }
  return filtered;
}
