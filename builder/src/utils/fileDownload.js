/**
 * ブラウザにファイルをダウンロードさせる小さなヘルパー群。
 * 一覧アクション (JSON/ZIP エクスポート) とダッシュボードカードの CSV/PNG 書き出しの両方で使う。
 */

/** ファイル名に使えない文字を _ に置換し、空になったら fallback を返す。 */
export function sanitizeFileBaseName(name, fallback) {
  const cleaned = String(name ?? "").replace(/[\\/:*?"<>|\r\n]/g, "_").replace(/^\.+/, "").trim();
  return cleaned || fallback;
}

/** Blob を filename でダウンロードさせる。 */
export function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** data: URL (Chart.js の toBase64Image など) を filename でダウンロードさせる。 */
export function triggerDataUrlDownload(dataUrl, filename) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  a.click();
}
