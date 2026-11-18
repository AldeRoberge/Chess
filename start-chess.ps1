# chess-experience launcher: preflight, auto-fix, dev server, browser.
# ASCII-only on purpose (Windows PowerShell 5.1 reads BOM-less files as ANSI); icons are built from code points.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}
$Host.UI.RawUI.WindowTitle = 'chess-experience'

$LogDir   = Join-Path $env:TEMP 'chess-experience'
New-Item -ItemType Directory -Force $LogDir | Out-Null
$ServerLog = Join-Path $LogDir 'dev-server.log'
$TaskLog   = Join-Path $LogDir 'task.log'

$OK   = [string][char]0x2714   # check
$BAD  = [string][char]0x2718   # cross
$WARN = [string][char]0x26A0   # warning
$ARW  = [string][char]0x25B8   # arrow
$DOT  = [string][char]0x25CF   # dot
$SPIN = 0x280B,0x2819,0x2839,0x2838,0x283C,0x2834,0x2826,0x2827,0x2807,0x280F | ForEach-Object { [string][char]$_ }

function Show-Banner {
    Clear-Host
    $art = @'

   ____ _   _ _____ ____ ____
  / ___| | | | ____/ ___/ ___|
 | |   | |_| |  _| \___ \___ \
 | |___|  _  | |___ ___) |__) |
  \____|_| |_|_____|____/____/
'@
    Write-Host $art -ForegroundColor Cyan
    Write-Host '   E X P E R I E N C E' -ForegroundColor White -NoNewline
    Write-Host '   nodal real-time chess table' -ForegroundColor DarkGray
    Write-Host ('  ' + ('-' * 56)) -ForegroundColor DarkGray
    Write-Host ''
}

function Ok($m)   { Write-Host "  $OK " -ForegroundColor Green -NoNewline;  Write-Host $m }
function Bad($m)  { Write-Host "  $BAD " -ForegroundColor Red -NoNewline;   Write-Host $m }
function Warn($m) { Write-Host "  $WARN " -ForegroundColor Yellow -NoNewline; Write-Host $m -ForegroundColor Yellow }
function Info($m) { Write-Host "  $ARW " -ForegroundColor Cyan -NoNewline;  Write-Host $m -ForegroundColor Gray }

# Run "cmd /c <command>" hidden with an animated spinner. Returns the exit code; output goes to $TaskLog.
function Invoke-Task([string]$Label, [string]$Command) {
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $p = Start-Process -FilePath 'cmd.exe' -ArgumentList "/c $Command" -WindowStyle Hidden -PassThru `
         -RedirectStandardOutput $TaskLog -RedirectStandardError "$TaskLog.err"
    $i = 0
    while (-not $p.HasExited) {
        Write-Host ("`r  {0} {1} ({2:N0}s)   " -f $SPIN[$i % $SPIN.Count], $Label, $sw.Elapsed.TotalSeconds) -ForegroundColor Cyan -NoNewline
        $i++; Start-Sleep -Milliseconds 90
    }
    Write-Host ("`r" + (' ' * 78) + "`r") -NoNewline
    $p.WaitForExit()
    return $p.ExitCode
}

function Show-LogTail([string]$Path, [int]$Lines = 8) {
    if (Test-Path $Path) {
        Get-Content $Path -Tail $Lines -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "      $_" -ForegroundColor DarkGray }
    }
}

function Test-PortFree([int]$Port) {
    try {
        $c = New-Object Net.Sockets.TcpClient
        $r = $c.BeginConnect('127.0.0.1', $Port, $null, $null)
        $busy = $r.AsyncWaitHandle.WaitOne(250) -and $c.Connected
        $c.Close()
        return -not $busy
    } catch { return $true }
}

function Stop-Tree($Proc) {
    if ($Proc -and -not $Proc.HasExited) { & taskkill /PID $Proc.Id /T /F 2>&1 | Out-Null }
}

function Fail([string]$Msg, [string]$Hint) {
    Write-Host ''
    Bad $Msg
    if ($Hint) { Info $Hint }
    Write-Host ''
    Write-Host "  Logs: $LogDir" -ForegroundColor DarkGray
    exit 1
}

Show-Banner

# ---- 1. Node / npm ---------------------------------------------------------
Write-Host '  Preflight' -ForegroundColor White
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Warn 'Node.js not found.'
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if ($winget) {
        Info 'Auto-fix: installing Node.js LTS with winget...'
        $code = Invoke-Task 'Installing Node.js LTS' 'winget install -e --id OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements'
        $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
        $node = Get-Command node -ErrorAction SilentlyContinue
        if ($code -ne 0 -or -not $node) { Fail 'Could not install Node.js automatically.' 'Install it from https://nodejs.org then run this again.' }
    } else {
        Fail 'Node.js is required.' 'Install it from https://nodejs.org then run this again.'
    }
}
$nodeVer = (& node --version).Trim()
$major = [int](($nodeVer -replace '^v','').Split('.')[0])
if ($major -lt 20) { Warn "Node $nodeVer is old; Node 20+ is recommended." } else { Ok "Node $nodeVer" }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { Fail 'npm not found.' 'Reinstall Node.js (it bundles npm).' }
Ok ('npm ' + (& cmd /c 'npm --version').Trim())

# ---- 2. Dependencies (with escalating auto-fix) ----------------------------
function Test-Deps { (Test-Path 'node_modules/vite') -and (Test-Path 'node_modules/chess.js') -and (Test-Path 'node_modules/.bin') }

