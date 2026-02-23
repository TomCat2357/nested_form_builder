# Google AppSheetスタイル データ管理アプリ デプロイスクリプト (PowerShell版)
# Usage: .\deploy.ps1 [--manifest-override <path>] [-PropertyStore <script|user>] [-BundleOnly] [-h|--help]

param(
    [string]$ManifestOverride = "",
    [ValidateSet("script", "user")]
    [string]$PropertyStore = "script",
    [switch]$BundleOnly,
    [switch]$h,
    [switch]$Help
)

$ErrorActionPreference = "Stop"

function Show-Help {
    @"
Usage: .\deploy.ps1 [options]

Options:
  --manifest-override <path>  指定したJSONファイルで gas/appsscript.json を上書きしてから push/deploy します。
  -PropertyStore <script|user> フォームマッピングの保存先を指定します（既定: script）。
  -BundleOnly                 ビルド＆バンドルのみ実行（clasp push/deploy はスキップ）。credential不要。
  -h, --help                  このヘルプを表示します。
"@
}

if ($h -or $Help) {
    Show-Help
    exit 0
}

if ($BundleOnly) {
    Write-Host "🔧 BundleOnly モード: ビルド＆バンドルのみ実行します（clasp不要）" -ForegroundColor Cyan
} else {
    Write-Host "🚀 Google AppSheetスタイル データ管理アプリのデプロイを開始します..." -ForegroundColor Cyan
}

# 既存デプロイ情報の読み込み
$DeployCacheFile = ".gas-deployment.json"
$ExistingDeploymentId = ""
$ExistingWebAppUrl = ""

if (Test-Path $DeployCacheFile) {
    try {
        $cacheData = Get-Content $DeployCacheFile -Raw | ConvertFrom-Json
        if ($cacheData.deploymentId) {
            $ExistingDeploymentId = $cacheData.deploymentId
        }
        if ($cacheData.webAppUrl) {
            $ExistingWebAppUrl = $cacheData.webAppUrl
        }
    } catch {
        # キャッシュ読み込み失敗は無視
    }
}

# フロントエンドのビルド
Write-Host "🛠 builder をビルド中..." -ForegroundColor Yellow

try {
    Push-Location builder
    npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "npm run build failed" }
} catch {
    Write-Host "❌ builder のビルドに失敗しました" -ForegroundColor Red
    Pop-Location
    exit 1
} finally {
    Pop-Location
}

# GASファイルの結合
Write-Host "🔧 GASファイルを結合中..." -ForegroundColor Yellow
node gas/scripts/bundle.js
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ GASファイルの結合に失敗しました" -ForegroundColor Red
    exit 1
}

# Bundle.gs 内のプロパティ保存先プレースホルダーを置換
$BundleFile = "dist/Bundle.gs"
if (-not (Test-Path $BundleFile)) {
    Write-Host "❌ Bundle.gs が見つかりません: $BundleFile" -ForegroundColor Red
    exit 1
}

$bundleContent = Get-Content $BundleFile -Raw -Encoding UTF8
$modePlaceholder = "__NFB_PROPERTY_STORE_MODE__"
if ($bundleContent.Contains($modePlaceholder)) {
    $bundleContent = $bundleContent -replace [Regex]::Escape($modePlaceholder), $PropertyStore
} else {
    Write-Host "⚠️ プロパティ保存先プレースホルダーが見つかりません。既定値(script)で動作します。" -ForegroundColor Yellow
}
$bundleContent | Set-Content $BundleFile -Encoding UTF8 -NoNewline
Write-Host "🗂 プロパティ保存先: $PropertyStore" -ForegroundColor Green

# デプロイファイルの準備
Write-Host "📄 デプロイファイルを準備中..." -ForegroundColor Yellow

# dist/Index.html が生成されているか確認
if (-not (Test-Path "dist/Index.html")) {
    Write-Host "❌ ビルド成果物 dist/Index.html が見つかりません" -ForegroundColor Red
    exit 1
}

# デプロイ時刻を取得（JST）
$DeployTimestamp = (Get-Date).ToUniversalTime().AddHours(9).ToString("yyyy-MM-dd HH:mm:ss") + " JST"

