"use strict";

const fs = require("fs");
const path = require("path");
const PptxGenJS = require("pptxgenjs");
const { imageSizingContain } = require("./pptxgenjs_helpers/image");
const {
  warnIfSlideHasOverlaps,
  warnIfSlideElementsOutOfBounds,
} = require("./pptxgenjs_helpers/layout");
const { safeOuterShadow } = require("./pptxgenjs_helpers/util");

const pptx = new PptxGenJS();
pptx.layout = "LAYOUT_WIDE";
pptx.author = "OpenAI Codex";
pptx.company = "Nested Form Builder";
pptx.subject = "Nested Form Builder 初学者向けマニュアル";
pptx.title = "Nested Form Builder かんたん使い方";
pptx.lang = "ja-JP";
pptx.theme = {
  headFontFace: "Yu Gothic",
  bodyFontFace: "Yu Gothic",
  lang: "ja-JP",
};

const COLORS = {
  bg: "F7F8F3",
  surface: "FFFDF9",
  panel: "ECF4EE",
  panelStrong: "D7EADC",
  primary: "2F7D6B",
  primarySoft: "DCEFE5",
  accent: "E18A56",
  accentSoft: "F7E2D2",
  text: "203132",
  subtext: "5D6D70",
  border: "C8D9CD",
  white: "FFFFFF",
};

const FONT = {
  title: "Yu Gothic",
  body: "Yu Gothic",
};

const SLIDE_W = 13.333;
const SLIDE_H = 7.5;
const OUTPUT_FILE = path.join(
  __dirname,
  "nested_form_builder_beginner_manual.pptx"
);
const IMAGES_DIR = path.resolve(__dirname, "..", "user_manual_images");

const image = (name) => {
  const filePath = path.join(IMAGES_DIR, name);
  if (!fs.existsSync(filePath)) {
    throw new Error(`画像が見つかりません: ${filePath}`);
  }
  return filePath;
};

function addBackground(slide, pageNumber) {
  slide.background = { color: COLORS.bg };
  slide.addShape("line", {
    x: 0.75,
    y: 6.95,
    w: 11.75,
    h: 0,
    line: { color: COLORS.border, transparency: 40, pt: 1 },
  });
  slide.addText(String(pageNumber).padStart(2, "0"), {
    x: 12.25,
    y: 6.82,
    w: 0.45,
    h: 0.24,
    fontFace: FONT.body,
    fontSize: 10,
    bold: true,
    color: COLORS.primary,
    align: "right",
    margin: 0,
  });
}

function addHeader(slide, section, title, subtitle) {
  slide.addShape("roundRect", {
    x: 0.78,
    y: 0.48,
    w: 1.45,
    h: 0.34,
    rectRadius: 0.06,
    line: { color: COLORS.primarySoft, transparency: 100 },
    fill: { color: COLORS.primarySoft },
  });
  slide.addText(section, {
    x: 0.9,
    y: 0.56,
    w: 1.2,
    h: 0.15,
    fontFace: FONT.body,
    fontSize: 10,
    bold: true,
    color: COLORS.primary,
    margin: 0,
    align: "center",
  });
  slide.addText(title, {
    x: 0.78,
    y: 0.98,
    w: 6.3,
    h: 0.68,
    fontFace: FONT.title,
    fontSize: 24,
    bold: true,
    color: COLORS.text,
    margin: 0,
  });
  if (subtitle) {
    slide.addText(subtitle, {
      x: 0.8,
      y: 1.72,
      w: 5.95,
      h: 0.28,
      fontFace: FONT.body,
      fontSize: 11.5,
      color: COLORS.subtext,
      margin: 0,
      breakLine: false,
    });
  }
}

function addFooterLabel(slide, text) {
  slide.addText(text, {
    x: 0.82,
    y: 6.83,
    w: 3.8,
    h: 0.18,
    fontFace: FONT.body,
    fontSize: 9.5,
    color: COLORS.subtext,
    margin: 0,
  });
}

function addChip(slide, text, x, y, options = {}) {
  const w = options.w || 1.45;
  slide.addShape("roundRect", {
    x,
    y,
    w,
    h: 0.36,
    rectRadius: 0.06,
    line: {
      color: options.borderColor || COLORS.accentSoft,
      transparency: 100,
    },
    fill: { color: options.fillColor || COLORS.accentSoft },
  });
  slide.addText(text, {
    x: x + 0.08,
    y: y + 0.08,
    w: w - 0.16,
    h: 0.18,
    fontFace: FONT.body,
    fontSize: 10.5,
    bold: true,
    color: options.textColor || COLORS.accent,
    margin: 0,
    align: "center",
  });
}

