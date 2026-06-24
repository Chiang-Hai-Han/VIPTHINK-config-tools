@echo off
setlocal

set "PYTHON_CMD="

python --version >nul 2>nul && set "PYTHON_CMD=python"
if not defined PYTHON_CMD (
  py -3 --version >nul 2>nul && set "PYTHON_CMD=py -3"
)
if not defined PYTHON_CMD (
  echo [ERROR] Python was not found.
  pause
  exit /b 1
)

echo ========================================
echo Topic Video Assistant
echo ========================================
echo 1. Start local assistant on port 8771.
echo 2. In Chrome, open chrome://extensions
echo 3. Load unpacked extension folder:
echo    chrome_extension_topic_video
echo 4. Refresh the backend page once.
echo 5. Open the extension and start batch copy.
echo ========================================
echo.

call %PYTHON_CMD% "%~dp0local_topic_video_assistant.py"
pause
