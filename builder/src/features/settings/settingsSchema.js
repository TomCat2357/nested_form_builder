import { SAVE_AFTER_ACTIONS } from "../../utils/settings.js";
import { VARIANT_LABELS } from "../analytics/variantLabels.js";

// 保存先スプレッドシートの手動指定グループ。標準フォルダ構成が既定のため常時は表示せず、
// フォームエディタのチェックボックスで開いたときだけレンダリングする（③）。
export const SPREADSHEET_SETTINGS_GROUP = {
  key: "spreadsheet",
  label: "入力データ保存スプレッドシート",
  fields: [
    {
      key: "spreadsheetId",
      label: "Spreadsheet ID / URL",
      placeholder: "1AbCdEf... / https://docs.google.com/... / https://drive.google.com/drive/folders/...",
      required: false,
      description: "空欄なら標準フォルダ構成の 04_spreadsheets に回答保存用スプレッドシートを自動作成します。フォルダURLを入れればそのフォルダ内に、スプレッドシートURLを入れれば既存シートにリンクします（作成後はURLが自動で入ります）。",
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
      {
        key: "searchQueryTableSource",
        label: "WHERE / SEARCH クエリの参照先",
        type: "select",
        required: false,
        defaultValue: "data",
        options: [
          { value: "data", label: `${VARIANT_LABELS.data}で検索（既定 / 選択肢は [親|選択肢] の真偽値）` },
          { value: "view", label: `${VARIANT_LABELS.view}で検索（選択肢は親列の表示ラベル文字列）` },
        ],
        description: "検索バーで WHERE / SEARCH の厳密検索を使うときに、選択肢（ラジオ／チェック等）をどの形で比較するかを選びます。「元データ形式」は選択肢ごとの真偽値列 [親|選択肢]（選択=true / 未選択=false）、「ビュー形式」は親列に入る選択肢ラベル文字列で比較します。日付・数値・テキストはどちらのモードでも同じ扱いです（日付は YYYY/MM/DD の正規化文字列として時系列＝辞書順で比較、数値は数値として比較）。",
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
        placeholder: "{`_id`}_{TIME_FORMAT(NOW(), 'YYYY-MM-DD')}",
        required: false,
        description: "出力ファイルの名前を決める書式です。質問カードごとに個別指定があればそれを優先し、なければここの設定、それもなければ既定値（{`_id`}_{TIME_FORMAT(NOW(), 'YYYY-MM-DD')}）を使います。",
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
    ],
  },
];