function addInfoCard(slide, title, body, x, y, w, h, opts = {}) {
  slide.addShape("roundRect", {
    x,
    y,
    w,
    h,
    rectRadius: 0.08,
    line: { color: opts.lineColor || COLORS.border, pt: 1 },
    fill: { color: opts.fillColor || COLORS.surface },
    shadow: safeOuterShadow("9EB9AD", 0.12, 45, 2, 1),
  });
  if (opts.index) {
    slide.addShape("ellipse", {
      x: x + 0.18,
      y: y + 0.18,
      w: 0.32,
      h: 0.32,
      line: { color: COLORS.primary, transparency: 100 },
      fill: { color: COLORS.primary },
    });
    slide.addText(String(opts.index), {
      x: x + 0.18,
      y: y + 0.255,
      w: 0.32,
      h: 0.12,
      fontFace: FONT.body,
      fontSize: 10,
      bold: true,
      color: COLORS.white,
      align: "center",
      margin: 0,
    });
  }
  slide.addText(title, {
    x: x + (opts.index ? 0.6 : 0.24),
    y: y + 0.18,
    w: w - (opts.index ? 0.82 : 0.48),
    h: 0.25,
    fontFace: FONT.body,
    fontSize: 14,
    bold: true,
    color: COLORS.text,
    margin: 0,
  });
  slide.addText(body, {
    x: x + 0.24,
    y: y + 0.54,
    w: w - 0.48,
    h: h - 0.7,
    fontFace: FONT.body,
    fontSize: 11.5,
    color: COLORS.subtext,
    margin: 0,
    valign: "top",
  });
}

function addBulletRows(slide, items, x, y, w, options = {}) {
  const rowGap = options.rowGap || 0.36;
  const bulletColor = options.bulletColor || COLORS.primary;
  const textColor = options.textColor || COLORS.text;
  items.forEach((item, index) => {
    const rowY = y + index * rowGap;
    slide.addShape("ellipse", {
      x,
      y: rowY + 0.075,
      w: 0.14,
      h: 0.14,
      line: { color: bulletColor, transparency: 100 },
      fill: { color: bulletColor },
    });
    slide.addText(item, {
      x: x + 0.22,
      y: rowY,
      w: w - 0.22,
      h: 0.24,
      fontFace: FONT.body,
      fontSize: options.fontSize || 12,
      color: textColor,
      margin: 0,
      breakLine: false,
    });
  });
}

function addScreenshot(slide, imagePath, x, y, w, h, caption) {
  slide.addShape("roundRect", {
    x,
    y,
    w,
    h,
    rectRadius: 0.08,
    line: { color: COLORS.border, pt: 1.2 },
    fill: { color: COLORS.white },
    shadow: safeOuterShadow("8FAE9E", 0.16, 45, 2, 1),
  });
  slide.addImage({
    path: imagePath,
    ...imageSizingContain(imagePath, x + 0.12, y + 0.12, w - 0.24, h - 0.32),
  });
  if (caption) {
    slide.addText(caption, {
      x: x + 0.14,
      y: y + h - 0.18,
      w: w - 0.28,
      h: 0.12,
      fontFace: FONT.body,
      fontSize: 9,
      color: COLORS.subtext,
      margin: 0,
      align: "right",
    });
  }
}

function addFlowStep(slide, num, title, x, y, w) {
  slide.addShape("roundRect", {
    x,
    y,
    w,
    h: 0.62,
    rectRadius: 0.06,
    line: { color: COLORS.border, pt: 1 },
    fill: { color: COLORS.surface },
  });
  slide.addShape("ellipse", {
    x: x + 0.12,
    y: y + 0.12,
    w: 0.36,
    h: 0.36,
    line: { color: COLORS.primary, transparency: 100 },
    fill: { color: COLORS.primary },
  });
  slide.addText(String(num), {
    x: x + 0.12,
    y: y + 0.205,
    w: 0.36,
    h: 0.1,
    fontFace: FONT.body,
    fontSize: 10,
    bold: true,
    color: COLORS.white,
    align: "center",
    margin: 0,
  });
  slide.addText(title, {
    x: x + 0.56,
    y: y + 0.19,
    w: w - 0.68,
    h: 0.16,
    fontFace: FONT.body,
    fontSize: 11,
    bold: true,
    color: COLORS.text,
    margin: 0,
  });
}

