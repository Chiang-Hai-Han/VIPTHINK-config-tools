@echo off
setlocal
cd /d "%~dp0"

set "PORT=8769"
set "PYTHON_EXE=C:\Users\jianghaihan\AppData\Local\Programs\Python\Python312\python.exe"

rem Ask an already-running assistant to exit cleanly first.
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:%PORT%/shutdown' -TimeoutSec 2 | Out-Null; Start-Sleep -Milliseconds 700 } catch {}" >nul 2>nul

rem If the port is still occupied, clear the stale listener so restart is reliable.
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:"127\.0\.0\.1:%PORT% .*LISTENING"') do (
  if not "%%P"=="0" taskkill /PID %%P /F >nul 2>nul
)

"%PYTHON_EXE%" "%~dp0local_prelaunch_assistant.py"
