// =============================================================================
// domain.gs — payload からドメインモデル（mapping.gs の get キー全部入り）を組み立てる
//
// Cho_buildModel_(payload) が返すモデルのうち、シート静的マップが参照するキーは
// すべてフラットな文字列/数値/Date。加えて:
//   speciesList   : [{ name, count, unit, eggCount }]      … 種数テーブル用
//   rosterEntries : [{ certNo, includePersonal, worker, method }] … 名簿ブロック用
//   warnings      : string[]                                … 応答ページに表示
// =============================================================================

function Cho_buildModel_(payload) {
  var record = (payload && payload.record) || {};
  var split = Cho_splitParentAndChildren_(record.items || []);
  var idx = Cho_indexItems_(split.parentItems);
  var warnings = [];

  // ----- 従事者（子レコード） -----
  var workers = [];
  for (var i = 0; i < split.children.length; i++) {
    workers.push(Cho_parseWorker_(Cho_indexItems_(split.children[i].items)));
  }
  if (workers.length === 0) {
    warnings.push("従事者情報の子レコードが届いていません（フォームの「従事者情報」参照で includeChildData を有効にしてください）。");
  }
  var repWorker = null;
  for (var r = 0; r < workers.length; r++) {
    if (workers[r].isRep) { repWorker = workers[r]; break; }
  }
  if (!repWorker && workers.length > 0) repWorker = workers[0];
  var workerCount = workers.length;

  // ----- 申請者 -----
  var applicantType = idx.get(CHO_L_APPLICANT_ + "/" + CHO_L_APPLICANT_TYPE_); // 個人 / 法人
  var pBase = CHO_L_APPLICANT_ + "/" + CHO_L_APPLICANT_TYPE_ + "/個人/";
  var cBase = CHO_L_APPLICANT_ + "/" + CHO_L_APPLICANT_TYPE_ + "/法人/";
  var corporateName = idx.get(cBase + "法人名及び代表者名");
  var applicantName;
  var applicantAddress;
  var applicantOccupation = "";
  var applicantBirthDate = "";
  if (applicantType === "法人") {
    applicantName = corporateName;
    applicantAddress = idx.get(cBase + "申請者住所");
  } else {
    // substitution（代表的個人から自動抽出）優先、空なら代表従事者から補完
    applicantName = idx.get(pBase + "氏名") || (repWorker ? repWorker.name : "");
    applicantAddress = idx.get(pBase + "住所") || (repWorker ? repWorker.address : "");
    applicantOccupation = idx.get(pBase + "職業") || (repWorker ? repWorker.occupation : "");
    applicantBirthDate = Cho_toDateOrText_(idx.get(pBase + "生年月日")) || (repWorker ? repWorker.birth : "");
  }
  var othersSuffix = workerCount > 1 ? "(ほか" + (workerCount - 1) + "名)" : "";
  var applicantNameComposed = applicantType === "法人" ? corporateName : (applicantName + othersSuffix);

  // ----- 種数（申請全体） -----
  var speciesList = [];
  var speciesNames = Cho_splitChecks_(idx.get(CHO_L_PARENT_SPECIES_));
  for (var s = 0; s < speciesNames.length; s++) {
    var sp = speciesNames[s];
    var base = CHO_L_PARENT_SPECIES_ + "/" + sp + "/";
    // 鳥類は「捕獲羽数」、獣類は「捕獲頭数」（フォーム定義どおり両方引く）
    var count = Cho_toNumberOrText_(idx.get(base + "捕獲羽数"));
    if (count === "") count = Cho_toNumberOrText_(idx.get(base + "捕獲頭数"));
    var egg = Cho_toNumberOrText_(idx.get(base + "採取卵数"));
    var name = CHO_SPECIES_NAME_MAP_[sp] || sp;
    speciesList.push({
      name: name,
      count: count,
      unit: CHO_SPECIES_UNIT_[sp] || CHO_SPECIES_UNIT_[name] || "頭",
      eggCount: egg
    });
  }
  var speciesNamesJoined = [];
  for (var sn = 0; sn < speciesList.length; sn++) speciesNamesJoined.push(speciesList[sn].name);
  speciesNamesJoined = speciesNamesJoined.join(" ");

  // ----- 目的・期間・区域 -----
  var purpose = idx.get(CHO_L_PURPOSE_);
  var periodStart = Cho_toDateOrText_(idx.get(CHO_L_PERIOD_ + "/開始"));
  var periodEnd = Cho_toDateOrText_(idx.get(CHO_L_PERIOD_ + "/終了"));
  var periodDaysText = "";
  if (periodStart instanceof Date && periodEnd instanceof Date) {
    periodDaysText = Math.round((periodEnd.getTime() - periodStart.getTime()) / 86400000 + 1) + "日間";
  }
  var areaLocation = idx.get(CHO_L_AREA_ + "/所在地");
  var area7Path = CHO_L_AREA_ + "/" + CHO_L_AREA7_;
  var area7Selected = Cho_splitChecks_(idx.get(area7Path));
  var area7Flag = area7Selected.length > 0 ? "該当あり" : "該当なし";
  var area7Parts = [];
  for (var a = 0; a < area7Selected.length; a++) {
    var opt = area7Selected[a];
    var detailName = idx.get(area7Path + "/" + opt + "/具体的名称");
    area7Parts.push(detailName ? opt + "（" + detailName + "）" : opt);
  }
  var area7Detail = area7Parts.join("、");

  // ----- 方法・処置（申請全体） -----
  var methodsRaw = Cho_splitChecks_(idx.get(CHO_L_PARENT_METHOD_));
  var methods = [];
  for (var mi = 0; mi < methodsRaw.length; mi++) {
    methods.push(CHO_TOOL_NAME_[methodsRaw[mi]] || methodsRaw[mi]);
  }
  var hasTrapMethod = methodsRaw.indexOf("はこわな") !== -1 || methodsRaw.indexOf("くくりわな") !== -1;
  var disposalsRaw = Cho_splitChecks_(idx.get(CHO_L_DISPOSAL_));
  var disposals = [];
  for (var di = 0; di < disposalsRaw.length; di++) {
    var dv = CHO_DISPOSAL_MAP_[disposalsRaw[di]] || disposalsRaw[di];
    if (disposals.indexOf(dv) === -1) disposals.push(dv); // 廃棄+埋設 → 埋設・廃棄 の重複排除
  }

  // ----- 証明書 / 依頼書 -----
  var certOrRequest = idx.get(CHO_L_CERT_OR_REQ_); // 証明書 / 依頼書
  var certBase = CHO_L_CERT_OR_REQ_ + "/証明書/";
  var reqBase = CHO_L_CERT_OR_REQ_ + "/依頼書/";
  var requesterName = idx.get(reqBase + "依頼者氏名");
  var requestPeriodStart = Cho_toDateOrText_(idx.get(reqBase + CHO_L_PERIOD_ + "/開始"));
  var requestPeriodEnd = Cho_toDateOrText_(idx.get(reqBase + CHO_L_PERIOD_ + "/終了"));
  if (requestPeriodStart === "") requestPeriodStart = periodStart;
  if (requestPeriodEnd === "") requestPeriodEnd = periodEnd;

  // ----- 許可処分情報 -----
  var permitNo = idx.get(CHO_L_PERMIT_GROUP_ + "/許可番号");
  var permitDate = Cho_toDateOrText_(idx.get(CHO_L_PERMIT_GROUP_ + "/許可年月日"));
  var permitConditions = idx.get(CHO_L_PERMIT_GROUP_ + "/処分の種類/条件付き許可/許可条件");
  var permitNoFull = permitNo ? "第" + permitNo + "号" : "";
  var permitDocNo = permitNo ? "札環対許可第" + permitNo + "号" : "";
  var workerCertNo1 = permitNo ? "第" + permitNo + "-1号" : "";
  var permitNoTail = permitNo ? permitNo + "号" : "";

  // ----- 合成テキスト -----
  var applicationDate = Cho_toDateOrText_(String(payload.generatedAt || "").slice(0, 10));
  var notifyBodyText = Cho_formatWareki_(applicationDate) +
    "付けで申請のあった鳥獣の捕獲等又は鳥類の卵の採取等（及び従事者証の交付）について、" +
    "次のとおり許可し、別添許可証（及び従事者証）を交付します。";
  var returnReportText = "";
  if (permitDate !== "" && permitDocNo) {
    returnReportText = Cho_formatWareki_(permitDate) + "付け" + permitDocNo +
      "で許可された鳥獣の捕獲等又は鳥類の卵の採取等に係る許可証（及び従事者証）を別添のとおり返納するとともに、" +
      "捕獲等又は採取等の結果を次のとおり報告します。";
  }
  var certNoRangeText = "";
  if (permitNo && workerCount > 1) {
    var rangePrefix = applicantType === "法人" ? "従事者証番号" : "許可証番号";
    certNoRangeText = "(" + rangePrefix + "　第" + permitNo + "-1号～第" + permitNo + "-" + workerCount + "号)";
  }
  var certNoRangePersonal = applicantType === "個人" ? certNoRangeText : "";
  var certNoRangeCorp = "";
  if (applicantType === "法人" && permitNo) {
    certNoRangeCorp = workerCount > 1
      ? "(従事者証番号　第" + permitNo + "-1号～第" + permitNo + "-" + workerCount + "号)"
      : "(従事者証番号　第" + permitNo + "-1号)";
  }
  var reviewClassText = certOrRequest === "依頼書"
    ? CHO_REVIEW_CLASS_PROXY_
    : (applicantType === "法人" ? CHO_REVIEW_CLASS_CORP_ : CHO_REVIEW_CLASS_VICTIM_);

  // 別添従事者名簿のとおり（該当する従事者がいるときのみ）
  var hasAnyLicense = false;
  var hasAnyRegistration = false;
  var hasAnyGunPermit = false;
  for (var w = 0; w < workers.length; w++) {
    for (var wm = 0; wm < workers[w].methods.length; wm++) {
      var meth = workers[w].methods[wm];
      if (meth.lic) hasAnyLicense = true;
      if (meth.reg) hasAnyRegistration = true;
      if (meth.poss) hasAnyGunPermit = true;
    }
  }

  // ----- 名簿エントリ展開（従事者 × 捕獲方法） -----
  var rosterEntries = Cho_expandRosterEntries_(workers, permitNo);

  var model = {
    warnings: warnings,
    workers: workers,
    rosterEntries: rosterEntries,
    speciesList: speciesList,

    applicationDate: applicationDate,
    applicantType: applicantType,
    certOrRequest: certOrRequest,
    applicantAddress: applicantAddress,
    applicantName: applicantName,
    applicantNameComposed: applicantNameComposed,
    applicantNameSama: applicantName ? applicantName + "　様" : "",
    applicantOccupation: applicantType === "法人" ? "" : applicantOccupation,
    applicantBirthDate: applicantType === "法人" ? "" : applicantBirthDate,
    corporateName: corporateName,
    workerCount: workerCount,
    othersSuffix: othersSuffix,
    othersSuffixCorp: applicantType === "法人" ? othersSuffix : "",

    repWorkerName: repWorker ? repWorker.name : "",
    repWorkerNameCorp: applicantType === "法人" && repWorker ? repWorker.name : "",
    repWorkerNameWithOthers: repWorker ? repWorker.name + othersSuffix : "",
    repWorkerAddress: repWorker ? repWorker.address : "",
    repWorkerOccupation: repWorker ? repWorker.occupation : "",
    repWorkerBirthDate: repWorker ? repWorker.birth : "",

    speciesCount: speciesList.length > 0 ? speciesList.length : "",
    speciesNamesJoined: speciesNamesJoined,
    speciesDamageText: speciesNamesJoined ? speciesNamesJoined + "による被害等" : "",

    purpose: purpose,
    periodStart: periodStart,
    periodEnd: periodEnd,
    periodDaysText: periodDaysText,
    areaLocation: areaLocation,
    area7Flag: area7Flag,
    area7Detail: area7Detail,
    area7CheckText: area7Selected.length > 0 ? CHO_AREA7_CHECKED_ : CHO_AREA7_UNCHECKED_,

    method1: methods[0] || "",
    method2: methods[1] || "",
    method3: methods[2] || "",
    method3Rest: methods.slice(2).join("、"),
    method4Rest: methods.slice(3).join("、"),
    disposal1: disposals[0] || "",
    disposal2: disposals[1] || "",
    disposal3: disposals[2] || "",
    disposal3Rest: disposals.slice(2).join("、"),
    disposal4: disposals[3] || "",
    hasTrapMethod: hasTrapMethod,
    trapNoticeText: hasTrapMethod ? CHO_TRAP_NOTICE_ : "",

    licenseNote: hasAnyLicense ? CHO_NOTE_SEE_ROSTER_ : "",
    registrationNote: hasAnyRegistration ? CHO_NOTE_SEE_ROSTER_ : "",
    gunPermitNote: hasAnyGunPermit ? CHO_NOTE_SEE_ROSTER_ : "",

    certDamageTime: idx.get(certBase + "被害発生の時期"),
    certDamageArea: idx.get(certBase + "被害発生区域（場所）"),
    certDamageContent: idx.get(certBase + "被害の内容"),
    certCountermeasure: idx.get(certBase + "被害防除対策の実施内容及び実施効果"),
    certPastResults: idx.get(certBase + "過去数年間の捕獲実績"),

    requesterAddress: idx.get(reqBase + "依頼者住所"),
    requesterName: requesterName,
    requesterNameLabel: requesterName ? "依頼者氏名：" : "",
    damageStatus: idx.get(reqBase + "被害状況"),
    requestReason: idx.get(reqBase + "依頼した理由"),
    requestPeriodStart: requestPeriodStart,
    requestPeriodEnd: requestPeriodEnd,

    permitNo: permitNo,
    permitNoFull: permitNoFull,
    permitNoTail: permitNoTail,
    permitDocNo: permitDocNo,
    permitDate: permitDate,
    permitConditions: permitConditions,
    workerCertNo1: workerCertNo1,
    certNoRangeText: certNoRangeText,
    certNoRangePersonal: certNoRangePersonal,
    certNoRangeCorp: certNoRangeCorp,
    notifyBodyText: notifyBodyText,
    returnReportText: returnReportText,
    reviewClassText: reviewClassText,

    remarks: idx.get(CHO_L_REMARKS_)
  };
  return model;
}

