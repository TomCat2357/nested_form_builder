// =============================================================================
// TestPayload.gs — テスト用ゴールデン payload
//
// xlsx 原本の作例（秋はじめ / 春元負比呂・キツネ 10 頭・くくりわな・依頼書）を
// builder/src/features/preview/printDocument.js の buildRecordItems の出力形式に
// 合わせて手組みしたもの。
//
// ※ 本番投入前に Playground（管理者 > Playground > Webhook モード）で実レコードの
//    payload を取得し、question パスの実形（特に日付の文字列書式と
//    子フォームの方法ラベル「…名称)」の半角閉じ括弧）と突き合わせること。
//    差異があればこのファイルと mapping.gs のラベル定数を実測に合わせて直す。
// =============================================================================

function Cho_buildGoldenPayload_() {
  var S = CHO_L_CHILD_SPECIES_; // 捕獲等をする鳥獣又は採取等をする鳥類の卵の種類及び数量
  var M = CHO_L_CHILD_METHOD_;  // 捕獲等又は採取等の方法（使用する捕獲用具の名称) ※閉じ半角
  var child1 = "従事者情報/#1/";
  var child2 = "従事者情報/#2/";
  var wanaLic = M + "/わな猟/免許の必要性/必要/免許情報/";

  return {
    context: "record",
    formId: "1_aLScq4lAQA-TgI2rZqyzqXB6SDiENy4",
    formName: "鳥獣保護管理法許可申請",
    generatedAt: "2026-06-01T01:23:45.000Z",
    record: {
      id: "r_01TESTTESTTESTTEST_choju001",
      no: 1,
      items: [
        { question: "許可処分情報", value: "", type: "message" },
        { question: "許可処分情報/処分の種類", value: "許可", type: "radio" },
        { question: "許可処分情報/許可番号", value: "8-81", type: "text" },
        { question: "許可処分情報/許可年月日", value: "2026-06-01", type: "date" },
        { question: "申請者情報", value: "", type: "message" },
        { question: "申請者情報/申請者の個人・法人の別", value: "個人", type: "radio" },
        { question: "申請者情報/申請者の個人・法人の別/個人/氏名", value: "秋　はじめ", type: "substitution" },
        { question: "申請者情報/申請者の個人・法人の別/個人/住所", value: "札幌市北区あいの里X条X丁目X-X", type: "substitution" },
        { question: "申請者情報/申請者の個人・法人の別/個人/生年月日", value: "1999-06-26", type: "substitution" },
        { question: "申請者情報/申請者の個人・法人の別/個人/職業", value: "会社役員", type: "substitution" },
        { question: "申請者情報/損害賠償能力", value: "狩猟登録者", type: "radio" },
        { question: "捕獲しようとする鳥獣の種類及び数量", value: "キツネ", type: "checkboxes" },
        { question: "捕獲しようとする鳥獣の種類及び数量/キツネ/捕獲頭数", value: "10", type: "number" },

        // ----- 従事者 #1（代表・わな猟） -----
        { question: child1 + "代表的個人", value: "はい", type: "radio" },
        { question: child1 + "氏名", value: "秋　はじめ", type: "text" },
        { question: child1 + "住所", value: "札幌市北区あいの里X条X丁目X-X", type: "text" },
        { question: child1 + "職業", value: "会社役員", type: "text" },
        { question: child1 + "生年月日", value: "1999-06-26", type: "date" },
        { question: child1 + S, value: "キツネ", type: "checkboxes" },
        { question: child1 + S + "/キツネ/捕獲頭数", value: "5", type: "number" },
        { question: child1 + M, value: "わな猟", type: "checkboxes" },
        { question: child1 + M + "/わな猟/わなの種類", value: "くくりわな", type: "checkboxes" },
        { question: child1 + M + "/わな猟/免許の必要性", value: "必要", type: "radio" },
        { question: child1 + wanaLic.slice(0, -1), value: "", type: "message" },
        { question: child1 + wanaLic + "許可権者", value: "北海道知事", type: "text" },
        { question: child1 + wanaLic + "交付年月日", value: "2025-04-01", type: "date" },
        { question: child1 + wanaLic + "許可番号", value: "石狩第0000号", type: "text" },
        { question: child1 + M + "/わな猟/狩猟者登録", value: "", type: "message" },
        { question: child1 + M + "/わな猟/狩猟者登録/登録の有無", value: "なし", type: "radio" },

        // ----- 従事者 #2（わな猟） -----
        { question: child2 + "代表的個人", value: "いいえ", type: "radio" },
        { question: child2 + "氏名", value: "春元　負比呂", type: "text" },
        { question: child2 + "住所", value: "札幌市北区あいの里X条X丁目X-X", type: "text" },
        { question: child2 + "職業", value: "会社員", type: "text" },
        { question: child2 + "生年月日", value: "1999-06-27", type: "date" },
        { question: child2 + S, value: "キツネ", type: "checkboxes" },
        { question: child2 + S + "/キツネ/捕獲頭数", value: "5", type: "number" },
        { question: child2 + M, value: "わな猟", type: "checkboxes" },
        { question: child2 + M + "/わな猟/わなの種類", value: "くくりわな", type: "checkboxes" },
        { question: child2 + M + "/わな猟/免許の必要性", value: "必要", type: "radio" },
        { question: child2 + wanaLic.slice(0, -1), value: "", type: "message" },
        { question: child2 + wanaLic + "許可権者", value: "北海道知事", type: "text" },
        { question: child2 + wanaLic + "交付年月日", value: "2025-04-01", type: "date" },
        { question: child2 + wanaLic + "許可番号", value: "石狩第0001号", type: "text" },
        { question: child2 + M + "/わな猟/狩猟者登録", value: "", type: "message" },
        { question: child2 + M + "/わな猟/狩猟者登録/登録の有無", value: "なし", type: "radio" },

        { question: "捕獲等又は採取等の目的", value: "管理（被害防止)", type: "text" },
        { question: "捕獲等又は採取等の期間", value: "", type: "message" },
        { question: "捕獲等又は採取等の期間/開始", value: "2026-06-01", type: "date" },
        { question: "捕獲等又は採取等の期間/終了", value: "2026-06-30", type: "date" },
        { question: "捕獲等又は採取等の区域", value: "", type: "message" },
        { question: "捕獲等又は採取等の区域/所在地", value: "札幌市白石区小坂９丁目９番9号", type: "text" },
        { question: "捕獲等又は採取等の区域/" + CHO_L_AREA7_, value: "公道", type: "checkboxes" },
        { question: CHO_L_PARENT_METHOD_, value: "くくりわな", type: "checkboxes" },
        { question: CHO_L_DISPOSAL_, value: "焼却", type: "checkboxes" },
        { question: CHO_L_CERT_OR_REQ_, value: "依頼書", type: "radio" },
        { question: CHO_L_CERT_OR_REQ_ + "/依頼書/依頼者住所", value: "札幌市中央区北１条西２丁目", type: "text" },
        { question: CHO_L_CERT_OR_REQ_ + "/依頼書/依頼者氏名", value: "札幌市長　秋元　克広", type: "text" },
        { question: CHO_L_CERT_OR_REQ_ + "/依頼書/" + CHO_L_PERIOD_, value: "", type: "message" },
        { question: CHO_L_CERT_OR_REQ_ + "/依頼書/" + CHO_L_PERIOD_ + "/開始", value: "2026-06-01", type: "date" },
        { question: CHO_L_CERT_OR_REQ_ + "/依頼書/" + CHO_L_PERIOD_ + "/終了", value: "2026-06-30", type: "date" },
        { question: CHO_L_CERT_OR_REQ_ + "/依頼書/被害状況", value: "住民へのつきまとい等", type: "text" },
        { question: CHO_L_CERT_OR_REQ_ + "/依頼書/依頼した理由", value: "つきまとい等の生活環境被害防止のため", type: "text" },
        { question: CHO_L_REMARKS_, value: "", type: "text" }
      ]
    }
  };
}

