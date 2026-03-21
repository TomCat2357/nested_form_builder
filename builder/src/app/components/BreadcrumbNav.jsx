import React from "react";

const MAX_LABEL_LENGTH = 20;

const truncate = (text, maxLen = MAX_LABEL_LENGTH) => {
  if (!text || text.length <= maxLen) return text || "";
  return text.slice(0, maxLen - 1) + "…";
};

/**
 * パンくずナビ（ページ上部表示）
 *
 * 表示例（子フォームのレコード画面）:
 *   {ルートフォーム名}       ← リンク（ルート検索へ）
 *   > {代表名}               ← リンク（ルートレコードへ）
 *   > {子フォーム名}         ← リンク（子フォーム検索へ）
 *   > {代表名}               ← 現在地（リンクなし）
 *
 * Props:
 *   trail: [{formId, recordId, representativeValue}] - 親階層の情報
 *   currentFormId: 現在のフォームID（検索リンク構築用）
 *   currentFormTitle: 現在のフォーム名
 *   currentRecordLabel: 現在のレコード代表値（レコード画面のみ）
 *   parentRecordId: 現在の親レコードID（子フォーム検索リンク構築用）
 *   getFormById: フォーム取得関数
 *   onNavigate: (path, state) => void ナビゲーション関数
 */
export default function BreadcrumbNav({
  trail = [],
  currentFormId = "",
  currentFormTitle = "",
  currentRecordLabel = "",
  parentRecordId = "",
  getFormById,
  onNavigate,
}) {
  const items = [];
  const isOnRecordPage = Boolean(currentRecordLabel);

  if (trail.length === 0) {
    // ルートフォーム
    if (isOnRecordPage) {
      // レコード画面: フォーム名はリンク（検索へ）、代表名は現在地
      items.push({
        label: currentFormTitle,
        type: "link",
        path: `/search?form=${currentFormId}`,
        state: {},
      });
      items.push({ label: currentRecordLabel, type: "current" });
    } else {
      // 検索画面: フォーム名は現在地
      items.push({ label: currentFormTitle, type: "current" });
    }
  } else {
    // 子フォーム以降
    for (let i = 0; i < trail.length; i++) {
      const crumb = trail[i];
      const crumbForm = getFormById ? getFormById(crumb.formId) : null;
      const formTitle = crumbForm?.settings?.formTitle || crumb.formId;
      const prevCrumb = i > 0 ? trail[i - 1] : null;

      // フォーム名 → 検索画面へのリンク
      if (i === 0) {
        // ルートフォーム検索
        items.push({
          label: formTitle,
          type: "link",
          path: `/search?form=${crumb.formId}`,
          state: {},
        });
      } else {
        // 中間フォーム検索（parentRecordId付き）
        items.push({
          label: formTitle,
          type: "link",
          path: `/search?form=${crumb.formId}&parentRecordId=${prevCrumb.recordId}`,
          state: { breadcrumbTrail: trail.slice(0, i) },
        });
      }

      // 代表名 → レコードへのリンク
      items.push({
        label: crumb.representativeValue || crumb.recordId,
        type: "link",
        path: `/form/${crumb.formId}/entry/${crumb.recordId}`,
        state: { breadcrumbTrail: trail.slice(0, i) },
      });
    }

    // 現在のフォーム名
    if (isOnRecordPage) {
      // レコード画面: フォーム名は検索結果一覧へのリンク
      const lastCrumb = trail[trail.length - 1];
      items.push({
        label: currentFormTitle,
        type: "link",
        path: `/search?form=${currentFormId}&parentRecordId=${lastCrumb.recordId}`,
        state: { breadcrumbTrail: trail },
      });
      items.push({ label: currentRecordLabel, type: "current" });
    } else {
      // 検索画面: フォーム名は現在地
      items.push({ label: currentFormTitle, type: "current" });
    }
  }

  if (items.length === 0) return null;

  return (
    <div className="breadcrumb-nav breadcrumb-nav--page-top">
      <div className="breadcrumb-nav__trail">
        {items.map((item, i) => (
          <div key={i} className="breadcrumb-nav__item">
            {i > 0 && <span className="breadcrumb-nav__sep">&gt;</span>}
            {item.type === "link" ? (
              <button
                type="button"
                className="breadcrumb-nav__link"
                title={item.label}
                onClick={() => onNavigate && onNavigate(item.path, item.state)}
              >
                {truncate(item.label)}
              </button>
            ) : (
              <span className="breadcrumb-nav__current" title={item.label}>
                {truncate(item.label)}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
