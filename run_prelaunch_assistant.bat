@echo off
setlocal
cd /d "%~dp0"

set "PORT=8769"
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

powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:%PORT%/shutdown' -TimeoutSec 2 | Out-Null; Start-Sleep -Milliseconds 700 } catch {}" >nul 2>nul

for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:"127\.0\.0\.1:%PORT% .*LISTENING"') do (
  if not "%%P"=="0" taskkill /PID %%P /F >nul 2>nul
)

call %PYTHON_CMD% "%~dp0local_prelaunch_assistant.py"
