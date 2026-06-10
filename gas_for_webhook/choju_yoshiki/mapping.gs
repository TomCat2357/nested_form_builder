// =============================================================================
// mapping.gs — 様式セルマップ + 値変換テーブル（全部データ。ロジックは fill.gs / domain.gs）
//
// セル番地の典拠は form_data/鳥獣保護管理法様式.xlsx の旧数式
// （scripts/extract_formula_map.py で抽出した formulas.tsv）。
// セル番地を直したいときはこのファイルだけ編集すればよい。
//
// 規約:
//   - cell は必ず結合セルの左上番地で書く（merges.tsv で検証済み）
//   - get はドメインモデル（domain.gs の Cho_buildModel_）のフラットなキー名
//   - 値が "" / null のセルは書き込まない（fill.gs 側でスキップ）
// =============================================================================

// ----- ラベル定数（フォーム定義の正確な文字列。半角/全角括弧の罠を 1 箇所に隔離）-----
// 親フォーム「鳥獣保護管理法許可申請」
var CHO_L_PARENT_METHOD_ = "捕獲等又は採取等の方法 （使用する捕獲用具の名称）"; // ラベル内空白 + 全角閉じ
var CHO_L_PARENT_SPECIES_ = "捕獲しようとする鳥獣の種類及び数量";
var CHO_L_FORMLINK_ = "従事者情報";
var CHO_L_DISPOSAL_ = "捕獲等又は採取等をしたあとの処置";
var CHO_L_PURPOSE_ = "捕獲等又は採取等の目的";
var CHO_L_PERIOD_ = "捕獲等又は採取等の期間";
var CHO_L_AREA_ = "捕獲等又は採取等の区域";
var CHO_L_AREA7_ = "規則第７条第１項第７号に係る場所等の位置、名称及び理由";
var CHO_L_CERT_OR_REQ_ = "証明書又は依頼書の別";
var CHO_L_APPLICANT_ = "申請者情報";
var CHO_L_APPLICANT_TYPE_ = "申請者の個人・法人の別";
var CHO_L_PERMIT_GROUP_ = "許可処分情報";
var CHO_L_REMARKS_ = "備考";
// 子フォーム「従事者情報」
var CHO_L_CHILD_METHOD_ = "捕獲等又は採取等の方法（使用する捕獲用具の名称)"; // 閉じ括弧が半角!
var CHO_L_CHILD_SPECIES_ = "捕獲等をする鳥獣又は採取等をする鳥類の卵の種類及び数量";
var CHO_L_REP_ = "代表的個人";

// ----- 値変換テーブル -----
// フォームの種名 → 様式の種名（様式の入力規則: ハシブトガラス,ハシボソガラス,ドバト,スズメ,アライグマ,キツネ,キジバト）
var CHO_SPECIES_NAME_MAP_ = { "カワラバト": "ドバト" }; // 他は素通し（ノイヌ/ノネコ/ねずみ は as-is）
// 種ごとの数量単位（フォーム定義の 捕獲羽数/捕獲頭数 と一致させる）
var CHO_SPECIES_UNIT_ = {
  "キジバト": "羽", "カワラバト": "羽", "ドバト": "羽", "スズメ": "羽",
  "ハシボソガラス": "羽", "ハシブトガラス": "羽",
  "キツネ": "頭", "ノイヌ": "頭", "ノネコ": "頭", "アライグマ": "頭", "ねずみ": "頭"
};
// 処置（様式の入力規則: 放鳥,放獣,放鳥・放獣,焼却,埋設・廃棄）
var CHO_DISPOSAL_MAP_ = { "焼却": "焼却", "廃棄": "埋設・廃棄", "埋設": "埋設・廃棄" };
// 捕獲用具の正規表記（様式の入力規則: 手捕り,はこわな,くくりわな,網(つき網),銃(散弾銃),銃(空気銃),…）
var CHO_TOOL_NAME_ = {
  "手捕り": "手捕り", "はこわな": "はこわな", "くくりわな": "くくりわな",
  "網猟": "網(つき網)", "空気銃": "銃(空気銃)", "散弾銃": "銃(散弾銃)", "ライフル銃": "銃(ライフル銃)"
};
// 子フォームの方法 → 狩猟免許の種類
var CHO_LICENSE_TYPE_ = {
  "わな猟": "わな猟", "網猟": "網猟", "空気銃": "第二種銃猟", "散弾銃・ライフル銃": "第一種銃猟"
};