# <base target="_top"> タグとデプロイ時刻を追加
$indexHtml = Get-Content "dist/Index.html" -Raw -Encoding UTF8

if (-not $indexHtml.Contains('<base target="_top">')) {
    $indexHtml = $indexHtml -replace '<head>', "<head>`n  <base target=""_top"">"
}

$deployMeta = "<meta name=""deploy-time"" content=""$DeployTimestamp"">"
if ($indexHtml -match '<meta name="deploy-time"') {
    $indexHtml = $indexHtml -replace '<meta name="deploy-time".*?>', $deployMeta
} else {
    $indexHtml = $indexHtml -replace '<head>', "<head>`n  $deployMeta"
}

$indexHtml | Set-Content "dist/Index.html" -Encoding UTF8 -NoNewline
Write-Host "📅 デプロイ時刻: $DeployTimestamp" -ForegroundColor Green

# appsscript.json をコピー
$BaseManifest = "gas/appsscript.json"
$TargetManifest = "dist/appsscript.json"

Copy-Item $BaseManifest $TargetManifest -Force
if (-not $?) {
    Write-Host "❌ appsscript.json のコピーに失敗しました" -ForegroundColor Red
    exit 1
}

# マニフェスト上書き処理
if ($ManifestOverride -ne "") {
    if (-not (Test-Path $ManifestOverride)) {
        Write-Host "❌ 指定されたマニフェスト上書きファイル '$ManifestOverride' が見つかりません" -ForegroundColor Red
        exit 1
    }

    try {
        $baseJson = Get-Content $TargetManifest -Raw | ConvertFrom-Json
        $overrideJson = Get-Content $ManifestOverride -Raw | ConvertFrom-Json

        # 簡易マージ（オーバーライドの値で上書き）
        foreach ($prop in $overrideJson.PSObject.Properties) {
            $baseJson | Add-Member -MemberType NoteProperty -Name $prop.Name -Value $prop.Value -Force
        }

        $baseJson | ConvertTo-Json -Depth 10 | Set-Content $TargetManifest -Encoding UTF8
        Write-Host "   ➕ マニフェスト上書き: $ManifestOverride を適用しました" -ForegroundColor Green
    } catch {
        Write-Host "❌ マニフェストの上書き処理に失敗しました" -ForegroundColor Red
        exit 1
    }
}

Write-Host "✅ デプロイファイルの準備が完了しました" -ForegroundColor Green
Write-Host "   - dist/Bundle.gs (GAS結合ファイル)"
Write-Host "   - dist/Index.html (Reactアプリ)"
if ($ManifestOverride -ne "") {
    Write-Host "   - dist/appsscript.json (GAS設定, overrides: $ManifestOverride)"
} else {
    Write-Host "   - dist/appsscript.json (GAS設定)"
}

# BundleOnlyモードの場合はここで終了
if ($BundleOnly) {
    Write-Host ""
    Write-Host "✅ BundleOnly モード: ビルド＆バンドルが完了しました（clasp push/deploy はスキップ）" -ForegroundColor Green
    exit 0
}

# プロジェクトをプッシュ
Write-Host "📤 プロジェクトファイルをGoogle Apps Scriptにプッシュ中..." -ForegroundColor Yellow
clasp push
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ プッシュに失敗しました" -ForegroundColor Red
    exit 1
}
Write-Host "✅ プッシュが完了しました" -ForegroundColor Green

# デプロイ
Write-Host "🌐 Webアプリとしてデプロイ中..." -ForegroundColor Yellow

$version = Get-Date -Format "yyyyMMdd_HHmmss"
$deployArgs = @("deploy", "--description", "Google AppSheetスタイル データ管理アプリ v$version")

if ($ExistingDeploymentId -ne "") {
    $deployArgs += "--deploymentId"
    $deployArgs += $ExistingDeploymentId
}

$DeploymentId = ""
$WebAppUrl = ""

# JSON出力を試行
$deployOutput = & clasp @deployArgs 2>&1 | Out-String

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ デプロイに失敗しました" -ForegroundColor Red
    Write-Host $deployOutput
    exit 1
}