function finalizeSlide(slide) {
  warnIfSlideHasOverlaps(slide, pptx);
  warnIfSlideElementsOutOfBounds(slide, pptx);
}

function createSlides() {
  let slide = pptx.addSlide();
  addBackground(slide, 1);
  slide.addShape("roundRect", {
    x: 0.78,
    y: 0.62,
    w: 1.72,
    h: 0.34,
    rectRadius: 0.06,
    line: { color: COLORS.primarySoft, transparency: 100 },
    fill: { color: COLORS.primarySoft },
  });
  slide.addText("BEGINNER GUIDE", {
    x: 0.93,
    y: 0.7,
    w: 1.42,
    h: 0.12,
    fontFace: FONT.body,
    fontSize: 10,
    bold: true,
    color: COLORS.primary,
    margin: 0,
    align: "center",
  });
  slide.addText("Nested Form Builder\nかんたん使い方", {
    x: 0.82,
    y: 1.18,
    w: 4.85,
    h: 1.05,
    fontFace: FONT.title,
    fontSize: 28,
    bold: true,
    color: COLORS.text,
    margin: 0,
    valign: "mid",
  });
  slide.addText(
    "この資料は、初学者が最初の1本を迷わず作れるように、\n「何ができるか」と「どう操作するか」だけに絞ってまとめた入門版です。",
    {
      x: 0.84,
      y: 2.45,
      w: 4.55,
      h: 0.74,
      fontFace: FONT.body,
      fontSize: 12.5,
      color: COLORS.subtext,
      margin: 0,
      valign: "mid",
    }
  );
  addChip(slide, "フォームを作る", 0.84, 3.38, { w: 1.5 });
  addChip(slide, "分岐付きで入力", 2.45, 3.38, { w: 1.68 });
  addChip(slide, "検索・Excel出力", 4.26, 3.38, { w: 1.85 });
  addInfoCard(
    slide,
    "最初に覚える流れ",
    "フォーム管理で新規作成し、質問を足し、プレビューで確認して保存します。作った後は検索画面から新規入力と検索ができます。",
    0.82,
    4.06,
    4.65,
    1.68,
    { fillColor: COLORS.surface }
  );
  addScreenshot(
    slide,
    image("manual_06_form_editor_page.png"),
    6.15,
    0.92,
    6.1,
    5.68,
    "フォーム編集画面"
  );
  addFooterLabel(slide, "Nested Form Builder 初学者向けマニュアル");
  finalizeSlide(slide);

  slide = pptx.addSlide();
  addBackground(slide, 2);
  addHeader(
    slide,
    "全体像",
    "このシステムでできること",
    "大きく分けると、フォーム作成、回答入力、検索・管理の3つです。"
  );
  addInfoCard(
    slide,
    "1. フォームを作る",
    "テキスト、日付、数値、ラジオ、チェックボックスなどを組み合わせて入力フォームを作成できます。",
    0.8,
    2.2,
    3.4,
    1.24,
    { fillColor: COLORS.surface, index: 1 }
  );
  addInfoCard(
    slide,
    "2. 分岐も作れる",
    "選択肢ごとに子質問を追加できるので、「その他のときだけ詳細入力」のような分岐も作れます。",
    0.8,
    3.58,
    3.4,
    1.34,
    { fillColor: COLORS.surface, index: 2 }
  );
  addInfoCard(
    slide,
    "3. 入力後に活用する",
    "保存したレコードは一覧表示、検索、編集、削除、Excel出力まで行えます。",
    0.8,
    5.06,
    3.4,
    1.18,
    { fillColor: COLORS.surface, index: 3 }
  );
  addScreenshot(
    slide,
    image("manual_01_main_page.png"),
    4.58,
    2.08,
    7.95,
    3.7,
    "フォーム一覧"
  );
  addFlowStep(slide, 1, "フォーム一覧", 4.58, 6.05, 1.53);
  addFlowStep(slide, 2, "フォーム管理", 6.18, 6.05, 1.66);
  addFlowStep(slide, 3, "フォーム編集", 7.91, 6.05, 1.6);
  addFlowStep(slide, 4, "入力", 9.58, 6.05, 1.15);
  addFlowStep(slide, 5, "検索", 10.8, 6.05, 1.15);
  addFooterLabel(slide, "入口から入力・検索までを1つの画面群で扱えます");
  finalizeSlide(slide);

  slide = pptx.addSlide();
  addBackground(slide, 3);
  addHeader(
    slide,
    "入口",
    "最初はここから始めます",
    "フォーム一覧は、このシステムのスタート地点です。"
  );
  addScreenshot(
    slide,
    image("manual_01_main_page.png"),
    0.82,
    2.1,
    6.25,
    3.7,
    "フォーム一覧画面"
  );
  addInfoCard(
    slide,
    "見方のポイント",
    "右側のカードを押すと、そのフォームの検索画面へ移動します。左側のメニューから設定とフォーム管理へ入れます。",
    7.32,
    2.16,
    4.95,
    1.45,
    { fillColor: COLORS.surface }
  );
  addBulletRows(
    slide,
    [
      "公開中のフォームはカードで並びます",
      "カードを開くと、そのフォームのデータ検索へ進みます",
      "新しいフォームがまだないときは「フォーム管理」を押します",
    ],
    7.56,
    3.98,
    4.4,
    { rowGap: 0.54, fontSize: 12.2 }
  );
  addChip(slide, "入口はいつもここ", 7.52, 5.88, { w: 1.76 });
  addChip(slide, "迷ったら左メニュー", 9.45, 5.88, {
    w: 2.06,
    fillColor: COLORS.primarySoft,
    textColor: COLORS.primary,
  });
  addFooterLabel(slide, "カードを開くと検索、フォーム管理を開くと作成・編集です");
  finalizeSlide(slide);

  slide = pptx.addSlide();
  addBackground(slide, 4);
  addHeader(
    slide,
    "作成",
    "新しいフォームを作る",
    "初心者が最初に押すボタンは「新規作成」です。"
  );
  addScreenshot(
    slide,
    image("tutorial_01_form_list.png"),
    0.82,
    2.12,
    5.25,
    3.75,
    "フォーム管理から新規作成"
  );
  addScreenshot(
    slide,
    image("tutorial_02_new_form_editor.png"),
    6.38,
    2.12,
    5.95,
    3.75,
    "新規フォーム編集画面"
  );
  addInfoCard(
    slide,
    "最初に入力する内容",
    "フォーム名と説明を入れ、必要ならGoogle Drive保存先や回答保存先スプレッドシートを設定します。仲間で共有するなら共有フォルダURLと共有スプレッドシートURLを入れます。",
    0.82,
    6.02,
    11.5,
    0.78,
    { fillColor: COLORS.surface }
  );
  addFooterLabel(slide, "作成の入口は「フォーム管理」→「新規作成」");
  finalizeSlide(slide);

  slide = pptx.addSlide();
  addBackground(slide, 5);
  addHeader(
    slide,
    "共有",
    "仲間のフォームはインポートして使います",
    "フォーム一覧は利用者ごとに分かれるため、共有されたGoogle DriveのURLを各自の一覧へ取り込みます。"
  );
  addScreenshot(
    slide,
    image("manual_04_form_management_page.png"),
    0.82,
    2.12,
    7.12,
    1.9,
    "フォーム管理からインポート"
  );
  addScreenshot(
    slide,
    image("manual_05_import_dialog.png"),
    8.18,
    2.12,
    4.1,
    2.28,
    "Google Drive URLを入力"
  );
  addInfoCard(
    slide,
    "1. 渡す側",
    "フォーム定義JSONのファイルURLかフォルダURLを仲間へ渡し、回答保存先のスプレッドシートも共有します。",
    0.82,
    4.5,
    3.7,
    1.58,
    { fillColor: COLORS.surface }
  );
  addInfoCard(
    slide,
    "2. 受け取る側",
    "「フォーム管理」→「インポート」を押し、共有されたファイルURLまたはフォルダURLを貼って取り込みます。",
    4.72,
    4.5,
    3.7,
    1.58,
    { fillColor: COLORS.surface }
  );
  addInfoCard(
    slide,
    "3. 取り込み後",
    "フォーム編集で「Spreadsheet ID / URL」と「Sheet Name」を確認します。空欄なら共有スプレッドシートURLを入れて保存します。",
    8.62,
    4.5,
    3.66,
    1.58,
    { fillColor: COLORS.panel }
  );
  addChip(slide, "ファイルURL: 1フォーム", 0.82, 6.34, {
    w: 2.18,
    fillColor: COLORS.primarySoft,
    textColor: COLORS.primary,
  });
  addChip(slide, "フォルダURL: 一括取込", 3.18, 6.34, { w: 2.18 });
  addChip(slide, "同じフォームIDは自動スキップ", 5.54, 6.34, {
    w: 2.64,
    fillColor: COLORS.primarySoft,
    textColor: COLORS.primary,
  });
  addChip(slide, "スプレッドシート権限も必要", 8.44, 6.34, {
    w: 2.84,
  });
  addFooterLabel(slide, "インポートにはGoogle DriveのファイルURLかフォルダURLを使います");
  finalizeSlide(slide);

  slide = pptx.addSlide();
  addBackground(slide, 6);
  addHeader(
    slide,
    "作成",
    "質問はカードで組み立てます",
    "質問1つごとにカードを編集し、必要なら次の質問を追加していきます。"
  );
  addScreenshot(
    slide,
    image("tutorial_06_q1_soudan_name.png"),
    0.82,
    2.08,
    5.25,
    3.55,
    ""
  );
  addScreenshot(
    slide,
    image("tutorial_12_all_6_questions.png"),
    6.35,
    2.08,
    5.95,
    3.55,
    ""
  );
  addBulletRows(
    slide,
    [
      "項目名: 入力画面に表示されるラベルです",
      "タイプ: テキスト、日付、ラジオなどの入力形式です",
      "必須: 未入力では保存できない質問にします",
      "表示: 検索結果に出したい項目をONにします",
    ],
    0.92,
    5.78,
    11.15,
    { rowGap: 0.27, fontSize: 11.2 }
  );
  addFooterLabel(slide, "質問はカード単位で考えると分かりやすくなります");
  finalizeSlide(slide);

  slide = pptx.addSlide();
  addBackground(slide, 7);
  addHeader(
    slide,
    "分岐",
    "条件分岐も直感的に作れます",
    "「その他を選んだら詳細入力」のような分岐は、選択肢ごとの子質問で作ります。"
  );
  addScreenshot(
    slide,
    image("tutorial_07_radio_type.png"),
    0.82,
    2.12,
    5.35,
    3.72,
    "ラジオやチェックボックスを選ぶ"
  );
  addScreenshot(
    slide,
    image("manual_09_question_card_nested.png"),
    6.42,
    2.12,
    5.86,
    3.72,
    "選択肢ごとに子質問を追加"
  );
  addInfoCard(
    slide,
    "作り方の流れ",
    "1. タイプをラジオ・チェックボックス・ドロップダウンのいずれかにする\n2. 選択肢を追加する\n3. 必要な選択肢の「子質問追加」を押す",
    0.82,
    6.02,
    7.2,
    0.72,
    { fillColor: COLORS.surface }
  );
  addChip(slide, "分岐は選択肢から作る", 8.28, 6.2, {
    w: 2.2,
    fillColor: COLORS.primarySoft,
    textColor: COLORS.primary,
  });
  addChip(slide, "子質問も普通の質問と同じ", 10.64, 6.2, {
    w: 2.06,
  });
  addFooterLabel(slide, "入力者に必要な項目だけ見せたいときに便利です");
  finalizeSlide(slide);

  slide = pptx.addSlide();
  addBackground(slide, 8);
  addHeader(
    slide,
    "確認",
    "保存前にプレビューで見え方を確認",
    "入力画面の見た目と、検索結果に何が出るかを保存前に確認できます。"
  );
  addScreenshot(
    slide,
    image("manual_10_preview_page.png"),
    0.82,
    2.08,
    7.3,
    4.1,
    "入力画面プレビュー"
  );
  addInfoCard(
    slide,
    "見るポイント",
    "質問名の分かりやすさ、入力欄の見え方、表示ONにした項目が検索プレビューに出ているかを確認します。",
    8.42,
    2.22,
    3.86,
    1.34,
    { fillColor: COLORS.surface }
  );
  addBulletRows(
    slide,
    [
      "保存前でも完成形に近い見た目で確認できます",
      "No. とIDの表示有無もここで見られます",
      "表示崩れや項目名の重複に気づきやすくなります",
    ],
    8.6,
    3.96,
    3.45,
    { rowGap: 0.48, fontSize: 11.4 }
  );
  addFooterLabel(slide, "迷ったら、保存前に必ず1回プレビューを見るのがおすすめです");
  finalizeSlide(slide);

  slide = pptx.addSlide();
  addBackground(slide, 9);
  addHeader(
    slide,
    "入力",
    "回答の登録と編集も同じ流れです",
    "作ったフォームは、検索画面から新規入力を押して使います。"
  );
  addScreenshot(
    slide,
    image("manual_13_form_input_page.png"),
    0.82,
    2.08,
    7.28,
    4.18,
    "フォーム入力画面"
  );
  addInfoCard(
    slide,
    "入力画面でできること",
    "新規登録だけでなく、既存レコードの閲覧・編集や、既存レコードからコピーした新規作成もできます。",
    8.42,
    2.2,
    3.84,
    1.42,
    { fillColor: COLORS.surface }
  );
  addBulletRows(
    slide,
    [
      "保存: 入力内容を保存します",
      "キャンセル: 編集前の状態へ戻します",
      "既存レコードからコピー: 似た内容を流用できます",
      "目次: 長いフォームでも移動しやすくなります",
    ],
    8.58,
    4.0,
    3.5,
    { rowGap: 0.42, fontSize: 11.6 }
  );
  addFooterLabel(slide, "フォームを作った後は「新規入力」で実際に使い始めます");
  finalizeSlide(slide);

  slide = pptx.addSlide();
  addBackground(slide, 10);
  addHeader(
    slide,
    "検索",
    "保存したデータは検索して活用します",
    "一覧から開く、探す、削除する、Excelに出力する、までを1画面で行えます。"
  );
  addScreenshot(
    slide,
    image("manual_12_search_page.png"),
    0.82,
    2.08,
    7.25,
    4.1,
    "検索画面"
  );
  addInfoCard(
    slide,
    "よく使う操作",
    "新規入力、更新、削除、検索結果を出力、一覧行のクリックによる詳細表示が中心です。",
    8.42,
    2.18,
    3.84,
    1.2,
    { fillColor: COLORS.surface }
  );
  addInfoCard(
    slide,
    "検索例",
    "山田\n相談者名:山田\n受付日>=2026/03/01",
    8.42,
    3.62,
    3.84,
    1.42,
    { fillColor: COLORS.panel }
  );
  addChip(slide, "単純検索も条件検索もOK", 8.56, 5.34, {
    w: 2.32,
    fillColor: COLORS.primarySoft,
    textColor: COLORS.primary,
  });
  addChip(slide, "Excel出力もここから", 11.0, 5.34, {
    w: 1.65,
  });
  addFooterLabel(slide, "作成した後は、検索画面が日常的に使う中心画面になります");
  finalizeSlide(slide);

  slide = pptx.addSlide();
  addBackground(slide, 11);
  addHeader(
    slide,
    "まとめ",
    "最短で使い始めるなら、この順番です",
    "最初の1本は完璧さより、流れを1回通すことを優先すると理解しやすくなります。"
  );
  addInfoCard(
    slide,
    "作成も共有取込も、この5ステップ",
    "1. フォーム管理を開く\n2. 新規作成またはインポート\n3. 保存先と質問内容を確認する\n4. プレビューで見え方を確認する\n5. 保存して、新規入力と検索を試す",
    0.82,
    2.18,
    5.45,
    2.18,
    { fillColor: COLORS.surface }
  );
  addInfoCard(
    slide,
    "最初に覚えるボタン",
    "新規作成 / インポート / 保存 / プレビュー / 新規入力 / 更新 / 検索結果を出力",
    0.82,
    4.62,
    5.45,
    1.22,
    { fillColor: COLORS.panel }
  );
  addInfoCard(
    slide,
    "困ったときの見直しポイント",
    "フォーム名が空欄ではないか、項目名が重複していないか、保存先URLや権限に問題がないかを確認します。",
    0.82,
    6.0,
    5.45,
    0.68,
    { fillColor: COLORS.surface }
  );
  addFlowStep(slide, 1, "フォーム管理", 6.72, 2.34, 1.98);
  addFlowStep(slide, 2, "作成/取込", 8.84, 2.34, 1.7);
  addFlowStep(slide, 3, "確認", 10.68, 2.34, 1.32);
  addFlowStep(slide, 4, "保存", 7.72, 3.26, 1.42);
  addFlowStep(slide, 5, "入力と検索", 9.28, 3.26, 2.08);
  addScreenshot(
    slide,
    image("manual_04_form_management_page.png"),
    6.72,
    4.2,
    5.56,
    2.16,
    "フォーム管理のイメージ"
  );
  addFooterLabel(slide, "作成でも取込でも、1件入力と1回検索まで試せば流れがつかめます");
  finalizeSlide(slide);
}

async function main() {
  createSlides();
  await pptx.writeFile({ fileName: OUTPUT_FILE });
  console.log(`PPTXを出力しました: ${OUTPUT_FILE}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
