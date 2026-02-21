export const SETTINGS_GROUPS = [
  {
    key: "spreadsheet",
    label: "入力データ保存スプレッドシート",
    fields: [
      {
        key: "spreadsheetId",
        label: "Spreadsheet ID / URL",
        placeholder: "1AbCdEf... / https://docs.google.com/... / https://drive.google.com/drive/folders/...",
        required: false,
        description: "未設定/フォルダURLの場合はマイドライブ直下または指定フォルダに新規作成されます（保存後にURLが自動入力）",
      },
      {
        key: "sheetName",
        label: "Sheet Name",
        placeholder: "Data",
        required: false,
      },
    ],
  },
  {
    key: "search",
    label: "検索画面設定",
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
  {
    key: "access",
    label: "アクセス制御",
    fields: [
      {
        key: "showRecordNo",
        label: "No.を表示する",
        type: "checkbox",
        required: false,
        defaultValue: true,
        description: "OFFにすると、検索画面・レコード画面でNo.列が非表示になります（回答状況の推測を防止）",
      },
      {
        key: "showOwnRecordsOnly",
        label: "自分の回答のみ表示",
        type: "checkbox",
        required: false,
        description: "ONにすると、検索画面で自分が作成したレコードのみ表示されます（管理者は全件表示）",
      },
    ],
  },
];

// 後方互換のためフラット配列もエクスポート
export const SETTINGS_FIELDS = SETTINGS_GROUPS.flatMap((g) => g.fields);
