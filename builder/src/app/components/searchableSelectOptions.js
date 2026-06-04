import { compileNameMatcher, joinFolderPath } from "../../utils/folderTree.js";
import { compareStrings } from "../../features/search/searchTableValues.js";
import { formQualifiedName } from "../../features/analytics/utils/formIdentifierResolver.js";

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

/**
 * forms[] を SearchableSelect の option[] に変換する純関数。
 * label = フォルダ込みフォーム名（論理パス）、folder = 並び替え用。
 * null / id 欠落の要素はスキップする。
 */
export function formsToOptions(forms) {
  return (Array.isArray(forms) ? forms : [])
    .filter((f) => f && f.id)
    .map((f) => ({ value: f.id, label: formQualifiedName(f) || f.id, folder: f.folder || "" }));
}

/**
 * questions[] を SearchableSelect の option[] に変換する純関数。
 * label = フォルダ込み Question 名（論理パス）、folder = 並び替え用。
 * null / id 欠落の要素はスキップする。
 */
export function questionsToOptions(questions) {
  return (Array.isArray(questions) ? questions : [])
    .filter((q) => q && q.id)
    .map((q) => ({ value: q.id, label: joinFolderPath(q.folder, q.name) || q.id, folder: q.folder || "" }));
}

/**
 * getFormColumns() の列メタ配列を SearchableSelect の option[] に変換する純関数。
 * value = 列の pipe-path（key）。SQL 内で [列名] として参照する識別子そのもので、
 * コピーするトークンとも一致する。
 * label も key（フルパス）を使う：葉ラベルは別グループで重複しうるので、フルパスを
 * 表示かつ検索対象にして曖昧さを排除する。メタ列（id / No. / createdAt 等）は
 * 「（メタ）」を付けて識別できるようにする。
 * folder は持たないので空文字（sortAndFilterOptions は label 昇順で安定整列）。
 * key 欠落の要素はスキップ、非配列入力は空配列を返す。
 */
export function columnsToOptions(columns) {
  return (Array.isArray(columns) ? columns : [])
    .filter((c) => c && c.key)
    .map((c) => ({
      value: c.key,
      label: c.isMeta ? c.key + "（メタ）" : c.key,
      folder: "",
    }));
}
