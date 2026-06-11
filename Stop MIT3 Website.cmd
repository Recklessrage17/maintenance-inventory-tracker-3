@echo off
title Stop MIT3 Website
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop-mit3-website.ps1"
pause
