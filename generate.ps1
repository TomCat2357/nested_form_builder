<#
目的:
- 「環境共生担当課_苦情・通報等一覧 - 入力.csv」の **1〜11行目(ヘッダー/定義行)** をそのまま保持
- **12行目以降**に、同じ列数(418列)の “適当データ” を **10000件** 生成して出力

使い方:
  pwsh .\gen-10000.ps1 -InputPath ".\環境共生担当課_苦情・通報等一覧 - 入力.csv" -OutputPath ".\generated_10000.csv" -Count 10000
#>

param(
  [Parameter(Mandatory=$true)]
  [string]$InputPath,

  [Parameter(Mandatory=$true)]
  [string]$OutputPath,

  [int]$Count = 10000
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $InputPath)) {
  throw "InputPath not found: $InputPath"
}

# 元CSVを全行読み込み（BOM付きUTF-8でもOK）
$lines = Get-Content -LiteralPath $InputPath -Encoding UTF8
if ($lines.Count -lt 12) {
  throw "入力CSVは最低でも12行必要です（1〜11行ヘッダー + 12行目以降データ）。"
}

# 1〜11行目はそのまま出力
$headerLines = $lines[0..10]

# 12行目（最初のデータ行）をテンプレとして使う
$templateLine = $lines[11]
$templateCols = $templateLine.Split(',')
$colCount = $templateCols.Count

# 1行目の列数と一致しているか軽くチェック（厳密にはテンプレ基準で生成）
$headerColCount = $headerLines[0].Split(',').Count
if ($headerColCount -ne $colCount) {
  throw "列数不一致: header=$headerColCount, template=$colCount"
}

function New-RowId {
  # それっぽい形式: r_<GUID32>_<GUID8>
  $g1 = ([guid]::NewGuid().ToString("N")).ToUpper()
  $g2 = ([guid]::NewGuid().ToString("N").Substring(0,8))
  return "r_${g1}_${g2}"
}

# 生成開始
$sb = New-Object System.Text.StringBuilder

# ヘッダー(1〜11行目)を書き込み
foreach ($h in $headerLines) {
  [void]$sb.AppendLine($h)
}

# 乱数（固定seedにしたければここで指定）
$rng = New-Object System.Random

# 現在時刻を基準に epoch ms を作る
$now = Get-Date

for ($i = 1; $i -le $Count; $i++) {
  # テンプレをコピー
  $cols = [string[]]::new($colCount)
  [Array]::Copy($templateCols, $cols, $colCount)

  # 適当な時刻（過去0〜30日、0〜23:59）
  $daysBack = $rng.Next(0, 31)
  $minsBack = $rng.Next(0, 24*60)
  $dt = $now.AddDays(-$daysBack).AddMinutes(-$minsBack)

  # Unix epoch milliseconds
  $epoch = [DateTimeOffset]$dt
  $createdAt = [int64]$epoch.ToUnixTimeMilliseconds()
  $modifiedAt = $createdAt + $rng.Next(0, 600000) # 最大+10分くらい適当に

  # 主要列を差し替え（列名は1行目に対応、indexは0-based）
  # 0:id, 1:No., 2:createdAt, 3:modifiedAt, 4:deletedAt, 5:createdBy, 6:modifiedBy, 7:deletedBy, 8:受付日, 9:受付時間
  $cols[0] = New-RowId
  $cols[1] = $i.ToString()
  $cols[2] = $createdAt.ToString()
  $cols[3] = $modifiedAt.ToString()

  # 削除系は空にしておく（適当データ）
  $cols[4] = ""   # deletedAt
  $cols[7] = ""   # deletedBy

  # メールは固定（適当でOK）
  $cols[5] = "test@example.com"
  $cols[6] = "test@example.com"

  # 受付日/時間
  $cols[8] = $dt.ToString("yyyy/MM/dd")
  $cols[9] = $dt.ToString("HH:mm")

  # 問合せ元など、テンプレの "aaa" が入ってる箇所があれば適当に置換（任意）
  # ※「aaa」を見つけた最初の1箇所だけ差し替え
  for ($k = 0; $k -lt $colCount; $k++) {
    if ($cols[$k] -eq "aaa") {
      $cols[$k] = "ダミー内容$i"
      break
    }
  }

  # CSV行として出力（元データがクォートなしなので、ここもクォートなし）
  [void]$sb.AppendLine(($cols -join ","))
}

# UTF-8 BOM で保存（元ファイル互換に寄せる）
$utf8Bom = New-Object System.Text.UTF8Encoding($true)
[System.IO.File]::WriteAllText($OutputPath, $sb.ToString(), $utf8Bom)

Write-Host "OK: generated $Count rows -> $OutputPath"
Write-Host "  header lines: 11"
Write-Host "  columns: $colCount"
