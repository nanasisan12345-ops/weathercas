@echo off
setlocal
cd /d "%~dp0"
set "npm_config_cache=%~dp0Data\cache\npm"
set "NODE_USE_SYSTEM_CA=1"
set "TEMP=%~dp0Data\temp"
set "TMP=%~dp0Data\temp"
if not exist "%TEMP%" mkdir "%TEMP%"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22.12 or later is required. See README.md.
  pause
  exit /b 1
)
if not exist node_modules (
  call npm ci --no-audit --no-fund
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
call npm run dev -- --open
pause
