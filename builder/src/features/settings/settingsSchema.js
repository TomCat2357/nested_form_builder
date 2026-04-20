import { SAVE_AFTER_ACTIONS } from "../../utils/settings.js";

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
      {
        key: "deletedRetentionDays",
        label: "削除済みデータの保存日数",
        placeholder: "30",
        required: false,
        type: "number",
        description: "deletedAt からこの日数を超過したデータは、次回同期時に完全削除されます",
      },
    ],
  },
  {
    key: "printTemplate",
    label: "標準印刷出力様式",
    fields: [
      {
        key: "standardPrintTemplateUrl",
        label: "印刷様式テンプレートURL",
        placeholder: "https://docs.google.com/document/d/...",
        required: false,
        description: "未設定時は既存の自動生成ドキュメントを使います",
      },
      {
        key: "standardPrintFileNameTemplate",
        label: "印刷様式出力ファイル名規則",
        placeholder: "{@_id}_{@_NOW|time:YYYY-MM-DD}",
        required: false,
        description: "PDF は「カード個別 > フォーム共通 > 既定値」で解決します。Gmail の PDF 添付はフォーム共通か既定値のみを使い、未入力時の既定値は {@_id}_{@_NOW|time:YYYY-MM-DD} です",
      },
      {
        key: "showPrintHeader",
        label: "印刷様式のヘッダーを表示する",
        type: "checkbox",
        required: false,
        defaultValue: true,
        description: "OFFにすると、印刷様式先頭のフォーム名・出力日時・レコードNo・IDを非表示にします。",
      },
      {
        key: "omitEmptyRowsOnPrint",
        label: "印刷様式出力時に空欄項目を省く",
        type: "checkbox",
        required: false,
        defaultValue: true,
        description: "OFFにすると、未回答の項目も印刷様式へ出力します。",
      },
    ],
  },
  {
    key: "record",
    label: "レコード画面設定",
    fields: [
      {
        key: "saveAfterAction",
        label: "通常保存後の動作",
        type: "select",
        required: false,
        defaultValue: SAVE_AFTER_ACTIONS.RETURN_TO_LIST,
        options: [
          { value: SAVE_AFTER_ACTIONS.RETURN_TO_LIST, label: "一覧に戻る" },
          { value: SAVE_AFTER_ACTIONS.STAY_ON_RECORD, label: "レコード画面に留まる" },
        ],
        description: "レコード画面の通常の「保存」ボタンを押した後の遷移先を設定します",
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
        key: "showSearchId",
        label: "検索結果一覧でIDを表示する",
        type: "checkbox",
        required: false,
        defaultValue: true,
        description: "OFFにすると、検索画面のID列が非表示になります",
      },
      {
        key: "showSearchCreatedAt",
        label: "検索結果一覧で作成日時を表示する",
        type: "checkbox",
        required: false,
        defaultValue: true,
        description: "OFFにすると、検索画面の作成日時列が非表示になります",
      },
      {
        key: "showSearchModifiedAt",
        label: "検索結果一覧で最終更新日時を表示する",
        type: "checkbox",
        required: false,
        defaultValue: true,
        description: "OFFにすると、検索画面の最終更新日時列が非表示になります",
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
