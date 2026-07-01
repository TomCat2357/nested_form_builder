/**
 * ===========================================================
 * 対話ダイアログで印刷設定を指定してPDF化するツール (GAS)
 * -----------------------------------------------------------
 * メニュー「PDF出力 → 設定してPDF出力」を実行すると、
 * 用紙 / 縦横 / スケール(%) / 余白 / 対象シート を入力する
 * ダイアログが立ち上がり、その設定でPDFを生成 → 自動ダウンロード。
 *
 * ・スケールは Google の /export が % 非対応のため、
 *   fitToWidth / fitToHeight（○ページに収める）で近似します。
 *   等倍(100%)は「収める指定なし」= 実寸出力です。
 * ・改ページ位置でデータ範囲を分割し、pdf-lib で1つに結合します。
 * ===========================================================
 */

const SKIP_HIDDEN_SHEETS = true;
const CFG_KEY_PREFIX = 'PRINT_CFG_';   // 様式名ごとの設定を保存するキーの接頭辞

/** 汎用デフォルト（様式名が既知プリセットに一致しないとき） */
const GENERIC_DEFAULT = {
  size: 'A4', orientation: 'portrait', scaleMode: 'actual', fitToWidth: false,
  margins: { top: 0.75, bottom: 0.75, left: 0.7, right: 0.7 },
  horizontalCentered: true, gridlines: false,
};

/**
 * 様式名ごとの既定設定。キー = 様式名（シート名の最初の "_" より前）。
 * 一度も保存していない様式は、ここに定義があればそれ、無ければ GENERIC_DEFAULT。
 * margins はインチ。scaleMode:'fit' + fitToWidth:true = 横幅に合わせる。
 * ※ 実際のシート名（様式名）に合わせてキーを編集してください。
 */
const FORM_DEFAULTS = {
  '許可証': {
    size: 'A4', orientation: 'landscape', scaleMode: 'fit', fitToWidth: true,
    margins: { top: 0.4, bottom: 0.4, left: 0.7, right: 0.7 },
    horizontalCentered: true, gridlines: false,
  },
  '従事者名簿': {
    size: 'A4', orientation: 'landscape', scaleMode: 'fit', fitToWidth: true,
    margins: { top: 0.4, bottom: 0.4, left: 0.7, right: 0.7 },
    horizontalCentered: true, gridlines: false,
  },
  '交付通知書': {
    size: 'A4', orientation: 'portrait', scaleMode: 'fit', fitToWidth: true,
    margins: { top: 0.8, bottom: 0.4, left: 1.0, right: 1.0 },
    horizontalCentered: true, gridlines: false,
  },
  '振興局宛通知': {
    size: 'A4', orientation: 'portrait', scaleMode: 'fit', fitToWidth: true,
    margins: { top: 0.8, bottom: 0.4, left: 1.0, right: 1.0 },
    horizontalCentered: true, gridlines: false,
  },
  '警察宛通知': {
    size: 'A4', orientation: 'portrait', scaleMode: 'fit', fitToWidth: true,
    margins: { top: 0.8, bottom: 0.4, left: 1.0, right: 1.0 },
    horizontalCentered: true, gridlines: false,
  },
  '従事者証': {
    size: 'A4', orientation: 'landscape', scaleMode: 'fit', fitToWidth: true,
    margins: { top: 0.7, bottom: 0.4, left: 0.7, right: 0.7 },
    horizontalCentered: true, gridlines: false,
  },
};

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('PDF出力')
    .addItem('設定してPDF出力', 'openPrintDialog')
    .addToUi();
}

// ============================================================
// Web アプリ層（一括・全ページ PDF をダウンロード出力）
// ------------------------------------------------------------
// 元テンプレートにバインドされたこのスクリプトを「ウェブアプリ」として
// デプロイ（実行=自分（USER_DEPLOYING）／アクセス=組織内）すると、URL の
// ?ssId=<コピーID> で対象スプレッドシートを開き、一括 PDF
// （シートごとに1PDF・複数はZIP）をダウンロード出力する。
// 認可はこの1プロジェクトに対して一度きりで、テンプレのコピーごとに
// 発生していた「毎回の権限承認」はなくなる。
// 個別印刷は従来どおりメニュー（onOpen → openPrintDialog → generateSingle）を使う。
// ============================================================

