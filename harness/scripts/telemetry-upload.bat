@echo off
:: Titan telemetry uploader — wraps Node script for the Windows Scheduled Task.
:: Called every 4 h by the task that install-telemetry-task.bat registers.
:: Argument: <workspace-path>
::
:: Exits 0 always — never fail the scheduled task.

setlocal

if "%~1"=="" (
    echo Usage: telemetry-upload.bat ^<workspace-path^>
    exit /b 0
)

set "SCRIPT_DIR=%~dp0"
set "UPLOADER=%SCRIPT_DIR%telemetry-upload.js"
set "ARG_WORKSPACE=%~1"

:: Self-heal against path drift. The scheduled task's workspace argument is a
:: snapshot taken at install-telemetry-task.bat registration time — if the
:: workspace folder is later moved, renamed, or the repo is re-cloned to a new
:: path, that argument goes stale and uploads silently target the wrong (or a
:: since-deleted) folder forever, with no error surfaced anywhere. This script's
:: own file location can't go stale — it's always <workspace>\.claude\scripts\
:: — so derive the real workspace from %~dp0 and prefer it over the argument.
for %%I in ("%SCRIPT_DIR%..\..") do set "DERIVED_WORKSPACE=%%~fI"

set "WORKSPACE=%ARG_WORKSPACE%"
if /I not "%DERIVED_WORKSPACE%"=="%ARG_WORKSPACE%" (
    set "WORKSPACE=%DERIVED_WORKSPACE%"
    if exist "%DERIVED_WORKSPACE%\.claude\telemetry" (
        >>"%DERIVED_WORKSPACE%\.claude\telemetry\upload.log" echo [%DATE% %TIME%] Self-heal: task arg "%ARG_WORKSPACE%" != actual location "%DERIVED_WORKSPACE%" — using actual location and re-registering task.
    )
    if exist "%SCRIPT_DIR%install-telemetry-task.bat" (
        call "%SCRIPT_DIR%install-telemetry-task.bat" "%DERIVED_WORKSPACE%" >nul 2>&1
    )
)

if not exist "%UPLOADER%" (
    echo Uploader script not found: %UPLOADER%
    exit /b 0
)

where node >nul 2>&1
if errorlevel 1 (
    echo Node.js not on PATH — telemetry uploader skipped.
    exit /b 0
)

node "%UPLOADER%" "%WORKSPACE%"
exit /b 0
