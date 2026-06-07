// テストモード（-TestMode で公開した匿名アクセス可能なデプロイ）に対して、
// 「フォーム新規作成 → 保存 → 実 Drive 到達を別コンテキストで検証 → 後片付け（Drive 削除）」を回す E2E。
//
// 実 Google Drive（デプロイしたオーナーの Drive）にフォームを作成・削除するため、
// 誤爆防止に PLAYWRIGHT_ALLOW_WRITE=1 のときだけ実行する。未設定なら理由を表示して何もしない。
//
// 前提（docs/claude/testing.md の「テストモードでの保存系 E2E」を参照）:
//   - ./deploy.ps1 -TestMode で公開（executeAs=USER_DEPLOYING / access=ANYONE_ANONYMOUS）。
//   - PropertyStore=script（既定）で、NFB_ADMIN_KEY / NFB_ADMIN_EMAIL は未設定（匿名を管理者にするため）。
//   - 初回はオーナーがブラウザで一度開き OAuth スコープを承認済みであること。

const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const {
  DEFAULT_TIMEOUT_MS,
  resolveAppUrl,
  buildRouteUrl,
  getAppSurface,
  expectNoGoogleLogin,
  waitForAppReady,
} = require("./playwright-helpers.js");

const ALLOW_WRITE = process.env.PLAYWRIGHT_ALLOW_WRITE === "1";
const LOCAL_ID_PREFIX = "local_"; // builder/src/core/ids.js の LOCAL_ID_PREFIX と一致させること
const UPLOAD_TIMEOUT_MS = Number(process.env.PLAYWRIGHT_UPLOAD_TIMEOUT_MS || 60000);

function uniqueTitle() {
  const rand = Math.floor(Math.random() * 1e9).toString(36);
  return `__pw_test_${Date.now()}_${rand}`;
}

async function openFormList(page, appUrl) {
  await page.goto(buildRouteUrl(appUrl, "/admin/forms"), {
    waitUntil: "domcontentloaded",
    timeout: DEFAULT_TIMEOUT_MS,
  });
  await page.waitForTimeout(2500);
  await expectNoGoogleLogin(page);
  const surface = await getAppSurface(page);
  await waitForAppReady(surface);
  return surface;
}

// 「+ 新規フォーム」ボタンの出現＝匿名ユーザーが管理者として一覧に入れたことの確認。
async function ensureAdminFormList(surface, page) {
  const newBtn = surface.getByRole("button", { name: "+ 新規フォーム" });
  const deadline = Date.now() + DEFAULT_TIMEOUT_MS;
  while (Date.now() < deadline && !(await newBtn.count())) {
    await page.waitForTimeout(500);
  }
  assert.ok(
    await newBtn.count(),
    "管理フォーム一覧（『+ 新規フォーム』ボタン）が表示されません。\n" +
      "  テスト用デプロイで匿名ユーザーが管理者になっていない可能性があります。\n" +
      "  条件: ./deploy.ps1 -TestMode（PropertyStore=script 既定）/ NFB_ADMIN_KEY・NFB_ADMIN_EMAIL が未設定。",
  );
  return newBtn;
}

// 一覧から、指定タイトルの行の フォームID（.admin-form-id ボタンのテキスト）を返す。無ければ ""。
async function readFormIdByTitle(surface, title) {
  const row = surface.locator("tr.admin-row").filter({ hasText: title }).first();
  if (!(await row.count())) return "";
  const idBtn = row.locator(".admin-form-id").first();
  if (!(await idBtn.count())) return "";
  return String(await idBtn.innerText()).trim();
}

// オフラインファースト保存のバックグラウンドアップロード完了（local_ → 実 fileId 確定）を、
// 同一ページ上でライブに待つ（リロードしてアップロードを中断しないため）。
async function waitForRealFormIdLive(page, title) {
  const deadline = Date.now() + UPLOAD_TIMEOUT_MS;
  let lastId = "";
  while (Date.now() < deadline) {
    const surface = await getAppSurface(page);
    lastId = await readFormIdByTitle(surface, title);
    if (lastId && !lastId.startsWith(LOCAL_ID_PREFIX)) return lastId;
    await page.waitForTimeout(1500);
  }
  return lastId;
}

async function createFormAndGetId(page, appUrl, title) {
  const surface = await openFormList(page, appUrl);
  const newBtn = await ensureAdminFormList(surface, page);

  await newBtn.first().click();
  await page.waitForTimeout(1500);
  const editor = await getAppSurface(page);
  await waitForAppReady(editor);

  const nameInput = editor.getByPlaceholder("フォーム名");
  await nameInput.waitFor({ state: "visible", timeout: DEFAULT_TIMEOUT_MS });
  await nameInput.fill(title);

  // フィールド 0（質問なし）でも保存は成立する（FormBuilderWorkspace の各バリデーションは空スキーマを通す）。
  const saveBtn = editor.getByRole("button", { name: "保存" }).first();
  await saveBtn.click();

  // 保存後は一覧へ戻る（navigateBack）。SPA 遷移なのでリロードせずライブに実IDの確定を待つ。
  const fileId = await waitForRealFormIdLive(page, title);
  assert.ok(
    fileId && !fileId.startsWith(LOCAL_ID_PREFIX),
    `保存したフォームが実 fileId に確定しませんでした（id=${fileId || "(見つからず)"}）。\n` +
      "  Google Drive へのアップロードが失敗している可能性があります（OAuth スコープ未承認 / executeAs 設定 / ネットワーク）。",
  );
  return fileId;
}

