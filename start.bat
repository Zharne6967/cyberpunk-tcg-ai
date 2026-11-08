@echo off
REM Cyberpunk TCG AI - uruchomienie. Kliknij dwa razy.
cd /d "%~dp0"
title Cyberpunk TCG AI
where node >nul 2>nul
if errorlevel 1 (
  echo [BLAD] Nie znaleziono Node.js. Zainstaluj Node.js LTS z https://nodejs.org i uruchom ponownie.
  pause
  exit /b 1
)
where pnpm >nul 2>nul
if errorlevel 1 (
  echo Instaluje pnpm...
  call npm install -g pnpm@10
)
if not exist node_modules (
  echo Pierwsze uruchomienie - instaluje zaleznosci...
  call pnpm install
  if errorlevel 1 (
    echo [BLAD] pnpm install sie nie powiodl.
    pause
    exit /b 1
  )
)
echo Buduje interfejs...
call pnpm build >nul
if errorlevel 1 (
  echo [BLAD] Budowanie interfejsu sie nie powiodlo. Uruchom "pnpm build" w terminalu, aby zobaczyc szczegoly.
  pause
  exit /b 1
)
echo.
echo Otwieram przegladarke: http://localhost:5177
start "" cmd /c "timeout /t 3 /nobreak >nul & start http://localhost:5177"
call pnpm start
pause
