@echo off
rem Install (first run), start and watch this repo's self-hosted GitHub Actions runner on this PC.
rem It runs the shared setup-runner.ps1 from github-self-hosted-runner-tools, cloned next to this repo
rem (it is cloned there on the first run). That script asks for administrator rights, registers the
rem runner as a Windows service with a token from gh, checks it is online, then follows the live job log.
rem   start-runner.bat              install or verify, then follow the job log
rem   start-runner.bat -Reinstall   remove and register the runner again
rem   start-runner.bat -NoLogs      verify only
rem Needs gh (logged in with admin rights on the repo), git and node.
setlocal
cd /d "%~dp0"
title GitHub runner
set "TOOLS=%~dp0..\github-self-hosted-runner-tools"
set "RC=0"

where gh >nul 2>&1
if errorlevel 1 (
  echo GitHub CLI ^(gh^) not found. Install it, run "gh auth login", then try again.
  set "RC=1"
)

if "%RC%"=="0" if not exist "%TOOLS%\setup-runner.ps1" (
  echo Getting the runner tools into %TOOLS% ...
  gh repo clone AldeRoberge/github-self-hosted-runner-tools "%TOOLS%"
  if errorlevel 1 set "RC=1"
) else (
  git -C "%TOOLS%" pull --ff-only --quiet 2>nul
  if errorlevel 1 echo Could not update the runner tools. Using the copy already there.
)

if "%RC%"=="0" (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%TOOLS%\setup-runner.ps1" %*
  if errorlevel 1 set "RC=1"
)

if not "%RC%"=="0" (
  echo.
  echo   Read the message above, fix it, then run start-runner.bat again.
  pause
)
exit /b %RC%