// 別コンテキスト（IndexedDB 空）で一覧を開き、タイトルの存否が期待どおりになるまで待つ。
// IndexedDB キャッシュではなく実際に Drive→GAS 経由で読めた／消えたことの証明に使う。
async function awaitPresenceInFreshContext(browser, appUrl, title, shouldExist) {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const deadline = Date.now() + DEFAULT_TIMEOUT_MS * 2;
    let found = false;
    while (Date.now() < deadline) {
      const surface = await openFormList(page, appUrl);
      await ensureAdminFormList(surface, page);
      found = !!(await readFormIdByTitle(surface, title));
      if (found === shouldExist) return found;
      await page.waitForTimeout(2000);
    }
    return found;
  } finally {
    await context.close();
  }
}

// 実 Drive からの削除。一覧の「リンク解除」はマッピングのみ解除しファイル本体を残すため、
// 後片付けには nfbDeleteForm（gas/formsPublicApi の登録解除＋ファイル trash）を直接呼ぶ。
async function deleteFormFromDrive(surface, fileId) {
  return surface.evaluate(
    (id) =>
      new Promise((resolve, reject) => {
        const g = window.google;
        if (!(g && g.script && g.script.run)) {
          reject(new Error("google.script.run が利用できません（GAS コンテナ外）"));
          return;
        }
        g.script.run
          .withSuccessHandler((res) => resolve(res))
          .withFailureHandler((err) => reject(new Error(String((err && err.message) || err))))
          .nfbDeleteForm(id);
      }),
    fileId,
  );
}

async function run() {
  if (!ALLOW_WRITE) {
    console.log("[Playwright:save] PLAYWRIGHT_ALLOW_WRITE=1 が未設定のためスキップします。");
    console.log("  このテストは実 Google Drive にフォームを作成・削除します。実行するには:");
    console.log('    PowerShell: $env:PLAYWRIGHT_ALLOW_WRITE = "1"; npm run test:playwright:save');
    return;
  }

  const appUrl = resolveAppUrl();
  assert.ok(appUrl, "PLAYWRIGHT_APP_URL も deployment 情報も見つからないため検証を開始できません");
  console.log(`[Playwright:save] target: ${appUrl}`);

  const title = uniqueTitle();
  console.log(`[Playwright:save] test form title: ${title}`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  let fileId = "";
  let cleaned = false;

  try {
    // 1. 作成 → 保存 → 実 fileId 確定（同コンテキスト）。
    fileId = await createFormAndGetId(page, appUrl, title);
    console.log(`[Playwright:save] created & uploaded, fileId=${fileId}`);

    // 2. 別コンテキスト（キャッシュ空）の一覧に現れる＝実際に Drive へ到達した証明。
    const present = await awaitPresenceInFreshContext(browser, appUrl, title, true);
    assert.ok(
      present,
      "別コンテキスト（キャッシュ空）の一覧に保存フォームが現れません＝Drive へ到達していない可能性があります",
    );
    console.log("[Playwright:save] persistence verified in a fresh context");

    // 3. 後片付け（実 Drive から削除）。
    const surface = await getAppSurface(page);
    await deleteFormFromDrive(surface, fileId);
    cleaned = true;
    console.log("[Playwright:save] cleanup: nfbDeleteForm done");

    // 4. 後片付けの確認（best-effort）。別コンテキストで消えていること。
    const goneEventually = !(await awaitPresenceInFreshContext(browser, appUrl, title, false));
    if (goneEventually) {
      console.log("[Playwright:save] cleanup verified (form no longer listed)");
    } else {
      console.warn("[Playwright:save] 警告: 削除後も一覧に残っています（GAS 側キャッシュの可能性）。手動確認を推奨。");
    }

    console.log("[Playwright:save] form create/save/persist/cleanup passed");
  } finally {
    // 異常終了時の保険: 実 fileId を掴めていてまだ消していなければ削除を試みる。
    if (fileId && !fileId.startsWith(LOCAL_ID_PREFIX) && !cleaned) {
      try {
        const surface = await getAppSurface(page);
        await deleteFormFromDrive(surface, fileId);
        console.log(`[Playwright:save] cleanup (finally): deleted ${fileId}`);
      } catch (cleanupErr) {
        console.warn(
          `[Playwright:save] cleanup (finally) 失敗。手動削除してください: title=${title} id=${fileId}\n  ${cleanupErr && cleanupErr.message}`,
        );
      }
    }
    await browser.close();
  }
}

run().catch((error) => {
  console.error("[Playwright:save] failed:", error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