// ----- 従事者 1 名のモデル化 -----
// idx は子フォーム内パスで索引化済みの items 索引。
function Cho_parseWorker_(idx) {
  var M = CHO_L_CHILD_METHOD_;
  var worker = {
    name: idx.get("氏名"),
    address: idx.get("住所"),
    occupation: idx.get("職業"),
    birth: Cho_toDateOrText_(idx.get("生年月日")),
    isRep: idx.get(CHO_L_REP_) === "はい",
    species: [],
    methods: []
  };

  // 従事者ごとの種数（子フォームは鳥類でも「捕獲頭数」ラベル）
  var spNames = Cho_splitChecks_(idx.get(CHO_L_CHILD_SPECIES_));
  for (var s = 0; s < spNames.length; s++) {
    var sp = spNames[s];
    var base = CHO_L_CHILD_SPECIES_ + "/" + sp + "/";
    var name = CHO_SPECIES_NAME_MAP_[sp] || sp;
    worker.species.push({
      name: name,
      count: Cho_toNumberOrText_(idx.get(base + "捕獲頭数")),
      unit: CHO_SPECIES_UNIT_[sp] || CHO_SPECIES_UNIT_[name] || "頭",
      eggCount: Cho_toNumberOrText_(idx.get(base + "採取卵数"))
    });
  }

  // 狩猟者登録（各方法分岐の配下に同型で存在）
  function parseReg(branchBase, licType) {
    if (idx.get(branchBase + "/狩猟者登録/登録の有無") !== "あり") return null;
    return {
      type: licType,
      no: idx.get(branchBase + "/狩猟者登録/登録の有無/あり/番号"),
      date: Cho_toDateOrText_(idx.get(branchBase + "/狩猟者登録/登録の有無/あり/交付年月日"))
    };
  }

  var selected = Cho_splitChecks_(idx.get(M));
  for (var i = 0; i < selected.length; i++) {
    var kind = selected[i];
    var b = M + "/" + kind;
    if (kind === "手捕り") {
      worker.methods.push({ kind: kind, tools: ["手捕り"], lic: null, reg: null, poss: null, gunKind: "" });
    } else if (kind === "わな猟") {
      var trapTools = Cho_splitChecks_(idx.get(b + "/わなの種類"));
      var tools = [];
      for (var t = 0; t < trapTools.length; t++) tools.push(CHO_TOOL_NAME_[trapTools[t]] || trapTools[t]);
      var lic = null;
      if (idx.get(b + "/免許の必要性") === "必要") {
        var lb = b + "/免許の必要性/必要/免許情報";
        lic = {
          type: CHO_LICENSE_TYPE_[kind],
          authority: idx.get(lb + "/許可権者"),
          no: idx.get(lb + "/許可番号"),
          date: Cho_toDateOrText_(idx.get(lb + "/交付年月日"))
        };
      }
      worker.methods.push({
        kind: kind, tools: tools.length ? tools : ["わな"],
        lic: lic, reg: parseReg(b, CHO_LICENSE_TYPE_[kind]), poss: null, gunKind: ""
      });
    } else if (kind === "網猟") {
      worker.methods.push({
        kind: kind, tools: [CHO_TOOL_NAME_["網猟"]],
        lic: {
          type: CHO_LICENSE_TYPE_[kind],
          authority: idx.get(b + "/免許情報/許可権者"),
          no: idx.get(b + "/免許情報/許可番号"),
          date: Cho_toDateOrText_(idx.get(b + "/免許情報/交付年月日"))
        },
        reg: parseReg(b, CHO_LICENSE_TYPE_[kind]), poss: null, gunKind: ""
      });
    } else if (kind === "空気銃") {
      worker.methods.push({
        kind: kind, tools: [CHO_TOOL_NAME_["空気銃"]],
        lic: {
          type: CHO_LICENSE_TYPE_[kind],
          authority: idx.get(b + "/第二種銃猟免許/許可権者"),
          no: idx.get(b + "/第二種銃猟免許/許可番号"),
          date: Cho_toDateOrText_(idx.get(b + "/第二種銃猟免許/交付年月日"))
        },
        reg: parseReg(b, CHO_LICENSE_TYPE_[kind]),
        poss: {
          no: idx.get(b + "/所持許可/所持許可証番号"),
          date: Cho_toDateOrText_(idx.get(b + "/所持許可/交付年月日"))
        },
        gunKind: "空気銃"
      });
    } else if (kind === "散弾銃・ライフル銃") {
      // 銃 1 丁 = 1 エントリ（所持許可は銃ごとに別番号・別交付年月日のため）。
      // 第一種銃猟免許・狩猟者登録は同値を各エントリへ持たせ、Z 列（鉄砲の種類）で区別する。
      var firstLic = {
        type: CHO_LICENSE_TYPE_[kind],
        authority: idx.get(b + "/第一種銃猟免許/許可権者"),
        no: idx.get(b + "/第一種銃猟免許/許可番号"),
        date: Cho_toDateOrText_(idx.get(b + "/第一種銃猟免許/交付年月日"))
      };
      var firstReg = parseReg(b, CHO_LICENSE_TYPE_[kind]);
      var guns = Cho_splitChecks_(idx.get(b + "/鉄砲の種類"));
      if (guns.length === 0) guns = [""];
      for (var g = 0; g < guns.length; g++) {
        var gun = guns[g];
        var possBase = b + "/鉄砲の種類/" + gun + "/所持許可";
        worker.methods.push({
          kind: kind,
          tools: [gun ? (CHO_TOOL_NAME_[gun] || gun) : "銃"],
          lic: firstLic,
          reg: firstReg,
          poss: gun ? {
            no: idx.get(possBase + "/所持許可証番号"),
            date: Cho_toDateOrText_(idx.get(possBase + "/交付年月日"))
          } : null,
          gunKind: gun
        });
      }
    } else {
      worker.methods.push({ kind: kind, tools: [kind], lic: null, reg: null, poss: null, gunKind: "" });
    }
  }
  return worker;
}

// ----- 名簿エントリ展開（従事者 × 捕獲方法 → 1 エントリ = 名簿 1 ブロック） -----
// 2 エントリ目以降は個人欄（住所/氏名/職業/生年月日/従事者証番号）と種数欄を空欄にする
// （数量の二重計上防止。捕獲方法に関係ない欄は空白でよい、というユーザー方針）。
function Cho_expandRosterEntries_(workers, permitNo) {
  var entries = [];
  for (var w = 0; w < workers.length; w++) {
    var worker = workers[w];
    var methods = worker.methods.length > 0
      ? worker.methods
      : [{ kind: "", tools: [], lic: null, reg: null, poss: null, gunKind: "" }];
    for (var m = 0; m < methods.length; m++) {
      entries.push({
        includePersonal: m === 0,
        certNo: m === 0 && permitNo ? "第" + permitNo + "-" + (w + 1) + "号" : "",
        worker: worker,
        method: methods[m]
      });
    }
  }
  return entries;
}
