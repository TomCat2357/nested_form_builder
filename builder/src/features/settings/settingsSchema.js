import { SAVE_AFTER_ACTIONS } from "../../utils/settings.js";

// 保存先スプレッドシートの手動指定グループ。標準フォルダ構成が既定のため常時は表示せず、
// フォームエディタのチェックボックスで開いたときだけレンダリングする（③）。
export const SPREADSHEET_SETTINGS_GROUP = {
  key: "spreadsheet",
  label: "入力データ保存スプレッドシート",
  fields: [
    {
      key: "spreadsheetPath",
      label: "保存先スプレッドシート（04_spreadsheets から選択）",
      type: "spreadsheetSelect",
      required: false,
      description: "04_spreadsheets 内のスプレッドシートを論理パスで選びます。コピー時もリンクが引き継がれます。一覧に無いパスを保存すると、そのパスへ新規作成します。直接URLを使う場合は下の欄に入力してください（どちらか一方）。",
    },
    {
      key: "spreadsheetId",
      label: "Spreadsheet ID / URL（参照のみ・編集不可）",
      placeholder: "保存時に自動で入ります",
      required: false,
      readOnly: true,
      description: "保存時に解決された物理 URL を参照表示します（編集不可）。指定は上の論理パスで行ってください。プロジェクト外/別フォルダの既存シートは保存時に 04_spreadsheets へ取り込み（外部はコピー・内部は移動）、論理パスへ貼り直します。",
    },
    {
      key: "sheetName",
      label: "Sheet Name",
      placeholder: "Data",
      required: false,
    },
  ],
};

export const SETTINGS_GROUPS = [
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
        key: "searchHitColumnMinWidth",
        label: "検索ヒット箇所列の最小幅（px）",
        placeholder: "280",
        required: false,
        type: "number",
        description: "簡易検索時に表示される「検索ヒット箇所」列の最小幅。未設定なら 280px",
      },
      {
        key: "deletedRetentionDays",
        label: "削除済みデータの保存日数",
        placeholder: "30",
        required: false,
        type: "number",
        description: "削除してからこの日数が過ぎたデータは、次回の同期時に完全に消えます",
      },
    ],
  },
  {
    key: "printTemplate",
    label: "標準印刷出力様式",
    note: "下の「デフォルト様式」で始まる設定は、テンプレートを選ばなかったときに自動生成される印刷様式（デフォルト様式）にのみ適用されます。テンプレートを選んだ場合はテンプレート側のレイアウトがそのまま使われます。",
    fields: [
      {
        key: "standardPrintTemplateId",
        label: "標準印刷様式テンプレート",
        type: "reportTemplateSelect",
        required: false,
        description: "05_report_templates 内の Google ドキュメントから選びます。未選択時は自動生成の「デフォルト様式」を使います。",
      },
      {
        key: "standardPrintFileNameTemplate",
        label: "印刷様式出力ファイル名規則",
        placeholder: "{{`_id`}}_{{TIME_FORMAT(NOW(), 'YYYY-MM-DD')}}",
        required: false,
        description: "出力ファイルの名前を決める書式です（テンプレート選択時・デフォルト様式どちらにも適用）。質問カードごとに個別指定があればそれを優先し、なければここの設定、それもなければ既定値（{{`_id`}}_{{TIME_FORMAT(NOW(), 'YYYY-MM-DD')}}）を使います。",
      },
      {
        key: "showPrintHeader",
        label: "デフォルト様式のヘッダーを表示する",
        type: "checkbox",
        required: false,
        defaultValue: true,
        description: "デフォルト様式（テンプレート未選択時）にのみ適用。OFFにすると、様式先頭のフォーム名・出力日時・レコードNo・IDを非表示にします。",
      },
      {
        key: "omitEmptyRowsOnPrint",
        label: "デフォルト様式で空欄項目を省く",
        type: "checkbox",
        required: false,
        defaultValue: true,
        description: "デフォルト様式（テンプレート未選択時）にのみ適用。OFFにすると、未回答の項目も様式へ出力します。",
      },
      {
        key: "linkUploadFilesOnPrint",
        label: "デフォルト様式で添付ファイルにリンクを貼る",
        type: "checkbox",
        required: false,
        defaultValue: true,
        description: "デフォルト様式（テンプレート未選択時）にのみ適用。ONにすると、アップロードされたファイル名に Drive へのリンクを貼ります。OFFにするとファイル名のテキストだけを出力します。",
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
    ],
  },
];
