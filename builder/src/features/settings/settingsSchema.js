export const SETTINGS_GROUPS = [
  {
    key: "spreadsheet",
    label: "保存先スプレッドシート",
    fields: [
      {
        key: "spreadsheetId",
        label: "Spreadsheet ID / URL",
        placeholder: "1AbCdEf... または https://docs.google.com/...",
        required: false,
        description: "設定しない時はマイドライブの直下に新規作成されます",
      },
      {
        key: "sheetName",
        label: "Sheet Name",
        placeholder: "Responses",
        required: false,
      },
    ],
  },
  {
    key: "search",
    label: "検索画面",
    fields: [
      {
        key: "pageSize",
        label: "1画面あたりの表示件数",
        placeholder: "20",
        required: false,
        type: "number",
      },
      {
        key: "searchTableMaxWidth",
        label: "検索結果テーブルの幅（px）",
        placeholder: "1200",
        required: false,
        type: "number",
        description: "未設定の場合は画面幅に合わせて可変",
      },
      {
        key: "searchCellMaxChars",
        label: "検索結果セルの表示文字数上限",
        placeholder: "50",
        required: false,
        type: "number",
      },
    ],
  },
];

// 後方互換のためフラット配列もエクスポート
export const SETTINGS_FIELDS = SETTINGS_GROUPS.flatMap((g) => g.fields);