function doGet(e) {
  const ssId = (e && e.parameter && (e.parameter.ssId || e.parameter.id)) || '';
  const t = HtmlService.createTemplateFromFile('BatchDownload');
  t.ssId = ssId;
  let title = '', infos = [], errorMsg = '';
  if (ssId) {
    try {
      const ss = SpreadsheetApp.openById(ssId);
      title = ss.getName();
      infos = listBatchSheetInfos_(ss);
    } catch (ex) {
      errorMsg = 'スプレッドシートを開けませんでした（ID と共有権限を確認してください）: ' + ex;
    }
  } else {
    errorMsg = 'URL に ?ssId=<スプレッドシートID> を付けてアクセスしてください。';
  }
  t.title = title;
  t.sheetInfos = infos;
  t.errorMsg = errorMsg;
  return t.evaluate()
    .setTitle('許可証 一括PDFダウンロード')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** 印刷対象になり得るシート（非表示を除く）の一覧を返す。 */
function listBatchSheetInfos_(ss) {
  return ss.getSheets()
    .filter(function (s) { return !(SKIP_HIDDEN_SHEETS && s.isSheetHidden()); })
    .map(function (s) {
      const n = s.getName();
      return { name: n, form: formNameOf_(n) };
    });
}

/**
 * Web アプリからの一括ダウンロード実行。
 * @param ssId    対象スプレッドシート（テンプレのコピー）の ID
 * @param targets 出力するシート名の配列（チェックされたもの）
 * 戻り値は generateBatch(download) と同じ:
 *   {ok, mode:'download', name, mime, b64, note, succeeded, failed, empty} / {ok:false, error}
 */
async function webGenerateBatch(ssId, targets) {
  try {
    if (!ssId) return { ok: false, error: 'スプレッドシートIDが指定されていません。' };
    const ss = SpreadsheetApp.openById(ssId);
    const token = ScriptApp.getOAuthToken();
    return await generateBatch(targets, 'download', ss, token);
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/** シート名 → 様式名（最初の "_" より前。"_" が無ければシート名そのもの） */
function formNameOf_(sheetName) {
  const i = sheetName.indexOf('_');
  return i >= 0 ? sheetName.slice(0, i) : sheetName;
}

/** 様式名の保存キー */
function cfgKey_(formName) { return CFG_KEY_PREFIX + formName; }

/** 様式名の設定を返す。保存済み→無ければ FORM_DEFAULTS→無ければ GENERIC_DEFAULT */
function loadFormCfg_(formName) {
  try {
    const raw = PropertiesService.getDocumentProperties().getProperty(cfgKey_(formName));
    if (raw) return JSON.parse(raw);
  } catch (e) { Logger.log('loadFormCfg_ 失敗(' + formName + '): ' + e); }
  return FORM_DEFAULTS[formName] || GENERIC_DEFAULT;
}

/** 様式名の設定を保存 */
function saveFormCfg_(formName, cfg) {
  PropertiesService.getDocumentProperties()
    .setProperty(cfgKey_(formName), JSON.stringify(cfg));
  Logger.log('saveFormCfg_ 保存OK(' + formName + '): ' + JSON.stringify(cfg));
}

/** ① 設定ダイアログを開く */
function openPrintDialog() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = ss.getSheets()
    .filter(function (s) { return !(SKIP_HIDDEN_SHEETS && s.isSheetHidden()); });
  const sheetNames = sheets.map(function (s) { return s.getName(); });

  // 一括印刷用: 各シートの様式名と、その様式の現在設定
  const sheetInfos = sheetNames.map(function (n) {
    const form = formNameOf_(n);
    return { name: n, form: form, cfg: loadFormCfg_(form) };
  });

  // 個別印刷用: 今開いているシートと、その様式設定
  const active = ss.getActiveSheet();
  const activeName = active ? active.getName() : (sheetNames[0] || '');
  const activeForm = activeName ? formNameOf_(activeName) : '';
  const activeCfg = activeName ? loadFormCfg_(activeForm) : GENERIC_DEFAULT;

  const t = HtmlService.createTemplateFromFile('PrintDialog');
  t.sheetInfos = sheetInfos;
  t.activeName = activeName;
  t.activeForm = activeForm;
  t.activeCfg = activeCfg;
  SpreadsheetApp.getUi().showModalDialog(
    t.evaluate().setWidth(440).setHeight(640), '印刷設定'
  );
}

/**
 * 1枚のシートを、指定 cfg で PDF 化して状態オブジェクトを返す（改ページ分割→結合）。
 * 戻り値:
 *   成功           : { status: 'ok', blob }
 *   データが空      : { status: 'empty' }
 *   ページ取得失敗  : { status: 'failed' }
 */
async function sheetToPdfBlob_(ss, sheet, cfg, token) {
  const blobs = [];
  const pages = buildPages_(sheet);
  if (!pages.length) return { status: 'empty' };   // データが空
  for (let i = 0; i < pages.length; i++) {
    const url = buildPageExportUrl_(ss.getId(), sheet.getSheetId(), pages[i], cfg);
    const blob = fetchExportWithRetry_(url, token, sheet.getName() + ' p' + (i + 1));
    if (!blob) {
      // 1ページでも取得できなければ、このシートは不完全 → 失敗扱い
      Logger.log('シート不完全のため中止: %s（%s/%s ページ目で失敗）',
        sheet.getName(), (i + 1), pages.length);
      return { status: 'failed' };
    }
    blobs.push(blob);
    Utilities.sleep(120);
  }
  const name = sanitize_(sheet.getName()) + '.pdf';
  const merged = await mergePdfBlobs_(blobs, name);
  return { status: 'ok', blob: merged };
}

/**
 * /export を取得。429/5xx は指数バックオフでリトライ。成功→Blob / 最終失敗→null。
 */
function fetchExportWithRetry_(url, token, label) {
  const maxTry = 4;
  let wait = 800;   // ms（失敗ごとに倍化）
  for (let t = 1; t <= maxTry; t++) {
    let code = 0;
    try {
      const res = UrlFetchApp.fetch(url, {
        headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
      code = res.getResponseCode();
      if (code === 200) return res.getBlob();
    } catch (e) {
      Logger.log('fetch例外 %s (try %s): %s', label, t, e);
    }
    // リトライ対象か（429/500/502/503/504 と例外時）
    const retryable = (code === 0 || code === 429 || (code >= 500 && code <= 504));
    Logger.log('export失敗 %s: HTTP %s (try %s/%s)%s',
      label, code, t, maxTry, retryable && t < maxTry ? ' → リトライ' : '');
    if (!retryable || t === maxTry) break;
    Utilities.sleep(wait);
    wait *= 2;
  }
  return null;
}

/**
 * ② 一括印刷。チェックされた各シートを、その様式名の保存済み設定で個別PDF化。
 * @param targets シート名の配列（チェックされたもの）
 * @param dest    'download' = ブラウザDL（1枚:PDF / 複数:ZIP）
 *                'drive'    = スプレッドシートと同じフォルダ内に「日時フォルダ」を作り各PDFを保存
 * 戻り値（いずれも succeeded/failed/empty を含む）:
 *   download: {ok, mode:'download', name, mime, b64, note, succeeded, failed, empty}
 *   drive   : {ok, mode:'drive', folderName, folderUrl, count, note, succeeded, failed, empty}
 *   全滅時  : {ok:false, error, succeeded, failed, empty}
 *   succeeded = 印刷できたシート名 / failed = ダウンロード失敗 / empty = 空で未出力
 */
async function generateBatch(targets, dest, ssOpt, tokenOpt) {
  try {
    if (!targets || !targets.length) return { ok: false, error: 'シートが選択されていません。' };
    // ssOpt / tokenOpt を渡せば任意のスプレッドシート（テンプレのコピー）に対して実行できる
    // ＝ Web アプリ駆動（webGenerateBatch）で使用。省略時はバインドされたアクティブなシート
    // ＝ メニュー（onOpen → openPrintDialog）からの実行。
    const ss = ssOpt || SpreadsheetApp.getActiveSpreadsheet();
    const token = tokenOpt || ScriptApp.getOAuthToken();
    const want = targets.reduce(function (o, n) { o[n] = true; return o; }, {});

    const pdfBlobs = [];
    const usedNames = {};   // ファイル名の重複回避
    const succeeded = [];   // 印刷できたシート名
    const failed = [];      // ダウンロード（生成）に失敗したシート名
    const empty = [];       // 空で出力されなかったシート名

    // シート順を保ちつつ、選択されたものだけ処理
    for (const sheet of ss.getSheets()) {
      if (SKIP_HIDDEN_SHEETS && sheet.isSheetHidden()) continue;
      if (!want[sheet.getName()]) continue;

      const sname = sheet.getName();
      const cfg = loadFormCfg_(formNameOf_(sname));  // 様式名の設定を使用
      const result = await sheetToPdfBlob_(ss, sheet, cfg, token);
      if (result.status !== 'ok') {
        if (result.status === 'empty') empty.push(sname);
        else failed.push(sname);
        Logger.log('一括: 出力なし（%s）→ %s', result.status, sname);
        continue;
      }
      const blob = result.blob;
      // 同名回避（重複時は連番）
      let base = sanitize_(sname);
      let fname = base + '.pdf';
      let k = 2;
      while (usedNames[fname]) { fname = base + '(' + k + ').pdf'; k++; }
      usedNames[fname] = true;
      blob.setName(fname);
      pdfBlobs.push(blob);
      succeeded.push(sname);
      Logger.log('一括: 追加 %s → %s', sname, fname);
    }

    // 未出力の内訳をラベル付きで組み立て（後方互換のため note に格納）
    const noteParts = [];
    if (failed.length) noteParts.push('ダウンロード失敗: ' + failed.join(', '));
    if (empty.length) noteParts.push('空のため未出力: ' + empty.join(', '));
    const note = noteParts.join(' ／ ');

    if (!pdfBlobs.length) {
      return { ok: false,
        error: '出力対象がありませんでした。' + (note ? '（' + note + '）' : ''),
        succeeded: succeeded, failed: failed, empty: empty };
    }

    // ---- Drive 保存: 同じフォルダ内に日時フォルダを作って各PDFを入れる ----
    if (dest === 'drive') {
      const parent = getSpreadsheetParentFolder_(ss);
      if (!parent) return { ok: false, error: 'スプレッドシートの保存先フォルダを取得できませんでした。',
        succeeded: succeeded, failed: failed, empty: empty };
      const folderName = sanitize_(ss.getName()) + '_' + nowStamp_();
      const folder = parent.createFolder(folderName);
      pdfBlobs.forEach(function (b) { folder.createFile(b); });
      return {
        ok: true, mode: 'drive',
        folderName: folderName, folderUrl: folder.getUrl(),
        count: pdfBlobs.length, note: note,
        succeeded: succeeded, failed: failed, empty: empty,
      };
    }

    // ---- ダウンロード: 1枚はPDF、複数はZIP ----
    if (pdfBlobs.length === 1) {
      const b = pdfBlobs[0];
      return { ok: true, mode: 'download', name: b.getName(), mime: MimeType.PDF,
        b64: Utilities.base64Encode(b.getBytes()), note: note,
        succeeded: succeeded, failed: failed, empty: empty };
    }
    const zip = Utilities.zip(pdfBlobs, sanitize_(ss.getName()) + '.zip');
    return { ok: true, mode: 'download', name: zip.getName(), mime: 'application/zip',
      b64: Utilities.base64Encode(zip.getBytes()), note: note,
      succeeded: succeeded, failed: failed, empty: empty };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/** スプレッドシートが置かれている親フォルダを返す（無ければマイドライブ直下相当のnull） */
function getSpreadsheetParentFolder_(ss) {
  try {
    const file = DriveApp.getFileById(ss.getId());
    const parents = file.getParents();
    if (parents.hasNext()) return parents.next();
    return DriveApp.getRootFolder();
  } catch (e) {
    Logger.log('親フォルダ取得失敗: ' + e);
    return null;
  }
}

/** 日時スタンプ（例 20260701_2230）。スプレッドシートのタイムゾーン基準。 */
function nowStamp_() {
  const tz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone() || 'Asia/Tokyo';
  return Utilities.formatDate(new Date(), tz, 'yyyyMMdd_HHmm');
}

/**
 * ③ 個別印刷。今開いているシートを cfg で1枚PDF化。
 *    設定は様式名キーに保存（＝一括印刷にも反映される）。
 * @param cfg ダイアログの自由設定（size/orientation/scaleMode/fitToWidth/margins/…）
 * 戻り値: {ok, name, mime, b64} / {ok:false, error}
 */
async function generateSingle(cfg) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getActiveSheet();
    if (!sheet) return { ok: false, error: 'アクティブなシートがありません。' };

    const form = formNameOf_(sheet.getName());
    saveFormCfg_(form, cfg);   // 様式名キーに保存（接尾語を除いて共通）

    const token = ScriptApp.getOAuthToken();
    const result = await sheetToPdfBlob_(ss, sheet, cfg, token);
    if (result.status !== 'ok') {
      return { ok: false, error: result.status === 'empty'
        ? '出力できませんでした（データが空です）。'
        : '出力できませんでした（ダウンロードに失敗しました）。' };
    }
    const blob = result.blob;
    return { ok: true, name: blob.getName(), mime: MimeType.PDF,
      b64: Utilities.base64Encode(blob.getBytes()) };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// ---- ページ構築（そのシートの実改ページを使用） ----------------

/** シートの実際の改ページ位置でデータ範囲を分割 */
function buildPages_(sheet) {
  const lastRow = sheet.getLastRow(), lastCol = sheet.getLastColumn();
  if (lastRow < 1 || lastCol < 1) return [];
  const rowBands = toBands_(getRowBreaks_(sheet), lastRow);
  const colBands = toBands_(getColBreaks_(sheet), lastCol);
  const pages = [];
  colBands.forEach(function (cb) {
    rowBands.forEach(function (rb) {
      pages.push({ r1: rb[0] - 1, r2: rb[1], c1: cb[0] - 1, c2: cb[1] });
    });
  });
  return pages;
}

/** 実シートの行改ページ位置(1始まりの最終行)を取得 */
function getRowBreaks_(sheet) {
  try {
    return sheet.getRowBreaks ? sheet.getRowBreaks() : [];
  } catch (e) { return []; }
}
function getColBreaks_(sheet) {
  try { return sheet.getColumnBreaks ? sheet.getColumnBreaks() : []; }
  catch (e) { return []; }
}

function toBands_(breaks, last) {
  const bands = []; let prev = 0;
  (breaks || []).slice().sort(function (a, b) { return a - b; }).forEach(function (b) {
    if (b > prev && b <= last) { bands.push([prev + 1, b]); prev = b; }
  });
  if (prev < last) bands.push([prev + 1, last]);
  if (!bands.length) bands.push([1, last]);
  return bands;
}

// ---- エクスポートURL -------------------------------------------

function buildPageExportUrl_(ssId, gid, p, cfg) {
  const params = {
    format: 'pdf', gid: gid,
    size: cfg.size || 'A4',
    portrait: (cfg.orientation || 'portrait') !== 'landscape',
    gridlines: !!cfg.gridlines,
    printtitle: false, sheetnames: false, pagenumbers: false, fzr: false,
    r1: p.r1, c1: p.c1, r2: p.r2, c2: p.c2,
  };

  // スケール: /export は%不可のため fitTo で近似。等倍は指定しない。
  if (cfg.scaleMode === 'fit') {
    if (cfg.fitToWidth)  params.fitw = true;   // 幅をページに合わせる
    // fitw のみで横1ページに収まる。高さは自然改ページに任せる。
  }

  if (cfg.horizontalCentered) params.horizontal_alignment = 'CENTER';

  const m = cfg.margins || {};
  if (m.top != null) {
    params.top_margin = m.top; params.bottom_margin = m.bottom;
    params.left_margin = m.left; params.right_margin = m.right;
  }

  const q = Object.keys(params)
    .map(function (k) { return k + '=' + encodeURIComponent(params[k]); }).join('&');
  return 'https://docs.google.com/spreadsheets/d/' + ssId + '/export?' + q;
}

// ---- PDF結合 ---------------------------------------------------

let _pdfLibLoaded = false;
/** pdf-lib を一度だけロード（実行内で使い回す）。globalThis.PDFLib に載せる。 */
function ensurePdfLib_() {
  if (_pdfLibLoaded && typeof globalThis.PDFLib !== 'undefined') return;
  const cdn = 'https://cdn.jsdelivr.net/npm/pdf-lib/dist/pdf-lib.min.js';
  const src = UrlFetchApp.fetch(cdn).getContentText()
    .replace(/setTimeout\(.*?,.*?(\d*?)\)/g, 'Utilities.sleep($1);return t();');
  eval(src);
  // eval のローカル束縛をグローバルへ退避（他関数から参照するため）
  if (typeof PDFLib !== 'undefined') globalThis.PDFLib = PDFLib;
  _pdfLibLoaded = true;
}

async function mergePdfBlobs_(pdfBlobs, fileName) {
  ensurePdfLib_();
  const PDFLib = globalThis.PDFLib;
  const merged = await PDFLib.PDFDocument.create();
  for (let i = 0; i < pdfBlobs.length; i++) {
    const doc = await PDFLib.PDFDocument.load(new Uint8Array(pdfBlobs[i].getBytes()));
    const pages = await merged.copyPages(doc, doc.getPageIndices());
    pages.forEach(function (pg) { merged.addPage(pg); });
  }
  const bytes = await merged.save();
  return Utilities.newBlob([...new Int8Array(bytes)], MimeType.PDF, fileName);
}

// ---- ユーティリティ --------------------------------------------

function sanitize_(name) { return name.replace(/[\\\/:*?"<>|]/g, '_'); }