// ----- 静的セルマップ（シート名 → [{cell, get}]）-----
var CHO_SHEET_MAPS_ = {
  "申請書": [
    { cell: "I2", get: "applicationDate" },
    { cell: "G6", get: "applicantAddress" },
    { cell: "G8", get: "applicantNameComposed" },
    { cell: "G9", get: "applicantOccupation" },
    { cell: "G10", get: "applicantBirthDate" },
    { cell: "E23", get: "purpose" },
    { cell: "E24", get: "periodStart" },
    { cell: "I24", get: "periodEnd" },
    { cell: "E25", get: "areaLocation" },
    { cell: "E26", get: "method1" },
    { cell: "E27", get: "method2" },
    { cell: "E28", get: "method3Rest" }, // 4 つ以上は 3 枠目に連結
    { cell: "E29", get: "disposal1" },
    { cell: "E30", get: "disposal2" },
    { cell: "E31", get: "disposal3" },
    { cell: "E32", get: "disposal4" },
    { cell: "E33", get: "area7Flag" },
    { cell: "E34", get: "area7Detail" },
    { cell: "E35", get: "licenseNote" },      // 狩猟免許あり → 別添従事者名簿のとおり
    { cell: "E39", get: "registrationNote" }, // 狩猟者登録あり → 〃
    { cell: "E42", get: "gunPermitNote" },    // 銃器使用あり → 〃
    { cell: "E45", get: "remarks" }
  ],
  "証明書": [
    { cell: "I2", get: "applicationDate" },
    { cell: "H5", get: "applicantNameComposed" },
    { cell: "E19", get: "certDamageTime" },
    { cell: "E20", get: "certDamageArea" },
    { cell: "E21", get: "certDamageContent" },
    { cell: "E22", get: "certCountermeasure" },
    { cell: "E23", get: "certPastResults" }
    // E24（証明者氏名）はフォームに該当項目が無いため空欄のまま
  ],
  "依頼書": [
    { cell: "I2", get: "applicationDate" },
    { cell: "H6", get: "requesterAddress" },
    { cell: "H8", get: "requesterName" },
    { cell: "E15", get: "repWorkerAddress" }, // 被依頼者 = 代表従事者
    { cell: "E16", get: "repWorkerName" },
    { cell: "E17", get: "repWorkerOccupation" },
    { cell: "E18", get: "repWorkerBirthDate" },
    { cell: "E25", get: "requestPeriodStart" },
    { cell: "I25", get: "requestPeriodEnd" },
    { cell: "E26", get: "areaLocation" },
    { cell: "E27", get: "damageStatus" },
    { cell: "E28", get: "requestReason" }
  ],
  "許可伺書": [
    { cell: "D3", get: "applicantAddress" },
    { cell: "D4", get: "applicantNameComposed" },
    { cell: "D5", get: "permitNoFull" },
    { cell: "D12", get: "purpose" },
    { cell: "D13", get: "periodStart" },
    { cell: "G13", get: "periodEnd" },
    { cell: "D14", get: "areaLocation" },
    { cell: "D15", get: "method1" },
    { cell: "E15", get: "method2" },
    { cell: "G15", get: "method3Rest" },
    { cell: "D18", get: "requesterName" }
  ],
  "交付通知書": [
    { cell: "B3", get: "permitDocNo" },      // 札環対許可第N号
    { cell: "B4", get: "permitDate" },
    { cell: "B7", get: "applicantNameSama" }, // 氏名 + 様
    { cell: "B13", get: "notifyBodyText" },   // {申請日和暦}付けで申請のあった…交付します。
    { cell: "C16", get: "repWorkerName" },
    { cell: "D16", get: "othersSuffix" },     // (ほかN名)
    { cell: "C17", get: "permitNoFull" },
    { cell: "D17", get: "certNoRangeText" },  // (許可証番号/従事者証番号 第N-1号～第N-M号)
    { cell: "C24", get: "purpose" },
    { cell: "C25", get: "periodStart" },
    { cell: "F25", get: "periodEnd" },
    { cell: "C26", get: "areaLocation" },
    { cell: "C27", get: "method1" },
    { cell: "D27", get: "method2" },
    { cell: "F27", get: "method3Rest" },
    { cell: "C28", get: "permitConditions" },
    { cell: "B30", get: "trapNoticeText" }    // わな使用時の標識掲示の注意書き
  ],
  "従事者証": [
    { cell: "C4", get: "workerCertNo1" },     // 第N-1号
    { cell: "F4", get: "periodStart" },
    { cell: "F5", get: "periodEnd" },
    { cell: "K14", get: "permitNoFull" },
    { cell: "K17", get: "corporateName" },    // 法人の名称（法人時のみ）
    { cell: "D18", get: "repWorkerAddress" },
    { cell: "D23", get: "repWorkerNameWithOthers" },
    { cell: "D29", get: "repWorkerBirthDate" },
    { cell: "K26", get: "purpose" },
    { cell: "K29", get: "areaLocation" },
    { cell: "K33", get: "method1" },
    { cell: "L33", get: "method2" },
    { cell: "N33", get: "method3Rest" },
    { cell: "K36", get: "permitConditions" }
  ],
  "許可審査表": [
    { cell: "D5", get: "applicantAddress" },
    { cell: "G5", get: "reviewClassText" },   // 1 被害者 / 2 法人等 / 3 依頼を受けた者
    { cell: "D8", get: "applicantName" },
    { cell: "G8", get: "requesterNameLabel" }, // 依頼者あり時 "依頼者氏名："
    { cell: "I8", get: "requesterName" },
    { cell: "D11", get: "repWorkerName" },
    { cell: "E12", get: "othersSuffix" },
    { cell: "D15", get: "speciesNamesJoined" },
    { cell: "G23", get: "speciesDamageText" }, // {種名…}による被害等
    { cell: "D26", get: "periodStart" },
    { cell: "D28", get: "periodEnd" },
    { cell: "E29", get: "periodDaysText" },    // N日間
    { cell: "D30", get: "areaLocation" },
    { cell: "G31", get: "area7CheckText" },    // ☑/□次の区域を含む。【施行規則第7条第1項第7号】
    { cell: "D43", get: "method1" },
    { cell: "D44", get: "method2" },
    { cell: "D45", get: "method3" },
    { cell: "D46", get: "method4Rest" }
  ],
  "許可証個人": [
    { cell: "C3", get: "workerCertNo1" },
    { cell: "H4", get: "periodStart" },
    { cell: "H5", get: "periodEnd" },
    { cell: "G12", get: "applicantAddress" },
    { cell: "G13", get: "applicantNameComposed" },
    { cell: "G14", get: "applicantBirthDate" },
    { cell: "G23", get: "purpose" },
    { cell: "G25", get: "areaLocation" },
    { cell: "G28", get: "method1" },
    { cell: "H28", get: "method2" },
    { cell: "J28", get: "method3Rest" },
    { cell: "G30", get: "disposal1" },
    { cell: "H30", get: "disposal2" },
    { cell: "J30", get: "disposal3Rest" },
    { cell: "G32", get: "permitConditions" }
  ],
  "許可証法人": [
    { cell: "C3", get: "permitNoFull" },
    { cell: "H4", get: "periodStart" },
    { cell: "H5", get: "periodEnd" },
    { cell: "G12", get: "applicantAddress" },
    { cell: "G13", get: "corporateName" },
    { cell: "G23", get: "purpose" },
    { cell: "G25", get: "areaLocation" },
    { cell: "G28", get: "method1" },
    { cell: "H28", get: "method2" },
    { cell: "J28", get: "method3Rest" },
    { cell: "G30", get: "disposal1" },
    { cell: "H30", get: "disposal2" },
    { cell: "J30", get: "disposal3Rest" },
    { cell: "G32", get: "permitConditions" }
  ],
  "振興局宛通知": [
    { cell: "H3", get: "permitDocNo" },
    { cell: "H4", get: "permitDate" },
    { cell: "C13", get: "applicantAddress" },
    { cell: "C14", get: "applicantNameComposed" },
    { cell: "C15", get: "permitNoFull" },
    { cell: "D15", get: "certNoRangePersonal" }, // 個人かつ複数名のとき (許可証番号 第N-1号～…)
    { cell: "C16", get: "repWorkerNameCorp" },   // 法人時のみ代表従事者名
    { cell: "D17", get: "othersSuffixCorp" },
    { cell: "D18", get: "certNoRangeCorp" },     // 法人時 (従事者証番号 第N-1号～…)
    { cell: "C25", get: "purpose" },
    { cell: "C28", get: "periodStart" },
    { cell: "F28", get: "periodEnd" },
    { cell: "C31", get: "areaLocation" },
    { cell: "C34", get: "method1" },
    { cell: "D34", get: "method2" },
    { cell: "F34", get: "method3Rest" }
  ],
  "警察宛通知": [
    { cell: "H3", get: "permitDocNo" },
    { cell: "H4", get: "permitDate" },
    { cell: "C13", get: "applicantAddress" },
    { cell: "C14", get: "applicantNameComposed" },
    { cell: "C15", get: "permitNoFull" },
    { cell: "D15", get: "certNoRangePersonal" },
    { cell: "C16", get: "repWorkerNameCorp" },
    { cell: "D17", get: "othersSuffixCorp" },
    { cell: "D18", get: "certNoRangeCorp" },
    { cell: "C25", get: "purpose" },
    { cell: "C28", get: "periodStart" },
    { cell: "F28", get: "periodEnd" },
    { cell: "C31", get: "areaLocation" },
    { cell: "C34", get: "method1" },
    { cell: "D34", get: "method2" },
    { cell: "F34", get: "method3Rest" }
  ],
  "報告書添付": [
    { cell: "A2", get: "speciesCount" },
    { cell: "O3", get: "permitDate" },
    { cell: "D10", get: "returnReportText" }, // {許可日和暦}付け札環対許可第N号で許可された…報告します。
    { cell: "J16", get: "areaLocation" }
    // G 列以降の捕獲実績は事後入力のため空欄
  ],
  "結果報告書": [
    { cell: "A2", get: "speciesCount" },
    { cell: "O3", get: "permitDate" },
    { cell: "O4", get: "permitNoTail" },  // {許可番号}号
    { cell: "P4", get: "permitNo" },
    { cell: "D10", get: "returnReportText" },
    { cell: "J16", get: "areaLocation" }
    // K3（報告日）・捕獲実績・P 列集計は事後入力のため空欄
  ],
  "わな": [
    { cell: "C2", get: "applicantNameComposed" },
    { cell: "C3", get: "applicantAddress" },
    { cell: "C5", get: "permitDate" },
    { cell: "C6", get: "periodStart" },
    { cell: "E6", get: "periodEnd" }
  ]
};

