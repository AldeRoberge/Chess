@echo off
rem Chess XP - one-click Cloudflare deploy setup. The real work is the PowerShell below the marker line.
chcp 65001 >nul
title Chess XP - Cloudflare deploy setup
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$f='%~f0'; $c=[IO.File]::ReadAllText($f,[Text.Encoding]::UTF8); $i=$c.IndexOf('::PSBE'+'GIN::')+11; & ([scriptblock]::Create($c.Substring($i)))"
exit /b %errorlevel%
::PSBEGIN::
$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type @"
using System; using System.Runtime.InteropServices;
public class Vt {
  [DllImport("kernel32.dll")] public static extern IntPtr GetStdHandle(int h);
  [DllImport("kernel32.dll")] public static extern bool GetConsoleMode(IntPtr h, out int m);
  [DllImport("kernel32.dll")] public static extern bool SetConsoleMode(IntPtr h, int m);
}
"@
$hnd = [Vt]::GetStdHandle(-11); $mode = 0
[void][Vt]::GetConsoleMode($hnd, [ref]$mode); [void][Vt]::SetConsoleMode($hnd, ($mode -bor 4))

# ---------- look & feel ----------
$ESC = [char]27
$RST = "$ESC[0m"; $BLD = "$ESC[1m"; $RED = "$ESC[91m"; $GRN = "$ESC[92m"; $YEL = "$ESC[93m"; $BLU = "$ESC[94m"; $MAG = "$ESC[95m"; $CYN = "$ESC[96m"; $DIM = "$ESC[90m"
$HZ = [string][char]0x2500; $VT = [string][char]0x2502
$TL = [string][char]0x256D; $TR = [string][char]0x256E; $BL = [string][char]0x2570; $BR = [string][char]0x256F
$TICK = [string][char]0x2714; $CROSS = [string][char]0x2718
$FRAMES = 0x280B, 0x2819, 0x2839, 0x2838, 0x283C, 0x2834, 0x2826, 0x2827, 0x2807, 0x280F | ForEach-Object { [string][char]$_ }

$Repo = $null
$DefaultAcct = 'e2a5f5d2bbf981db61184e9e31ff3522'   # from the deploy workflow comment; replaced by the real one if different
$Base = 'https://api.cloudflare.com/client/v4'
$TokenUrl = 'https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=' +
  [uri]::EscapeDataString('[{"key":"workers_scripts","type":"edit"},{"key":"workers_routes","type":"edit"},{"key":"zone","type":"read"}]') + '&name=chess-deploy'

function Box([string[]]$lines, [string]$col) {
  $w = ($lines | ForEach-Object { $_.Length } | Measure-Object -Maximum).Maximum
  Write-Host "$col$TL$($HZ * ($w + 4))$TR$RST"
  foreach ($l in $lines) { Write-Host "$col$VT$RST  $l$ESC[$($w + 6)G$col$VT$RST" }
  Write-Host "$col$BL$($HZ * ($w + 4))$BR$RST"
}
function Step($n, $t) { Write-Host ""; Write-Host "$BLU$BLD[$n/4]$RST $BLD$t$RST"; Write-Host "$DIM$($HZ * 60)$RST" }
function Ok($t)   { Write-Host "  $GRN$TICK$RST $t" }
function Note($t) { Write-Host "  $DIM$t$RST" }
function Say($t)  { Write-Host "  $t" }

