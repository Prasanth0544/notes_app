@echo off
cd /d "%~dp0"
echo Starting NoteVault...
start "NoteVault Server" python server.py
timeout /t 2 /nobreak > NUL
start "" "http://127.0.0.1:5000"