// シートごとの記入条件（無いシートは常時記入）。m = ドメインモデル。
var CHO_SHEET_CONDITIONS_ = {
  "証明書": function (m) { return m.certOrRequest === "証明書"; },
  "依頼書": function (m) { return m.certOrRequest === "依頼書"; },
  "許可証個人": function (m) { return m.applicantType === "個人"; },
  "許可証法人": function (m) { return m.applicantType === "法人"; },
  "わな": function (m) { return m.hasTrapMethod; }
};

// ----- 種数テーブル（捕獲しようとする鳥獣の種類及び数量の繰り返し行）-----
// cols のキー: name / count / unit / eggLabel("卵") / eggCount / eggUnit("個")
//             name2 / quotaCount / quotaEgg（許可審査表の 1 人あたり数量）
var CHO_SPECIES_TABLES_ = {
  "申請書":     { startRow: 17, maxRows: 6, cols: { name: "E", count: "G", unit: "H", eggLabel: "I", eggCount: "J", eggUnit: "K" } },
  "証明書":     { startRow: 13, maxRows: 6, cols: { name: "E", count: "G", unit: "H", eggLabel: "I", eggCount: "J", eggUnit: "K" } },
  "依頼書":     { startRow: 19, maxRows: 6, cols: { name: "E", count: "G", unit: "H", eggLabel: "I", eggCount: "J", eggUnit: "K" } },
  "許可伺書":   { startRow: 6,  maxRows: 6, cols: { name: "D", count: "E", unit: "F", eggLabel: "G", eggCount: "H", eggUnit: "I" } },
  "交付通知書": { startRow: 18, maxRows: 6, cols: { name: "C", count: "D", unit: "E", eggLabel: "F", eggCount: "G", eggUnit: "H" } },
  "振興局宛通知": { startRow: 19, maxRows: 6, cols: { name: "C", count: "D", unit: "E", eggLabel: "F", eggCount: "G", eggUnit: "H" } },
  "警察宛通知": { startRow: 19, maxRows: 6, cols: { name: "C", count: "D", unit: "E", eggLabel: "F", eggCount: "G", eggUnit: "H" } },
  "従事者証":   { startRow: 20, maxRows: 6, cols: { name: "K", count: "L", unit: "M", eggLabel: "N", eggCount: "O", eggUnit: "P" } },
  "許可証個人": { startRow: 17, maxRows: 6, cols: { name: "G", count: "H", unit: "I", eggLabel: "J", eggCount: "K", eggUnit: "L" } },
  "許可証法人": { startRow: 17, maxRows: 6, cols: { name: "G", count: "H", unit: "I", eggLabel: "J", eggCount: "K", eggUnit: "L" } },
  "許可審査表": { startRow: 17, maxRows: 6, cols: { name: "D", count: "E", eggCount: "F", name2: "G", quotaCount: "H", quotaEgg: "I" } }
};

