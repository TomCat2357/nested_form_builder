export const SETTINGS_FIELDS = [
  {
    key: "formTitle",
    label: "受付フォームのタイトル",
    placeholder: "例: 来場者受付",
    required: true,
  },
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
    key: "gasUrl",
    label: "GAS WebApp URL",
    placeholder: "https://script.google.com/macros/s/.../exec",
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
];;