Write-Host "✅ デプロイが完了しました" -ForegroundColor Green
Write-Host $deployOutput

# WebApp URLを出力から抽出
if ($deployOutput -match 'https://script\.google\.com/macros/s/[^\s]+') {
    $WebAppUrl = $Matches[0]
}

# URLからdeploymentIdを抽出
if ($WebAppUrl -match '/macros/s/([^/]+)/') {
    $DeploymentId = $Matches[1]
}

# それでも取れない場合はAKfで始まるIDを探す
if ($DeploymentId -eq "" -and $deployOutput -match 'AKf[A-Za-z0-9_\-]+') {
    $DeploymentId = $Matches[0]
}

# Script IDを取得
$ScriptId = ""
if (Test-Path ".clasp.json") {
    try {
        $claspJson = Get-Content ".clasp.json" -Raw | ConvertFrom-Json
        $ScriptId = $claspJson.scriptId
    } catch {
        # 無視
    }
}

# デプロイメント一覧から取得（IDが取れなかった場合）
if ($DeploymentId -eq "" -and $WebAppUrl -eq "") {
    Write-Host "📋 デプロイメント情報を取得中..." -ForegroundColor Yellow
    $deploymentsOutput = & clasp deployments 2>&1 | Out-String
    if ($deploymentsOutput -match '@HEAD.*?(AKf[A-Za-z0-9_\-]+)') {
        $DeploymentId = $Matches[1]
        $WebAppUrl = "https://script.google.com/macros/s/$DeploymentId/exec"
    }
}

# 結果表示
Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "🌟 Webアプリケーションの情報" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

Write-Host "📅 デプロイ時刻: $DeployTimestamp"

if ($DeploymentId -ne "") {
    Write-Host "🆔 Deployment ID: $DeploymentId"
}

if ($WebAppUrl -ne "") {
    Write-Host ""
    Write-Host "🌐 Web App URL:"
    Write-Host "   $WebAppUrl" -ForegroundColor Green
    Write-Host ""
} elseif ($DeploymentId -ne "") {
    $AdminWebUrl = "https://script.google.com/macros/s/$DeploymentId/exec"
    Write-Host ""
    Write-Host "🌐 Web App URL:"
    Write-Host "   $AdminWebUrl" -ForegroundColor Green
    Write-Host ""
}

if ($ScriptId -ne "") {
    Write-Host "📋 Script ID: $ScriptId"
    $AdminEditUrl = "https://script.google.com/home/projects/$ScriptId/edit"
    Write-Host "⚙️  管理画面: $AdminEditUrl"
}

Write-Host "==========================================" -ForegroundColor Cyan

Write-Host ""
Write-Host "📖 次のステップ:"
Write-Host "1. 管理画面でデプロイ設定を確認"
Write-Host "2. アクセス権限を設定（全員 または 組織内のユーザー）"
Write-Host "3. Web App URLを共有してアプリを使用開始"

# デプロイ情報をキャッシュ
if ($DeploymentId -ne "" -or $WebAppUrl -ne "") {
    $cacheData = @{}
    if ($DeploymentId -ne "") {
        $cacheData["deploymentId"] = $DeploymentId
    }
    if ($WebAppUrl -ne "") {
        $cacheData["webAppUrl"] = $WebAppUrl
    }
    $cacheData | ConvertTo-Json | Set-Content $DeployCacheFile -Encoding UTF8
}

# アクセス権限の警告
if ($WebAppUrl -ne "") {
    try {
        $response = Invoke-WebRequest -Uri $WebAppUrl -Method Head -MaximumRedirection 0 -ErrorAction SilentlyContinue
    } catch {
        $statusCode = $_.Exception.Response.StatusCode.value__
        if ($statusCode -eq 302 -or $statusCode -eq 401) {
            Write-Host "⚠️  Web App が HTTP $statusCode を返しました。公開設定が『全員』になっているか確認してください。" -ForegroundColor Yellow
        }
    }
}

Write-Host ""
Write-Host "🎉 デプロイが正常に完了しました！" -ForegroundColor Green
Write-Host "📚 詳細な使用方法はREADME.mdを参照してください"
