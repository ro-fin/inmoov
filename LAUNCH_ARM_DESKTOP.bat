@echo off
setlocal
title RoboAttis InMoov Studio
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0launch_studio.ps1"
if errorlevel 1 pause
