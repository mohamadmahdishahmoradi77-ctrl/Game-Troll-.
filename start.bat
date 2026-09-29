@echo off
echo ========================================
echo        GAME TROLL SERVER
echo ========================================
echo.
echo Installing dependencies...
call npm install
if errorlevel 1 (
  echo.
  echo npm install failed. Make sure Node.js 20+ is installed.
  pause
  exit /b 1
)
echo.
echo Starting GAME TROLL...
call npm start
pause
