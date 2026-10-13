@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0launch_studio.ps1" -NoBrowser -PairOnly
pause
