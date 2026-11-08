@echo off
REM Instalator zaleznosci Cyberpunk TCG AI (Windows). Uruchom dwuklikiem.
cd /d "%~dp0"
echo.
echo === Cyberpunk TCG AI - instalacja ===
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo [BLAD] Nie znaleziono Node.js.
  echo Zainstaluj Node.js LTS ze strony https://nodejs.org ^(przycisk "LTS"^),
  echo zamknij to okno i uruchom instaluj.bat ponownie.
  echo.
  pause
  exit /b 1
)
for /f "tokens=1 delims=v." %%a in ('node -v') do set NODE_MAJOR=%%a
if %NODE_MAJOR% LSS 22 (
  echo [BLAD] Masz Node.js w wersji %NODE_MAJOR%, potrzebna jest 22 lub nowsza.
  echo Zainstaluj aktualne LTS ze strony https://nodejs.org
  pause
  exit /b 1
)
echo [OK] Node.js:
node -v
where pnpm >nul 2>nul
if errorlevel 1 (
  echo Instaluje pnpm...
  call npm install -g pnpm@10
  if errorlevel 1 (
    echo [BLAD] Nie udalo sie zainstalowac pnpm.
    pause
    exit /b 1
  )
)
echo [OK] pnpm:
call pnpm -v
echo.
echo Instaluje zaleznosci projektu (to moze potrwac minute)...
call pnpm install
if errorlevel 1 (
  echo [BLAD] pnpm install sie nie powiodl - skopiuj komunikat powyzej i wyslij go.
  pause
  exit /b 1
)
echo Buduje interfejs...
call pnpm build
echo.
echo Pobieram obrazki kart (mozna przerwac Ctrl+C - dociagna sie w trakcie gry)...
call pnpm images
echo.
echo === Gotowe! ===
echo Uruchom gre:  start.bat  (dwuklik)
echo.
pause
