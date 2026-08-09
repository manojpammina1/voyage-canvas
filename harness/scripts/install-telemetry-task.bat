@echo off
:: Titan — registers a Windows Scheduled Task to upload telemetry every 4 h.
:: Runs as the current user (no admin required). Idempotent — safe to re-run.
:: One fixed task per machine, running against whichever workspace this
:: installer/self-heal call was invoked for.
::
:: Args:
::   %1  workspace path  (e.g. C:\codebase\ecom-webapp)
::   %2  (optional)      interval in minutes  default 240 (4 h)

setlocal

if "%~1"=="" (
    echo Usage: install-telemetry-task.bat ^<workspace-path^> [interval-minutes]
    exit /b 1
)

set "WORKSPACE=%~1"
set "INTERVAL=%~2"
if "%INTERVAL%"=="" set "INTERVAL=240"

set "SCRIPT_DIR=%~dp0"
set "UPLOADER_BAT=%SCRIPT_DIR%telemetry-upload.bat"
set "TASK_NAME=Titan-Telemetry-Upload"

if not exist "%UPLOADER_BAT%" (
    echo telemetry-upload.bat missing: %UPLOADER_BAT%
    exit /b 1
)

:: Remove existing task if present (idempotency).
schtasks /Query /TN "%TASK_NAME%" >nul 2>&1
if not errorlevel 1 (
    echo Removing existing scheduled task %TASK_NAME%...
    schtasks /Delete /TN "%TASK_NAME%" /F >nul 2>&1
)

:: Create the task. /SC MINUTE /MO %INTERVAL% — every N minutes.
:: /F overwrites without prompt. /RL LIMITED — runs without admin.
schtasks /Create ^
    /TN "%TASK_NAME%" ^
    /TR "\"%UPLOADER_BAT%\" \"%WORKSPACE%\"" ^
    /SC MINUTE ^
    /MO %INTERVAL% ^
    /RL LIMITED ^
    /F

if errorlevel 1 (
    echo Failed to register scheduled task.
    exit /b 1
)

echo Scheduled task %TASK_NAME% registered for %WORKSPACE%. Telemetry uploads every %INTERVAL% minute(s).
exit /b 0
