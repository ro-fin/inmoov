@echo off
setlocal
set "ARM_PAGE=%~dp0arm_calibrator.html"
if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" (
  start "" "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" --app="file:///%ARM_PAGE:\=/%"
) else (
  start "" "%ARM_PAGE%"
)
