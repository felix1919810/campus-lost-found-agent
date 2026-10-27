@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
where node.exe >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 or newer is required. Download: https://nodejs.org/
  pause
  exit /b 1
)
if not exist "node_modules\" (
  call npm.cmd ci
  if errorlevel 1 (
    echo Dependency installation failed. Check your network and try again.
    pause
    exit /b 1
  )
)
if not exist ".env" copy /y ".env.example" ".env" >nul
echo Starting Xunhui. Open the local URL printed below in your browser.
echo To stop the server, press Ctrl+C, then close this window.
call npm.cmd start
pause
endlocal
