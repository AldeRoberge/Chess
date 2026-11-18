@echo off
title chess-experience
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-chess.ps1"
if errorlevel 1 pause
