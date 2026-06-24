// SettingsAdminTab の通知メッセージ整形と入力正規化（純関数）。
// 描画と分離してユニットテスト可能にする。

// ";" 区切りの管理者メール入力を trim + 空要素除去で正規化する。
export function normalizeAdminEmailInput(value) {
  return String(value || "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .join(";");
}

// 管理者メンバーシップ検証の失敗理由を、ユーザー向けの説明文へ変換する。
export function buildMembershipFailMessage({ userEmail, reason, groupErrors, detail }) {
  const safeUser = userEmail || "不明";
  if (reason === "missing_current_user_email") {
    return "現在ユーザーのメールアドレスを取得できませんでした。Google アカウントにログインし直してから再度お試しください。";
  }
  if (reason === "group_fetch_failed") {
    const entries = Object.entries(groupErrors || {});
    const lines = entries.length
      ? entries.map(([group, message]) => `・${group}: ${message}`).join("\n")
      : "（詳細不明）";
    return (
      `現在のアカウント（${safeUser}）が管理者メンバーであるか確認できませんでした。\n` +
      `以下のグループのメンバー取得に失敗しました:\n${lines}\n\n` +
      `権限不足・外部グループ・削除済みグループの可能性があります。\n` +
      `回避策: 自分のメールアドレスを管理者リストに直接追加してから保存してください。`
    );
  }
  if (reason === "not_member") {
    return (
      `現在のアカウント（${safeUser}）が管理者リストに含まれていません。\n` +
      `自分自身をロックアウトしないよう、現在のメールアドレスまたは所属グループをリストに含めてください。`
    );
  }
  return detail || `管理者リストの検証に失敗しました（${reason || "unknown"}）。`;
}

// 標準フォルダ作成 + 全件整列の結果を通知文字列へ整形する。
export function formatAlignSummary(rootName, align) {
  const fmt = (label, c) => (c.skipped
    ? `${label}: スキップ（標準フォルダが無効）`
    : `${label}: 移動 ${c.moved}件 / 取込(コピー) ${c.copiedExternal}件 / 再リンク ${c.rekeyed}件 / 整合済 ${c.aligned}件${c.errors ? ` / エラー ${c.errors}件` : ""}`);

  const rr = align.reresolved || {};
  const reresolvedTotal = (rr.forms || 0) + (rr.questions || 0) + (rr.dashboards || 0);
  const lines = [
    `「${rootName}」配下に標準フォルダ構成（01_forms〜08_documents）を作成しました。`,
    fmt("フォーム", align.forms),
    fmt("Question", align.questions),
    fmt("Dashboard", align.dashboards),
    `参照リンク再構成: ${align.relinkedFiles}件`,
    `参照リンク復旧（論理パス→物理）: ${reresolvedTotal}件`,
    `フォーム物理参照の再配置（spreadsheet/印刷様式）: ${align.formPhysicalAligned || 0}件`,
  ];
  if (align.errors.length) {
    lines.push(`エラー ${align.errors.length}件:`);
    align.errors.slice(0, 3).forEach((e) => lines.push(`・[${e.kind}] ${e.name || e.id}（${e.folder}）: ${e.reason}`));
    if (align.errors.length > 3) lines.push(`…ほか ${align.errors.length - 3}件`);
  }
  return lines.join("\n");
}

// システムごとコピーの結果を通知文字列へ整形する。
// categories（正規化済みカテゴリ選択）が渡された場合、未選択カテゴリは「除外」と表示し分ける
// （件数 0 が「元が空」か「意図的に除外」かを区別する）。未指定なら従来どおり件数のみ。
export function formatCopyResult({ summary, categories, clearedLinks, unresolvedLinks, unresolvedQuestionLinks, appsScriptCopied, appsScriptCopyError, message }) {
  const lines = Object.keys(summary).map((k) =>
    (categories && categories[k] === false) ? `${k}: 除外` : `${k}: ${summary[k]}件`);
  const appsScriptStatus = appsScriptCopied
    ? "コピーしました"
    : `コピーできませんでした（${appsScriptCopyError || "権限等を確認してください"}）`;
  // unresolvedLinks = フォーム同士 / Question→フォーム / ダッシュボード→Question 合算（旧版は
  // ダッシュボード分のみの unresolvedQuestionLinks）。論理パスは保持し、コピー元へは繋がない。
  const unresolved = unresolvedLinks ?? unresolvedQuestionLinks ?? 0;
  return (
    `${message}\n\nappsscript 本体: ${appsScriptStatus}\n` +
    `コピー件数:\n${lines.join("\n")}\nクリアしたリンク: ${clearedLinks}\n` +
    `未解決のリンク（参照は論理パスを保持・要再リンク）: ${unresolved}`
  );
}

// マッピングインポートの結果を通知文字列（本文）へ整形する。
// 呼び出し側で見出し（「マッピングをインポートしました。」）を前置する。
export function formatImportResult({ imported, skipped, errors }) {
  const lines = [
    `フォーム: ${imported.forms || 0}件`,
    `Question: ${imported.questions || 0}件`,
    `Dashboard: ${imported.dashboards || 0}件`,
    `スキップ（重複）: ${skipped || 0}件`,
  ];
  if (errors && errors.length) {
    lines.push(`エラー: ${errors.length}件`);
    errors.slice(0, 3).forEach((e) => lines.push(`・[${e.section}] ${e.id}: ${e.reason}`));
    if (errors.length > 3) lines.push(`…ほか ${errors.length - 3}件`);
  }
  // インポートはマッピングのマージのみ。取り込んだ資産の物理整列・リンク補完は、
  // 各エンティティを次に保存した際のサーバ側自動リンク補完（バックグラウンドアップロード）が担う。
  lines.push("", "取り込んだフォーム・Question・Dashboard は、次回保存時に標準フォルダへ自動整列・再リンクされます。");
  return lines.join("\n");
}
