@echo off
setlocal

set "PYTHON_CMD="

python --version >nul 2>nul && set "PYTHON_CMD=python"

if not defined PYTHON_CMD (
  py -3 --version >nul 2>nul && set "PYTHON_CMD=py -3"
)

if not defined PYTHON_CMD if exist "%LocalAppData%\Programs\Python\Python312\python.exe" (
  set "PYTHON_CMD=%LocalAppData%\Programs\Python\Python312\python.exe"
)

if not defined PYTHON_CMD if exist "%LocalAppData%\Programs\Python\Python314\python.exe" (
  set "PYTHON_CMD=%LocalAppData%\Programs\Python\Python314\python.exe"
)

if not defined PYTHON_CMD (
  echo [ERROR] Python was not found.
  echo Please install Python or add py/python to PATH.
  pause
  exit /b 1
)

echo ========================================
echo Chapter Config Assistant
echo ========================================
echo.
echo 1. Start local assistant on port 8768.
echo 2. In Chrome, open chrome://extensions
echo 3. Load unpacked extension folder:
echo    chrome_extension_chapter_test
echo 4. Refresh the courseware page once.
echo 5. Open the extension and start config.
echo.
echo Edit the Excel file first, then run config.
echo ========================================
echo.
call %PYTHON_CMD% "%~dp0local_chapter_config_assistant.py"
pause
