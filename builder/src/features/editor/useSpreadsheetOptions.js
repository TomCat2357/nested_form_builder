import { ensureArray } from "../../utils/arrays.js";
import { useEffect, useState } from "react";
import { listSpreadsheets } from "../../services/gasClient.js";

// スプレッドシート（04_spreadsheets 配下の Google スプレッドシート）一覧を一度だけ取得して
// モジュールレベルにキャッシュする。フォーム編集の保存先選択で共有する。
let cachedPromise = null;

export function loadSpreadsheetOptions() {
  if (!cachedPromise) {
    cachedPromise = listSpreadsheets()
      .then((r) => (ensureArray(r.files)))
      .catch((err) => {
        cachedPromise = null; // 失敗時は次回再試行できるようキャッシュを破棄
        throw err;
      });
  }
  return cachedPromise;
}

// SearchableSelect 用 option へ変換。value = 論理パス（04_spreadsheets からの相対パス。
// 葉＝シートのファイル名で拡張子なし）、label = 論理パス、url = シート URL、folder = 先頭サブフォルダ（並び替え用）。
// フォーム側は value（論理パス）を spreadsheetPath に保存し、実行時に GAS がパス→fileId を解決する。
const toOption = (file) => {
  const path = typeof file.path === "string" && file.path ? file.path : (file.name || "");
  const slash = path.indexOf("/");
  return {
    value: path,
    label: path,
    folder: slash >= 0 ? path.slice(0, slash) : "",
    url: file.url,
    fileId: file.fileId,
  };
};

// スプレッドシートの選択肢・読込状態を返すフック。
// dev（google.script.run 不在）や権限不足ではエラーを握り、空一覧 + error メッセージを返す。
export function useSpreadsheetOptions() {
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    loadSpreadsheetOptions()
      .then((files) => {
        if (!alive) return;
        setOptions(files.map(toOption));
        setError(null);
      })
      .catch((err) => {
        if (!alive) return;
        setOptions([]);
        setError(err?.message || String(err));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => { alive = false; };
  }, []);

  return { options, loading, error };
}