function Popup([string]$text, [string]$title = 'Chess XP setup', [string]$buttons = 'OK', [string]$icon = 'Information') {
  $col = switch ($icon) { 'Error' { $RED } 'Warning' { $YEL } default { $CYN } }
  $glyph = switch ($icon) { 'Error' { $CROSS } 'Warning' { '!' } default { 'i' } }
  $w = 66
  $lines = New-Object System.Collections.Generic.List[string]
  foreach ($para in ($text -split "`n")) {
    if ($para.Trim() -eq '') { $lines.Add(''); continue }
    $indent = $para.Substring(0, $para.Length - $para.TrimStart().Length)
    $cur = ''
    foreach ($wd in ($para.Trim() -split '\s+')) {
      if ($cur -ne '' -and ($indent.Length + $cur.Length + 1 + $wd.Length) -gt $w) { $lines.Add($indent + $cur); $cur = $wd }
      elseif ($cur -eq '') { $cur = $wd } else { $cur = "$cur $wd" }
    }
    $lines.Add($indent + $cur)
  }
  $hint = switch ($buttons) { 'OKCancel' { '[Enter] Continue    [Esc] Cancel' } 'YesNo' { '[Y] Yes    [N] No' } default { '[Enter] OK' } }
  $top = "$HZ $title " ; $top = $top + ($HZ * [Math]::Max(0, $w + 4 - $top.Length))
  Write-Host ""
  Write-Host "$col$TL$top$TR$RST"
  Write-Host "$col$VT$RST$ESC[$($w + 6)G$col$VT$RST"
  $first = $true
  foreach ($l in $lines) {
    $g = if ($first) { " $col$BLD$glyph$RST " } else { '   ' }
    Write-Host "$col$VT$RST$g$l$ESC[$($w + 6)G$col$VT$RST"
    $first = $false
  }
  Write-Host "$col$VT$RST$ESC[$($w + 6)G$col$VT$RST"
  Write-Host "$col$VT$RST  $BLD$hint$RST$ESC[$($w + 6)G$col$VT$RST"
  Write-Host "$col$BL$($HZ * ($w + 4))$BR$RST"
  while ($true) {
    $k = [Console]::ReadKey($true)
    switch ($buttons) {
      'YesNo'    { if ($k.Key -eq 'Y') { return 'Yes' } if ($k.Key -eq 'N' -or $k.Key -eq 'Escape') { return 'No' } }
      'OKCancel' { if ($k.Key -eq 'Enter') { return 'OK' } if ($k.Key -eq 'Escape') { return 'Cancel' } }
      default    { if ($k.Key -eq 'Enter' -or $k.Key -eq 'Spacebar' -or $k.Key -eq 'Escape') { return 'OK' } }
    }
  }
}

function Spin([string]$text, [scriptblock]$work, [object[]]$jobArgs = @()) {
  $job = Start-Job -ScriptBlock $work -ArgumentList $jobArgs
  $i = 0
  try { [Console]::CursorVisible = $false } catch {}
  while ($job.State -eq 'Running') {
    Write-Host -NoNewline "`r  $CYN$($FRAMES[$i % $FRAMES.Count])$RST $text   "
    $i++; Start-Sleep -Milliseconds 80
  }
  $res = Receive-Job $job -ErrorAction SilentlyContinue
  Remove-Job $job -Force
  Write-Host -NoNewline "`r$(' ' * ($text.Length + 12))`r"
  try { [Console]::CursorVisible = $true } catch {}
  return $res
}

$ApiWork = {
  param($url, $tok)
  try {
    $r = Invoke-RestMethod -Uri $url -Headers @{ Authorization = "Bearer $tok" } -ErrorAction Stop
    [pscustomobject]@{ ok = [bool]$r.success; data = $r.result; err = '' }
  } catch {
    $m = ''
    try { $m = (($_.ErrorDetails.Message | ConvertFrom-Json).errors | ForEach-Object { $_.message }) -join '; ' } catch {}
    if (-not $m) { $m = $_.Exception.Message }
    [pscustomobject]@{ ok = $false; data = $null; err = $m }
  }
}
function Api([string]$text, [string]$url, [string]$tok) { Spin $text $ApiWork @($url, $tok) }

function Read-Token {
  $s = Read-Host "  ${BLD}Paste the token here${RST} ${DIM}(typing is hidden)${RST}" -AsSecureString
  $p = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
  try { return ([Runtime.InteropServices.Marshal]::PtrToStringBSTR($p)).Trim() }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p) }
}

function Fail-Exit([string]$why) {
  Popup "Setup stopped.`n`n$why" 'Chess XP setup' 'OK' 'Error' | Out-Null
  Read-Host "  Press Enter to close" | Out-Null
  exit 1
}

# ---------- banner ----------
Clear-Host
Write-Host ""
Box @('Chess XP  -  automatic deploy setup', 'Publishes the app to alderoberge.com/chess', '', 'Adds two GitHub secrets, then runs the deploy.') $MAG
Write-Host ""
$go = Popup "This will:`n`n  1. check the GitHub CLI and your GitHub login`n  2. open Cloudflare so you can create a deploy token`n  3. check the token has every permission it needs`n  4. save it to GitHub and start the deploy`n`nContinue?" 'Chess XP setup' 'OKCancel' 'Information'
if ($go -ne 'OK') { Write-Host "  Cancelled."; exit 0 }

# ---------- 1. GitHub CLI ----------
Step 1 'GitHub CLI'
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  Say "GitHub CLI not found, installing it with winget..."
  $null = Spin 'Installing GitHub CLI' { winget install --id GitHub.cli -e --accept-source-agreements --accept-package-agreements *> $null; $LASTEXITCODE }
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
  if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { Fail-Exit 'Could not install the GitHub CLI. Install it from https://cli.github.com, then run this again.' }
}
Ok 'GitHub CLI found'