function Install-Deps {
    $steps = @(
        @{ Label = 'Installing dependencies';                    Cmd = 'npm install --no-audit --no-fund' },
        @{ Label = 'Auto-fix 1/2: verifying npm cache + retry';  Cmd = 'npm cache verify && npm install --no-audit --no-fund' },
        @{ Label = 'Auto-fix 2/2: clean reinstall';              Cmd = 'rmdir /s /q node_modules & npm install --no-audit --no-fund' }
    )
    foreach ($s in $steps) {
        $code = Invoke-Task $s.Label $s.Cmd
        if ($code -eq 0 -and (Test-Deps)) { return $true }
        Warn "$($s.Label) failed (exit $code)"
        Show-LogTail "$TaskLog.err" 4
    }
    return $false
}

if (Test-Deps) {
    Ok 'Dependencies present'
} else {
    if (-not (Install-Deps)) { Fail 'Dependency install failed.' "Check your network/proxy, then run: npm install  (log: $TaskLog.err)" }
    Ok 'Dependencies installed'
}

# ---- 3. Stockfish (optional) ----------------------------------------------
if (Test-Path 'public/stockfish') {
    Ok 'Stockfish engine ready'
} else {
    $code = Invoke-Task 'Setting up Stockfish' 'npm run setup:stockfish'
    if ($code -eq 0 -and (Test-Path 'public/stockfish')) { Ok 'Stockfish engine ready' }
    else { Warn 'Stockfish setup failed; a weaker fallback engine will play instead.' }
}

# ---- 4. Port ---------------------------------------------------------------
$port = 5173
while (-not (Test-PortFree $port) -and $port -lt 5190) { $port++ }
if ($port -ne 5173) { Warn "Port 5173 busy; using $port instead." } else { Ok "Port $port free" }
if (-not (Test-PortFree $port)) { Fail 'No free port between 5173 and 5190.' 'Close other dev servers and retry.' }

# ---- 5. Dev server (one auto-fix retry) ------------------------------------
function Start-Server([int]$Port) {
    if (Test-Path $ServerLog) { Remove-Item $ServerLog -Force -ErrorAction SilentlyContinue }
    $p = Start-Process -FilePath 'cmd.exe' -ArgumentList "/c npm run dev -- --port $Port --strictPort" -WindowStyle Hidden -PassThru `
         -RedirectStandardOutput $ServerLog -RedirectStandardError "$ServerLog.err"
    $sw = [Diagnostics.Stopwatch]::StartNew(); $i = 0
    while ($sw.Elapsed.TotalSeconds -lt 90) {
        if ($p.HasExited) { return @{ Proc = $p; Ready = $false } }
        try {
            $r = Invoke-WebRequest -Uri "http://localhost:$Port/" -UseBasicParsing -TimeoutSec 2
            if ($r.StatusCode -eq 200) { Write-Host ("`r" + (' ' * 78) + "`r") -NoNewline; return @{ Proc = $p; Ready = $true } }
        } catch {}
        Write-Host ("`r  {0} Starting dev server ({1:N0}s)   " -f $SPIN[$i % $SPIN.Count], $sw.Elapsed.TotalSeconds) -ForegroundColor Cyan -NoNewline
        $i++; Start-Sleep -Milliseconds 200
    }
    Write-Host ("`r" + (' ' * 78) + "`r") -NoNewline
    return @{ Proc = $p; Ready = $false }
}

$srv = Start-Server $port
if (-not $srv.Ready) {
    Stop-Tree $srv.Proc
    Warn 'Dev server did not start.'
    Show-LogTail "$ServerLog.err" 5
    Info 'Auto-fix: clean reinstall of dependencies, then retry...'
    if (Test-Path node_modules) { & cmd /c 'rmdir /s /q node_modules' | Out-Null }
    if (-not (Install-Deps)) { Fail 'Reinstall failed.' "See $TaskLog.err" }
    $srv = Start-Server $port
    if (-not $srv.Ready) {
        Stop-Tree $srv.Proc
        Show-LogTail $ServerLog 10
        Show-LogTail "$ServerLog.err" 10
        Fail 'Dev server still will not start.' "Full logs in $LogDir"
    }
}

$url = "http://localhost:$port"
Ok "Dev server running"
Write-Host ''
Write-Host '  ' -NoNewline
Write-Host " $DOT LIVE " -ForegroundColor Black -BackgroundColor Green -NoNewline
Write-Host "  $url" -ForegroundColor White
Write-Host '  Ctrl+C to stop.' -ForegroundColor DarkGray
Write-Host ('  ' + ('-' * 56)) -ForegroundColor DarkGray
try { Start-Process $url } catch { Warn "Could not open a browser; open $url yourself." }

# ---- 6. Live server log until exit -----------------------------------------
try {
    $fs = New-Object IO.FileStream($ServerLog, 'Open', 'Read', 'ReadWrite')
    $rd = New-Object IO.StreamReader($fs)
    while (-not $srv.Proc.HasExited) {
        while (($line = $rd.ReadLine()) -ne $null) {
            $clean = $line -replace ([string][char]27 + '\[[0-9;]*[A-Za-z]'), ''
            $color = 'DarkGray'
            if ($clean -match 'error|failed') { $color = 'Red' } elseif ($clean -match 'warn') { $color = 'Yellow' } elseif ($clean -match 'hmr|update') { $color = 'Cyan' }
            Write-Host "  $clean" -ForegroundColor $color
        }
        Start-Sleep -Milliseconds 300
    }
    Warn 'Dev server stopped unexpectedly.'
    Show-LogTail "$ServerLog.err" 8
} finally {
    Stop-Tree $srv.Proc
    if ($rd) { $rd.Close() }
    Write-Host ''
    Info 'Server stopped. Bye.'
}
