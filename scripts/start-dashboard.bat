@echo off
REM ============================================================================
REM  BlackSand dashboard - EXAMPLE local startup (edit before use)
REM
REM  Manual convenience only. This file is NOT installed or run automatically.
REM  Boot sequence: (1) start the Node/Express server, (2) wait a few seconds,
REM  (3) open Microsoft Edge in fullscreen kiosk mode.
REM
REM  To auto-run at login, either drop a SHORTCUT to this file in the Windows
REM  Startup folder (Win+R -> shell:startup), or create a Task Scheduler task
REM  "At log on". See README.md -> AUTOMATIC STARTUP. Do not add a service/PM2.
REM ============================================================================

REM --- EDIT THESE --------------------------------------------------------------
REM  Address the kiosk browser opens. On the SERVER PC itself, localhost is fine.
REM  On a separate TV, point that TV's browser at this PC's LAN IP instead
REM  (see README.md -> FINDING THE WINDOWS IP), e.g. 192.168.1.50 .
set "DASH_HOST=localhost"
set "DASH_PORT=3000"

REM  Which project this screen shows: business-address  OR  town-center
set "DASH_PROJECT=business-address"

REM  If msedge.exe is not on PATH, put its full path here (keep the quotes), e.g.
REM  set "EDGE=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
set "EDGE=msedge.exe"
REM -----------------------------------------------------------------------------

REM Change to the project folder = the folder ABOVE this script (portable; no
REM machine-specific absolute path baked in).
cd /d "%~dp0.."

REM 1) Start the Express server in its own window (leave it running).
start "BlackSand Dashboard Server" cmd /k "npm start"

REM 2) Give the server a few seconds to come up before the browser connects.
timeout /t 5 /nobreak >nul

REM 3) Launch Edge in fullscreen kiosk mode at the chosen project URL.
start "" "%EDGE%" --kiosk "http://%DASH_HOST%:%DASH_PORT%/?project=%DASH_PROJECT%" --edge-kiosk-type=fullscreen --no-first-run

REM Note: during testing, Alt+F4 exits Edge kiosk mode.