$null = gh auth status 2>$null
if ($LASTEXITCODE -ne 0) {
  Popup "You are not logged in to GitHub.`n`nA browser will open: follow the steps there." 'GitHub login' 'OK' 'Information' | Out-Null
  gh auth login --web --git-protocol https
  $null = gh auth status 2>$null
  if ($LASTEXITCODE -ne 0) { Fail-Exit 'GitHub login did not complete.' }
}
$Repo = (gh repo view --json nameWithOwner -q .nameWithOwner 2>$null)
if (-not $Repo) { Fail-Exit 'Could not work out which GitHub repository this folder belongs to.' }
Ok "Logged in to GitHub  ${DIM}($Repo)${RST}"

# ---------- 2. Cloudflare token (retry until it is right) ----------
Step 2 'Cloudflare API token'
Write-Host ""
Box @('In the Cloudflare page that opens:', '', '1. Sign in if asked.',
      '2. Account policy says "Include Select..." - click the pencil', '   and pick your account (required).',
      '3. Click "Continue to summary", then "Create Token".', '4. Copy the token (it is shown only once).') $CYN
Popup "Cloudflare will open in your browser with the permissions pre-filled.`n`nDon't forget: in the Account policy, click the pencil and select your account.`n`nThen Create Token and copy it." 'Cloudflare token' 'OK' 'Information' | Out-Null
Start-Process $TokenUrl

$acct = $null; $zone = $null; $tok = $null
while ($true) {
  Write-Host ""
  $tok = Read-Token
  $problem = $null

  if (-not $tok) {
    $problem = @{ what = 'Nothing was pasted.'; why = 'The prompt is hidden, so nothing shows while you paste. Right-click in the window to paste.'; fix = 'Paste the token and press Enter.' }
  }
  elseif ($tok -notmatch '^[A-Za-z0-9_-]{40,100}$') {
    $first = $tok.Substring(0, [Math]::Min(10, $tok.Length))
    $problem = @{ what = "This isn't a Cloudflare token (first 10 characters: $first)."
                  why = 'A token is 40+ characters of letters, digits, "-" and "_", with no spaces.'
                  fix = 'Copy the value shown after "Create Token" - not the token name, the account ID, or the "Authorization: Bearer" example line.' }
  }
  else {
    $first = $tok.Substring(0, 10)
    $a = Api 'Asking Cloudflare about this token' "$Base/accounts" $tok
    if (-not $a.ok) {
      $problem = @{ what = "Cloudflare rejected this token (first 10 characters: $first)."
                    why = "Cloudflare said: $($a.err). The token was probably cut off when copying, or was deleted or expired."
                    fix = 'Copy the whole token again (use the copy button next to it), or create a new one.' }
    } else {
      Ok 'Token is valid'
      $ids = @($a.data | ForEach-Object { $_.id })
      $z = Api 'Looking for the alderoberge.com zone' "$Base/zones?name=alderoberge.com" $tok
      if (-not $z.ok) {
        $problem = @{ what = 'The token cannot read zones.'; why = "Cloudflare said: $($z.err). The permission  Zone > Zone > Read  is missing."
                      fix = 'Create the token again from the pre-filled link, or add Zone: Read to this token in Cloudflare (My Profile > API Tokens > Edit).' }
      } elseif (@($z.data).Count -eq 0) {
        $names = ($a.data | ForEach-Object { $_.name }) -join ', '
        $problem = @{ what = 'The token cannot see the alderoberge.com zone.'; why = "It can see these accounts: $names. alderoberge.com is not in them, or Zone Resources does not include it."
                      fix = 'Set Zone Resources to "Include > All zones" (or the alderoberge.com zone) and the Account policy to the account that owns alderoberge.com.' }
      } else {
        $zone = @($z.data)[0].id; $acct = @($z.data)[0].account.id
        Ok "Zone alderoberge.com found  ${DIM}(account $(@($z.data)[0].account.name))${RST}"
        if ($ids -notcontains $acct) {
          $problem = @{ what = 'The token is not allowed on the account that owns alderoberge.com.'; why = "alderoberge.com belongs to account $acct, but the token only sees: $($ids -join ', ')."
                        fix = 'In the Account policy, click the pencil and select the account that owns alderoberge.com.' }
        } else {
          $s = Api 'Checking Workers Scripts permission' "$Base/accounts/$acct/workers/scripts" $tok
          if (-not $s.ok) {
            $problem = @{ what = 'Workers Scripts permission is missing.'; why = "Cloudflare said: $($s.err). The token needs  Account > Workers Scripts > Edit  on that account."
                          fix = 'Create the token again from the pre-filled link, and select your account in the Account policy.' }
          } else {
            Ok 'Workers Scripts permission'
            $rt = Api 'Checking Workers Routes permission' "$Base/zones/$zone/workers/routes" $tok
            if (-not $rt.ok) {
              $problem = @{ what = 'Workers Routes permission is missing.'; why = "Cloudflare said: $($rt.err). This is the permission that made an earlier deploy fail: the app uploaded but could not attach alderoberge.com/chess."
                            fix = 'Add  Zone > Workers Routes > Edit  to the token (zone alderoberge.com or all zones).' }
            } else { Ok 'Workers Routes permission' }
          }
        }
      }
    }
  }

  if (-not $problem) { break }

  Popup "$($problem.what)`n`nWhy: $($problem.why)`n`nFix: $($problem.fix)" 'That did not work' 'OK' 'Warning' | Out-Null
  Write-Host ""
  $ans = Read-Host "  Press Enter to paste the token again, R to reopen the Cloudflare page, or Q to quit"
  if ($ans -match '^[Qq]') { Fail-Exit 'You chose to quit. Nothing was saved to GitHub.' }
  if ($ans -match '^[Rr]') { Start-Process $TokenUrl }
}