// ----- 従事者名簿のブロック幾何 -----
// 1 ブロック = 6 行。個人情報・免許列はブロック全体の縦結合（左上 = ブロック先頭行）。
// P 列（捕獲用具）のみ 2 行 × 3 サブスロット（先頭行 +0 / +2 / +4）。
var CHO_ROSTER_COLS_ = {
  certNo: "E", address: "F", name: "G", occupation: "H", birth: "I",
  speciesName: "J", speciesCount: "K", speciesUnit: "L",
  eggLabel: "M", eggCount: "N", eggUnit: "O",
  toolCol: "P", toolSlotOffsets: [0, 2, 4],
  licType: "Q", licAuthority: "R", licNo: "S", licDate: "T",
  regType: "U", regNo: "V", regDate: "W",
  gunPermitNo: "X", gunPermitDate: "Y", gunKind: "Z",
  remarks: "AA"
};
var CHO_ROSTER_LAYOUTS_ = {
  "個人": { sheetName: "従事者名簿",        firstRow: 5, blockHeight: 6, blockCount: 7,  cols: CHO_ROSTER_COLS_ },
  "法人": { sheetName: "従事者名簿 (法人)", firstRow: 5, blockHeight: 6, blockCount: 34, cols: CHO_ROSTER_COLS_ }
};

// テンプレートから削除する入力専用シート
var CHO_SHEETS_TO_DELETE_ = ["Sheet1", "申請内容"];

// 固定文言
var CHO_NOTE_SEE_ROSTER_ = "別添従事者名簿のとおり";
var CHO_TRAP_NOTICE_ = "※　わなを使用する場合は、標識の掲示を必ず行ってください。";
var CHO_AREA7_CHECKED_ = "☑次の区域を含む。【施行規則第7条第1項第7号】";
var CHO_AREA7_UNCHECKED_ = "□次の区域を含む。【施行規則第7条第1項第7号】";
var CHO_REVIEW_CLASS_VICTIM_ = "1　被害者（国・地方公共団体・農協以外の法人・個人）";
var CHO_REVIEW_CLASS_CORP_ = "2　法人等(国・地方公共団体・農協)";
var CHO_REVIEW_CLASS_PROXY_ = "3　被害者又は法人等から依頼を受けた者";
