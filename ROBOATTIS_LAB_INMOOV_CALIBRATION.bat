@echo off
setlocal
title RoboAttis Lab - InMoov Servo Calibration Tool
color 0A

set "TOOL_DIR=%~dp0"
if "%TOOL_DIR:~-1%"=="\" set "TOOL_DIR=%TOOL_DIR:~0,-1%"
set "TOOL_FILE=%TOOL_DIR%\nano_calibrator.html"
set "DETECTED_PORT=unknown"
for /f "usebackq delims=" %%P in (`powershell.exe -NoProfile -Command "$p=Get-CimInstance Win32_SerialPort | Where-Object {$_.Name -match 'Arduino|USB|CH340|CP210'} | Select-Object -First 1 -ExpandProperty DeviceID; if($p){$p}"`) do set "DETECTED_PORT=%%P"

echo ============================================================
echo       ROBOATTIS LAB - INMOOV SERVO CALIBRATION TOOL
echo ============================================================
echo.
echo Safety: use an external servo supply with common ground.
echo Start with one unloaded servo and conservative limits.
echo.

if not exist "%TOOL_FILE%" goto :missing_tool
if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" (
  start "" "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" --app="file:///%TOOL_FILE:\=/%?detectedPort=%DETECTED_PORT%"
) else if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
  start "" "%ProgramFiles%\Google\Chrome\Application\chrome.exe" --app="file:///%TOOL_FILE:\=/%?detectedPort=%DETECTED_PORT%"
) else (
  start "" "%TOOL_FILE%"
)
exit /b 0

:missing_tool
echo ERROR: Calibration interface not found:
echo %TOOL_FILE%
pause
exit /b 1
