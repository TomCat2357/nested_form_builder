import { ensureArray } from "../../utils/arrays.js";
import { useEffect, useState } from "react";
import { listReportTemplates } from "../../services/gasClient.js";

// 印刷様式テンプレート（05_report_templates 配下の Google ドキュメント）一覧を
// 一度だけ取得してモジュールレベルにキャッシュする。複数の質問カード / 設定欄で共有する。
let cachedPromise = null;

export function loadReportTemplateOptions() {
  if (!cachedPromise) {
    cachedPromise = listReportTemplates()
      .then((r) => (ensureArray(r.files)))
      .catch((err) => {
        cachedPromise = null; // 失敗時は次回再試行できるようキャッシュを破棄
        throw err;
      });
  }
  return cachedPromise;
}

// SearchableSelect 用 option へ変換。value = fileId（リネーム耐性のある安定キー）、
// label = 論理パス（サブフォルダ含む）、folder = 先頭サブフォルダ（並び替え用）。
const toOption = (file) => {
  const path = typeof file.path === "string" && file.path ? file.path : (file.name || "");
  const slash = path.indexOf("/");
  return {
    value: file.fileId,
    label: path,
    path: path,
    folder: slash >= 0 ? path.slice(0, slash) : "",
    url: file.url,
    fileId: file.fileId,
  };
};

// 印刷様式テンプレートの選択肢・読込状態を返すフック。
// dev（google.script.run 不在）や権限不足ではエラーを握り、空一覧 + error メッセージを返す。
export function useReportTemplateOptions() {
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    loadReportTemplateOptions()
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
