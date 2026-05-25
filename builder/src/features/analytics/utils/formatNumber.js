/**
 * 数値の書式整形ユーティリティ。number / trend / progressBar / gauge / pivot 等で共有する。
 *
 * オプション:
 *   prefix   : 先頭に付与する文字列 (例: "¥")
 *   suffix   : 末尾に付与する文字列 (例: "件")
 *   decimals : 小数点以下桁数 (null は自動)
 *   locale   : Intl.NumberFormat に渡すロケール (空文字は既定)
 *
 * 数値以外 / null / undefined / 空文字は "—" を返す。
 */
export function formatNumber(value, options) {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "—";

  const opts = options || {};
  const prefix = typeof opts.prefix === "string" ? opts.prefix : "";
  const suffix = typeof opts.suffix === "string" ? opts.suffix : "";
  const decimals = Number.isFinite(opts.decimals) ? opts.decimals : null;
  const locale = typeof opts.locale === "string" && opts.locale ? opts.locale : undefined;

  const fmtOpts = {};
  if (decimals !== null && decimals >= 0) {
    fmtOpts.minimumFractionDigits = decimals;
    fmtOpts.maximumFractionDigits = decimals;
  }
  let body;
  try {
    body = new Intl.NumberFormat(locale, fmtOpts).format(n);
  } catch (_e) {
    body = String(n);
  }
  return prefix + body + suffix;
}

/**
 * 増減率 (%) を符号付きで整形する。
 * value, base のいずれかが 0 / 不正値の場合は "—" を返す。
 */
export function formatDeltaPercent(current, previous) {
  if (current === null || current === undefined || current === "") return "—";
  if (previous === null || previous === undefined || previous === "") return "—";
  const a = typeof current === "number" ? current : Number(current);
  const b = typeof previous === "number" ? previous : Number(previous);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return "—";
  const pct = ((a - b) / Math.abs(b)) * 100;
  if (!Number.isFinite(pct)) return "—";
  const sign = pct >= 0 ? "+" : "";
  return sign + pct.toFixed(1) + "%";
}
