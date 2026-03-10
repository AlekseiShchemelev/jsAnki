@echo off
chcp 65001 >nul
echo ======================================
echo   Anki JS Cards - Local Server
echo ======================================
echo.

echo Проверка Python...
python --version >nul 2>&1
if %errorlevel% == 0 (
    echo ✓ Python найден
    echo.
    echo Запуск сервера на http://localhost:8000
    echo Нажмите Ctrl+C для остановки
    echo.
    python -m http.server 8000
    goto :end
)

echo ✗ Python не найден
echo.
echo Проверка Node.js...
node --version >nul 2>&1
if %errorlevel% == 0 (
    echo ✓ Node.js найден
    echo.
    echo Запуск сервера на http://localhost:3000
    echo Нажмите Ctrl+C для остановки
    echo.
    npx serve . -l 3000
    goto :end
)

echo ✗ Node.js не найден
echo.
echo Установите Python (https://python.org) или Node.js (https://nodejs.org)
echo Или откройте index.html напрямую в браузере (PWA функции будут ограничены)
echo.
pause

:end