// 方法 3 種（わな猟 2 用具 + 空気銃 + 散弾銃・ライフル銃 2 丁）を持つ従事者の items。
// 名簿展開（1 + 1 + 2 = 4 ブロック、2 ブロック目以降の個人欄空白）の検証用。
function Cho_buildMultiMethodWorkerItems_(childPrefix) {
  var S = CHO_L_CHILD_SPECIES_;
  var M = CHO_L_CHILD_METHOD_;
  var p = childPrefix; // 例: "従事者情報/#3/"
  var guns = p + M + "/散弾銃・ライフル銃/";
  return [
    { question: p + "代表的個人", value: "いいえ", type: "radio" },
    { question: p + "氏名", value: "冬村　多才", type: "text" },
    { question: p + "住所", value: "札幌市南区真駒内9条9丁目", type: "text" },
    { question: p + "職業", value: "猟師", type: "text" },
    { question: p + "生年月日", value: "1980-01-15", type: "date" },
    { question: p + S, value: "キツネ, アライグマ", type: "checkboxes" },
    { question: p + S + "/キツネ/捕獲頭数", value: "3", type: "number" },
    { question: p + S + "/アライグマ/捕獲頭数", value: "2", type: "number" },
    { question: p + M, value: "わな猟, 空気銃, 散弾銃・ライフル銃", type: "checkboxes" },
    // わな猟（はこわな + くくりわな = 1 ブロックに用具 2 つ）
    { question: p + M + "/わな猟/わなの種類", value: "はこわな, くくりわな", type: "checkboxes" },
    { question: p + M + "/わな猟/免許の必要性", value: "必要", type: "radio" },
    { question: p + M + "/わな猟/免許の必要性/必要/免許情報/許可権者", value: "北海道知事", type: "text" },
    { question: p + M + "/わな猟/免許の必要性/必要/免許情報/交付年月日", value: "2024-04-01", type: "date" },
    { question: p + M + "/わな猟/免許の必要性/必要/免許情報/許可番号", value: "石狩第1111号", type: "text" },
    { question: p + M + "/わな猟/狩猟者登録/登録の有無", value: "あり", type: "radio" },
    { question: p + M + "/わな猟/狩猟者登録/登録の有無/あり/交付年月日", value: "2025-10-01", type: "date" },
    { question: p + M + "/わな猟/狩猟者登録/登録の有無/あり/番号", value: "わ第222号", type: "text" },
    // 空気銃
    { question: p + M + "/空気銃/所持許可/所持許可証番号", value: "空第333号", type: "text" },
    { question: p + M + "/空気銃/所持許可/交付年月日", value: "2023-07-01", type: "date" },
    { question: p + M + "/空気銃/第二種銃猟免許/許可権者", value: "北海道知事", type: "text" },
    { question: p + M + "/空気銃/第二種銃猟免許/許可番号", value: "石狩第4444号", type: "text" },
    { question: p + M + "/空気銃/第二種銃猟免許/交付年月日", value: "2023-06-01", type: "date" },
    { question: p + M + "/空気銃/狩猟者登録/登録の有無", value: "なし", type: "radio" },
    // 散弾銃・ライフル銃（2 丁 → 所持許可が別 → 2 ブロック）
    { question: guns + "鉄砲の種類", value: "散弾銃, ライフル銃", type: "checkboxes" },
    { question: guns + "鉄砲の種類/散弾銃/所持許可/所持許可証番号", value: "散第555号", type: "text" },
    { question: guns + "鉄砲の種類/散弾銃/所持許可/交付年月日", value: "2022-05-01", type: "date" },
    { question: guns + "鉄砲の種類/ライフル銃/所持許可/所持許可証番号", value: "ラ第666号", type: "text" },
    { question: guns + "鉄砲の種類/ライフル銃/所持許可/交付年月日", value: "2022-05-02", type: "date" },
    { question: guns + "第一種銃猟免許/許可権者", value: "北海道知事", type: "text" },
    { question: guns + "第一種銃猟免許/許可番号", value: "石狩第7777号", type: "text" },
    { question: guns + "第一種銃猟免許/交付年月日", value: "2022-04-01", type: "date" },
    { question: guns + "狩猟者登録/登録の有無", value: "あり", type: "radio" },
    { question: guns + "狩猟者登録/登録の有無/あり/交付年月日", value: "2025-10-15", type: "date" },
    { question: guns + "狩猟者登録/登録の有無/あり/番号", value: "銃第888号", type: "text" }
  ];
}