if ($acct -ne $DefaultAcct) { Note "Using your Cloudflare account $acct (the workflow comment listed $DefaultAcct)." }
Write-Host ""
Box @('Token has every permission the deploy needs.') $GRN

# ---------- 3. Save secrets ----------
Step 3 'Saving the secrets to GitHub'
$SecretWork = { param($name, $val, $repo) $o = ($val | gh secret set $name -R $repo 2>&1 | Out-String); [pscustomobject]@{ ok = ($LASTEXITCODE -eq 0); out = $o.Trim() } }
foreach ($pair in @(@('CLOUDFLARE_API_TOKEN', $tok), @('CLOUDFLARE_ACCOUNT_ID', $acct))) {
  $r = Spin "Saving $($pair[0])" $SecretWork @($pair[0], $pair[1], $Repo)
  if (-not $r.ok) { Fail-Exit "Could not save $($pair[0]) to GitHub: $($r.out)" }
  Ok "Saved $($pair[0])"
}
$tok = $null

# ---------- 4. Deploy ----------
Step 4 'Deploying'
$since = [DateTimeOffset]::UtcNow.AddSeconds(-20).ToString('o')
$null = gh workflow run deploy.yml --ref main -R $Repo 2>&1
if ($LASTEXITCODE -ne 0) {
  Popup "The secrets are saved, but I could not start the deploy.`n`nRe-run 'Deploy /chess' from the Actions tab." 'Deploy' 'OK' 'Warning' | Out-Null
  Start-Process "https://github.com/$Repo/actions"; exit 0
}
Ok 'Deploy workflow started'
$WatchWork = {
  param($repo, $since)
  $limit = (Get-Date).AddMinutes(8)
  while ((Get-Date) -lt $limit) {
    Start-Sleep -Seconds 5
    $j = gh run list -w deploy.yml -R $repo --limit 3 --json databaseId,status,conclusion,url,createdAt 2>$null | ConvertFrom-Json
    $run = $j | Where-Object { [DateTimeOffset]::Parse($_.createdAt) -ge [DateTimeOffset]::Parse($since) } | Select-Object -First 1
    if ($run -and $run.status -eq 'completed') { return $run }
  }
  [pscustomobject]@{ status = 'timeout'; conclusion = 'timeout'; url = "https://github.com/$repo/actions" }
}
$run = Spin 'Building and deploying (this takes a few minutes)' $WatchWork @($Repo, $since)
Write-Host ""
if ($run.conclusion -eq 'success') {
  Box @('Deployed!', 'https://alderoberge.com/chess') $GRN
  $o = Popup "Deployed!`n`nhttps://alderoberge.com/chess`n`nOpen it now?" 'Chess XP setup' 'YesNo' 'Information'
  if ($o -eq 'Yes') { Start-Process 'https://alderoberge.com/chess' }
} elseif ($run.conclusion -eq 'timeout') {
  Box @('Still running', 'Check progress on the Actions page.') $YEL
  Start-Process $run.url
} else {
  Box @("The deploy finished with: $($run.conclusion)", $run.url) $RED
  $o = Popup "The secrets are saved, but the deploy ended with '$($run.conclusion)'.`n`nOpen the run log to see why?" 'Deploy' 'YesNo' 'Warning'
  if ($o -eq 'Yes') { Start-Process $run.url }
}
Read-Host "`n  Press Enter to close" | Out-Null
exit 0
