export const SETTINGS_FIELDS = [
  {
    key: "spreadsheetId",
    label: "Spreadsheet ID / URL",
    placeholder: "1AbCdEf... または https://docs.google.com/...",
    required: true,
  },
  {
    key: "sheetName",
    label: "Sheet Name",
    placeholder: "Responses",
    required: false,
  },
  {
    key: "pageSize",
    label: "1画面あたりの表示件数",
    placeholder: "20",
    required: false,
    type: "number",
  },
  {
    key: "searchTableMaxWidth",
    label: "検索結果テーブルの最大幅（px）",
    placeholder: "1200",
    required: false,
    type: "number",
  },
  {
    key: "searchCellMaxChars",
    label: "検索結果セルの表示文字数上限",
    placeholder: "50",
    required: false,
    type: "number",
  },
];
