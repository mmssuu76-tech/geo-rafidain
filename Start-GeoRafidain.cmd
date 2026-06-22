@echo off
chcp 65001 >nul
title GeoRafidain Local Server
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0local-server.ps1"
pause
