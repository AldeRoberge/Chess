<#
  One-shot setup: Cloudflare Worker key proxy for OpenAI + ElevenLabs (alderoberge.com/chess/api/*).

  Prereqs: node/npm. Wrangler runs through npx. A Cloudflare account with alderoberge.com on it.
  Usage (from the repo root):
      powershell -ExecutionPolicy Bypass -File scripts/setup-cloudflare-proxy.ps1 [-SkipDeploy] [-BaseUrl https://alderoberge.com/chess]

  What it does (idempotent, safe to re-run):
    1. wrangler login if needed
    2. Creates the KEYS KV namespace and writes its id into wrangler.jsonc (skips if already set)
    3. Builds and deploys the worker (npm run build, wrangler deploy)
    4. Stores ADMIN_PASSPHRASE as a worker secret (typed hidden; leave blank to generate one)
    5. Uploads your OpenAI / ElevenLabs keys into KV through PUT /chess/api/keys
       (hidden prompts; leave one blank to keep what is already stored)
    6. Checks GET /chess/api/status

  Keys never touch disk or the repo, and never reach the browser.
#>
param(
  [string] $BaseUrl = "https://alderoberge.com/chess",
  [switch] $SkipDeploy
)
# Continue (not Stop): Windows PowerShell 5.1 turns native stderr output into terminating errors under Stop.
# Native failures are checked through $LASTEXITCODE instead.
$ErrorActionPreference = "Continue"
function Step($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }
function Plain([securestring]$s) { [System.Net.NetworkCredential]::new("", $s).Password }
function Wr { & npx --yes wrangler @args; if ($LASTEXITCODE -ne 0) { throw "wrangler $($args -join ' ') failed" } }

if (-not (Get-Command npx -ErrorAction SilentlyContinue)) { throw "Missing 'npx' (install Node.js)." }
Set-Location (git rev-parse --show-toplevel)
$cfg = Join-Path (Get-Location) "wrangler.jsonc"
if (-not (Test-Path $cfg)) { throw "wrangler.jsonc not found." }

Step "Cloudflare login"
Write-Host "(first run downloads wrangler, this can take a minute)"
$who = (npx --yes wrangler whoami 2>&1 | Out-String)
Write-Host $who
if ($who -match "not authenticated|You are not|Not logged|error") {
  Write-Host "Opening the browser to log in. Approve it there, then come back (Ctrl+C to abort)." -ForegroundColor Yellow
  Wr login
}

Step "KV namespace KEYS"
$text = Get-Content $cfg -Raw
if ($text -match "REPLACE_WITH_KV_NAMESPACE_ID") {
  $id = $null
  $out = (npx --yes wrangler kv namespace create KEYS 2>&1 | Out-String)
  if ($out -match '"id":\s*"([0-9a-f]{32})"') { $id = $Matches[1] }
  else {
    Write-Host "Create did not return an id (already exists?). Looking it up..."
    $list = (npx --yes wrangler kv namespace list 2>$null | Out-String) | ConvertFrom-Json
    $id = ($list | Where-Object { $_.title -eq "KEYS" -or $_.title -like "*-KEYS" } | Select-Object -First 1).id
  }
  if (-not $id) { throw "Could not get the KV namespace id.`n$out" }
  [IO.File]::WriteAllText($cfg, ($text -replace "REPLACE_WITH_KV_NAMESPACE_ID", $id), (New-Object Text.UTF8Encoding($false)))
  Write-Host "wrangler.jsonc updated with KV id $id (commit it)."
} else { Write-Host "KV id already set in wrangler.jsonc." }

if (-not $SkipDeploy) {
  Step "Build + deploy"
  npm run build; if ($LASTEXITCODE -ne 0) { throw "npm run build failed" }
  Wr deploy
}

Step "Admin passphrase"
$pass = Plain (Read-Host "ADMIN_PASSPHRASE (blank = generate)" -AsSecureString)
if (-not $pass) {
  $bytes = New-Object byte[] 24
  $rng = New-Object Security.Cryptography.RNGCryptoServiceProvider; $rng.GetBytes($bytes)
  $pass = [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+","-").Replace("/","_")
  Write-Host "Generated passphrase (save it in your password manager): $pass" -ForegroundColor Yellow
}
$pass | npx --yes wrangler secret put ADMIN_PASSPHRASE
if ($LASTEXITCODE -ne 0) { throw "secret put failed" }

Step "API keys"
# Neither OpenAI nor ElevenLabs offers OAuth for API keys, so: open their key page in the browser
# (you sign in there), create a key, copy it, and the script reads it from the clipboard.
function Get-KeyViaBrowser($name, $url, $pattern) {
  $a = Read-Host "`n$name key: [Enter] open browser and use clipboard, [p] paste manually, [s] skip/keep"
  if ($a -eq "s") { return "" }
  if ($a -eq "p") { return Plain (Read-Host "$name key" -AsSecureString) }
  Start-Process $url
  Write-Host "Sign in, create a key, copy it (Ctrl+C)." -ForegroundColor Yellow
  while ($true) {
    if ((Read-Host "Press Enter once copied (or type s to skip)") -eq "s") { return "" }
    $clip = (Get-Clipboard -Raw)
    if ($clip) { $clip = $clip.Trim() }
    if ($clip -and $clip -match $pattern) { Set-Clipboard -Value " "; Write-Host "Got $name key from clipboard (clipboard cleared)."; return $clip }
    Write-Host "Clipboard doesn't look like a $name key. Copy it again." -ForegroundColor Red
  }
}
$openai = Get-KeyViaBrowser "OpenAI" "https://platform.openai.com/api-keys" '^sk-[\w-]{20,}$'
$eleven = Get-KeyViaBrowser "ElevenLabs" "https://elevenlabs.io/app/settings/api-keys" '^[\w-]{20,}$'
$body = @{}
if ($openai) { $body.openai = $openai }
if ($eleven) { $body.elevenlabs = $eleven }
if ($body.Count) {
  $res = $null
  for ($i = 1; $i -le 5 -and -not $res; $i++) {
    try {
      $res = Invoke-RestMethod -ErrorAction Stop -Method Put -Uri "$BaseUrl/api/keys" -ContentType "application/json" `
        -Headers @{ Authorization = "Bearer $pass" } -Body ($body | ConvertTo-Json)
    } catch { Write-Host "  attempt $i failed ($($_.Exception.Message)); waiting for the route to go live..."; Start-Sleep 5 }
  }
  if (-not $res) { throw "Could not store keys. Check the route and passphrase, then re-run." }
  Write-Host "Stored: $($res | ConvertTo-Json -Compress)"
} else { Write-Host "No keys entered, nothing uploaded." }

Step "Status"
Invoke-RestMethod "$BaseUrl/api/status" | ConvertTo-Json -Compress
Write-Host "`nDone. Rotate a key later by re-running this script." -ForegroundColor Green
